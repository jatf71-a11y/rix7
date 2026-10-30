#!/usr/bin/env node
/**
 * Audita **todas** las credenciales que el proyecto necesita: cuáles están, cuáles
 * faltan, si tienen la forma esperada y —cuando falta una— **dónde se consigue
 * exactamente** y con qué comando se guarda. Un solo comando, una sola pantalla.
 *
 * ¿Por qué existe? Porque conseguir la clave que faltaba exigía armar la respuesta
 * a mano, juntando cuatro documentos: el registro de cuentas y servicios (§3 dice
 * dónde vive cada credencial), `health.ts` (dice qué se rompe sin ella), `DEPLOY.md`
 * y los runbooks. Y en el medio, la pregunta que de verdad importa —«¿puedo correr
 * el corte o me falta algo?»— no la contestaba ninguno.
 *
 * Lo que **no** hace, a propósito:
 *
 * - **No comprueba si la base responde.** Eso es `npm run check:auth` (habla con
 *   el proyecto) y `npm run check:schema` (mira el esquema). Acá solo se mira lo
 *   que hay configurado, sin red, en milisegundos.
 * - **No dice de quién es la base.** Eso es `npm run check:cuenta`, que necesita
 *   el token justamente porque es la única pregunta que no se contesta con lo que
 *   ya está escrito en la máquina.
 * - **No toca Vercel.** Las variables del despliegue las sincroniza
 *   `npm run vercel:sync`, y su vista previa sin escribir nada es
 *   `npm run corte:supabase -- --dry-run`.
 *
 * La forma de cada valor se valida con los mismos clasificadores que usan los otros
 * comandos (`classifySupabaseUrl`, `classifyAnonKey`, `isPlausibleSecret`): así este
 * informe y el corte no pueden discrepar sobre si una clave «sirve».
 *
 * Nada de esto imprime un valor: solo nombres, estados y la forma.
 *
 * ## Uso
 *
 *   npm run check:credenciales                # lo que hay en .env.local y en el entorno
 *   npm run check:credenciales -- --online    # además: sesión de Vercel y secretos del repo
 *   npm run check:credenciales -- --json      # para encadenar con otras herramientas
 *
 * Salida: `0` = no falta nada crítico ni degradado (pueden faltar opcionales) ·
 *         `1` = falta algo que el portal necesita · `2` = el comando se usó mal.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { classifyAnonKey, classifySupabaseUrl, readEnvContent } from './check-auth-config.mjs';
import { DEFAULT_FILE } from './vercel-sync-env.mjs';
import { isPlausibleSecret } from './token-supabase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** El archivo local de variables, el mismo que leen el corte y `db:push`. */
export const ENV_FILE = DEFAULT_FILE;

/**
 * El proyecto de la **cuenta dueña** y su correo. Van literales y no en variables
 * por el mismo motivo que en `lib/utils/supabaseOwner`: son el dato que estos
 * comandos defienden, y un valor que se puede cambiar desde el entorno sin querer
 * no defiende nada. Si un día cambia el proyecto, se cambia acá y en
 * `lib/utils/supabaseOwner` — hay un test que comprueba que sigan coincidiendo.
 */
export const OWNER_PROJECT_REF = 'vsqkjimpssdvlvdwrtnh';
export const OWNER_ACCOUNT_EMAIL = 'jatf71@gmail.com';

/** El proyecto de Vercel y el archivo que dice a cuál está enlazado el repo. */
export const EXPECTED_VERCEL_PROJECT_ID = 'prj_38HRJ2h2Q8lxjsXu4pRU6MkRpMD4';
export const VERCEL_LINK_FILE = '.vercel/project.json';

/** La consola de Supabase del proyecto de la cuenta dueña (no es un secreto: es su URL). */
const SUPABASE_PROJECT_URL = `https://supabase.com/dashboard/project/${OWNER_PROJECT_REF}`;

/** El prefijo de los respaldos del archivo de variables (`cp .env.local .env.local.pre-…`). */
export const BACKUP_PREFIX = '.env.local.pre-';

/**
 * Cuánto se espera a los comandos externos de `--online`.
 *
 * 60 s y no 20: la CLI de Vercel —que `npx` baja la primera vez— tardó 41 s en
 * responder `whoami` en esta máquina, así que con un tope corto el informe decía
 * «la CLI no tiene sesión» sobre una sesión que estaba. Un tiempo agotado no es un
 * veredicto: por eso, además, se informa como «sin comprobar» y no como falta.
 */
export const ONLINE_TIMEOUT_MS = 60000;

// ═════════════════════════════════════════════════════════════════════════════
// El catálogo
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Qué implica que falte. Son las mismas tres palabras que usa
 * `lib/utils/health` para que el informe de salud y este digan lo mismo:
 *
 * - `critical`: sin esto no hay portal interactivo (cuentas, altas, panel).
 * - `degraded`: el portal anda, una parte no (avisos, panel de socias, corte).
 * - `optional`: solo se pierde visibilidad o comodidad.
 *
 * @typedef {'critical' | 'degraded' | 'optional'} Severity
 */

/**
 * @typedef {object} Credential
 * @property {string} id
 * @property {string} label
 * @property {string[]} vars      Nombres aceptados; el primero es el que se documenta.
 * @property {Severity} severity
 * @property {string} impact      Qué deja de funcionar mientras falte.
 * @property {string} where       Dónde se consigue, con el camino exacto en el panel.
 * @property {string | null} link Página donde se emite, cuando existe.
 * @property {string} save        El comando (o el lugar) con el que se guarda.
 * @property {boolean} [cut]      Si el corte de Supabase la necesita.
 * @property {(value: string) => { ok: boolean, problem?: string | null, note?: string | null }} [shape]
 * @property {string} [note]      Advertencia permanente, con o sin valor.
 */

