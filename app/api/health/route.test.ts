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

/** Todas las claves que el informe mira, para fijarlas en cada test. */
const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
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
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  RESEND_API_KEY: 're_abcdefghijklmnopqrstuvwxyz',
  ALERTS_FROM_EMAIL: 'Rix7 <avisos@rix7.cl>',
  ALERTS_CRON_SECRET: 'un-secreto-largo-y-aleatorio',
  NEXT_PUBLIC_SENTRY_DSN: 'https://clave@o4507.ingest.sentry.io/4507',
  NEXT_PUBLIC_SITE_URL: 'https://rix7.cl',
};

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
});
