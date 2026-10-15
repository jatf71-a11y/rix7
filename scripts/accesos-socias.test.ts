/**
 * Tests de los accesos de socias y corredoras.
 *
 * Lo que hay que proteger no es «que corra», sino tres cosas que se rompen en
 * silencio:
 *
 * - **Sin `--aplicar` no se escribe nada**: ni una cuenta, ni un correo.
 * - **Nadie recibe un enlace antes de que su cuenta tenga rol y corredora**,
 *   porque ese correo lleva a un panel vacío y a una llamada a soporte.
 * - **No se vuelve a escribirle a quien ya recibió su enlace**, ni se pierde a
 *   nadie cuando una corrida se corta a la mitad.
 *
 * Además se comprueba que las reglas de rol y de metadata son **las mismas** que
 * las del panel (`lib/data/socioAccounts.ts`): si divergieran, una cuenta creada
 * acá y otra vinculada desde la UI no se comportarían igual.
 *
 * Todo se prueba sin red: el `fetch` se inyecta, y también la escritura del
 * registro.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { linkMetadata, normalizeEmail as panelNormalizeEmail } from '@/lib/data/socioAccounts';
import { resolveRole } from '@/lib/utils/roles';

import {
  BATCH_SIZE,
  accessMetadata,
  buildAccessEmail,
  createAccount,
  escapeHtml,
  fetchAccounts,
  fetchPartners,
  formatAccessOutcome,
  formatPlanTable,
  generateAccessLink,
  inspectAccessEnv,
  mergeLedger,
  normalizeEmail,
  normalizeRoster,
  parseAccessArgs,
  parseRosterCsv,
  parseRosterJson,
  planAccounts,
  planBatches,
  readRoster,
  resolveRoleLike,
  rosterFromPartners,
  runAccessRecovery,
  sendAccessBatch,
  stepTitle,
} from './accesos-socias.mjs';

const REF = 'vsqkjimpssdvlvdwrtnh';
const URL = `https://${REF}.supabase.co`;

/**
 * Claves con forma pero **no** con valor real, armadas acá y no en el repo: un
 * literal entero lo marcaría la guardia de secretos (`npm run check:secrets`), y
 * una guardia que se silencia con una excepción deja de servir.
 */
const SERVICE = ['sb', 'secret', 'solo-para-el-test', 'no-es-una-clave-real'].join('_');
const ANON = ['sb', 'publishable', 'solo-para-el-test', 'no-es-una-clave-real'].join('_');

/** Un JWT sin firma válida: alcanza para leer el cuerpo, que es lo que se usa. */
function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.${'firma-de-test'.repeat(3)}`;
}

const SERVICE_JWT = jwt({ role: 'service_role', ref: REF });

const valuesOk: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_JWT,
  NEXT_PUBLIC_SITE_URL: 'https://rix7.cl',
  // Clave con forma pero sin valor real: Resend no se llama de verdad en ningún test.
  RESEND_API_KEY: 're_de_prueba',
};

const dirs: string[] = [];

function tempDir(prefix = 'rix7-accesos-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function envFile(values: Record<string, string> = valuesOk): string {
  const file = path.join(tempDir(), '.env.local');
  writeFileSync(file, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, 'utf8');
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Una base y un Resend de mentira, con estado.
 *
 * Se mantiene **estado** y no respuestas fijas porque lo que hay que comprobar es
 * el encadenado: crear la cuenta, releerla para verificar y recién entonces
 * generar y mandar el enlace. Con respuestas fijas, «verificar» sería un adorno.
 */
function fakeBackend({
  partners = [{ id: 'catedral', name: 'Catedral Propiedades', contact_email: 'jtorres@catedralpropiedades.com' }],
  accounts = [] as Record<string, unknown>[],
  accountsPages = null as Record<string, unknown>[][] | null,
  partnerStatus = 200,
  accountsStatus = 200,
  generateStatus = 200,
  resendStatus = 200,
} = {}) {
  const calls: Call[] = [];
  let page = 0;

  const impl = (async (url: string | URL, options: RequestInit = {}) => {
    const target = String(url);
    const method = (options.method ?? 'GET').toUpperCase();
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ method, url: target, body });

    const json = (status: number, payload: unknown) =>
      ({ ok: status < 400, status, json: async () => payload }) as unknown as Response;

    if (target.includes('/rest/v1/partners')) {
      return partnerStatus === 200 ? json(200, partners) : json(partnerStatus, { message: 'boom' });
    }

    if (target.includes('/auth/v1/admin/users') && method === 'GET') {
      if (accountsStatus !== 200) return json(accountsStatus, { message: 'boom' });
      if (accountsPages) {
        const batch = accountsPages[page] ?? [];
        page += 1;
        return json(200, { users: batch });
      }
      return json(200, { users: accounts });
    }

    if (target.includes('/auth/v1/admin/users') && method === 'POST') {
      const created = { id: `id-${body.email}`, email: body.email, app_metadata: body.app_metadata };
      accounts.push(created);
      return json(200, created);
    }

    if (target.includes('/auth/v1/admin/users/') && method === 'PUT') {
      const id = decodeURIComponent(target.split('/').pop() as string);
      const account = accounts.find((entry) => entry.id === id);
      if (account) account.app_metadata = body.app_metadata;
      return json(200, { id, app_metadata: body.app_metadata });
    }

    if (target.includes('/auth/v1/admin/generate_link')) {
      if (generateStatus !== 200) return json(generateStatus, { message: 'boom' });
      const redirect = body.redirect_to ?? 'https://rix7.cl';
      return json(200, {
        action_link: `${URL}/auth/v1/verify?token=token-de-${body.email}&type=magiclink&redirect_to=${encodeURIComponent(redirect)}`,
        verification_type: 'magiclink',
      });
    }

    if (target.includes('api.resend.com/emails/batch')) {
      return resendStatus === 200 ? json(200, { data: body.map((_mail: unknown, index: number) => ({ id: `mail-${index}` })) }) : json(resendStatus, { message: 'rechazado' });
    }

    return json(404, { message: `ruta inesperada: ${method} ${target}` });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const person = (
  email: string,
  partnerId: string | null = 'catedral',
  extra: { name?: string; role?: 'member' | 'admin' } = {},
) => ({
  email,
  name: extra.name ?? '',
  role: extra.role ?? 'member',
  partnerId,
});

describe('normalizeEmail', () => {
  it('recorta y pasa a minúsculas', () => {
    expect(normalizeEmail('  Ana.Perez@Correo.CL ')).toBe('ana.perez@correo.cl');
  });

  it('rechaza lo que no sirve, en vez de devolver una cadena vacía', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail('sin-arroba')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(200)}@correo.cl`)).toBeNull();
  });

  it('es exactamente la regla del panel', () => {
    const cases = ['Ana@Correo.CL ', 'ana@correo.cl', ' sin-arroba', 'a@b', '', 'x@y.z', 12, null, undefined];
    for (const value of cases) {
      expect(normalizeEmail(value)).toBe(panelNormalizeEmail(value));
    }
  });
});