/** La forma de un valor: `ok: false` con el motivo, o `ok: true` con una nota si la hay. */
const shapeOf = (value) => ({ ok: true, problem: null, note: null });

/** Una cadena larga inventada: es lo que `ALERTS_CRON_SECRET` tiene que ser. */
const shapeLongSecret = (value) =>
  value.trim().length >= 16
    ? shapeOf(value)
    : { ok: false, problem: 'Es corta para un secreto: conviene una cadena larga generada al azar.' };

/** Un correo, con o sin nombre para mostrar («Rix7 <avisos@rix7.cl>»). */
const shapeEmail = (value) =>
  value.includes('@') ? shapeOf(value) : { ok: false, problem: 'No parece un correo.' };

/** La clave de Resend: `re_` y el resto del alfabeto que usa el servicio. */
const shapeResendKey = (value) =>
  /^re_[A-Za-z0-9_-]{16,}$/.test(value.trim())
    ? shapeOf(value)
    : { ok: false, problem: 'No empieza con el prefijo de Resend.' };

/** Un DSN de Sentry: `https://<clave>@<organización>.ingest.sentry.io/<proyecto>`. */
const shapeSentryDsn = (value) =>
  /^https:\/\/[^@\s]+@[^/\s]+\/\d+$/.test(value.trim())
    ? shapeOf(value)
    : { ok: false, problem: 'No tiene la forma de un DSN de Sentry.' };

/** El token personal de Supabase: reusa el validador que usa `db:token`. */
const shapeAccessToken = (value) => {
  const verdict = isPlausibleSecret('SUPABASE_ACCESS_TOKEN', value);
  return verdict.ok ? shapeOf(value) : { ok: false, problem: verdict.hint };
};

/** La clave de servicio: clásica (`eyJ…`) o nueva (`sb_secret_…`). */
const shapeServiceKey = (value) => {
  const verdict = isPlausibleSecret('SUPABASE_SERVICE_ROLE_KEY', value);
  return verdict.ok ? shapeOf(value) : { ok: false, problem: verdict.hint };
};

/** La URL del proyecto, con el clasificador compartido. */
const shapeSupabaseUrl = (value) => {
  const verdict = classifySupabaseUrl(value);
  return verdict.ok
    ? { ok: true, problem: null, note: verdict.note ?? null, ref: verdict.ref ?? null }
    : { ok: false, problem: verdict.reason, ref: null };
};

/** La clave pública, con el clasificador compartido. */
const shapeAnonKey = (value) => {
  const verdict = classifyAnonKey(value);
  return verdict.ok ? shapeOf(value) : { ok: false, problem: verdict.reason };
};

/**
 * El catálogo completo. El orden es el de la cadena de dependencias: primero lo que
 * hace falta para que el portal funcione, después lo que hace falta para operarlo
 * (el corte, el correo, el CI) y al final lo opcional.
 *
 * @type {Credential[]}
 */
