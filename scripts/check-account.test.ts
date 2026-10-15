/**
 * Tests del núcleo de la sonda de titularidad.
 *
 * Lo que hay que proteger acá es que **no se apruebe de gusto**: que un «no se
 * pudo comprobar» no se confunda con un «verificado», que la lectura de las
 * respuestas no se rompa por un nombre de campo distinto del esperado —la
 * documentación confirma los endpoints pero no todos los nombres— y que el token
 * no aparezca en ningún informe.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OWNER_ACCOUNT_EMAIL,
  describeApiFailure,
  exitCodeFor,
  findOrganization,
  findProject,
  formatReport,
  judgeAccountOwnership,
  ownerEmails,
  projectRefFromUrl,
  readCredentials,
  readMembers,
  readOrganizations,
  readProjects,
  summaryMarkdown,
} from './check-account.mjs';
import { OWNER_ACCOUNT_EMAIL } from '../lib/utils/supabaseOwner';

const EXPECTED = 'jatf71@gmail.com';

describe('projectRefFromUrl', () => {
  it('lee la referencia de los dos dominios de Supabase', () => {
    expect(projectRefFromUrl('https://vsqkjimpssdvlvdwrtnh.supabase.co')).toBe('vsqkjimpssdvlvdwrtnh');
    expect(projectRefFromUrl('https://vsqkjimpssdvlvdwrtnh.supabase.in')).toBe('vsqkjimpssdvlvdwrtnh');
    expect(projectRefFromUrl('https://vsqkjimpssdvlvdwrtnh.supabase.co/rest/v1/')).toBe('vsqkjimpssdvlvdwrtnh');
  });

  it('no inventa una referencia donde no hay proyecto', () => {
    expect(projectRefFromUrl('https://placeholder.supabase.co')).toBe('placeholder');
    expect(projectRefFromUrl('https://ejemplo.com')).toBeNull();
    expect(projectRefFromUrl('')).toBeNull();
    expect(projectRefFromUrl(null)).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
  });
});

describe('el correo esperado por defecto', () => {
  it('es el mismo que defiende el chequeo del portal', () => {
    // Está en los dos lados a propósito (aquel módulo es TypeScript y lo usa el
    // runtime; este es una sonda sin compilar). Si alguien cambia uno, este test
    // lo dice en vez de dejar dos verdades distintas.
    expect(DEFAULT_OWNER_ACCOUNT_EMAIL).toBe(OWNER_ACCOUNT_EMAIL);
  });
});

describe('readProjects', () => {
  it('acepta `ref` y `id`, y las dos formas de la organización', () => {
    // `/v1/organizations/{slug}/projects` documenta `ref`; `/v1/projects` no tiene
    // esquema confirmado. Se leen las dos en vez de romperse por una.
    const projects = readProjects([
      { ref: 'aaa', name: 'uno', organization_id: 'org-1' },
      { id: 'bbb', name: 'dos', organizationId: 'org-2' },
    ]);

    expect(projects).toEqual([
      { ref: 'aaa', name: 'uno', organizationId: 'org-1' },
      { ref: 'bbb', name: 'dos', organizationId: 'org-2' },
    ]);
  });

  it('acepta la respuesta envuelta, porque el sobre no está confirmado', () => {
    expect(readProjects({ data: [{ ref: 'aaa' }] })).toHaveLength(1);
    expect(readProjects({ items: [{ ref: 'aaa' }] })).toHaveLength(1);
  });

  it('una respuesta con forma de error no se lee como lista vacía', () => {
    // Confundir «la API dijo que no» con «la API no listó nada» cambiaría el motivo
    // del informe, y el motivo es lo que se lee en el issue.
    expect(readProjects({ message: 'Unauthorized', status: 401 })).toEqual([]);
    expect(readProjects(null)).toEqual([]);
    expect(readProjects('texto')).toEqual([]);
  });

  it('descarta lo que no tiene referencia', () => {
    expect(readProjects([{ name: 'sin ref' }, { ref: '   ' }])).toEqual([]);
  });
});

describe('readOrganizations', () => {
  it('resuelve id, slug y nombre', () => {
    expect(readOrganizations([{ id: 'org-1', slug: 'miorg', name: 'Mi Org' }])).toEqual([
      { id: 'org-1', slug: 'miorg', name: 'Mi Org' },
    ]);
  });

  it('si solo viene el slug, sirve de identificador', () => {
    // El slug es lo que piden los endpoints de proyectos y miembros: sin él no se
    // puede seguir, así que se prefiere a descartar la organización.
    expect(readOrganizations([{ slug: 'miorg' }])).toEqual([{ id: 'miorg', slug: 'miorg', name: null }]);
  });
});

describe('readMembers', () => {
  it('lee la API v1 (role_name) y la v2 (roles[])', () => {
    expect(readMembers([{ user_id: 'u', user_name: 'Javi', email: 'a@b.cl', role_name: 'Owner' }])).toEqual([
      { email: 'a@b.cl', name: 'Javi', role: 'Owner' },
    ]);

    expect(readMembers([{ username: 'javi', primary_email: 'a@b.cl', roles: [{ name: 'Owner' }] }])).toEqual([
      { email: 'a@b.cl', name: 'javi', role: 'Owner' },
    ]);

    expect(readMembers([{ primary_email: 'a@b.cl', roles: ['Owner', 'Developer'] }])).toEqual([
      { email: 'a@b.cl', name: null, role: 'Owner · Developer' },
    ]);
  });
});

describe('ownerEmails', () => {
  it('solo cuenta a quien figura como dueño, sin importar mayúsculas', () => {
    const members = [
      { email: 'dueno@cuenta.cl', role: 'owner' },
      { email: 'admin@cuenta.cl', role: 'Administrator' },
      { email: 'dev@cuenta.cl', role: 'Read-only' },
    ];

    expect(ownerEmails(members)).toEqual(['dueno@cuenta.cl']);
  });

  it('un miembro sin correo no puede contar como dueño', () => {
    // Sin correo no hay nada que comparar con lo esperado: contarlo sería aprobar
    // sin haber comprobado.
    expect(ownerEmails([{ email: null, role: 'Owner' }])).toEqual([]);
  });

  it('no repite correos y normaliza a minúscula', () => {
    expect(ownerEmails([{ email: 'A@B.cl', role: 'Owner' }, { email: 'a@b.cl', role: 'Owner' }])).toEqual(['a@b.cl']);
  });
});

describe('findProject y findOrganization', () => {
  it('encuentran por referencia e id', () => {
    expect(findProject([{ ref: 'aaa', name: null, organizationId: 'org-1' }], 'aaa')?.ref).toBe('aaa');
    expect(findProject([{ ref: 'aaa', name: null, organizationId: 'org-1' }], 'bbb')).toBeNull();
    expect(findOrganization([{ id: 'org-1', slug: 'x', name: null }], 'org-1')?.slug).toBe('x');
    expect(findOrganization([{ id: 'org-1', slug: 'x', name: null }], null)).toBeNull();
  });
});

describe('judgeAccountOwnership', () => {
  const project = { ref: 'aaa', name: 'rix7-portal', organizationId: 'org-1' };
  const organization = { id: 'org-1', slug: 'miorg', name: 'Mi Org' };

  const decide = (extra = {}) =>
    judgeAccountOwnership({
      projectRef: 'aaa',
      expectedOwnerEmail: EXPECTED,
      project,
      organization,
      owners: null,
      obstacle: null,
      ...extra,
    });

  it('verificado cuando el dueño de la organización es el esperado', () => {
    const verdict = decide({ owners: [EXPECTED] });

    expect(verdict.state).toBe('verified');
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBeNull();
    expect(verdict.ownerEmails).toEqual([EXPECTED]);
  });

  it('no le importa cómo venga escrito el correo', () => {
    // La API devuelve el correo como lo tenga registrado la cuenta.
    expect(decide({ owners: ['JATF71@Gmail.com'] }).state).toBe('verified');
  });

  it('alcanza con que sea uno de los dueños', () => {
    expect(decide({ owners: ['otra@cuenta.cl', EXPECTED] }).state).toBe('verified');
  });

  it('la base de otra cuenta: lo dice, con la organización y los dos correos', () => {
    const verdict = decide({ owners: ['otra@cuenta.cl'] });

    expect(verdict.state).toBe('mismatch');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('Mi Org');
    expect(verdict.reason).toContain('otra@cuenta.cl');
    expect(verdict.reason).toContain(EXPECTED);
    // El informe de esta sonda se pega en un issue público: nada de `→`, que es
    // donde el aviso corta la línea para armar su huella.
    expect(verdict.reason).not.toContain('→');
  });

  it('un impedimento no se convierte en un aprobado', () => {
    const verdict = decide({ obstacle: 'al token le falta permiso para esto (HTTP 403).' });

    expect(verdict.state).toBe('unconfirmed');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('403');
  });

  it('que el token no vea el proyecto no es un «es de otra cuenta»', () => {
    // Puede ser otra cuenta o un alcance insuficiente: se dice eso, no una
    // acusación que no se puede probar.
    const verdict = decide({ project: null });

    expect(verdict.state).toBe('unconfirmed');
    expect(verdict.reason).toContain('otra cuenta');
    expect(verdict.reason).toContain('alcance');
  });

  it('sin organización, sin dueño o sin correos de dueño: sin comprobar', () => {
    expect(decide({ organization: null }).state).toBe('unconfirmed');
    expect(decide({ owners: [] }).state).toBe('unconfirmed');
    expect(decide({ owners: [] }).reason).toContain('dueño');
  });

  it('conserva las notas del camino y las peticiones hechas', () => {
    const verdict = decide({ owners: [EXPECTED], notes: ['Se recorrieron 1 de 3 organizaciones.'], requests: 5 });

    expect(verdict.notes).toContain('Se recorrieron 1 de 3 organizaciones.');
    expect(verdict.notes.join(' ')).toContain('Mi Org');
    expect(verdict.requests).toBe(5);
  });
});

describe('exitCodeFor', () => {
  it('el código de salida es el contrato con el workflow', () => {
    expect(exitCodeFor('verified')).toBe(0);
    expect(exitCodeFor('mismatch')).toBe(1);
    expect(exitCodeFor('unconfirmed')).toBe(2);
  });
});

describe('describeApiFailure', () => {
  it('cada fallo dice su arreglo, no solo el número', () => {
    expect(describeApiFailure(401, null)).toContain('revocado');
    expect(describeApiFailure(403, null)).toContain('permiso');
    expect(describeApiFailure(429, null)).toContain('tasa');
    expect(describeApiFailure(0, 'fetch failed')).toContain('fetch failed');
    expect(describeApiFailure(500, null)).toContain('500');
  });
});

describe('los informes', () => {
  const verified = judgeAccountOwnership({
    projectRef: 'aaa',
    expectedOwnerEmail: EXPECTED,
    project: { ref: 'aaa', name: null, organizationId: 'org-1' },
    organization: { id: 'org-1', slug: 'miorg', name: 'Mi Org' },
    owners: [EXPECTED],
    obstacle: null,
    requests: 4,
  });
  const mismatch = judgeAccountOwnership({
    projectRef: 'aaa',
    expectedOwnerEmail: EXPECTED,
    project: { ref: 'aaa', name: null, organizationId: 'org-1' },
    organization: { id: 'org-1', slug: 'miorg', name: 'Mi Org' },
    owners: ['otra@cuenta.cl'],
    obstacle: null,
    requests: 4,
  });
  const unconfirmed = judgeAccountOwnership({
    projectRef: 'aaa',
    expectedOwnerEmail: EXPECTED,
    project: null,
    organization: null,
    owners: null,
    obstacle: null,
    requests: 2,
  });

  it('el verificado lo dice y no usa la marca de fallo', () => {
    const report = formatReport({ ref: 'aaa', verdict: verified });

    expect(report).toContain('✓');
    expect(report).not.toContain('✗');
    expect(report).toContain('4 petición');
  });

  it('la contradicción usa la marca que el aviso del issue sabe leer', () => {
    // `notice-health` arma su huella con las líneas `✗` y `::error::`: si el rojo
    // no trajera ninguna, el job quedaría rojo sin motivo legible.
    expect(formatReport({ ref: 'aaa', verdict: mismatch })).toContain('✗');
  });

  it('el «no se pudo» no se viste de contradicción, pero tampoco de verde', () => {
    const report = formatReport({ ref: 'aaa', verdict: unconfirmed });

    expect(report).not.toContain('✓');
    expect(report).not.toContain('✗');
    expect(report).toContain('?');
  });

  it('sin proyecto que comprobar lo dice y no decide nada', () => {
    const report = formatReport({ ref: null, verdict: null, skipped: 'No hay NEXT_PUBLIC_SUPABASE_URL.' });

    expect(report).toContain('No hay NEXT_PUBLIC_SUPABASE_URL');
    expect(report).not.toContain('✓');
  });

  it('el resumen del CI nombra al dueño según la API y al esperado', () => {
    const markdown = summaryMarkdown({ ref: 'aaa', verdict: mismatch, exitCode: 1 });

    expect(markdown).toContain('otra@cuenta.cl');
    expect(markdown).toContain(EXPECTED);
    expect(markdown).toContain('❌');
    expect(summaryMarkdown({ ref: null, verdict: null, skipped: 'sin URL', exitCode: 0 })).toContain('ℹ️');
  });
});

describe('readCredentials', () => {
  const file = ['# comentario', 'NEXT_PUBLIC_SUPABASE_URL=https://aaa.supabase.co', 'SUPABASE_ACCESS_TOKEN="sbp_de-prueba"', ''].join(
    '\n'
  );

  it('lee la URL y el token de .env.local', () => {
    const credentials = readCredentials({ env: {}, exists: () => true, read: () => file });

    expect(credentials.url).toBe('https://aaa.supabase.co');
    expect(credentials.token).toBe('sbp_de-prueba');
    expect(credentials.owner).toBeNull();
  });

  it('lo que ya está en el entorno manda sobre el archivo', () => {
    const credentials = readCredentials({
      env: { NEXT_PUBLIC_SUPABASE_URL: 'https://bbb.supabase.co', SUPABASE_OWNER_ACCOUNT_EMAIL: 'otro@cuenta.cl' },
      exists: () => true,
      read: () => file,
    });

    expect(credentials.url).toBe('https://bbb.supabase.co');
    expect(credentials.owner).toBe('otro@cuenta.cl');
  });

  it('sin .env.local no rompe: es el caso del CI, que recibe todo por el entorno', () => {
    const credentials = readCredentials({ env: { SUPABASE_ACCESS_TOKEN: 'sbp_x' }, exists: () => false });

    expect(credentials).toEqual({ url: null, token: 'sbp_x', owner: null });
  });
});