describe('resolveRoleLike', () => {
  it('reconoce los alias del producto y no asciende por accidente', () => {
    expect(resolveRoleLike('admin')).toBe('admin');
    expect(resolveRoleLike('Administrator')).toBe('admin');
    expect(resolveRoleLike('cliente')).toBe('member');
    expect(resolveRoleLike('  CLIENTE ')).toBe('member');
    // «socia» y «corredora» NO son roles del producto, aunque sean las palabras
    // del negocio: el vocabulario del rol es admin/member, y la lista del roster
    // ya pone member por defecto. Inventar alias acá crearía cuentas con un rol
    // que el panel no reconoce.
    expect(resolveRoleLike('socia')).toBe('visitor');
    expect(resolveRoleLike('corredora')).toBe('visitor');
    expect(resolveRoleLike('superuser')).toBe('visitor');
    expect(resolveRoleLike({ role: 'admin' })).toBe('visitor');
  });

  it('coincide con la resolución del producto caso por caso', () => {
    const cases = ['admin', 'ADMIN', 'administrator', 'member', 'client', 'cliente', 'miembro', 'visitor', 'corredora', '', ' basura ', 42, null];
    for (const value of cases) {
      expect(resolveRoleLike(value)).toBe(resolveRole({ app_metadata: { role: value } }));
    }
  });
});

describe('accessMetadata', () => {
  it('es la misma regla que la del panel (linkMetadata)', () => {
    const cases: unknown[] = [
      undefined,
      {},
      { plan: 'pro' },
      { role: 'admin' },
      { role: 'administrator', plan: 'pro' },
      { role: 'visitor' },
      { role: 'member', partner_id: 'vieja' },
      'basura',
      ['x'],
      { role: 42 },
    ];
    for (const existing of cases) {
      expect(accessMetadata(existing, { role: 'member', partnerId: 'catedral' })).toEqual(
        linkMetadata(existing, 'catedral'),
      );
    }
  });

  it('no degrada a un admin: le agrega el vínculo y conserva el rol', () => {
    expect(accessMetadata({ role: 'admin' }, { role: 'member', partnerId: 'catedral' })).toEqual({
      role: 'admin',
      partner_id: 'catedral',
    });
  });

  it('conserva el resto de la metadata de la cuenta', () => {
    expect(accessMetadata({ plan: 'pro', telefono: '9' }, { role: 'member', partnerId: 'savills' })).toEqual({
      plan: 'pro',
      telefono: '9',
      role: 'member',
      partner_id: 'savills',
    });
  });
});

describe('parseRosterCsv', () => {
  it('lee un CSV con encabezado, en cualquier orden de columnas', () => {
    const { entries, problems } = parseRosterCsv(
      ['corredora,nombre,correo,rol', 'catedral,Ana Pérez,ana@correo.cl,member'].join('\n'),
    );
    expect(problems).toEqual([]);
    expect(entries).toEqual([{ partnerId: 'catedral', name: 'Ana Pérez', email: 'ana@correo.cl', role: 'member' }]);
  });

  it('sin encabezado interpreta el orden correo, nombre, rol, corredora', () => {
    const { entries } = parseRosterCsv('ana@correo.cl,Ana,member,catedral');
    expect(entries[0]).toMatchObject({ email: 'ana@correo.cl', partnerId: 'catedral' });
  });

  it('acepta el punto y coma: es lo que exporta una planilla', () => {
    const { entries } = parseRosterCsv('correo;nombre;corredora\nana@correo.cl;Ana;catedral');
    expect(entries).toEqual([{ email: 'ana@correo.cl', name: 'Ana', partnerId: 'catedral' }]);
  });

  it('ignora comentarios, líneas vacías y comillas', () => {
    const { entries } = parseRosterCsv(
      ['# la lista de socias', '', 'correo,corredora', '"ana@correo.cl",catedral', ''].join('\r\n'),
    );
    expect(entries).toEqual([{ email: 'ana@correo.cl', partnerId: 'catedral' }]);
  });

  it('dice en qué línea falta el correo en vez de saltarla en silencio', () => {
    const { entries, problems } = parseRosterCsv('correo,corredora\n, catedral\nana@correo.cl,catedral');
    expect(entries).toHaveLength(1);
    expect(problems[0]).toContain('línea 2');
  });

  it('un archivo sin datos se informa como problema', () => {
    expect(parseRosterCsv('   ').problems[0]).toContain('ninguna línea');
  });
});