export const CREDENTIALS = [
  {
    id: 'supabase_url',
    label: 'Supabase: URL del proyecto',
    vars: ['NEXT_PUBLIC_SUPABASE_URL'],
    severity: 'critical',
    cut: true,
    impact: 'Ni cuentas ni altas ni panel: sin proyecto real el portal cae al catálogo en memoria y no guarda nada.',
    where: `Supabase → proyecto rix7-portal (${OWNER_PROJECT_REF}) → Project Settings » API Keys`,
    link: `${SUPABASE_PROJECT_URL}/settings/api-keys`,
    save: '`.env.local` (y `npm run vercel:sync` para el despliegue)',
    shape: shapeSupabaseUrl,
  },
  {
    id: 'supabase_anon_key',
    label: 'Supabase: clave pública',
    vars: ['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    severity: 'critical',
    cut: true,
    impact: 'El navegador no puede hablar con la base: login, favoritos y catálogo fallan.',
    where: `Supabase → proyecto rix7-portal (${OWNER_PROJECT_REF}) → Project Settings » API Keys → **Publishable key** (\`sb_publishable_…\`) o la pestaña **Legacy** (\`anon\`, \`eyJ…\`)`,
    link: `${SUPABASE_PROJECT_URL}/settings/api-keys`,
    save: '`.env.local` (y `npm run vercel:sync`)',
    shape: shapeAnonKey,
    note: 'Es pública a propósito: viaja al navegador y sale en el bundle. La que nunca sale es la de servicio.',
  },
  {
    id: 'supabase_service_role_key',
    label: 'Supabase: clave de servicio',
    vars: ['SUPABASE_SERVICE_ROLE_KEY'],
    severity: 'degraded',
    cut: true,
    impact: 'El panel de socias y los avisos responden 401/503, y el corte de Vercel no puede correr: es la clave que falta para apuntar producción a la base propia.',
    where: `Supabase → proyecto rix7-portal (${OWNER_PROJECT_REF}) → Project Settings » API Keys → sección **Secret keys** → fila \`default\` → **Copy API key** (\`sb_secret_…\`)`,
    link: `${SUPABASE_PROJECT_URL}/settings/api-keys`,
    save: '`npm run env:secret` (se pega sin eco; la aplica al despliegue el corte)',
    shape: shapeServiceKey,
    note: 'Va sin el prefijo NEXT_PUBLIC_ a propósito: salta RLS, así que nunca debe llegar al navegador.',
  },
  {
    id: 'supabase_access_token',
    label: 'Supabase: token personal',
    vars: ['SUPABASE_ACCESS_TOKEN'],
    severity: 'degraded',
    impact: 'No se pueden aplicar migraciones (`db:push`, `db:status`) y la sonda de cada 6 h se saltea la comprobación de titularidad en vez de hacerla.',
    where: 'Supabase → tu avatar → **Access Tokens** → **Generate new token** (conviene con alcance de solo lectura: «Organization Projects → Read» y «Organization Members → Read»)',
    link: 'https://supabase.com/dashboard/account/tokens',
    save: '`npm run db:token` (local) · `gh secret set SUPABASE_ACCESS_TOKEN` (para el CI)',
    shape: shapeAccessToken,
    note: 'Solo se muestra una vez al emitirlo: si se perdió, se emite otro. Con el token vigente alcanza para `check:cuenta`, no para cambiar nada.',
  },
  {
    id: 'vercel_oidc_token',
    label: 'Vercel: token del proyecto',
    vars: ['VERCEL_OIDC_TOKEN'],
    severity: 'optional',
    impact: 'Se pierden los datos de despliegue que no pasan por la CLI; nada del portal deja de funcionar.',
    where: 'Se baja del proyecto enlazado con la CLI',
    link: null,
    save: '`npx vercel env pull` (o `npx vercel link` si el repo todavía no está enlazado)',
    note: 'Caduca solo: si venció, se vuelve a bajar. No es un secreto que haya que guardar en ningún lado.',
  },
  {
    id: 'resend_api_key',
    label: 'Correo: clave de Resend',
    vars: ['RESEND_API_KEY'],
    severity: 'degraded',
    impact: 'No sale ningún correo: ni la bienvenida al registrarse ni los avisos de búsquedas guardadas. `accesos:socias --enviar` no puede mandar los enlaces.',
    where: 'Resend → **API Keys** (cuenta del equipo; el dominio del remitente tiene que estar verificado ahí)',
    link: 'https://resend.com/api-keys',
    save: 'Vercel (variable de entorno). En `.env.local` solo hace falta para correr `accesos:socias --enviar` desde esta máquina',
    shape: shapeResendKey,
  },
  {
    id: 'alerts_cron_secret',
    label: 'Avisos: secreto del cron',
    vars: ['ALERTS_CRON_SECRET'],
    severity: 'degraded',
    impact: 'El cron no puede disparar el job: `/api/alerts/run` responde 503 y las alertas no salen solas.',
    where: 'No se consigue en ningún panel: se genera (cualquier cadena larga al azar)',
    link: null,
    save: '`gh secret set ALERTS_CRON_SECRET` y la misma en Vercel (los dos lados, o el cron no pasa)',
    shape: shapeLongSecret,
  },
  {
    id: 'alerts_from_email',
    label: 'Correo: remitente de los avisos',
    vars: ['ALERTS_FROM_EMAIL'],
    severity: 'optional',
    impact: 'Los correos salen con el remitente por defecto («Rix7 <avisos@rix7.cl>»).',
    where: 'Es un valor, no un secreto: el correo verificado en Resend para el dominio',
    link: null,
    save: 'Vercel (variable de entorno)',
    shape: shapeEmail,
  },
  {
    id: 'solicitudes_email_to',
    label: 'Solicitudes: correo del equipo',
    vars: ['SOLICITUDES_EMAIL_TO'],
    severity: 'degraded',
    impact:
      'Las solicitudes de corredora, inmobiliaria y profesional independiente se guardan y aparecen en /admin/solicitudes, pero nadie recibe el aviso por correo.',
    where: 'Es un valor, no un secreto: la bandeja del equipo que revisa los registros',
    link: null,
    save: 'Vercel (variable de entorno, Production)',
    shape: shapeEmail,
  },
  {
    id: 'sentry_dsn',
    label: 'Monitoreo: DSN de Sentry',
    vars: ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN'],
    severity: 'optional',
    impact: 'Los errores quedan solo en los registros del servidor: no hay avisos ni conteo de repeticiones.',
    where: 'Sentry → la organización del equipo → **Project Settings » Client Keys (DSN)**',
    link: 'https://sentry.io/settings/projects/',
    save: 'Vercel. Sirven las dos: la pública la usa el cliente y `SENTRY_DSN` el servidor',
    shape: shapeSentryDsn,
  },
  {
    id: 'sentry_auth_token',
    label: 'Monitoreo: token de Sentry (source maps)',
    vars: ['SENTRY_AUTH_TOKEN'],
    severity: 'optional',
    impact: 'El build no sube los source maps: los errores llegan a Sentry sin la línea de código que los causó.',
    where: 'Sentry → **Auth Tokens** → User Auth Token con alcance `org:ci`',
    link: 'https://sentry.io/settings/auth-tokens/',
    save: 'Vercel (es un secreto de build: nunca con `NEXT_PUBLIC_`)',
    shape: shapeLongSecret,
    note: 'Sin él el build no se rompe: `next.config` desactiva la subida de source maps.',
  },
  {
    id: 'sentry_webhook_secret',
    label: 'Monitoreo: secreto del webhook de Sentry',
    vars: ['SENTRY_WEBHOOK_SECRET'],
    severity: 'optional',
    impact: '`/api/webhooks/sentry` responde 503: las alertas de Sentry no llegan por correo.',
    where: 'Sentry → **Settings » Developer Settings » Custom Integrations** → crear el webhook interno apuntando a `/api/webhooks/sentry` → el **Client Secret** que genera',
    link: 'https://sentry.io/settings/developer-settings/',
    save: 'Vercel. La guía paso a paso, ya escrita, está en `docs/activar-monitoreo-vercel.md` (§4)',
    shape: shapeLongSecret,
    note: 'Verifica la firma HMAC sobre el cuerpo crudo: sin él no se procesa nada en vez de procesar sin verificar.',
  },
  {
    id: 'sentry_alert_email',
    label: 'Monitoreo: destinatario de las alertas',
    vars: ['SENTRY_ALERT_EMAIL'],
    severity: 'optional',
    impact: 'El webhook procesa la alerta y no la manda: lo registra como `skipped` en vez de fingir el aviso.',
    where: 'Es un valor, no un secreto: el correo de guardia que recibe las alertas',
    link: null,
    save: 'Vercel (variable de entorno)',
    shape: shapeEmail,
  },
  {
    id: 'site_url',
    label: 'SEO: URL canónica',
    vars: ['NEXT_PUBLIC_SITE_URL'],
    severity: 'optional',
    impact: 'El sitemap, el canonical y las tarjetas Open Graph apuntan al dominio por defecto.',
    where: 'Es un valor, no un secreto: el dominio productivo',
    link: null,
    save: 'Vercel (variable de entorno), sin barra final',
    shape: (value) =>
      /^https:\/\/[^\s/]+$/.test(value.trim())
        ? shapeOf(value)
        : /^https:\/\/[^\s/]+\/$/.test(value.trim())
          ? { ok: true, problem: null, note: 'Termina en barra: el canonical puede quedar con doble barra. Se recomienda sin ella.' }
          : { ok: false, problem: 'No parece una URL https sin barra final.' },
  },
];

/** Cómo se llama cada severidad en el informe. */
export const SEVERITY_LABEL = {
  critical: 'crítica',
  degraded: 'degradada',
  optional: 'opcional',
};

/**
 * El plural, escrito y no derivado: `opcional` + `s` no es `opcionales`, y un
 * informe que dice `opcionals` desluce justo donde tiene que dar confianza.
 */
export const SEVERITY_PLURAL = {
  critical: 'críticas',
  degraded: 'degradadas',
  optional: 'opcionales',
};

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en `check-credentials.test.ts`)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * La referencia del proyecto que llevan dentro las claves clásicas.
 *
 * Los JWT de Supabase van sin firmar en la parte que sirve acá: el cuerpo lleva
 * `ref`, que es el proyecto del que salió la clave. No se verifica la firma ni se
 * pretende —alcanza para atajar el error real, que es pegar la clave de **otro**
 * proyecto—. Las claves nuevas no lo llevan, y por eso devuelve `null`.
 *
 * @param {string | null | undefined} key
 * @returns {string | null}
 */
