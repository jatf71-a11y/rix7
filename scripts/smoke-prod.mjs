#!/usr/bin/env node
/**
 * Prueba de humo contra un despliegue: ¿está la tanda y está guardando?
 *
 * Comprueba desde afuera —como lo haría una visita— las piezas que se despliegan
 * juntas: la portada, el panel de registros, el alta `/api/registro` y las rutas
 * del panel de socios (`/socio`, `/api/partner/access`, `/api/admin/socios`).
 * Esas tres últimas están porque una tanda puede desplegarse a medias: la página
 * responde y la API que necesita da 404, y eso no se ve en ninguna otra parte.
 *
 * Y responde la pregunta que ningún test de la suite puede responder, porque
 * depende de la base real: **¿el alta se está guardando o la respuesta se está
 * perdiendo en la memoria del servidor?**
 *
 *   npm run smoke:prod                                  # solo mirar (no escribe nada)
 *   npm run smoke:prod -- --url http://localhost:3111
 *   npm run smoke:prod -- --write --email tu@correo.cl  # además da un alta de prueba
 *   npm run smoke:prod -- --bridge --email tu@correo.cl # solo registro → alta (y lo borra)
 *
 * Por qué la escritura es una decisión aparte: el alta manda el correo de
 * bienvenida y deja una fila en `public.signups`, que es **solo-anexa** (no hay
 * política de UPDATE). Escribir sin querer no es inofensivo: un correo a una
 * dirección inexistente rebota y eso le cuesta reputación al dominio del
 * remitente. Por eso `--write` exige decir a qué correo mandar la bienvenida —el
 * tuyo, que además te deja comprobar el correo de punta a punta— y la fila queda
 * identificada como de prueba para poder borrarla.
 *
 * Sin `--write` el informe dice honestamente que la persistencia **no se
 * verificó**: no se puede saber sin intentarlo.
 *
 * El puente registro → alta tiene su propia opción (`--bridge`, y `--write` la
 * incluye). También escribe —el autómata manda el correo del resultado— pero
 * **borra lo que escribió** al terminar: comprueba que un registro de socio
 * aprobado nace como alta en `Calificado`, y deja la base como estaba. Eso es lo
 * que lo hace apto para correr después de cada release.
 *
 * El núcleo recibe `fetch` inyectado, así que se prueba sin red
 * (`scripts/smoke-prod.test.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEnvContent } from './check-auth-config.mjs';

/** Producción por defecto; se cambia con `--url` o `SMOKE_URL`. */
const DEFAULT_BASE_URL = 'https://rix7.cl';

/** De dónde salen las claves para leer y borrar el alta de prueba. */
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local');

/** Identidad de la fila de prueba: se ve de lejos y se puede borrar. */
export const SMOKE_NAME = 'Prueba de humo (no es una persona)';
export const SMOKE_PHONE = '+56 9 0000 0000';

/**
 * Identidad del registro de prueba del puente.
 *
 * El nombre dice lo que es porque, si la limpieza falla, alguien lo va a ver en
 * el panel de Solicitudes: «Prueba de humo» y no un nombre de persona inventado.
 */
export const SMOKE_REGISTRO_NAME = 'Prueba de humo · puente registro→alta (no es una persona)';

/**
 * Los tres pasos del puente, con nombre estable.
 *
 * El release los usa para afirmar en su informe si el puente se comprobó de
 * verdad: comparar por texto en dos archivos distintos se rompe en silencio en
 * cuanto alguien reescribe una etiqueta.
 */
export const BRIDGE_STEP_LABELS = {
  registro: 'POST /api/solicitudes (registro de prueba)',
  alta: 'Alta del registro en Calificado',
  cleanup: 'Limpieza del registro de prueba',
};

/** Marcas de identidad de cada página. */
export const HOME_MARKER = 'Rix7';
/** La tabla del panel: solo se ve con sesión de admin. */
export const ADMIN_MARKER = 'Registros';
/**
 * La puerta del panel: lo que el servidor manda a una visita **sin** sesión.
 *
 * El layout de `/admin` comprueba el rol en el servidor y, si no lo hay, sirve
 * `AdminAccess`. Esa tarjeta se importa con `ssr: false`, así que en el HTML del
 * servidor aparecen su esqueleto de carga y, en el cliente, la tarjeta; ninguna
 * de las dos es la tabla. Se aceptan las dos marcas porque cuál de ellas llega
 * depende de si el `fetch` ejecutó el cliente, y en los dos casos es el mismo
 * estado: la ruta existe y pide sesión.
 *
 * Exigir la tabla del panel hacía fallar la verificación de un deploy sano y
 * mandaba a buscar el problema en el deploy. Ver `judgeAdminPage`.
 */
