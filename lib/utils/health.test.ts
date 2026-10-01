/**
 * Tests del informe de salud.
 *
 * Lo que importa que sea correcto: que el informe **distinga** un subsistema de
 * otro (es toda su razón de ser), que no degrade el estado por algo opcional, y
 * que cada faltante venga con qué deja de funcionar y qué hacer.
 */
import { describe, expect, it } from 'vitest';

import {
  buildHealthReport,
  describeSubsystems,
  httpStatus,
  subsystemEnvFrom,
  type SubsystemId,
  type SubsystemInput,
  type SubsystemStatus,
} from './health';

const COMPLETE: SubsystemInput = {
  supabaseUrl: 'https://abcdefghijkl.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnopqrstuvwxyz',
  supabaseServiceRoleKey: 'clave-de-servicio-abcdefghijklmnopqrstuvwxyz',
  resendApiKey: 're_abcdefghijklmnopqrstuvwxyz',
  alertsFromEmail: 'Rix7 <avisos@rix7.cl>',
  alertsCronSecret: 'un-secreto-largo-y-aleatorio',
  sentryDsn: 'https://clave@o4507.ingest.sentry.io/4507',
  siteUrl: 'https://rix7.cl',
};

const without = (...keys: (keyof SubsystemInput)[]): SubsystemInput => {
  const copy = { ...COMPLETE };
  for (const key of keys) copy[key] = null;
  return copy;
};

const find = (subsystems: SubsystemStatus[], id: SubsystemId): SubsystemStatus => {
  const found = subsystems.find((subsystem) => subsystem.id === id);
  if (!found) throw new Error(`No se describió el subsistema ${id}`);
  return found;
};

describe('subsystemEnvFrom', () => {
  it('lee las variables del proyecto, incluidas las dos formas del DSN de Sentry', () => {
    const env = subsystemEnvFrom({
      NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'clave',
      SUPABASE_SERVICE_ROLE_KEY: 'servicio',
      RESEND_API_KEY: 're_123',
      ALERTS_FROM_EMAIL: 'a@b.cl',
      ALERTS_CRON_SECRET: 'secreto',
      SENTRY_DSN: 'https://srv.ingest.sentry.io/1',
      NEXT_PUBLIC_SITE_URL: 'https://rix7.cl',
    });

    expect(env.supabaseUrl).toBe('https://abc.supabase.co');
    expect(env.sentryDsn).toBe('https://srv.ingest.sentry.io/1');
    expect(env.siteUrl).toBe('https://rix7.cl');
  });

  it('prefiere el DSN público y cae al del servidor', () => {
    const both = subsystemEnvFrom({
      NEXT_PUBLIC_SENTRY_DSN: 'https://publico/1',
      SENTRY_DSN: 'https://servidor/1',
    });

    expect(both.sentryDsn).toBe('https://publico/1');
  });

  it('una cadena vacía o con espacios es «no configurado»', () => {
    // Un valor en blanco es tan inservible como la variable ausente, y decirlo
    // evita el rato perdido buscando por qué «está puesta» y no funciona.
    expect(subsystemEnvFrom({ RESEND_API_KEY: '' }).resendApiKey).toBeNull();
    expect(subsystemEnvFrom({ RESEND_API_KEY: '   ' }).resendApiKey).toBeNull();
    expect(subsystemEnvFrom({ RESEND_API_KEY: '  re_123  ' }).resendApiKey).toBe('re_123');
  });

  it('sin nada definido devuelve todo vacío', () => {
    expect(subsystemEnvFrom()).toEqual({
      supabaseUrl: null,
      supabaseAnonKey: null,
      supabaseServiceRoleKey: null,
      resendApiKey: null,
      alertsFromEmail: null,
      alertsCronSecret: null,
      sentryDsn: null,
      siteUrl: null,
    });
  });
});