export function jwtRef(key) {
  const parts = String(key ?? '').trim().split('.');
  if (parts.length !== 3) return null;

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const body = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return typeof body?.ref === 'string' && body.ref ? body.ref : null;
  } catch {
    return null;
  }
}

/** El primer nombre de la lista que tenga un valor no vacío. */
function pick(values, vars) {
  for (const name of vars) {
    const value = values[name];
    if (value && String(value).trim()) return { name, value: String(value).trim() };
  }
  return { name: vars[0], value: null };
}

/**
 * Audita el catálogo contra unos valores y unos hechos.
 *
 * Es puro: recibe el entorno ya leído y los hechos ya comprobados (o `null` si no
 * se comprobaron), y devuelve el veredicto. Así se prueba cada combinación sin
 * tocar la máquina ni la red, y el informe no puede inventar nada que no le hayan
 * pasado.
 *
 * @param {{ values?: Record<string, string | undefined>, facts?: Facts }} [input]
 * @returns {Finding[]}
 */
export function auditCredentials({ values = {}, facts = {} } = {}) {
  const findings = CREDENTIALS.map((credential) => {
    const { name, value } = pick(values, credential.vars);

    /** @type {Finding} */
    const finding = {
      id: credential.id,
      label: credential.label,
      severity: credential.severity,
      variable: name,
      cut: Boolean(credential.cut),
      state: 'missing',
      detail: 'falta',
      notes: credential.note ? [credential.note] : [],
      impact: credential.impact,
      where: credential.where,
      link: credential.link ?? null,
      save: credential.save,
    };

    if (!value) return finding;

    const verdict = credential.shape ? credential.shape(value) : shapeOf(value);

    if (verdict.ok) {
      finding.state = 'ok';
      finding.detail = verdict.ref ? `proyecto ${verdict.ref}` : 'configurada';
      if (verdict.note) finding.notes.push(verdict.note);
    } else {
      finding.state = 'malformed';
      finding.detail = 'la forma no es la esperada';
      finding.problem = verdict.problem ?? null;
    }

    return finding;
  });

  crossCheckProjectRefs(findings, values);

  findings.push(...factFindings(facts));

  return findings;
}

/**
 * Coteja que las claves sean del mismo proyecto que la URL.
 *
 * Es el error de copiar y pegar que el corte ataja antes de escribir nada, visto
 * desde el lado del entorno: una clave del proyecto viejo con la URL nueva deja el
 * portal respondiendo 401 sin decir por qué.
 *
 * @param {Finding[]} findings
 * @param {Record<string, string | undefined>} values
 */