export const ADMIN_GATE_MARKERS = ['Verificando el acceso', 'Acceso al panel'];
export const SOCIO_MARKER = 'Panel profesional';

/** Señales de que lo que llegó es una pantalla de error, no la página. */
const ERROR_PAGE = /Application error|Internal Server Error|a server-side exception|__next_error__/i;

/**
 * @typedef {{ level: 'ok' | 'fail' | 'warn' | 'info', label: string, detail: string }} SmokeStep
 * @typedef {object} SmokeReport
 * @property {string} baseUrl
 * @property {boolean} ok                 ¿Todo lo comprobado salió bien?
 * @property {SmokeStep[]} steps
 * @property {boolean | null} persisted   null = no se intentó (sin --write)
 * @property {boolean} [bridge]           ¿se recorrió registro → alta?
 */

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en smoke-prod.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/** Quita la barra final para no armar `//api/...`. */
export function normalizeBaseUrl(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

/** El alta de prueba: las dos autorizaciones obligatorias y ninguna opcional. */
export function smokeSignupPayload(email) {
  return {
    name: SMOKE_NAME,
    email,
    phone: SMOKE_PHONE,
    // Las opcionales van en false a propósito: es lo que no queremos que quede
    // autorizado por una prueba.
    consents: {
      personal_data: true,
      terms: true,
      marketing: false,
      third_party: false,
    },
  };
}

/**
 * Dígito verificador módulo 11 de un cuerpo numérico.
 *
 * El motor de evaluación rechaza un RUT con dígito inválido, así que el registro
 * de prueba necesita uno de verdad: inventar `12345678-9` haría fallar el smoke
 * por la razón equivocada.
 */
export function rutCheckDigit(body) {
  let sum = 0;
  let factor = 2;

  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const rest = 11 - (sum % 11);
  if (rest === 11) return '0';
  if (rest === 10) return 'K';
  return String(rest);
}

/**
 * RUT válido y distinto en cada corrida.
 *
 * La evaluación marca «duplicado» cuando otra solicitud tiene el mismo RUT, así
 * que reusar uno fijo haría que la segunda corrida se quedara en
 * `Pendiente_Informacion` y el smoke fallara por su propio rastro.
 */
export function smokeTestRut(random = Math.random) {
  const body = String(20000000 + Math.floor(random() * 7000000));
  return `${body}-${rutCheckDigit(body)}`;
}

/**
 * Correo del registro de prueba: un alias del mismo buzón que se pasó por
 * `--email`.
 *
 * Se le agrega la marca después del `+` para que sea único: el correo es parte
 * del detector de duplicados, y dos corridas con la misma dirección dejarían la
 * segunda en `Pendiente_Informacion`. Llega a la misma bandeja, que es lo que
 * permite revisar el correo del camino real.
 */
export function bridgeEmailFor(email, stamp = Date.now()) {
  const value = String(email ?? '');
  const at = value.lastIndexOf('@');
  if (at <= 0) return value;
  return `${value.slice(0, at)}+puente${stamp}@${value.slice(at + 1)}`;
}

/** El registro de prueba: un profesional independiente que se aprueba solo. */
export function smokeRegistroPayload({ email, rut, now = Date.now() }) {
  return {
    kind: 'agente',
    name: SMOKE_REGISTRO_NAME,
    email,
    phone: SMOKE_PHONE,
    rut,
    coverage: 'nacional',
    consent: true,
    message: `Registro de prueba del puente registro→alta (${new Date(now).toISOString()}). El smoke lo borra al terminar.`,
  };
}

const errorDetail = (error) =>
  error instanceof Error ? error.message : 'error desconocido';

/**
 * Cómo leer la portada.
 *
 * Se comprueba que sea la página y no una pantalla de error, que es lo que
 * distingue «el deploy salió bien» de «el deploy responde 200 con el error
 * adentro» — el caso que un `curl -o /dev/null -w %{http_code}` deja pasar.
 */
export function judgeHome(status, html) {
  if (status !== 200) return { level: 'fail', detail: `HTTP ${status}` };
  if (ERROR_PAGE.test(html)) {
    return { level: 'fail', detail: 'devolvió 200 pero el cuerpo es una pantalla de error' };
  }
  if (!html.includes(HOME_MARKER) || html.length < 5000) {
    return { level: 'fail', detail: `no parece la portada (${html.length} caracteres)` };
  }
  return { level: 'ok', detail: `200 · ${(html.length / 1024).toFixed(1)} kB` };
}

/**
 * Cómo leer `/admin/registros`.
 *
 * Una redirección cuenta como buena: la página existe y el panel pide la sesión.
 * Un 404 significa que el deploy no trajo la ruta, que es justo lo que hay que
 * detectar; un 200 sin la marca de la página, que llegó otra cosa.
 *
 * Sin sesión lo que se sirve es la **pantalla de acceso** (`ADMIN_GATE_MARKERS`),
 * no la tabla: la ruta existe, el guard del servidor está puesto y no se filtró
 * ninguna sección. Eso es un verde; la tabla solo aparece con sesión de admin.
 */
export function judgeAdminPage(status, html) {
  return judgeAdminPageLike(
    status,
    html,
    ADMIN_MARKER,
    'la pantalla de registros',
    ADMIN_GATE_MARKERS
  );
}

/**
 * Cómo leer una ruta de API protegida sin sesión.
 *
 * Responde dos preguntas de una sola petición, y las responde distinto:
 *
 * - **¿está desplegada?** Un 404 quiere decir que el deploy no trajo la ruta.
 *   Es el caso que motivó esta comprobación: la gestión de socios existía en el
 *   repositorio y no en producción, así que el panel se veía vacío sin que nada
 *   lo advirtiera.
 * - **¿está protegida?** Un 200 sin sesión significa que la guardia dejó pasar
 *   datos que no corresponden a una visita.
 *
 * @param {number} status
 * @param {string} subject  qué es lo que no debería verse sin sesión
 */
export function judgeProtectedEndpoint(status, subject = 'los datos') {
  if (status === 404) {
    return { level: 'fail', detail: 'HTTP 404: la ruta no está desplegada' };
  }
  if (status === 200) {
    return {
      level: 'fail',
      detail: `HTTP 200 sin sesión: la guardia dejó pasar ${subject}`,
    };
  }
  if ([401, 403, 503].includes(status)) {
    return { level: 'ok', detail: `HTTP ${status}: existe y pide sesión (no devuelve datos)` };
  }
  return { level: 'fail', detail: `HTTP ${status}: respuesta inesperada` };
}

/**
 * Cómo leer `GET /api/registro` sin sesión.
 *
 * Lo importante es que **no** devuelva datos: es el listado de quién autorizó
 * qué, y con la guardia puesta nunca se ve sin sesión de admin. Un 404 significa
 * que la ruta no se desplegó; un 200, que la guardia dejó pasar el listado.
 */
export function judgeRegistroGuard(status) {
  return judgeProtectedEndpoint(status, 'el listado de registros');
}

/**
 * Cómo leer el panel de socios.
 *
 * Igual que el panel de registros: sirve que la ruta exista (no un 404) y que la
 * página sea la del panel y no una pantalla de error. El contenido real necesita
 * sesión de corredora, así que acá no se juzga lo que muestra: solo que esté.
 */
export function judgeSocioPanel(status, html) {
  return judgeAdminPageLike(status, html, SOCIO_MARKER, 'el panel de socios');
}

/**
 * El juicio compartido de una pantalla del panel: existe, no es un error y trae
 * su marca. Se separa para que los dos paneles no se juzguen distinto —que es
 * como una comprobación nueva termina siendo más laxa que la vieja.
 */
function judgeAdminPageLike(status, html, marker, what, gateMarkers = []) {
  if (status === 404) {
    return { level: 'fail', detail: 'HTTP 404: la ruta no está desplegada' };
  }
  if (status >= 300 && status < 400) {
    return {
      level: 'ok',
      detail: `HTTP ${status}: la página existe y redirige al host del panel o pide sesión`,
    };
  }
  if (status !== 200) return { level: 'fail', detail: `HTTP ${status}` };
  if (ERROR_PAGE.test(html)) {
    return { level: 'fail', detail: 'devolvió 200 pero el cuerpo es una pantalla de error' };
  }
  if (!html.includes(marker)) {
    // La pantalla de acceso es el estado correcto sin sesión. Se distingue en
    // el detalle para que el informe no diga «200 · la tabla» cuando lo que se
    // vio fue la puerta.
    if (gateMarkers.some((gate) => html.includes(gate))) {
      return { level: 'ok', detail: '200 · existe y pide sesión (pantalla de acceso)' };
    }
    return { level: 'fail', detail: `devolvió 200 pero no es ${what}` };
  }
  return { level: 'ok', detail: `200 · ${(html.length / 1024).toFixed(1)} kB` };
}

/** Primer dato del informe de `/api/health` que explica por qué no se guarda. */
export function persistenceHint(health) {
  const broken = health?.missing?.broken ?? [];
  if (broken.includes('supabase')) {
    return 'Falta el proyecto Supabase real (NEXT_PUBLIC_SUPABASE_URL): sin él el alta se acepta pero queda en la memoria del servidor.';
  }
  if (broken.includes('supabase_owner')) {
    return 'La base de este despliegue no es la de la cuenta dueña del proyecto: el alta se guarda, pero en una base que quizá no se pueda administrar. Cortá con `npm run corte:supabase` (ver `docs/runbook-accesos-socias.md` y `docs/registro-cuentas-y-servicios.md`).';
  }
  return 'Puede faltar aplicar la migración 0010_signups.sql: compruébalo con `npm run db:status`.';
}

/**
 * Cómo leer la respuesta del registro de prueba del puente.
 *
 * Lo que se exige es el camino completo: 201, el autómata aprobando en la misma
 * petición y ninguna pregunta abierta. Si el autómata pide información, el
 * registro no llegó a la etapa que este smoke comprueba y hay que decir por qué
 * (un duplicado o un rate limit, no un «falló» genérico).
 */
export function judgeBridgeRegistro(status, body) {
  if (status === 429) {
    return {
      level: 'warn',
      detail: 'HTTP 429: el rate limit de solicitudes ya se gastó; el puente no se pudo comprobar',
    };
  }
  if (status !== 201) {
    return {
      level: 'fail',
      detail: `HTTP ${status}: ${body?.error ?? JSON.stringify(body ?? {}).slice(0, 160)}`,
    };
  }

  const autopilot = body?.autopilot;
  if (autopilot?.status !== 'Aceptada') {
    const questions = (autopilot?.questions ?? [])
      .map((question) => question?.question)
      .filter(Boolean)
      .join(' ');
    return {
      level: 'fail',
      detail: `el autómata no aprobó el registro (${autopilot?.status ?? 'sin estado'})${questions ? `: ${questions}` : ''}`,
    };
  }

  return { level: 'ok', detail: 'la evaluación lo aprobó y disparó la conversión al alta' };
}

/**
 * Cómo leer lo que quedó guardado: registro aprobado y su alta en `Calificado`.
 *
 * Se comprueban los dos lados del vínculo —`solicitud_origen` en el alta y
 * `payload.kyb_application_id` en el registro— porque el panel lee uno y el
 * índice único del otro es lo que impide duplicar la conversión. Un alta suelta
 * sin vínculo se vería en el pipeline pero el registro seguiría mostrándose como
 * aprobado sin tramo comercial.
 */
export function judgeBridgeAlta({ solicitud, alta } = {}, solicitudId) {
  if (!solicitud) {
    return { level: 'fail', detail: 'la solicitud no quedó guardada (o no se pudo leer)' };
  }
  if (solicitud.status !== 'Aceptada') {
    return { level: 'fail', detail: `el registro quedó en «${solicitud.status}» y no en Aceptada` };
  }
  if (!alta) {
    return { level: 'fail', detail: 'el registro se aprobó pero no nació su alta' };
  }
  if (alta.status !== 'Calificado') {
    return { level: 'fail', detail: `el alta quedó en «${alta.status}» y no en Calificado` };
  }
  if (alta.solicitud_origen !== solicitudId) {
    return { level: 'fail', detail: 'el alta no apunta de vuelta al registro (solicitud_origen)' };
  }
  if (solicitud.payload?.kyb_application_id !== alta.id) {
    return {
      level: 'fail',
      detail: 'el registro no guardó el vínculo al alta (payload.kyb_application_id)',
    };
  }

  return {
    level: 'ok',
    detail: `alta ${String(alta.id).slice(0, 8)}… en Calificado, vinculada por los dos lados`,
  };
}

/**
 * Cómo leer la respuesta del alta.
 *
 * `persistent:false` con `saved:true` es el caso silencioso y peligroso: la
 * pantalla dice «listo», la constancia de consentimiento no quedó en ningún lado
 * y se pierde al reiniciar la función. Es lo que este script existe para ver.
 */
export function judgeSignup(status, body) {
  if (status === 429) {
    return {
      level: 'warn',
      detail: 'HTTP 429: el rate limit (10 por 10 minutos por IP) ya se gastó; no se pudo comprobar',
    };
  }
  if (status === 400) {
    return { level: 'fail', detail: `HTTP 400: ${body?.error ?? 'el alta de prueba fue rechazada'}` };
  }
  if (status !== 201) {
    return { level: 'fail', detail: `HTTP ${status}: ${JSON.stringify(body ?? {}).slice(0, 200)}` };
  }
  if (body?.stored?.saved !== true) {
    return {
      level: 'fail',
      detail: 'el alta respondió 201 pero no se guardó (stored.saved = false)',
    };
  }
  if (body?.stored?.persistent !== true) {
    return {
      level: 'fail',
      detail:
        'el alta se acepta pero NO se está guardando en Supabase (queda en la memoria del servidor)',
    };
  }
  return { level: 'ok', detail: 'el alta quedó guardada en Supabase' };
}

/**
 * Texto del informe, listo para imprimir.
 *
 * @param {SmokeReport} report
 */
export function formatReport(report) {
  const mark = { ok: '✓', fail: '✗', warn: '!', info: '·' };
  const lines = ['', `== Prueba de humo · ${report.baseUrl} ==`, ''];

  for (const step of report.steps) {
    lines.push(`  ${mark[step.level]} ${step.label} — ${step.detail}`);
  }

  const failed = report.steps.filter((step) => step.level === 'fail');
  lines.push('');

  if (report.persisted === true) {
    lines.push('  ✓ El alta quedó guardada: el registro y sus autorizaciones persisten.');
  } else if (report.persisted === false) {
    lines.push('  ✗ El alta NO persiste. Quien se registre va a ver el aviso ámbar del modal y');
    lines.push('    sus autorizaciones se pierden al reiniciar el servidor.');
    const hint = report.hint ?? 'Mira `npm run db:status` y `GET /api/health`.';
    for (const line of hint.split('\n')) lines.push(`    ${line}`);
  } else {
    lines.push(
      report.bridge
        ? '  · La visita de prueba no se dio de alta (sin `--write`); la persistencia de `/api/registro` no se verificó.'
        : '  · Sin `--write` no se intentó ningún alta: la persistencia no se verificó.'
    );
    if (report.hint) lines.push(`    ${report.hint}`);
  }

  if (report.bridge) {
    lines.push('  · El registro de prueba del puente se borró con su alta: no queda nada en el pipeline.');
  }

  lines.push('');
  lines.push(
    failed.length
      ? `  ${failed.length} comprobación(es) fallaron.`
      : '  Todo lo comprobado está en orden.'
  );
  lines.push('');

  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// La corrida (la red entra inyectada)
// ═════════════════════════════════════════════════════════════════════════════

/** Petición con redirecciones a mano: un 3xx es información, no un salto. */
async function probe(fetchImpl, url, init = {}) {
  try {
    return { ok: true, response: await fetchImpl(url, { redirect: 'manual', ...init }) };
  } catch (error) {
    return { ok: false, error: errorDetail(error) };
  }
}

/**
 * Acceso mínimo a la base para comprobar y borrar el alta de prueba.
 *
 * El smoke es de caja negra salvo acá: la única forma de afirmar que el registro
 * se convirtió en un alta en `Calificado` es leerla, y la única forma de no dejar
 * basura en el pipeline es borrarla. Se usa la clave de servicio que ya vive en
 * `.env.local` para las migraciones; nunca se imprime.
 *
 * @param {{ url: string, key: string, fetchImpl?: typeof fetch }} options
 */
export function createBridgeStore({ url, key, fetchImpl = fetch }) {
  const base = normalizeBaseUrl(url);
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  async function rest(pathAndQuery, init = {}) {
    const response = await fetchImpl(`${base}/rest/v1/${pathAndQuery}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    const text = await response.text().catch(() => '');
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  }

  return {
    /** El registro y su alta, tal como quedaron guardados. */
    async read(solicitudId) {
      const id = encodeURIComponent(solicitudId);
      const solicitud = await rest(`solicitudes?id=eq.${id}&select=id,status,payload`);
      const alta = await rest(
        `kyb_applications?solicitud_origen=eq.${id}&select=id,status,solicitud_origen,legal_name,email`
      );
      return { solicitud: solicitud.body?.[0] ?? null, alta: alta.body?.[0] ?? null };
    },

    /** Borra el alta y el registro de prueba; devuelve cuántas filas se fueron. */
    async cleanup(solicitudId) {
      const id = encodeURIComponent(solicitudId);
      const prefer = { Prefer: 'return=representation' };
      const altas = await rest(`kyb_applications?solicitud_origen=eq.${id}`, {
        method: 'DELETE',
        headers: prefer,
      });
      const solicitudes = await rest(`solicitudes?id=eq.${id}`, {
        method: 'DELETE',
        headers: prefer,
      });
      return {
        ok: altas.ok && solicitudes.ok,
        altas: Array.isArray(altas.body) ? altas.body.length : 0,
        solicitudes: Array.isArray(solicitudes.body) ? solicitudes.body.length : 0,
      };
    },
  };
}

/**
 * El store del puente con las claves del entorno, o `null` si no están.
 *
 * Primero `process.env` y después `.env.local`, el mismo orden que
 * `check-schema.mjs` y `db-push.mjs`: así funciona desde un `npm run` y desde el
 * release sin exportar nada a mano.
 */
export function bridgeStoreFromEnv({
  env = process.env,
  envFile = ENV_FILE,
  exists = existsSync,
  read = (filePath) => readFileSync(filePath, 'utf8'),
} = {}) {
  const fromFile = exists(envFile) ? readEnvContent(read(envFile)) : {};
  const value = (name) => env[name] || fromFile[name] || null;

  const url = value('NEXT_PUBLIC_SUPABASE_URL');
  const key = value('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;

  return createBridgeStore({ url, key });
}

/**
 * El camino completo del puente: registro público → alta en `Calificado`.
 *
 * Escribe de verdad (el autómata manda el correo al solicitante) y **borra lo
 * que escribió**: un pipeline con filas de prueba de cada release es peor que no
 * comprobar nada. El correo va a un alias del `--email` que se pasó, así que
 * llega a la misma bandeja y queda revisable.
 *
 * @param {{ baseUrl?: string, email?: string | null, store?: { read: Function, cleanup: Function } | null, fetchImpl?: typeof fetch, now?: number }} options
 * @returns {Promise<SmokeStep[]>}
 */
export async function runBridgeCheck({
  baseUrl = DEFAULT_BASE_URL,
  email = null,
  store = null,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  const base = normalizeBaseUrl(baseUrl);
  const label = BRIDGE_STEP_LABELS.registro;
  const altaLabel = BRIDGE_STEP_LABELS.alta;
  const cleanupLabel = BRIDGE_STEP_LABELS.cleanup;

  if (!email) {
    return [
      {
        level: 'fail',
        label,
        detail: 'falta --email: el registro de prueba manda correo al solicitante',
      },
      { level: 'info', label: altaLabel, detail: 'no se intentó' },
      { level: 'info', label: cleanupLabel, detail: 'no se intentó' },
    ];
  }

  const destino = bridgeEmailFor(email, now);
  const payload = smokeRegistroPayload({ email: destino, rut: smokeTestRut(), now });

  const post = await probe(fetchImpl, `${base}/api/solicitudes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!post.ok) {
    return [
      { level: 'fail', label, detail: `no respondió: ${post.error}` },
      { level: 'info', label: altaLabel, detail: 'no se intentó' },
      { level: 'info', label: cleanupLabel, detail: 'no se intentó' },
    ];
  }

  const body = await post.response.json().catch(() => null);
  const verdict = judgeBridgeRegistro(post.response.status, body);
  const solicitudId = typeof body?.id === 'string' ? body.id : null;

  const steps = [
    {
      label,
      level: verdict.level,
      detail:
        verdict.level === 'ok'
          ? `${verdict.detail} · correo a ${destino}`
          : verdict.detail,
    },
  ];

  if (!solicitudId || verdict.level !== 'ok') {
    steps.push({ level: 'info', label: altaLabel, detail: 'no se intentó' });
    steps.push({ level: 'info', label: cleanupLabel, detail: 'no hay nada que borrar' });
    return steps;
  }

  if (!store) {
    steps.push({
      level: 'fail',
      label: altaLabel,
      detail:
        'no se pudo leer: falta SUPABASE_SERVICE_ROLE_KEY (o NEXT_PUBLIC_SUPABASE_URL) para consultar y borrar',
    });
    steps.push({
      level: 'fail',
      label: cleanupLabel,
      detail: `quedó sin borrar la solicitud ${solicitudId}: hay que sacarla a mano`,
    });
    return steps;
  }

  const saved = await store.read(solicitudId).catch((error) => ({ error: errorDetail(error) }));
  steps.push({
    label: altaLabel,
    ...(saved.error
      ? { level: 'fail', detail: `no se pudo leer lo guardado: ${saved.error}` }
      : judgeBridgeAlta(saved, solicitudId)),
  });

  const cleanup = await store
    .cleanup(solicitudId)
    .catch((error) => ({ ok: false, error: errorDetail(error) }));

  if (cleanup.ok && cleanup.altas === 1 && cleanup.solicitudes === 1) {
    steps.push({
      level: 'ok',
      label: cleanupLabel,
      detail: 'se borraron el registro y su alta: la producción no queda con datos de prueba',
    });
  } else {
    steps.push({
      level: 'fail',
      label: cleanupLabel,
      detail: `quedó algo (altas ${cleanup.altas ?? '?'}, solicitudes ${cleanup.solicitudes ?? '?'}) de la solicitud ${solicitudId}: sacala a mano`,
    });
  }

  return steps;
}

/**
 * Corre todas las comprobaciones.
 *
 * `write` da de alta la visita de prueba (`/api/registro`); `bridge` recorre el
 * camino registro de socio → alta en `Calificado` y borra lo que escribió. Son
 * dos escrituras distintas: la primera deja una fila en `public.signups` (solo
 * anexa) y la segunda no deja nada, así que el release puede pedir solo la
 * segunda.
 *
 * @param {{ baseUrl?: string, write?: boolean, email?: string | null, bridge?: boolean, bridgeStore?: { read: Function, cleanup: Function } | null, fetchImpl?: typeof fetch }} options
 * @returns {Promise<SmokeReport>}
 */
export async function runSmoke({
  baseUrl = DEFAULT_BASE_URL,
  write = false,
  email = null,
  bridge = false,
  bridgeStore = null,
  fetchImpl = fetch,
}) {
  const base = normalizeBaseUrl(baseUrl);
  const steps = [];
  let hint = null;

  // ── Portada ──
  const home = await probe(fetchImpl, `${base}/`);
  if (!home.ok) {
    steps.push({ level: 'fail', label: 'GET /', detail: `no respondió: ${home.error}` });
  } else {
    const html = await home.response.text().catch(() => '');
    steps.push({ label: 'GET /', ...judgeHome(home.response.status, html) });
  }

  // ── Panel de registros ──
  const admin = await probe(fetchImpl, `${base}/admin/registros`);
  if (!admin.ok) {
    steps.push({
      level: 'fail',
      label: 'GET /admin/registros',
      detail: `no respondió: ${admin.error}`,
    });
  } else {
    const html = await admin.response.text().catch(() => '');
    steps.push({ label: 'GET /admin/registros', ...judgeAdminPage(admin.response.status, html) });
  }

  // ── El panel de socios: existe y su gestión también ──
  // Estas tres comprobaciones existen por un incidente concreto: la sección
  // «Cuentas de socios» y su API vivían en el repositorio y no en producción,
  // así que el panel se veía sin la mitad que lo hace utilizable y nada lo
  // decía. Una ruta que da 404 es eso, y ahora se ve en el informe.
  const socio = await probe(fetchImpl, `${base}/socio`);
  if (!socio.ok) {
    steps.push({ level: 'fail', label: 'GET /socio', detail: `no respondió: ${socio.error}` });
  } else {
    const html = await socio.response.text().catch(() => '');
    steps.push({ label: 'GET /socio', ...judgeSocioPanel(socio.response.status, html) });
  }

  const socioEndpoints = [
    { path: '/api/partner/access', subject: 'el stock de la corredora' },
    { path: '/api/admin/socios', subject: 'las cuentas de socios' },
  ];

  for (const endpoint of socioEndpoints) {
    const label = `GET ${endpoint.path} (sin sesión)`;
    const response = await probe(fetchImpl, `${base}${endpoint.path}`);
    if (!response.ok) {
      steps.push({ level: 'fail', label, detail: `no respondió: ${response.error}` });
    } else {
      steps.push({
        label,
        ...judgeProtectedEndpoint(response.response.status, endpoint.subject),
      });
    }
  }

  // ── El alta: existe y está protegida ──
  const registro = await probe(fetchImpl, `${base}/api/registro`);
  if (!registro.ok) {
    steps.push({
      level: 'fail',
      label: 'GET /api/registro (sin sesión)',
      detail: `no respondió: ${registro.error}`,
    });
  } else {
    steps.push({
      label: 'GET /api/registro (sin sesión)',
      ...judgeRegistroGuard(registro.response.status),
    });
  }

  // ── Qué dice el despliegue de su propia configuración ──
  const health = await probe(fetchImpl, `${base}/api/health`);
  if (health.ok && health.response.status !== 404) {
    const report = await health.response.json().catch(() => null);
    const missing = [
      ...(report?.missing?.broken ?? []),
      ...(report?.missing?.degraded ?? []),
    ];
    steps.push({
      level: missing.length ? 'warn' : 'info',
      label: 'GET /api/health',
      detail: report?.summary ?? 'respondió algo que no se pudo leer',
    });
    if (!report || report.status === 'broken') hint = persistenceHint(report ?? {});
  } else {
    steps.push({
      level: 'info',
      label: 'GET /api/health',
      detail: health.ok ? 'HTTP 404: no está en este despliegue' : `no respondió: ${health.error}`,
    });
  }

  // ── El alta de verdad: ¿se guarda? ──
  let persisted = null;
  if (write) {
    const post = await probe(fetchImpl, `${base}/api/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(smokeSignupPayload(email)),
    });

    if (!post.ok) {
      steps.push({
        level: 'fail',
        label: 'POST /api/registro',
        detail: `no respondió: ${post.error}`,
      });
      persisted = false;
    } else {
      const body = await post.response.json().catch(() => null);
      const verdict = judgeSignup(post.response.status, body);
      steps.push({ label: 'POST /api/registro', ...verdict });
      if (verdict.level === 'warn') persisted = null;
      else persisted = verdict.level === 'ok';

      if (verdict.level !== 'warn' && persisted === false && !hint) {
        hint = persistenceHint({});
      }

      // El correo: ni se finge que salió ni se oculta que salió.
      if (persisted !== null) {
        if (body?.email?.sent === true) {
          steps.push({
            level: 'warn',
            label: 'Correo de bienvenida',
            detail: `enviado a ${email} — revisa la bandeja (y el spam)`,
          });
        } else if (body?.email?.skipped === true) {
          steps.push({
            level: 'info',
            label: 'Correo de bienvenida',
            detail: 'saltado: falta RESEND_API_KEY en este despliegue',
          });
        } else {
          steps.push({
            level: 'warn',
            label: 'Correo de bienvenida',
            detail: 'el envío se intentó y falló (mira los registros del despliegue)',
          });
        }
      }
    }
  }

  // ── El puente: un registro de socio que tiene que nacer como alta ──
  if (bridge) {
    steps.push(
      ...(await runBridgeCheck({ baseUrl: base, email, store: bridgeStore, fetchImpl }))
    );
  }

  const ok = !steps.some((step) => step.level === 'fail');
  return { baseUrl: base, ok, steps, persisted, hint, bridge };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = {
    url: process.env.SMOKE_URL || DEFAULT_BASE_URL,
    write: false,
    email: null,
    // El puente se comprueba salvo que se pida lo contrario: es la comprobación
    // que justifica escribir, y sin ella `--write` solo mira el alta de visitas.
    bridge: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--bridge') args.bridge = true;
    else if (arg === '--no-bridge') args.bridge = false;
    else if (arg === '--url') args.url = argv[++i] ?? args.url;
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else if (arg === '--email') args.email = argv[++i] ?? null;
    else if (arg.startsWith('--email=')) args.email = arg.slice('--email='.length);
  }

  return args;
}

function usage() {
  console.log(
    [
      '',
      'Prueba de humo contra un despliegue: portada, /admin/registros y /api/registro.',
      '',
      '  npm run smoke:prod                                  # solo mira (no escribe nada)',
      '  npm run smoke:prod -- --url http://localhost:3111',
      '  npm run smoke:prod -- --write --email tu@correo.cl  # además da un alta de prueba',
      '',
      'Opciones:',
      '  --url <url>     despliegue a probar (por defecto, producción; o SMOKE_URL)',
      '  --write         da de alta una visita de prueba para ver si persiste',
      '  --email <correo> a dónde mandar los correos de las pruebas (obligatorio con --write o --bridge)',
      '  --bridge        recorre registro de socio → alta en Calificado y lo borra',
      '  --no-bridge     no recorre el puente (con --write, solo prueba /api/registro)',
      '  --help          esto',
      '',
      'Con --write el smoke da un alta de prueba y recorre el puente; el puente',
      'también se puede pedir solo con --bridge. Los dos escriben y mandan correo real:',
      '--write deja una fila en public.signups (solo-anexa), el puente no deja nada',
      'porque borra el registro y su alta al terminar.',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  if ((args.write || args.bridge) && !args.email) {
    console.error(
      [
        '',
        `✗ ${args.write ? '--write' : '--bridge'} necesita --email <correo>.`,
        '',
        '  Las dos pruebas mandan correo real (bienvenida y resultado del registro), y una',
        '  prueba contra una dirección que no existe rebota: eso le cuesta reputación al',
        '  dominio del remitente. Usa tu propio correo, que además te deja comprobar los',
        '  correos de punta a punta. El del puente llega a un alias (+puente…) del mismo',
        '  buzón.',
        '',
        '  npm run smoke:prod -- --write --email tu@correo.cl',
        '  npm run smoke:prod -- --bridge --email tu@correo.cl',
        '',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }

  const bridgeStore = args.bridge ? bridgeStoreFromEnv() : null;
  const report = await runSmoke({
    baseUrl: args.url,
    write: args.write,
    email: args.email,
    bridge: args.bridge,
    bridgeStore,
  });
  console.log(formatReport(report));

  if (!report.ok) process.exitCode = 1;
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