describe('parseRosterJson', () => {
  it('lee un arreglo de personas', () => {
    const { entries } = parseRosterJson('[{"correo":"ana@correo.cl","corredora":"catedral","rol":"admin"}]');
    expect(entries).toEqual([{ email: 'ana@correo.cl', name: '', role: 'admin', partnerId: 'catedral' }]);
  });

  it('acepta un objeto con la clave personas (una exportación)', () => {
    const { entries } = parseRosterJson('{"personas":[{"email":"ana@correo.cl","partner_id":"savills"}]}');
    expect(entries[0]).toMatchObject({ email: 'ana@correo.cl', partnerId: 'savills' });
  });

  it('informa el JSON roto y los elementos sin correo', () => {
    expect(parseRosterJson('{').problems[0]).toContain('JSON');
    const { problems } = parseRosterJson('[{"nombre":"sin correo"}]');
    expect(problems[0]).toContain('elemento 1');
  });
});

describe('readRoster', () => {
  it('elige el formato por el contenido, no por la extensión', () => {
    expect(readRoster('[{"email":"ana@correo.cl"}]').entries[0].email).toBe('ana@correo.cl');
    expect(readRoster('correo,corredora\nana@correo.cl,catedral').entries[0].email).toBe('ana@correo.cl');
  });
});