function crossCheckProjectRefs(findings, values) {
  const url = findings.find((f) => f.id === 'supabase_url');
  if (!url || url.state === 'missing') return;

  const urlRef = jwtRef(values.NEXT_PUBLIC_SUPABASE_URL ?? null) ?? refFromUrl(values.NEXT_PUBLIC_SUPABASE_URL);
  if (!urlRef) return;

  for (const id of ['supabase_anon_key', 'supabase_service_role_key']) {
    const finding = findings.find((f) => f.id === id);
    if (!finding || finding.state !== 'ok') continue;

    const value = values[finding.variable] ?? null;

    if (value && String(value).startsWith('sb_publishable_')) {
      finding.notes.push(
        'Es una clave nueva (`sb_publishable_`), que no lleva su proyecto dentro: se comprueba preguntándole a la base con `npm run check:auth`.'
      );
      continue;
    }
    if (value && String(value).startsWith('sb_secret_')) {
      finding.notes.push(
        'Es una clave nueva (`sb_secret_`), que no lleva su proyecto dentro: el corte la sondea contra la base antes de aplicarla.'
      );
      continue;
    }

    const keyRef = jwtRef(value);
    if (keyRef && keyRef !== urlRef) {
      finding.state = 'mismatch';
      finding.detail = 'es de otro proyecto';
      finding.problem = `La clave es del proyecto ${keyRef} y la URL dice ${urlRef}: es la clave del proyecto equivocado.`;
    }
  }
}

/** La referencia de un proyecto a partir de su URL. */
function refFromUrl(url) {
  const verdict = classifySupabaseUrl(url ?? null);
  return verdict.ok && verdict.ref ? verdict.ref : null;
}

/**
 * Los hechos que no salen de una variable de entorno: si el repo está enlazado a
 * Vercel, si la CLI tiene sesión y qué secretos tiene el repositorio. `null`
 * significa «no se comprobó» (hace falta `--online`), y eso se informa como tal en
 * vez de darlo por bueno o por faltante.
 *
 * @typedef {{ ok: false, reason: 'timeout' | 'unavailable' | 'failed', message?: string }} ProbeProblem
 */

/**
 * @typedef {{
 *   vercelProjectId?: string | null,
 *   vercelSession?: string | null,
 *   vercelSessionProblem?: ProbeProblem | null,
 *   repoSecrets?: string[] | null,
 *   repoSecretsProblem?: ProbeProblem | null,
 *   backupFiles?: string[] | null,
 * }} Facts
 */

/**
 * @param {Facts} facts
 * @returns {Finding[]}
 */
function factFindings(facts) {
  const {
    vercelProjectId = null,
    vercelSession = null,
    vercelSessionProblem = null,
    repoSecrets = null,
    repoSecretsProblem = null,
    backupFiles = null,
  } = facts;

  const link = {
    id: 'vercel_link',
    label: 'Vercel: repo enlazado al proyecto',
    severity: 'degraded',
    variable: VERCEL_LINK_FILE,
    cut: false,
    impact: 'El corte no puede cotejar en qué proyecto de Vercel escribe: se detiene antes de tocar nada.',
    where: `El proyecto \`rix7\` del equipo (id ${EXPECTED_VERCEL_PROJECT_ID})`,
    link: null,
    save: '`npx vercel link`',
    notes: [],
  };

  /** @type {Finding} */
  const vercelLink = vercelProjectId
    ? vercelProjectId === EXPECTED_VERCEL_PROJECT_ID
      ? { ...link, state: 'ok', detail: 'enlazado al proyecto esperado' }
      : {
          ...link,
          state: 'mismatch',
          detail: 'enlazado a otro proyecto',
          problem: `El enlace apunta a ${vercelProjectId} y el corte escribe en ${EXPECTED_VERCEL_PROJECT_ID}.`,
        }
    : { ...link, state: 'missing', detail: `falta ${VERCEL_LINK_FILE}` };

  const cli = {
    id: 'vercel_cli',
    label: 'Vercel: sesión de la CLI',
    severity: 'degraded',
    variable: 'npx vercel whoami',
    cut: false,
    impact: 'El corte no puede aplicar las variables en Vercel ni desplegar. El preflight sí corre.',
    where: 'La cuenta de Vercel que publica el sitio',
    link: 'https://vercel.com/account/tokens',
    save: '`npx vercel login`',
    notes: [],
  };

  /** @type {Finding} */
  const vercelCli = vercelSession
    ? { ...cli, state: 'ok', detail: `sesión a nombre de ${vercelSession}` }
    : vercelSessionProblem
      ? vercelSessionProblem.reason === 'failed'
        ? {
            ...cli,
            state: 'missing',
            detail: 'la CLI no tiene sesión',
            notes: [...cli.notes, `La CLI contestó: ${vercelSessionProblem.message}`],
          }
        : {
            ...cli,
            state: 'unchecked',
            detail: 'sin comprobar',
            notes: [...cli.notes, problemNote(vercelSessionProblem)],
          }
      : {
          ...cli,
          state: 'unchecked',
          detail: 'sin comprobar',
          notes: [...cli.notes, 'Se comprueba con `--online` (pregunta `npx vercel whoami`).'],
        };

  const repo = {
    id: 'repo_secrets',
    label: 'GitHub: secretos del repositorio',
    severity: 'degraded',
    variable: 'SUPABASE_ACCESS_TOKEN, ALERTS_CRON_SECRET',
    cut: false,
    impact: 'Sin el token, la sonda de cada 6 h saltea la comprobación de titularidad; sin el secreto del cron, el job de avisos no corre.',
    where: 'GitHub → repositorio → Settings » Secrets and variables » Actions',
    link: null,
    save: '`gh secret set SUPABASE_ACCESS_TOKEN` · `gh secret set ALERTS_CRON_SECRET`',
    notes: [],
  };

  const expectedRepoSecrets = ['SUPABASE_ACCESS_TOKEN', 'ALERTS_CRON_SECRET'];
  /** @type {Finding} */
  const repoSecretsFinding = repoSecrets
    ? (() => {
        const missing = expectedRepoSecrets.filter((name) => !repoSecrets.includes(name));
        return missing.length
          ? { ...repo, state: 'missing', detail: `faltan: ${missing.join(', ')}` }
          : { ...repo, state: 'ok', detail: `están los ${expectedRepoSecrets.length}` };
      })()
    : repoSecretsProblem
      ? {
          ...repo,
          state: 'unchecked',
          detail: 'sin comprobar',
          notes: [...repo.notes, problemNote(repoSecretsProblem)],
        }
      : {
          ...repo,
          state: 'unchecked',
          detail: 'sin comprobar',
          notes: [...repo.notes, 'Se comprueba con `--online` (pregunta `gh secret list`).'],
        };

  const backup = {
    id: 'backup_env',
    label: 'Respaldo de las credenciales del proyecto viejo',
    severity: 'optional',
    variable: `${BACKUP_PREFIX}*`,
    cut: false,
    impact: 'Las credenciales del proyecto de la cuenta B solo quedan en Vercel: desde esta máquina no se podrían recuperar.',
    where: 'Es un archivo local: la copia del `.env.local` de antes de la migración',
    link: null,
    save: 'Se conserva tal cual (no se versiona ni se borra)',
    notes: [],
  };

  /** @type {Finding} */
  const backupFinding =
    backupFiles === null
      ? {
          ...backup,
          state: 'unchecked',
          detail: 'sin comprobar',
          notes: [...backup.notes, 'No se pudo leer el directorio del proyecto.'],
        }
      : backupFiles.length
        ? { ...backup, state: 'ok', detail: backupFiles.join(', ') }
        : { ...backup, state: 'missing', detail: 'no hay ninguna copia' };

  return [vercelLink, vercelCli, repoSecretsFinding, backupFinding];
}

