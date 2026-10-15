/**
 * Tests de `/api/health`.
 *
 * Es una ruta pública que informa de configuración, así que se comprueban dos
 * cosas: que el código HTTP distinga «falta algo crítico» de «falta algo
 * secundario» —es lo que mira un monitor de disponibilidad— y que **no se escape
 * ningún valor**, solo si está o no.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/health/route';
import { DEFAULT_OWNER_PROJECT_REF } from '@/lib/utils/supabaseOwner';

/** Todas las claves que el informe mira, para fijarlas en cada test. */
const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_OWNER_PROJECT_REF',
  'RESEND_API_KEY',
  'ALERTS_FROM_EMAIL',
  'ALERTS_CRON_SECRET',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SITE_URL',
] as const;

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnopqrstuvwxyz';
const SERVICE_KEY = 'clave-de-servicio-secreta-abcdefghijklmnopqrstuvwxyz';

const COMPLETE: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${DEFAULT_OWNER_PROJECT_REF}.supabase.co`,
  // La base esperada: el proyecto de la cuenta dueña (en el código; el entorno
  // puede declarar otro a propósito y el informe lo coteja contra ese).
  SUPABASE_OWNER_PROJECT_REF: DEFAULT_OWNER_PROJECT_REF,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  RESEND_API_KEY: 're_abcdefghijklmnopqrstuvwxyz',
  ALERTS_FROM_EMAIL: 'Rix7 <avisos@rix7.cl>',
  ALERTS_CRON_SECRET: 'un-secreto-largo-y-aleatorio',
  NEXT_PUBLIC_SENTRY_DSN: 'https://clave@o4507.ingest.sentry.io/4507',
  NEXT_PUBLIC_SITE_URL: 'https://rix7.cl',
};

/** El nombre exacto que lee la ruta (y que escribe el release). */
const BUILD_ENV = 'RIX7_BUILD';
const TREE_ID = '4f2a3c4b5d6e7f80';
const COMMIT = '9d1c3ab77e5f1234567890abcdef1234567890ab';
const STAMP = 1760361600;

/** Fija el entorno completo menos las claves que se quieran dejar vacías. */
function setEnv(overrides: Record<string, string | undefined> = {}) {
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, overrides[key] ?? COMPLETE[key] ?? '');
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/health', () => {
  it('con todo configurado responde 200 y lo dice', async () => {
    setEnv();

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body.success).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.missing).toEqual({ broken: [], degraded: [], optional: [] });
    expect(body.checkedAt).toBeTruthy();
  });

  it('responde 503 y nombra el subsistema cuando falta uno crítico', async () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.status).toBe('broken');
    expect(body.missing.broken).toEqual(['supabase']);

    const supabase = body.subsystems.find((s: { id: string }) => s.id === 'supabase');
    expect(supabase.configured).toBe(false);
    expect(supabase.reason).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(supabase.fix).toContain('Project Settings');
  });

  it('lo que falta pero no rompe el portal responde 200', async () => {
    // El catálogo se sirve desde memoria: sin Resend el portal funciona, solo no
    // salen correos. Devolver 503 acá haría que un monitor diera por caído algo
    // que está sirviendo.
    setEnv({ RESEND_API_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('degraded');
    expect(body.missing.degraded).toEqual(['service_role', 'email']);
  });

  it('responde 503 si la base no es la de la cuenta dueña del proyecto', async () => {
    // Es el caso del incidente del 2026-10-13 visto desde el otro lado: el portal
    // entero funciona, y lo que está mal es de quién es la base. Tiene que ser
    // crítico —503 y job rojo— o vuelve a pasar inadvertido.
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://wcxpkfmevrbjrjlbayba.supabase.co' });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('broken');
    expect(body.missing.broken).toEqual(['supabase_owner']);

    const owner = body.subsystems.find((s: { id: string }) => s.id === 'supabase_owner');
    expect(owner.configured).toBe(false);
    expect(owner.reason).toContain('wcxpkfmevrbjrjlbayba');
    expect(owner.reason).toContain(DEFAULT_OWNER_PROJECT_REF);
    expect(owner.fix).toContain('corte:supabase');
  });

  it('responde 503 si la clave es de otro proyecto aunque la URL sea la correcta', async () => {
    const foreign = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
      JSON.stringify({ role: 'anon', ref: 'wcxpkfmevrbjrjlbayba' }),
    ).toString('base64url')}.firma`;
    setEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: foreign });

    const body = await (await GET()).json();

    expect(body.missing.broken).toEqual(['supabase_owner']);
    expect(body.subsystems.find((s: { id: string }) => s.id === 'supabase_owner').reason).toContain(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  });

  it('informa el entorno de este despliegue', async () => {
    setEnv();
    vi.stubEnv('VERCEL_ENV', 'preview');

    const response = await GET();
    const body = await response.json();

    expect(body.environment).toBe('preview');
  });

  it('no filtra ningún valor: solo si está o no', async () => {
    setEnv();

    const response = await GET();
    const text = JSON.stringify(await response.json());

    expect(text).not.toContain(ANON_KEY);
    expect(text).not.toContain(SERVICE_KEY);
    expect(text).not.toContain('un-secreto-largo-y-aleatorio');
  });

  it('informa qué build está publicada, traducida a un objeto', async () => {
    // El identificador lo publica el deploy como variable del deployment (ver
    // `scripts/build-id.mjs`); acá se comprueba que la ruta lo traduzca, porque
    // es lo que permite comparar «lo que está en vivo» con «el árbol del repo».
    setEnv();
    vi.stubEnv(BUILD_ENV, `1.${TREE_ID}.${COMMIT}.1.${STAMP}`);

    const response = await GET();
    const body = await response.json();

    expect(body.build).toEqual({
      id: TREE_ID,
      commit: COMMIT,
      dirty: true,
      builtAt: new Date(STAMP * 1000).toISOString(),
    });
  });

  it('sin identificador responde null, no un objeto vacío', async () => {
    // Un `{ id: '' }` haría que la comparación dijera «coincide» sin haber
    // comparado nada: el hueco que este campo existe para cerrar.
    setEnv();
    vi.stubEnv(BUILD_ENV, '');

    const body = await (await GET()).json();
    expect(body.build).toBeNull();
  });

  it('un valor que no es del formato responde null en vez de adivinar', async () => {
    setEnv();
    vi.stubEnv(BUILD_ENV, 'el-de-ayer');

    const body = await (await GET()).json();
    expect(body.build).toBeNull();
  });
});