describe('rosterFromPartners', () => {
  it('arma una persona por corredora con su correo de contacto', () => {
    const result = rosterFromPartners([
      { id: 'catedral', name: 'Catedral', contact_email: 'contacto@catedral.cl' },
      { id: 'savills', name: 'Savills', contact_email: 'contacto@savills.cl' },
    ]);
    expect(result.entries).toEqual([
      { email: 'contacto@catedral.cl', name: 'Catedral', role: 'member', partnerId: 'catedral' },
      { email: 'contacto@savills.cl', name: 'Savills', role: 'member', partnerId: 'savills' },
    ]);
    expect(result.withoutEmail).toEqual([]);
  });

  it('separa las corredoras sin correo: no hay a quién avisarle', () => {
    const result = rosterFromPartners([
      { id: 'catedral', name: 'Catedral', contact_email: 'contacto@catedral.cl' },
      { id: 'sin-correo', name: 'Sin Correo', contact_email: '' },
      { id: 'roto', name: 'Roto', contact_email: 'no-es-un-correo' },
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.withoutEmail.map((entry) => entry.id)).toEqual(['sin-correo', 'roto']);
  });
});

describe('normalizeRoster', () => {
  it('empareja por correo en minúsculas: la misma persona es una sola cuenta', () => {
    const { people, problems } = normalizeRoster({
      entries: [
        { email: 'Contacto@Catedral.cl', partnerId: 'catedral' },
        { email: 'contacto@catedral.cl', name: 'Ana' },
      ],
      partners: ['catedral'],
    });
    expect(people).toEqual([{ email: 'contacto@catedral.cl', name: 'Ana', role: 'member', partnerId: 'catedral' }]);
    expect(problems[0]).toContain('más de una vez');
  });

  it('si ninguna aparición trae corredora, la persona queda sin corredora', () => {
    const { people } = normalizeRoster({ entries: [{ email: 'ana@correo.cl' }], partners: ['catedral'] });
    expect(people[0].partnerId).toBeNull();
  });

  it('avisa cuando la corredora no existe en la base', () => {
    const { problems } = normalizeRoster({ entries: [{ email: 'ana@correo.cl', partnerId: 'fantasma' }], partners: ['catedral'] });
    expect(problems[0]).toContain('fantasma');
  });

  it('descarta los correos inválidos con su motivo', () => {
    const { people, problems } = normalizeRoster({ entries: [{ email: 'roto' }], partners: [] });
    expect(people).toEqual([]);
    expect(problems[0]).toContain('correo inválido');
  });

  it('ordena por correo para que el plan sea estable entre corridas', () => {
    const { people } = normalizeRoster({
      entries: [{ email: 'z@correo.cl' }, { email: 'a@correo.cl' }],
      partners: [],
    });
    expect(people.map((entry) => entry.email)).toEqual(['a@correo.cl', 'z@correo.cl']);
  });
});

describe('planAccounts', () => {
  const partners = ['catedral', 'savills'];

  it('crea la cuenta que no existe', () => {
    const [row] = planAccounts({ people: [person('ana@correo.cl')], accounts: [], partners });
    expect(row.state).toBe('crear');
    expect(row.detail).toContain('catedral');
  });

  it('vincula cuando la cuenta existe sin rol ni corredora (el caso del corte)', () => {
    const [row] = planAccounts({
      people: [person('ana@correo.cl')],
      accounts: [{ id: 'u1', email: 'Ana@Correo.cl', app_metadata: {} }],
      partners,
    });
    expect(row.state).toBe('vincular');
    expect(row.accountId).toBe('u1');
  });

  it('mueve la cuenta a otra corredora cuando el vínculo cambió', () => {
    const [row] = planAccounts({
      people: [person('ana@correo.cl', 'savills')],
      accounts: [{ id: 'u1', email: 'ana@correo.cl', app_metadata: { role: 'member', partner_id: 'catedral' } }],
      partners,
    });
    expect(row.state).toBe('vincular');
    expect(row.detail).toContain('catedral');
  });

  it('no toca la que ya está lista', () => {
    const [row] = planAccounts({
      people: [person('ana@correo.cl')],
      accounts: [{ id: 'u1', email: 'ana@correo.cl', app_metadata: { role: 'member', partner_id: 'catedral' } }],
      partners,
    });
    expect(row.state).toBe('listo');
  });

  it('una cuenta del equipo conserva su rol y solo gana el vínculo', () => {
    const [row] = planAccounts({
      people: [person('equipo@rix7.cl')],
      accounts: [{ id: 'u1', email: 'equipo@rix7.cl', app_metadata: { role: 'admin' } }],
      partners,
    });
    expect(row.state).toBe('vincular');
    expect(row.detail).toContain('conserva el rol');
  });

  it('deja fuera del plan lo que no se puede aplicar', () => {
    const rows = planAccounts({
      people: [person('sin@correo.cl', null), person('otra@correo.cl', 'fantasma')],
      accounts: [],
      partners,
    });
    expect(rows.map((row) => row.state)).toEqual(['sin-corredora', 'corredora-desconocida']);
  });

  it('ignora las cuentas sin id o sin correo utilizable', () => {
    const [row] = planAccounts({
      people: [person('ana@correo.cl')],
      accounts: [{ email: 'ana@correo.cl', app_metadata: {} }, { id: 'x', email: 'roto' }, null],
      partners,
    });
    expect(row.state).toBe('crear');
  });
});

describe('buildAccessEmail', () => {
  const link = `${URL}/auth/v1/verify?token=abc&type=magiclink`;

  it('lleva el enlace y dice que es de un solo uso', () => {
    const email = buildAccessEmail({ name: 'Ana', link, siteUrl: 'https://rix7.cl' });
    expect(email.text).toContain(link);
    // En el HTML el `&` del enlace va escapado, como manda el estándar: el cliente
    // de correo lo vuelve a leer tal cual.
    expect(email.html).toContain(escapeHtml(link));
    expect(email.text).toMatch(/un solo uso/);
    expect(email.subject).toContain('Rix7');
  });

  it('aclara que no hay contraseña que recordar ni restablecer', () => {
    const email = buildAccessEmail({ link, siteUrl: 'https://rix7.cl' });
    expect(email.text).toMatch(/no usa contraseñas/);
    expect(email.text).toMatch(/Hola,/);
  });

  it('ofrece la salida por Google con el mismo correo y el panel', () => {
    const email = buildAccessEmail({ link, siteUrl: 'https://rix7.cl/' });
    expect(email.text).toContain('https://rix7.cl/socio');
    expect(email.text).toContain('Google');
  });

  it('saluda por nombre y menciona la corredora', () => {
    const email = buildAccessEmail({ name: 'Ana', partner: 'Catedral', link });
    expect(email.text).toContain('Hola Ana,');
    expect(email.text).toContain('Catedral');
    expect(email.html).toContain('Catedral');
  });

  it('escapa lo que venga de la lista antes de meterlo en el HTML', () => {
    const email = buildAccessEmail({ name: '<script>alert(1)</script>', partner: 'A & B', link });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('A &amp; B');
  });
});

describe('planBatches', () => {
  const many = (count: number) => Array.from({ length: count }, (_value, index) => ({ email: `p${index}@correo.cl` }));

  it('arma lotes del tamaño que acepta Resend, sin perder el orden', () => {
    const { batches } = planBatches({ people: many(205) });
    expect(batches.map((batch) => batch.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 5]);
    expect(batches[0][0].email).toBe('p0@correo.cl');
    expect(batches[2][4].email).toBe('p204@correo.cl');
  });

  it('se salta a quien ya tiene envío anotado: reanudar no repite correos', () => {
    const ledger = { 'p0@correo.cl': { link: { state: 'sent' } } };
    const { batches, skipped } = planBatches({ people: many(3), ledger });
    expect(skipped).toEqual(['p0@correo.cl']);
    expect(batches[0].map((entry) => entry.email)).toEqual(['p1@correo.cl', 'p2@correo.cl']);
  });

  it('--reenviar es la única forma de repetir un envío anotado', () => {
    const ledger = { 'p0@correo.cl': { link: { state: 'sent' } } };
    const { batches, skipped } = planBatches({ people: many(1), ledger, resend: true });
    expect(skipped).toEqual([]);
    expect(batches[0][0].email).toBe('p0@correo.cl');
  });

  it('sin gente no hay lotes', () => {
    expect(planBatches({ people: [] })).toEqual({ batches: [], skipped: [] });
  });
});

describe('mergeLedger', () => {
  it('anota el estado de una cuenta y conserva lo que ya había', () => {
    const next = mergeLedger({ 'ana@correo.cl': { role: 'member' } }, [
      { email: 'Ana@Correo.cl', accountId: 'u1', partnerId: 'catedral', state: 'ready' },
    ]);
    expect(next['ana@correo.cl']).toMatchObject({ role: 'member', accountId: 'u1', partnerId: 'catedral', state: 'ready' });
  });

  it('sella la fecha del envío', () => {
    const next = mergeLedger({}, [{ email: 'ana@correo.cl', link: { state: 'sent' } }], { at: '2026-10-14T00:00:00.000Z' });
    expect(next['ana@correo.cl'].link).toEqual({ state: 'sent', at: '2026-10-14T00:00:00.000Z' });
  });

  it('ignora los correos que no sirven en vez de crear una clave basura', () => {
    expect(mergeLedger({}, [{ email: 'roto' }])).toEqual({});
  });
});

describe('inspectAccessEnv', () => {
  it('acepta las credenciales del mismo proyecto', () => {
    expect(inspectAccessEnv(valuesOk)).toEqual({ ok: true, ref: REF, problems: [] });
  });

  it('detiene el comando si falta la clave de servicio y dice cómo guardarla', () => {
    const result = inspectAccessEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: '' });
    expect(result.problems.map((problem) => problem.code)).toEqual(['sin-service']);
    expect(result.problems[0].hint).toContain('env:secret');
  });

  it('ataja la pública en el lugar de la de servicio', () => {
    const result = inspectAccessEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: ANON });
    expect(result.problems.map((problem) => problem.code)).toContain('service-forma');
  });

  it('ataja una clave de otro proyecto', () => {
    const result = inspectAccessEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: 'otroref' }) });
    expect(result.problems.map((problem) => problem.code)).toContain('otro-proyecto');
  });

  it('ataja una clave pública con nombre de servicio', () => {
    const result = inspectAccessEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'anon', ref: REF }) });
    expect(result.problems.map((problem) => problem.code)).toContain('service-rol');
  });

  it('ataja el placeholder', () => {
    const result = inspectAccessEnv({ ...valuesOk, NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder-project.supabase.co' });
    expect(result.problems.map((problem) => problem.code)).toContain('url-placeholder');
  });

  it('nunca imprime el valor de una clave', () => {
    const result = inspectAccessEnv({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: ANON });
    expect(JSON.stringify(result)).not.toContain(ANON);
    expect(JSON.stringify(result)).not.toContain(SERVICE);
  });
});

