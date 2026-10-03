/**
 * Estado de los subsistemas que el portal necesita para funcionar **de verdad**.
 *
 * Existe por un problema concreto: cuando algo no estaba configurado, la
 * respuesta era un `503` con un mensaje genérico («Supabase no está configurado
 * en este entorno»), y eso no distingue entre que falte la URL del proyecto, la
 * clave anon, la clave de servicio o el proveedor de correo. Averiguarlo exigía
 * leer el código.
 *
 * Acá cada pieza se describe sola: si está, si no, **qué deja de funcionar**
 * mientras falte y **qué hacer** para ponerla. Es un módulo neutral (no importa
 * Supabase, ni React, ni Next): lo usan la ruta `/api/health` y el registro de
 * arranque del servidor, y se prueba sin levantar nada.
 *
 * No hace ninguna petición de red a propósito: responde «¿qué falta
 * configurar?», que es la pregunta que se puede contestar en milisegundos y sin
 * depender de que el otro extremo esté vivo. Comprobar que Supabase **responde**
 * es otra cosa, y para eso ya están `npm run check:auth` y el modo `?dry=1` de
 * `/api/alerts/run`.
 */
import { describeAnonKeyProblem, describeSupabaseUrlProblem } from './supabaseEnv';

export type SubsystemId =
  | 'supabase'
  | 'service_role'
  | 'email'
  | 'alerts_cron'
  | 'monitoring'
  | 'site_url';

/**
 * Qué implica que falte:
 *
 * - `critical`: sin esto no hay portal interactivo (cuentas, favoritos, altas,
 *   panel). El catálogo se sigue viendo porque vive en memoria, pero el alta de
 *   datos no se guarda.
 * - `degraded`: el portal anda, una parte no (avisos por correo, job de alertas).
 * - `optional`: solo se pierde comodidad o visibilidad (monitoreo, URL canónica).
 */
export type Severity = 'critical' | 'degraded' | 'optional';

export type HealthStatus = 'ok' | 'degraded' | 'broken';

/** Foto explícita de las variables, para no depender del `process.env` global. */
export interface SubsystemInput {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKey: string | null;
  resendApiKey: string | null;
  alertsFromEmail: string | null;
  alertsCronSecret: string | null;
  sentryDsn: string | null;
  siteUrl: string | null;
}

export interface SubsystemStatus {
  id: SubsystemId;
  label: string;
  severity: Severity;
  configured: boolean;
  /** Por qué no está configurado; `null` cuando está. */
  reason: string | null;
  /** Lo que falta mientras esté incompleto (por ejemplo, el remitente por defecto). */
  notes: string[];
  /** Qué deja de funcionar mientras falte. */
  impact: string;
  /** Qué hacer para configurarlo. */
  fix: string;
}

export interface HealthReport {
  status: HealthStatus;
  subsystems: SubsystemStatus[];
  /** Los que faltan, separados por lo que implican. */
  broken: SubsystemId[];
  degraded: SubsystemId[];
  optional: SubsystemId[];
  /** Cuántos de cuántos y cuáles, en una línea. */
  summary: string;
}

/** Remitente por defecto de los correos (`lib/email/sendEmail`). */
const DEFAULT_FROM = 'Rix7 <avisos@rix7.cl>';

const MISSING = {
  supabase:
    'Ni cuentas ni favoritos ni altas con autorizaciones ni panel: sin un proyecto real, todo eso cae al respaldo en memoria del servidor o falla cerrado.',
  serviceRole:
    'El job de alertas no puede leer las búsquedas de todas las personas: `/api/alerts/run` responde 503 y los avisos no salen.',
  email:
    'No sale ningún correo: ni el aviso de búsquedas guardadas ni la bienvenida al registrarse. Se informa como «saltado» en vez de fingir el envío.',
  cronSecret:
    'El cron no puede disparar el job: `/api/alerts/run` responde 503 y las alertas no se envían solas.',
  monitoring:
    'Los errores quedan solo en los registros del servidor: no hay avisos ni seguimiento de cuántas veces pasó.',
  siteUrl:
    'El sitemap, el canonical y las tarjetas Open Graph apuntan al dominio por defecto.',
} as const;

const FIXES = {
  supabase:
    'Pon NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY del proyecto real (Project Settings » API) en .env.local y en Vercel.',
  serviceRole:
    'Pon SUPABASE_SERVICE_ROLE_KEY (Project Settings » API » service_role) en Vercel. No lleva prefijo NEXT_PUBLIC_ a propósito: nunca debe llegar al navegador.',
  email:
    'Pon RESEND_API_KEY en Vercel. El dominio del remitente tiene que estar verificado en Resend.',
  cronSecret:
    'Genera una cadena larga en ALERTS_CRON_SECRET, en Vercel y en los secretos de GitHub (lo usa .github/workflows/alerts-run.yml).',
  monitoring:
    'Pon NEXT_PUBLIC_SENTRY_DSN y SENTRY_DSN (opcional: sin ellos el SDK queda en no-op y `reportError` solo escribe en consola).',
  siteUrl: 'Pon NEXT_PUBLIC_SITE_URL=https://rix7.cl (sin barra final).',
} as const;

/**
 * Lee las variables del entorno. Se pasa el `process.env` explícitamente para
 * poder probar cada combinación sin tocar el entorno real.
 */