/**
 * Qué decir del comando que no se pudo leer. Ni un verde ni un rojo: un «no sé»
 * con el motivo, porque el motivo cambia lo que hay que hacer (esperar más, revisar
 * la red, instalar la CLI) y no es lo mismo que faltar una credencial.
 */
function problemNote(problem) {
  if (problem.reason === 'timeout') {
    return 'No respondió a tiempo: no quiere decir que falte, sino que no se pudo comprobar.';
  }
  return `No se pudo ejecutar el comando (${problem.message ?? 'no está disponible'}): no quiere decir que falte, sino que no se pudo comprobar.`;
}

/**
 * @typedef {object} Finding
 * @property {string} id
 * @property {string} label
 * @property {Severity} severity
 * @property {string} variable
 * @property {boolean} cut
 * @property {'ok' | 'missing' | 'malformed' | 'mismatch' | 'unchecked'} state
 * @property {string} detail
 * @property {string} [problem]
 * @property {string[]} notes
 * @property {string} impact
 * @property {string} where
 * @property {string | null} link
 * @property {string} save
 */

/** ¿Falta algo que el portal necesite (crítico o degradado)? */
export function missingRequirements(findings) {
  return findings.filter(
    (f) => f.severity !== 'optional' && ['missing', 'malformed', 'mismatch'].includes(f.state)
  );
}

/**
 * Código de salida: `1` en cuanto falta algo crítico o degradado. Un «sin comprobar»
 * no cuenta como fallo —no se puede afirmar que falte— pero el informe lo dice.
 */
export function exitCodeFor(findings) {
  return missingRequirements(findings).length ? 1 : 0;
}

/**
 * ¿Tiene el corte todo lo que necesita? Son las tres variables que aplica en
 * Vercel, más los dos hechos locales que exige su preflight.
 */
export function cutReadiness(findings) {
  const required = findings.filter((f) => f.cut || f.id === 'vercel_link');
  const blockedBy = required.filter((f) => f.state !== 'ok').map((f) => f.label);
  return { ready: blockedBy.length === 0, blockedBy };
}

const MARK = { ok: '✓', missing: '✗', malformed: '✗', mismatch: '✗', unchecked: '?' };

/**
 * El informe legible. Nunca imprime un valor: solo el estado y, cuando falta algo,
 * dónde conseguirlo y con qué comando se guarda.
 *
 * @param {{ findings: Finding[], origin?: string, online?: boolean }} input
 * @returns {string}
 */