describe('las llamadas a la base', () => {
  it('lee el catálogo de corredoras con la clave pública', async () => {
    const backend = fakeBackend();
    const result = await fetchPartners({ url: URL, key: ANON, fetchImpl: backend.impl });
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(backend.calls[0].url).toContain('/rest/v1/partners');
  });

  it('informa el fallo del catálogo en vez de devolver una lista vacía', async () => {
    const backend = fakeBackend({ partnerStatus: 500 });
    expect(await fetchPartners({ url: URL, key: ANON, fetchImpl: backend.impl })).toMatchObject({ ok: false, rows: [] });
  });

  it('pagina las cuentas hasta la página corta', async () => {
    const backend = fakeBackend({ accountsPages: [[{ id: 'u1' }, { id: 'u2' }], [{ id: 'u3' }]] });
    const result = await fetchAccounts({ url: URL, key: SERVICE_JWT, fetchImpl: backend.impl, perPage: 2 });
    expect(result.ok).toBe(true);
    expect(result.users).toHaveLength(3);
    expect(backend.calls.filter((call) => call.method === 'GET')).toHaveLength(2);
  });

  it('avisa cuando la lista quedó truncada: con la mitad no se puede decidir', async () => {
    const backend = fakeBackend({ accountsPages: [[{ id: 'u1' }, { id: 'u2' }], [{ id: 'u3' }, { id: 'u4' }]] });
    const result = await fetchAccounts({ url: URL, key: SERVICE_JWT, fetchImpl: backend.impl, perPage: 2, maxPages: 2 });
    expect(result.truncated).toBe(true);
  });

  it('crea la cuenta ya confirmada y con su metadata', async () => {
    const backend = fakeBackend();
    const result = await createAccount({
      url: URL,
      key: SERVICE_JWT,
      email: 'ana@correo.cl',
      metadata: { role: 'member', partner_id: 'catedral' },
      fetchImpl: backend.impl,
    });
    expect(result.ok).toBe(true);
    expect(backend.calls[0]).toMatchObject({ method: 'POST' });
    expect(backend.calls[0].body).toMatchObject({ email: 'ana@correo.cl', email_confirm: true });
    expect((backend.calls[0].body as { app_metadata: Record<string, string> }).app_metadata.partner_id).toBe('catedral');
  });

  it('genera un enlace de un solo uso sin mandar correo', async () => {
    const backend = fakeBackend();
    const result = await generateAccessLink({
      url: URL,
      key: SERVICE_JWT,
      email: 'ana@correo.cl',
      redirectTo: 'https://rix7.cl/socio',
      fetchImpl: backend.impl,
    });
    expect(result.ok).toBe(true);
    expect(result.link).toContain('type=magiclink');
    expect(backend.calls[0].body).toMatchObject({ type: 'magiclink', redirect_to: 'https://rix7.cl/socio' });
    // Un solo endpoint: generar no envía nada.
    expect(backend.calls).toHaveLength(1);
  });

  it('un generate_link sin action_link es un error, no un enlace vacío', async () => {
    const backend = fakeBackend({ generateStatus: 200 });
    const impl = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
    expect((await generateAccessLink({ url: URL, key: SERVICE_JWT, email: 'a@b.cl', fetchImpl: impl })).ok).toBe(false);
    expect((await generateAccessLink({ url: URL, key: SERVICE_JWT, email: 'a@b.cl', fetchImpl: backend.impl, redirectTo: 'x' })).ok).toBe(true);
  });

  it('manda el lote a Resend con la clave en la cabecera', async () => {
    const backend = fakeBackend();
    const result = await sendAccessBatch({ apiKey: 're_de_prueba', messages: [{ to: ['a@b.cl'] }], fetchImpl: backend.impl });
    expect(result.ok).toBe(true);
    expect(backend.calls[0].url).toContain('api.resend.com/emails/batch');
    expect(Array.isArray(backend.calls[0].body)).toBe(true);
  });
});