export function subsystemEnvFrom(
  source: Record<string, string | undefined> = {}
): SubsystemInput {
  const read = (key: string): string | null => {
    const value = source[key];
    return value && value.trim() ? value.trim() : null;
  };

  return {
    supabaseUrl: read('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: read('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: read('SUPABASE_SERVICE_ROLE_KEY'),
    resendApiKey: read('RESEND_API_KEY'),
    alertsFromEmail: read('ALERTS_FROM_EMAIL'),
    alertsCronSecret: read('ALERTS_CRON_SECRET'),
    // Sirven las dos: la pública la usa el cliente, la otra el runtime del servidor.
    sentryDsn: read('NEXT_PUBLIC_SENTRY_DSN') ?? read('SENTRY_DSN'),
    siteUrl: read('NEXT_PUBLIC_SITE_URL'),
  };
}

/** El estado de cada subsistema, en el orden en que se leen. */
export function describeSubsystems(input: SubsystemInput): SubsystemStatus[] {
  // Se reutilizan los diagnósticos del modal de acceso: son los mismos valores y
  // sus motivos ya están probados (`lib/utils/supabaseEnv`).
  const supabaseProblems = [
    describeSupabaseUrlProblem(input.supabaseUrl),
    describeAnonKeyProblem(input.supabaseAnonKey),
  ].filter((problem): problem is string => problem !== null);

  const hasResend = Boolean(input.resendApiKey);
  const emailNotes = hasResend
    ? [
        input.alertsFromEmail
          ? null
          : `Sin ALERTS_FROM_EMAIL los correos salen con el remitente por defecto (${DEFAULT_FROM}).`,
      ].filter((note): note is string => note !== null)
    : [];

  return [
    {
      id: 'supabase',
      label: 'Supabase (proyecto real)',
      severity: 'critical',
      configured: supabaseProblems.length === 0,
      reason: supabaseProblems.length ? supabaseProblems.join(' ') : null,
      notes: [],
      impact: MISSING.supabase,
      fix: FIXES.supabase,
    },
    {
      id: 'service_role',
      label: 'Clave de servicio de Supabase',
      severity: 'degraded',
      configured: Boolean(input.supabaseServiceRoleKey),
      reason: input.supabaseServiceRoleKey ? null : 'Falta SUPABASE_SERVICE_ROLE_KEY.',
      notes: [],
      impact: MISSING.serviceRole,
      fix: FIXES.serviceRole,
    },
    {
      id: 'email',
      label: 'Correo saliente (Resend)',
      severity: 'degraded',
      configured: hasResend,
      reason: hasResend ? null : 'Falta RESEND_API_KEY.',
      notes: emailNotes,
      impact: MISSING.email,
      fix: FIXES.email,
    },
    {
      id: 'alerts_cron',
      label: 'Secreto del cron de alertas',
      severity: 'degraded',
      configured: Boolean(input.alertsCronSecret),
      reason: input.alertsCronSecret ? null : 'Falta ALERTS_CRON_SECRET.',
      notes: [],
      impact: MISSING.cronSecret,
      fix: FIXES.cronSecret,
    },
    {
      id: 'monitoring',
      label: 'Monitoreo de errores (Sentry)',
      severity: 'optional',
      configured: Boolean(input.sentryDsn),
      reason: input.sentryDsn ? null : 'Falta NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN.',
      notes: [],
      impact: MISSING.monitoring,
      fix: FIXES.monitoring,
    },
    {
      id: 'site_url',
      label: 'URL canónica del sitio',
      severity: 'optional',
      configured: Boolean(input.siteUrl),
      reason: input.siteUrl ? null : 'Falta NEXT_PUBLIC_SITE_URL.',
      notes: [],
      impact: MISSING.siteUrl,
      fix: FIXES.siteUrl,
    },
  ];
}

function list(ids: string[]): string {
  return ids.join(', ');
}

/**
 * El informe completo.
 *
 * El estado global es `broken` solo si falta algo **crítico**: el portal se sirve
 * igual sin Supabase (el catálogo vive en memoria), pero sin él no se guarda
 * nada de lo que la gente hace, y eso merece que un monitor de disponibilidad se
 * entere.
 */
export function buildHealthReport(input: SubsystemInput): HealthReport {
  const subsystems = describeSubsystems(input);
  const idsOf = (severity: Severity) =>
    subsystems.filter((s) => s.severity === severity && !s.configured).map((s) => s.id);

  const broken = idsOf('critical');
  const degraded = idsOf('degraded');
  const optional = idsOf('optional');

  const status: HealthStatus = broken.length ? 'broken' : degraded.length ? 'degraded' : 'ok';

  const missingCount = broken.length + degraded.length + optional.length;
  let summary: string;
  if (status === 'ok') {
    summary = 'Todo lo que el portal necesita está configurado.';
  } else {
    const parts = [
      broken.length ? `críticos: ${list(broken)}` : null,
      degraded.length ? `degradados: ${list(degraded)}` : null,
      optional.length ? `opcionales: ${list(optional)}` : null,
    ].filter((part): part is string => part !== null);

    summary = `${missingCount} de ${subsystems.length} subsistemas sin configurar — ${parts.join('; ')}.`;
    if (status === 'degraded' && !degraded.length) {
      // No debería pasar (status sería 'ok'), pero deja el texto coherente.
      summary = `${missingCount} de ${subsystems.length} subsistemas sin configurar.`;
    }
  }

  return { status, subsystems, broken, degraded, optional, summary };
}

/**
 * Código con el que responder la ruta: `503` solo cuando falta algo crítico, para
 * que un monitor de disponibilidad lo note sin castigar que el portal siga
 * sirviendo el catálogo.
 */
export function httpStatus(report: HealthReport): 200 | 503 {
  return report.status === 'broken' ? 503 : 200;
}