export function formatReport({ findings, origin = ENV_FILE, online = false }) {
  const lines = ['', '== Credenciales del proyecto ==', '', `Origen: ${origin} (y el entorno). No se imprime ningún valor.`, ''];

  for (const severity of ['critical', 'degraded', 'optional']) {
    const group = findings.filter((f) => f.severity === severity);
    if (!group.length) continue;

    lines.push(`  ${SEVERITY_PLURAL[severity]}`);

    for (const finding of group) {
      lines.push(`    ${MARK[finding.state]} ${finding.label} — ${finding.detail}`);

      if (finding.state !== 'ok') {
        if (finding.problem) lines.push(`        problema:  ${finding.problem}`);
        lines.push(`        para qué:  ${finding.impact}`);
        lines.push(`        dónde:     ${finding.where}`);
        if (finding.link) lines.push(`                   ${finding.link}`);
        lines.push(`        guardala:  ${finding.save}`);
      }

      for (const note of finding.notes) lines.push(`        · ${note}`);
    }

    lines.push('');
  }

  const { ready, blockedBy } = cutReadiness(findings);
  lines.push(
    ready
      ? '  Para el corte de Supabase: ✓ tiene todo lo que necesita (`npm run corte:supabase`).'
      : `  Para el corte de Supabase: ✗ le falta ${blockedBy.join(', ')}.`
  );

  const missing = missingRequirements(findings);
  const unchecked = findings.filter((f) => f.state === 'unchecked');
  const optionalMissing = findings.filter((f) => f.severity === 'optional' && f.state !== 'ok');

  if (missing.length === 0) {
    lines.push('  Resumen: no falta nada crítico ni degradado.');
  } else {
    const bySeverity = ['critical', 'degraded']
      .map((severity) => {
        const ids = missing.filter((f) => f.severity === severity).map((f) => f.id);
        return ids.length ? `${SEVERITY_PLURAL[severity]}: ${ids.join(', ')}` : null;
      })
      .filter(Boolean);
    lines.push(`  Resumen: ${missing.length} sin configurar — ${bySeverity.join('; ')}.`);
  }

  if (optionalMissing.length) {
    lines.push(`           ${optionalMissing.length} ${SEVERITY_PLURAL.optional} sin configurar (no bloquean nada).`);
  }
  if (unchecked.length) {
    lines.push(`           ${unchecked.length} sin comprobar${online ? ' (ver el motivo en cada una)' : ' (volvé con `--online`)'}.`);
  }
  if (!online) lines.push('           `--online` comprueba además la sesión de Vercel y los secretos del repositorio.');

  lines.push('');
  lines.push(
    '  Fuera del catálogo, a propósito: los argumentos de los propios scripts (`--url`, `--email`)\n' +
      '  y lo que inyecta la plataforma (Vercel, GitHub Actions): no son credenciales que conseguir.'
  );
  lines.push('');
  lines.push('  Ojo: esto mira lo que está **configurado**, no si la base responde.');
  lines.push('    · si el proyecto contesta → npm run check:auth');
  lines.push('    · si el esquema está al día → npm run check:schema');
  lines.push('    · de quién es la base → npm run check:cuenta');
  lines.push('    · si producción quedó atrás → npm run check:health');
  lines.push('');

  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// Lectura del entorno y de los hechos (con efectos, fuera del núcleo)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Los valores: primero el entorno del proceso (lo que ya está exportado) y encima
 * el archivo, en ese orden de precedencia —el mismo que usan `db-push` y el corte—.
 *
 * @param {{ env?: Record<string, string | undefined>, envFile?: string, exists?: (p: string) => boolean, read?: (p: string) => string }} [options]
 */
export function readValues({
  env = process.env,
  envFile = ENV_FILE,
  exists = existsSync,
  read = (filePath) => readFileSync(filePath, 'utf8'),
} = {}) {
  const values = exists(envFile) ? readEnvContent(read(envFile)) : {};

  // El entorno gana cuando trae algo (`env[k] || fromFile[k]`), que es la misma
  // precedencia que usan `db-push` y el corte: lo que se exportó a mano manda, y
  // una variable vacía en el entorno no tapa el valor del archivo.
  for (const [key, value] of Object.entries(env)) {
    if (value && String(value).trim()) values[key] = String(value);
  }

  return values;
}

/**
 * Los hechos locales: el enlace de Vercel y los respaldos del archivo de variables.
 * Los de red (`--online`) los agrega `probeOnline`.
 *
 * @param {{ root?: string, exists?: (p: string) => boolean, read?: (p: string) => string, list?: (p: string) => string[] }} [options]
 * @returns {Facts}
 */
export function readLocalFacts({
  root = ROOT,
  exists = existsSync,
  read = (filePath) => readFileSync(filePath, 'utf8'),
  list = (dir) => readdirSync(dir),
} = {}) {
  let vercelProjectId = null;
  try {
    const parsed = JSON.parse(read(path.join(root, VERCEL_LINK_FILE)));
    vercelProjectId = typeof parsed?.projectId === 'string' ? parsed.projectId : null;
  } catch {
    vercelProjectId = null;
  }

  let backupFiles = null;
  try {
    backupFiles = list(root).filter((name) => name.startsWith(BACKUP_PREFIX)).sort();
  } catch {
    backupFiles = null;
  }

  return { vercelProjectId, backupFiles };
}

/**
 * Los hechos que exigen salir a la máquina o a la red: la sesión de la CLI de
 * Vercel y los secretos del repositorio. Van detrás de `--online` porque tardan y
 * porque fallan por cosas que no tienen que ver con el proyecto (que no haya red).
 *
 * @param {{ run?: typeof spawnSync, timeout?: number }} [options]
 * @returns {Facts}
 */
export function probeOnline({ run = spawnSync, timeout = ONLINE_TIMEOUT_MS } = {}) {
  const session = runCommand(run, 'npx', ['--no-install', 'vercel', 'whoami'], timeout);
  const secrets = runCommand(run, 'gh', ['secret', 'list'], timeout);

  return {
    vercelSession: session.ok ? lastLine(session.output) : null,
    vercelSessionProblem: session.ok ? null : session,
    repoSecrets: secrets.ok ? secretNames(secrets.output) : null,
    repoSecretsProblem: secrets.ok ? null : secrets,
  };
}

/** La última línea con contenido: `vercel whoami` imprime su versión antes del usuario. */
function lastLine(output) {
  const lines = String(output ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

/** La primera línea: es donde la CLI escribe el motivo del fallo. */
function firstLine(output) {
  const line = String(output ?? '')
    .split('\n')
    .map((text) => text.trim())
    .filter(Boolean)[0];
  return line ? line.slice(0, 160) : null;
}

/** Los nombres de la salida de `gh secret list`, que va en columnas separadas por tabulador. */
function secretNames(output) {
  return String(output ?? '')
    .split('\n')
    .map((line) => line.split('\t')[0].trim())
    .filter(Boolean)
    // La CLI imprime una cabecera con el nombre de la columna.
    .filter((name) => name !== 'NAME');
}

/**
 * Corre un comando y devuelve su salida, o el motivo por el que no la hay.
 *
 * Tres detalles que no son de estilo:
 *
 * - La entrada va ignorada (`/dev/null`): un comando que decide preguntar algo se
 *   queda esperando para siempre, y un informe que no termina no informa nada.
 * - `shell` solo en Windows: `npx` es `npx.cmd` y `spawnSync` sin shell no lo
 *   resuelve —devuelve `ENOENT` y el informe diría que no hay sesión cuando el
 *   problema era cómo se lo llamó—. Es la misma solución que usa `vercel:sync`.
 * - Se corre desde la raíz del proyecto, para que `npx` resuelva lo local.
 *
 * @returns {{ ok: true, output: string } | ProbeProblem}
 */
function runCommand(run, command, args, timeout) {
  try {
    const result = run(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      shell: process.platform === 'win32',
    });
    if (!result) return { ok: false, reason: 'unavailable' };

    // El tiempo agotado se distingue del fallo: uno dice «no se pudo comprobar» y
    // el otro «el comando contestó que no». Confundirlos fue el defecto que este
    // módulo ya tuvo una vez.
    if (result.error) {
      return { ok: false, reason: result.error.code === 'ETIMEDOUT' ? 'timeout' : 'unavailable', message: result.error.code };
    }

    if (result.status !== 0) {
      return {
        ok: false,
        reason: 'failed',
        message: firstLine(result.stderr) ?? firstLine(result.stdout) ?? `salió con el código ${result.status}`,
      };
    }

    return { ok: true, output: String(result.stdout ?? '') };
  } catch (error) {
    return { ok: false, reason: 'unavailable', message: error instanceof Error ? error.message : undefined };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = { online: false, json: false, help: false };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--online') args.online = true;
    else if (arg === '--json') args.json = true;
  }

  return args;
}

function usage() {
  console.log(
    [
      '',
      'Audita las credenciales que el proyecto necesita: cuáles están, cuáles faltan y,',
      'para cada una, dónde se consigue y con qué comando se guarda.',
      '',
      '  npm run check:credenciales',
      '  npm run check:credenciales -- --online',
      '  npm run check:credenciales -- --json',
      '',
      'Opciones:',
      '  --online  comprueba además la sesión de la CLI de Vercel y los secretos del',
      '            repositorio (tarda unos segundos y necesita red)',
      '  --json    el veredicto en JSON, para encadenar con otras herramientas',
      '  --help    esto',
      '',
      'Lo lee de `.env.local` y del entorno, y no imprime ningún valor.',
      'No usa red salvo con --online; no toca Vercel, ni Supabase, ni GitHub.',
      '',
      'Salida: 0 = no falta nada crítico ni degradado · 1 = falta algo que el portal',
      '        necesita · 2 = el comando se usó mal.',
      '',
    ].join('\n')
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const unknown = process.argv.slice(2).filter((a) => !['--online', '--json', '--help', '-h'].includes(a));
  if (unknown.length) {
    console.error(`✖ Opción desconocida: ${unknown.join(' ')}`);
    console.error('  Probá con `npm run check:credenciales -- --help`.');
    process.exitCode = 2;
    return;
  }

  const values = readValues();
  const facts = { ...readLocalFacts(), ...(args.online ? probeOnline() : {}) };
  const findings = auditCredentials({ values, facts });
  const exitCode = exitCodeFor(findings);

  if (args.json) {
    const { ready, blockedBy } = cutReadiness(findings);
    console.log(
      JSON.stringify(
        {
          exitCode,
          corte: { listo: ready, falta: blockedBy },
          sinConfigurar: missingRequirements(findings).map((f) => f.id),
          credenciales: findings.map(({ id, label, severity, variable, state, detail, notes, cut }) => ({
            id,
            label,
            severity,
            variable,
            state,
            detail,
            notes,
            paraElCorte: cut,
          })),
        },
        null,
        2
      )
    );
  } else {
    console.log(formatReport({ findings, origin: path.relative(ROOT, ENV_FILE) || ENV_FILE, online: args.online }));
  }

  // Anotación legible desde la pestaña de Actions, si algún día lo corre el CI.
  const missing = missingRequirements(findings);
  if (missing.length) {
    console.error(`::error::Credenciales sin configurar: ${missing.map((f) => f.label).join(', ')}`);
  }

  process.exitCode = exitCode;
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