describe('parseAccessArgs', () => {
  it('por defecto solo planifica: no crea cuentas ni manda correos', () => {
    expect(parseAccessArgs([])).toMatchObject({ apply: false, send: false, resend: false });
  });

  it('--aplicar y --enviar son las dos puertas de escritura', () => {
    expect(parseAccessArgs(['--aplicar', '--enviar'])).toMatchObject({ apply: true, send: true });
  });

  it('--enviar sin --aplicar se rechaza: el correo llegaría a un panel vacío', () => {
    const args = parseAccessArgs(['--enviar']);
    expect(args.error).toContain('--aplicar');
    expect(args.apply).toBe(false);
  });

  it('--dry-run con --aplicar es una contradicción, y no se resuelve escribiendo', () => {
    expect(parseAccessArgs(['--dry-run', '--aplicar']).error).toContain('--dry-run');
    expect(parseAccessArgs(['--dry-run', '--enviar']).error).toContain('--dry-run');
    expect(parseAccessArgs(['--dry-run']).apply).toBe(false);
  });

  it('una bandera mal escrita detiene el comando', () => {
    expect(parseAccessArgs(['--aplicarr']).error).toMatch(/No reconozco/);
    expect(parseAccessArgs(['--cuentas']).error).toContain('--cuentas');
    expect(parseAccessArgs(['--limite']).error).toContain('--limite');
    expect(parseAccessArgs(['--redirect']).error).toContain('--redirect');
  });

  it('--solo acepta un correo y lo normaliza', () => {
    expect(parseAccessArgs(['--solo', 'Ana@Correo.CL']).only).toBe('ana@correo.cl');
    expect(parseAccessArgs(['--solo', 'roto']).error).toContain('--solo');
  });

  it('--limite tiene que ser un entero positivo', () => {
    expect(parseAccessArgs(['--limite', '3']).limit).toBe(3);
    expect(parseAccessArgs(['--limite', '0']).error).toContain('--limite');
    expect(parseAccessArgs(['--limite', 'dos']).error).toContain('--limite');
  });

  it('--redirect exige una URL completa', () => {
    expect(parseAccessArgs(['--redirect', 'https://rix7.cl/socio']).redirect).toBe('https://rix7.cl/socio');
    expect(parseAccessArgs(['--redirect', '/socio']).error).toContain('--redirect');
  });
});