describe('buildHealthReport', () => {
  it('con todo puesto no falta nada', () => {
    const report = buildHealthReport(COMPLETE);

    expect(report.status).toBe('ok');
    expect(report.broken).toEqual([]);
    expect(report.degraded).toEqual([]);
    expect(report.optional).toEqual([]);
    expect(report.summary).toContain('Todo lo que el portal necesita');
    expect(httpStatus(report)).toBe(200);
  });

  it('deja el portal «broken» solo por lo crítico y explica cuál es', () => {
    const report = buildHealthReport(without('supabaseUrl', 'supabaseAnonKey'));

    expect(report.status).toBe('broken');
    expect(report.broken).toEqual(['supabase']);
    expect(httpStatus(report)).toBe(503);

    const supabase = find(report.subsystems, 'supabase');
    expect(supabase.configured).toBe(false);
    // El motivo es específico: decir «Supabase no está configurado» era
    // exactamente el mensaje genérico que este informe viene a reemplazar.
    expect(supabase.reason).toContain('Falta NEXT_PUBLIC_SUPABASE_URL');
    expect(supabase.reason).toContain('Falta NEXT_PUBLIC_SUPABASE_ANON_KEY');
  });

  it('señala el placeholder como lo que es', () => {
    const report = buildHealthReport({
      ...COMPLETE,
      supabaseUrl: 'https://placeholder-project.supabase.co',
    });

    expect(report.status).toBe('broken');
    expect(find(report.subsystems, 'supabase').reason).toContain('ejemplo');
  });

  it('distingue la clave anon que falta de la URL que falta', () => {
    const report = buildHealthReport(without('supabaseAnonKey'));
    const reason = find(report.subsystems, 'supabase').reason ?? '';

    expect(reason).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(reason).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('sin clave de servicio queda degradado, no roto: el portal anda', () => {
    const report = buildHealthReport(without('supabaseServiceRoleKey'));

    expect(report.status).toBe('degraded');
    expect(report.degraded).toEqual(['service_role']);
    expect(report.broken).toEqual([]);
    expect(httpStatus(report)).toBe(200);
    // Y el efecto concreto se dice, no solo que «falta una variable».
    expect(find(report.subsystems, 'service_role').impact).toContain('/api/alerts/run');
  });

  it('sin proveedor de correo también queda degradado', () => {
    const report = buildHealthReport(without('resendApiKey'));
    const email = find(report.subsystems, 'email');

    expect(report.status).toBe('degraded');
    expect(report.degraded).toContain('email');
    expect(email.reason).toContain('RESEND_API_KEY');
    expect(email.impact).toContain('bienvenida');
  });

  it('lo opcional no degrada el estado', () => {
    const report = buildHealthReport(without('sentryDsn', 'siteUrl'));

    expect(report.status).toBe('ok');
    expect(report.optional).toEqual(['monitoring', 'site_url']);
    expect(httpStatus(report)).toBe(200);
  });

  it('cuenta cuántos de cuántos faltan, por gravedad', () => {
    const report = buildHealthReport(without('supabaseServiceRoleKey', 'resendApiKey'));

    expect(report.summary).toContain('2 de 6');
    expect(report.summary).toContain('degradados: service_role, email');
  });

  it('el correo configurado sin remitente propio avisa qué va a usar', () => {
    const report = buildHealthReport(without('alertsFromEmail'));
    const email = find(report.subsystems, 'email');

    expect(email.configured).toBe(true);
    expect(email.notes.join(' ')).toContain('avisos@rix7.cl');
    expect(report.status).toBe('ok');
  });
});

describe('cada subsistema del informe', () => {
  it('existe con su etiqueta, su consecuencia y su arreglo', () => {
    const subsystems = describeSubsystems(without(...Object.keys(COMPLETE) as (keyof SubsystemInput)[]));

    expect(subsystems.map((s) => s.id)).toEqual([
      'supabase',
      'service_role',
      'email',
      'alerts_cron',
      'monitoring',
      'site_url',
    ]);

    for (const subsystem of subsystems) {
      expect(subsystem.configured, subsystem.id).toBe(false);
      // Un informe que diga «falta algo» sin decir qué hacer deja al lector donde
      // empezó: los dos campos tienen que venir siempre.
      expect(subsystem.impact.length, subsystem.id).toBeGreaterThan(20);
      expect(subsystem.fix.length, subsystem.id).toBeGreaterThan(20);
      expect(subsystem.reason, subsystem.id).toBeTruthy();
    }
  });

  it('cuando está configurado no arrastra un motivo de falla', () => {
    for (const subsystem of describeSubsystems(COMPLETE)) {
      expect(subsystem.configured, subsystem.id).toBe(true);
      expect(subsystem.reason, subsystem.id).toBeNull();
    }
  });
});
