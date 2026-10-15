/**
 * Tests del cotejo de pertenencia de la base.
 *
 * Lo que hay que proteger es una sola cosa, y es la que costó un incidente: que
 * un despliegue guarde sobre una base **de otra cuenta** sin que nadie lo note.
 * Así que se prueban las tres respuestas posibles —es la base correcta, es otra,
 * y no se pudo comprobar— y que ninguna de ellas confunda «no comprobado» con
 * «correcto».
 *
 * Las claves de los ejemplos se arman acá con `jwt()` y no viven en el repo: la
 * guardia de secretos busca valores con forma de clave, y una guardia que se
 * silencia con una excepción deja de servir.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OWNER_PROJECT_REF,
  OWNER_ACCOUNT_EMAIL,
  decodeJwtBody,
  judgeProjectOwnership,
  projectRefFromUrl,
} from './supabaseOwner';

const OWNER_REF = DEFAULT_OWNER_PROJECT_REF;
/** El proyecto de la otra cuenta: el que quedó sin dueño accesible el 2026-10-13. */
const OTHER_REF = 'wcxpkfmevrbjrjlbayba';

/** Un JWT sin firma válida: alcanza para leer el cuerpo, que es lo que se usa. */
function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.${'firma-de-test'.repeat(3)}`;
}

const anonOf = (ref: string) => jwt({ role: 'anon', ref, iss: 'supabase' });
const serviceOf = (ref: string) => jwt({ role: 'service_role', ref, iss: 'supabase' });

describe('projectRefFromUrl', () => {
  it('lee la referencia del subdominio', () => {
    expect(projectRefFromUrl(`https://${OWNER_REF}.supabase.co`)).toBe(OWNER_REF);
    expect(projectRefFromUrl('https://abc123.supabase.in')).toBe('abc123');
    expect(projectRefFromUrl(`  https://${OWNER_REF}.supabase.co/ `)).toBe(OWNER_REF);
  });

  it('no inventa una referencia cuando la URL es de otro sitio', () => {
    expect(projectRefFromUrl('https://base.rix7.cl')).toBeNull();
    expect(projectRefFromUrl('https://vsqkjimpssdvlvdwrtnh.example.com')).toBeNull();
    expect(projectRefFromUrl('')).toBeNull();
    expect(projectRefFromUrl(null)).toBeNull();
    // `supabase.co.evil.com` no es Supabase: el ancla evita el subdominio falso.
    expect(projectRefFromUrl('https://algo.supabase.co.evil.com')).toBeNull();
  });
});

describe('decodeJwtBody', () => {
  it('lee el cuerpo sin verificar la firma', () => {
    expect(decodeJwtBody(anonOf(OWNER_REF))).toMatchObject({ role: 'anon', ref: OWNER_REF });
  });

  it('devuelve null cuando no es un JWT', () => {
    expect(decodeJwtBody('sb_publishable_lo_que_sea')).toBeNull();
    expect(decodeJwtBody('eyJhbGciOiJIUzI1NiJ9')).toBeNull();
    expect(decodeJwtBody('')).toBeNull();
    expect(decodeJwtBody(null)).toBeNull();
  });

  it('devuelve null cuando el cuerpo no es un objeto', () => {
    const notAnObject = `x.${Buffer.from('"hola"').toString('base64url')}.y`;
    expect(decodeJwtBody(notAnObject)).toBeNull();
  });
});

describe('judgeProjectOwnership', () => {
  const owner = {
    url: `https://${OWNER_REF}.supabase.co`,
    anonKey: anonOf(OWNER_REF),
    serviceRoleKey: serviceOf(OWNER_REF),
    ownerProjectRef: OWNER_REF,
  };

  it('acepta la base de la cuenta dueña, con sus claves', () => {
    expect(judgeProjectOwnership(owner)).toEqual({ ok: true, ref: OWNER_REF, reason: null, notes: [] });
  });

  it('rechaza la base de otra cuenta y dice de quién es cada una', () => {
    const verdict = judgeProjectOwnership({ ...owner, url: `https://${OTHER_REF}.supabase.co`, anonKey: anonOf(OTHER_REF) });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain(OTHER_REF);
    expect(verdict.reason).toContain(OWNER_REF);
    expect(verdict.reason).toContain(OWNER_ACCOUNT_EMAIL);
  });

  it('rechaza una URL que no es de Supabase', () => {
    const verdict = judgeProjectOwnership({ ...owner, url: 'https://base.prestada.cl' });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('rechaza la clave pública de otro proyecto aunque la URL sea la correcta', () => {
    // El error de copiar y pegar: la URL del proyecto propio con la clave del
    // otro. Sin este cotejo, la respuesta llegaría recién como 401 de la base.
    const verdict = judgeProjectOwnership({ ...owner, anonKey: anonOf(OTHER_REF) });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(verdict.reason).toContain(OTHER_REF);
  });

  it('rechaza la clave de servicio de otro proyecto', () => {
    const verdict = judgeProjectOwnership({ ...owner, serviceRoleKey: serviceOf(OTHER_REF) });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('no falla por una clave nueva, pero deja dicho que no la pudo cotejar', () => {
    // Las `sb_publishable_…` no llevan la referencia en su cuerpo: callarse eso
    // sería presentar un «no comprobado» como un aprobado.
    const verdict = judgeProjectOwnership({ ...owner, anonKey: 'sb_publishable_abc', serviceRoleKey: 'sb_secret_abc' });

    expect(verdict.ok).toBe(true);
    expect(verdict.notes.join(' ')).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(verdict.notes.join(' ')).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(verdict.notes.join(' ')).toContain('No se pudo cotejar');
  });

  it('sin URL o con el placeholder no hay nada que cotejar, y lo dice', () => {
    expect(judgeProjectOwnership({ ...owner, url: null }).notes.join(' ')).toContain('no hay proyecto que cotejar');
    expect(judgeProjectOwnership({ ...owner, url: 'https://placeholder-project.supabase.co' }).notes.join(' ')).toContain('placeholder');
    // Los dos casos se resuelven como «no hay nada mal acá»: quien avisa de eso
    // es el subsistema `supabase`, que sí es crítico cuando no hay proyecto.
    expect(judgeProjectOwnership({ ...owner, url: null }).ok).toBe(true);
  });

  it('sin referencia de la cuenta dueña no se coteja nada', () => {
    const verdict = judgeProjectOwnership({ ...owner, url: `https://${OTHER_REF}.supabase.co`, ownerProjectRef: null });

    expect(verdict.ok).toBe(true);
    expect(verdict.notes.join(' ')).toContain('SUPABASE_OWNER_PROJECT_REF');
  });

  it('una clave ausente no inventa un fallo: la reporta el subsistema que le toca', () => {
    const verdict = judgeProjectOwnership({ ...owner, anonKey: null, serviceRoleKey: null });
    expect(verdict).toEqual({ ok: true, ref: OWNER_REF, reason: null, notes: [] });
  });

  it('nunca devuelve el valor de una clave', () => {
    const anon = anonOf(OTHER_REF);
    const verdict = judgeProjectOwnership({ ...owner, anonKey: anon });

    expect(JSON.stringify(verdict)).not.toContain(anon);
    expect(JSON.stringify(verdict)).not.toContain('firma-de-test');
  });
});