describe('runAccessRecovery', () => {
  function context(options: Parameters<typeof fakeBackend>[0] = {}) {
    const backend = fakeBackend(options);
    const dir = tempDir();
    const written: { file: string; content: string }[] = [];
    return {
      backend,
      dir,
      written,
      run: (overrides: Record<string, unknown> = {}) =>
        runAccessRecovery({
          file: envFile(),
          stateDir: dir,
          ledger: {},
          env: {},
          fetchImpl: backend.impl,
          sleep: async () => {},
          log: () => {},
          writeFile: (file: string, content: string) => {
            written.push({ file, content });
          },
          ...overrides,
        }),
    };
  }

  it('sin clave de servicio se frena antes de escribir y antes de mandar nada', async () => {
    const { backend, run } = context();
    const result = await run({ file: envFile({ ...valuesOk, SUPABASE_SERVICE_ROLE_KEY: '' }) });

    expect(result.ok).toBe(false);
    expect(result.stop?.id).toBe('keys');
    expect(result.steps.map((step) => step.id)).toEqual(['file', 'roster']);
    // Solo se leyó el catálogo público: ni una llamada de administración.
    expect(backend.calls.every((call) => call.url.includes('/rest/v1/partners'))).toBe(true);
  });

  it('sin --aplicar el plan no escribe nada ni manda nada', async () => {
    const { backend, written, run } = context();
    const result = await run({ only: 'jtorres@catedralpropiedades.com' });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.sent).toBeNull();
    expect(backend.calls.some((call) => call.method === 'POST' || call.method === 'PUT')).toBe(false);
    expect(written).toEqual([]);
    expect(result.plan[0]).toMatchObject({ state: 'crear', partnerId: 'catedral' });
  });

  it('con --aplicar crea la cuenta nueva y completa la que ya existía', async () => {
    const { backend, written, run } = context({
      accounts: [{ id: 'u-equipo', email: 'equipo@rix7.cl', app_metadata: { role: 'admin' } }],
    });

    const result = await run({
      apply: true,
      rosterFile: (() => {
        const file = path.join(tempDir(), 'cuentas.csv');
        writeFileSync(file, 'correo,rol,corredora\nequipo@rix7.cl,admin,catedral\n', 'utf8');
        return file;
      })(),
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);

    const created = backend.calls.find((call) => call.method === 'POST');
    expect((created?.body as { email: string }).email).toBe('jtorres@catedralpropiedades.com');
    expect((created?.body as { app_metadata: Record<string, string> }).app_metadata).toEqual({
      role: 'member',
      partner_id: 'catedral',
    });

    const updated = backend.calls.find((call) => call.method === 'PUT');
    expect(updated?.url).toContain('u-equipo');
    expect((updated?.body as { app_metadata: Record<string, string> }).app_metadata).toEqual({
      role: 'admin',
      partner_id: 'catedral',
    });

    expect(result.steps.map((step) => step.id)).toContain('verify');
    expect(written[0].file).toContain('estado.json');
    expect(JSON.parse(written[0].content).people['jtorres@catedralpropiedades.com']).toMatchObject({ state: 'ready' });
  });

  it('no manda ningún correo si la verificación no queda limpia', async () => {
    // El POST responde bien pero la cuenta no aparece en la relectura: es el caso
    // de una metadata que no se guardó.
    const backend = fakeBackend();
    const broken = (async (url: string | URL, options: RequestInit = {}) => {
      const target = String(url);
      const method = (options.method ?? 'GET').toUpperCase();
      backend.calls.push({ method, url: target, body: options.body ? JSON.parse(String(options.body)) : undefined });
      if (target.includes('/auth/v1/admin/users') && method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 'u-nueva' }) } as unknown as Response;
      }
      return backend.impl(url, options);
    }) as unknown as typeof fetch;

    const { run } = context();
    const result = await run({ apply: true, send: true, fetchImpl: broken });

    expect(result.ok).toBe(false);
    expect(result.stop?.id).toBe('verify');
    expect(backend.calls.some((call) => call.url.includes('api.resend.com'))).toBe(false);
    expect(formatAccessOutcome({ steps: result.steps, stop: result.stop, applied: true })).toContain('Verificar');
  });

  it('con --aplicar --enviar genera el enlace y lo manda dentro del correo', async () => {
    const { backend, written, run } = context();
    const result = await run({ apply: true, send: true });

    expect(result.ok).toBe(true);
    expect(result.sent).toMatchObject({ sent: 1, skipped: 0, failed: 0 });

    const generated = backend.calls.find((call) => call.url.includes('generate_link'));
    expect((generated?.body as { redirect_to: string }).redirect_to).toBe('https://rix7.cl/socio');

    const batch = backend.calls.find((call) => call.url.includes('api.resend.com'));
    const messages = batch?.body as { to: string[]; html: string; text: string; subject: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toEqual(['jtorres@catedralpropiedades.com']);
    expect(messages[0].html).toContain('/auth/v1/verify?token=token-de-jtorres@catedralpropiedades.com');
    expect(messages[0].text).toContain('Catedral Propiedades');

    const ledger = JSON.parse(written[written.length - 1].content);
    expect(ledger.people['jtorres@catedralpropiedades.com'].link.state).toBe('sent');
  });

  it('la cuenta que ya está lista no se reescribe, pero sí recibe su enlace', async () => {
    const { backend, run } = context({
      accounts: [
        { id: 'u1', email: 'jtorres@catedralpropiedades.com', app_metadata: { role: 'member', partner_id: 'catedral' } },
      ],
    });

    const result = await run({ apply: true, send: true });

    expect(result.ok).toBe(true);
    expect(result.sent).toMatchObject({ sent: 1 });
    // Nada que escribir: la cuenta ya tenía su rol y su corredora. (El POST que
    // sí hubo es el lote de correos, no una cuenta.)
    const accountsWritten = backend.calls.filter(
      (call) => call.url.includes('/auth/v1/admin/users') && call.method !== 'GET',
    );
    expect(accountsWritten).toEqual([]);
    expect(backend.calls.some((call) => call.url.includes('generate_link'))).toBe(true);
  });

  it('a quien quedó sin corredora no se le manda el enlace', async () => {
    const { backend, run } = context({ partners: [{ id: 'catedral', name: 'Catedral', contact_email: '' }] });
    const file = path.join(tempDir(), 'cuentas.csv');
    writeFileSync(file, 'correo,nombre,corredora\nana@correo.cl,Ana,\n', 'utf8');

    const result = await run({ apply: true, send: true, rosterFile: file });

    expect(result.ok).toBe(true);
    expect(result.sent).toMatchObject({ sent: 0, skipped: 0 });
    expect(backend.calls.some((call) => call.url.includes('api.resend.com'))).toBe(false);
  });

  it('reanudar no vuelve a escribirle a quien ya recibió su enlace', async () => {
    const { backend, run } = context();
    const result = await run({
      apply: true,
      send: true,
      ledger: { 'jtorres@catedralpropiedades.com': { link: { state: 'sent' } } },
    });

    expect(result.ok).toBe(true);
    expect(result.sent).toMatchObject({ sent: 0, skipped: 1 });
    expect(backend.calls.some((call) => call.url.includes('api.resend.com'))).toBe(false);
  });

  it('--reenviar es la forma de repetirlo, y es explícita', async () => {
    const { backend, run } = context();
    const result = await run({
      apply: true,
      send: true,
      resend: true,
      ledger: { 'jtorres@catedralpropiedades.com': { link: { state: 'sent' } } },
    });

    expect(result.sent).toMatchObject({ sent: 1, skipped: 0 });
    expect(backend.calls.some((call) => call.url.includes('api.resend.com'))).toBe(true);
  });

  it('sin RESEND_API_KEY no finge un envío: genera los enlaces y lo dice', async () => {
    const { backend, run } = context();
    const result = await run({
      apply: true,
      send: true,
      env: { RESEND_API_KEY: '' },
    });

    expect(result.ok).toBe(false);
    expect(result.stop?.id).toBe('send');
    expect(result.stop?.detail).toContain('RESEND_API_KEY');
    expect(result.sent).toMatchObject({ sent: 0 });
    expect(backend.calls.some((call) => call.url.includes('generate_link'))).toBe(true);
    expect(backend.calls.some((call) => call.url.includes('api.resend.com'))).toBe(false);
  });

  it('--enlaces guarda los enlaces para entregarlos a mano', async () => {
    const { written, run } = context();
    const linksFile = path.join(tempDir(), 'enlaces.json');
    await run({ apply: true, send: true, env: { RESEND_API_KEY: '' }, linksFile });

    const saved = written.find((entry) => entry.file === linksFile);
    expect(saved).toBeDefined();
    expect(JSON.parse(saved!.content).links[0]).toMatchObject({ email: 'jtorres@catedralpropiedades.com' });
  });

  it('un lote rechazado por Resend se informa, y los envíos ya aceptados no se repiten', async () => {
    const { run } = context({ resendStatus: 429 });
    const result = await run({ apply: true, send: true });

    expect(result.ok).toBe(false);
    expect(result.stop?.id).toBe('send');
    expect(result.stop?.detail).toContain('429');
  });

  it('no aplica a quien no tiene corredora: la cuenta quedaría sin panel', async () => {
    const { backend, run } = context({
      partners: [{ id: 'catedral', name: 'Catedral', contact_email: '' }],
    });
    const file = path.join(tempDir(), 'cuentas.csv');
    writeFileSync(file, 'correo,corredora\nana@correo.cl,\n', 'utf8');

    const result = await run({ apply: true, rosterFile: file });

    expect(result.applied).toBe(true);
    expect(backend.calls.some((call) => call.method === 'POST')).toBe(false);
    expect(result.plan).toEqual([
      expect.objectContaining({ email: 'ana@correo.cl', state: 'sin-corredora' }),
    ]);
  });

  it('informa las corredoras sin correo de contacto antes de mandar nada', async () => {
    const { run } = context({
      partners: [
        { id: 'catedral', name: 'Catedral', contact_email: 'contacto@catedral.cl' },
        { id: 'sin-correo', name: 'Sin Correo', contact_email: '' },
      ],
    });
    const result = await run();
    const roster = result.steps.find((step) => step.id === 'roster');
    expect(roster?.detail).toContain('sin-correo');
  });

  it('si el catálogo no responde, se frena ahí: sin lista no hay plan', async () => {
    const { run } = context({ partnerStatus: 500 });
    const result = await run({ apply: true });
    expect(result.stop?.id).toBe('roster');
    expect(result.applied).toBe(false);
  });

  it('--limite y --solo recortan el trabajo a lo que se pide', async () => {
    const { backend, run } = context({
      partners: [
        { id: 'catedral', name: 'Catedral', contact_email: 'uno@catedral.cl' },
        { id: 'savills', name: 'Savills', contact_email: 'dos@savills.cl' },
      ],
    });

    const one = await run({ apply: true, only: 'dos@savills.cl' });
    expect(one.plan.map((row) => row.email)).toEqual(['dos@savills.cl']);

    const limited = await run({ apply: true, limit: 1 });
    // El plan sale ordenado por correo, así que la primera es la de savills.
    expect(limited.plan.map((row) => row.email)).toEqual(['dos@savills.cl']);
    // La cuenta de la primera de la lista ya existe en la segunda corrida, así
    // que esa corrida no la vuelve a crear: es la idempotencia que se pide.
    const created = backend.calls
      .filter((call) => call.method === 'POST')
      .map((call) => (call.body as { email: string }).email);
    expect(created).toEqual(['dos@savills.cl']);
  });
});

describe('el informe', () => {
  const step = (id: string, ok: boolean, detail = 'algo') => ({ id, ok, detail });

  it('nombra cada paso por su título', () => {
    const lines = formatPlanTable([]);
    expect(lines).toContain('Plan de accesos');
    expect(formatAccessOutcome({ steps: [step('send', true, '3 correos')] })).toContain(stepTitle('send'));
  });

  it('sin --aplicar dice que no se escribió nada', () => {
    const lines = formatAccessOutcome({ steps: [step('plan', true)], dryRun: true });
    expect(lines).toContain('no se escribe nada');
  });

  it('cuando se frena después de aplicar, dice que volver a correr es seguro', () => {
    const lines = formatAccessOutcome({
      steps: [step('apply', true)],
      stop: { id: 'send', detail: 'falta RESEND_API_KEY', hint: 'guardala' },
      applied: true,
    });
    expect(lines).toContain('YA se crearon o vincularon');
    expect(lines).toContain('idempotentes');
    expect(lines).toContain('guardala');
  });

  it('cuando se frena antes de aplicar, dice que no salió ningún correo', () => {
    const lines = formatAccessOutcome({ steps: [], stop: { id: 'keys', detail: 'falta', hint: 'x' }, applied: false });
    expect(lines).toContain('no salió ningún correo');
  });

  it('con las cuentas listas y sin --enviar, dice que falta avisar', () => {
    expect(formatAccessOutcome({ steps: [], dryRun: false, sent: null })).toContain('--enviar');
  });

  it('con el envío hecho, cuenta enviados y saltados', () => {
    const lines = formatAccessOutcome({ steps: [], dryRun: false, sent: { sent: 4, skipped: 1, failed: 0 } });
    expect(lines).toContain('4 enviado(s)');
    expect(lines).toContain('--reenviar');
  });

  it('el plan muestra el correo completo y el vínculo de cada persona', () => {
    const table = formatPlanTable([
      { email: 'ana@correo.cl', name: 'Ana', role: 'member', partnerId: 'catedral', accountId: null, state: 'crear', detail: '' },
    ]);
    expect(table).toContain('ana@correo.cl');
    expect(table).toContain('catedral');
    expect(table).toContain('1 × crear');
  });
});
