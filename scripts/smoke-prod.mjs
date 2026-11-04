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
 *   npm run smoke:prod -- --write --email tu@correo.cl  # alta completa de un socio
 *   npm run smoke:prod -- --bridge --email tu@correo.cl # solo registro → Calificado
 *
 * Por qué la escritura es una decisión aparte: el alta manda el correo de
 * bienvenida y escribe una fila en `public.signups`, que es **solo-anexa** (no
 * hay política de UPDATE). Escribir sin querer no es inofensivo: un correo a una
 * dirección inexistente rebota y eso le cuesta reputación al dominio del
 * remitente. Por eso `--write` exige decir a qué correo mandar la bienvenida —el
 * tuyo, que además te deja comprobar el correo de punta a punta— y **borra la
 * fila que escribió**: la tabla guarda constancias de consentimiento, así que
 * una fila de prueba por release no es un dato, es basura legal que se acumula.
 * La fila se busca por correo, nombre y hora de arranque, y se borra por id: con
 * las tres condiciones juntas no puede llevarse el alta real de nadie.
 *
 * Sin `--write` el informe dice honestamente que la persistencia **no se
 * verificó**: no se puede saber sin intentarlo.
 *
 * El puente registro → Calificado tiene su propia opción (`--bridge`). También
 * escribe —el autómata manda el correo del resultado— pero **borra lo que
 * escribió** al terminar: comprueba que un registro de socio aprobado nace como
 * alta en `Calificado`, y deja la base como estaba. Eso es lo que lo hace apto
 * para correr después de cada release.
 *
 * `--write` va más allá y recorre el **alta completa**, que es el camino que de
 * verdad recorre un socio nuevo: registro → Calificado → propuesta comercial
 * (enviada desde el endpoint real de admin) → el candidato la acepta → elige
 * plan y se le habilita el panel → se registra el pago y el alta queda en
 * `Operando` → el enlace del correo abre `/socio` **con sesión** → se borra todo
 * lo que se creó. Cada paso usa el endpoint de producción, no una copia: lo que
 * se comprueba es el camino que va a recorrer un cliente.
 *
 * El único punto donde el smoke no es de caja negra es el token de trámite. El
 * valor en claro solo existe en el correo —la base guarda su SHA-256 a
 * propósito— y el smoke no tiene bandeja. Después de que el servidor emite el
 * token de verdad (y manda su correo), el smoke escribe el hash de un token que
 * él conoce para poder seguir: lo que viene después —validación del token,
 * transición de estado, alta de la ficha y la cuenta, correo, pago, enlace de
 * acceso— corre entero contra producción. El enlace de acceso que se prueba es
 * uno real, emitido por el mismo `generateLink` que usa el alta.
 *
 * El núcleo recibe `fetch` inyectado, así que se prueba sin red
 * (`scripts/smoke-prod.test.ts`).
 */
import { createHash, randomBytes } from 'node:crypto';
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
 * Identidad del alta completa.
 *
 * El nombre propio (y no el del puente) es lo que distingue en el panel una
 * corrida de la otra si alguna limpieza falla: `partners` y `kyb_applications`
 * llevan este nombre, y buscarlo a mano es inmediato.
 */
export const SMOKE_ALTA_NAME = 'Prueba de humo · alta completa (no es una persona)';

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

/**
 * Los pasos de la escritura de `--write`.
 *
 * La limpieza va con nombre estable por el mismo motivo que los del puente: los
 * tests y el informe la buscan para afirmar si la base quedó como estaba.
 */
export const SIGNUP_STEP_LABELS = {
  post: 'POST /api/registro',
  correo: 'Correo de bienvenida',
  cleanup: 'Limpieza del alta de prueba',
};

/**
 * Los pasos del alta completa (`--write`), con nombre estable.
 *
 * Igual que los del puente: los tests y el informe buscan estas etiquetas, y
 * renombrarlas en un solo lado dejaría un verde sin comprobación detrás.
 */
export const ALTA_STEP_LABELS = {
  registro: 'Alta · POST /api/solicitudes (registro del socio)',
  calificado: 'Alta · Calificado vinculado al registro',
  propuesta: 'Alta · POST /api/kyb/:id/proposal (propuesta comercial)',
  aceptacion: 'Alta · POST /api/kyb/proposal (el candidato acepta)',
  plan: 'Alta · POST /api/kyb/activate (plan y panel)',
  pago: 'Alta · POST /api/admin/cobranza (pago → Operando)',
  acceso: 'Alta · enlace del correo abre /socio con sesión',
  cleanup: 'Limpieza del alta completa',
};

/** El orden del informe: cada paso se busca por esta lista. */
const ALTA_ORDER = Object.values(ALTA_STEP_LABELS);

/**
 * Cuánto se espera a que la fila recién escrita se pueda leer.
 *
 * PostgREST lee de la base, no de la respuesta del INSERT: entre una cosa y la
 * otra puede haber un instante de retraso. Tres intentos cubren ese hueco sin
 * convertir el smoke en una espera larga.
 */
const SIGNUP_CLEANUP_ATTEMPTS = 3;
const SIGNUP_CLEANUP_DELAY_MS = 700;

/**
 * Margen hacia atrás para el reloj: `created_at` lo pone Postgres, la hora de
 * arranque la pone esta máquina. Si el reloj local va unos segundos adelantado,
 * la fila recién escrita quedaría «antes» del corte y no se encontraría. Cinco
 * minutos cubren cualquier desfase razonable; la salvaguarda real contra borrar
 * algo ajeno es el correo **y** el nombre de prueba, no la hora.
 */
const SIGNUP_CLEANUP_CLOCK_MARGIN_MS = 5 * 60 * 1000;

/** Espera real; los tests la reemplazan para no dormir. */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * @property {boolean} [alta]             ¿se recorrió el alta completa?
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
  return aliasFor(email, `puente${stamp}`);
}

/** Correo del alta completa: otro alias del mismo buzón, para no chocar con el puente. */
export function altaEmailFor(email, stamp = Date.now()) {
  return aliasFor(email, `alta${stamp}`);
}

function aliasFor(email, tag) {
  const value = String(email ?? '');
  const at = value.lastIndexOf('@');
  if (at <= 0) return value;
  return `${value.slice(0, at)}+${tag}@${value.slice(at + 1)}`;
}

/** El registro de prueba: un profesional independiente que se aprueba solo. */
export function smokeRegistroPayload({
  email,
  rut,
  now = Date.now(),
  name = SMOKE_REGISTRO_NAME,
}) {
  return {
    kind: 'agente',
    name,
    email,
    phone: SMOKE_PHONE,
    rut,
    coverage: 'nacional',
    consent: true,
    message: `Registro de prueba de la prueba de humo (${new Date(now).toISOString()}). El smoke lo borra al terminar.`,
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

/** Primer dato del cuerpo que no se pudo leer como el JSON esperado. */
function bodyError(body, fallback = 'la respuesta no se pudo leer') {
  const error = body?.error;
  return typeof error === 'string' && error.trim() ? error : fallback;
}

/**
 * Cómo leer el envío de la propuesta comercial.
 *
 * Lo que tiene que quedar es el estado `Propuesta_Comercial`, no un 200: si el
 * endpoint respondiera «listo» sin mover el estado, el candidato recibiría un
 * enlace que no abre nada. El correo se informa aparte —un `skipped` no
 * invalida el paso, pero tiene que verse—.
 */
export function judgeProposalSent(status, body) {
  if (status === 401 || status === 403) {
    return { level: 'fail', detail: `HTTP ${status}: el endpoint de admin no aceptó la sesión` };
  }
  if (status === 409) {
    return { level: 'fail', detail: `HTTP 409: ${bodyError(body)}` };
  }
  if (status !== 200 || body?.success !== true) {
    return { level: 'fail', detail: `HTTP ${status}: ${bodyError(body)}` };
  }

  const proposal = body?.data?.proposal;
  if (!proposal || typeof proposal.monthlyClp !== 'number') {
    return { level: 'fail', detail: 'respondió 200 pero no devolvió la propuesta guardada' };
  }
  if (body?.data?.status !== 'Propuesta_Comercial') {
    return {
      level: 'fail',
      detail: `la solicitud quedó en «${body?.data?.status ?? 'sin estado'}» y no en Propuesta_Comercial`,
    };
  }

  return {
    level: 'ok',
    detail: `Propuesta_Comercial · ${proposal.planId} · alta $${proposal.altaClp} · mes $${proposal.monthlyClp}`,
  };
}

/** Cómo leer la aceptación del candidato: tiene que dejar la solicitud en `Alta`. */
export function judgeProposalAccepted(status, body) {
  if (status !== 200 || body?.success !== true) {
    return { level: 'fail', detail: `HTTP ${status}: ${bodyError(body)}` };
  }
  if (body?.data?.status !== 'Alta') {
    return {
      level: 'fail',
      detail: `la solicitud quedó en «${body?.data?.status ?? 'sin estado'}» y no en Alta`,
    };
  }
  return { level: 'ok', detail: 'propuesta aceptada · la solicitud pasó a Alta' };
}

/**
 * Cómo leer la elección de plan.
 *
 * Se exige `panel.enabled`, no solo el 200: es lo que separa «quedó guardado el
 * plan» de «la cuenta y la ficha existen y `/socio` va a abrir». El alta queda
 * en `Alta`, todavía sin pagar; `Operando` lo mueve el pago.
 */
export function judgeActivation(status, body) {
  if (status === 502) {
    return { level: 'fail', detail: `HTTP 502: no se pudo habilitar el panel — ${bodyError(body)}` };
  }
  if (status !== 200 || body?.success !== true) {
    return { level: 'fail', detail: `HTTP ${status}: ${bodyError(body)}` };
  }
  if (body?.data?.panel?.enabled !== true) {
    return { level: 'fail', detail: 'respondió 200 pero el panel no quedó habilitado' };
  }
  if (body?.data?.status !== 'Alta') {
    return {
      level: 'fail',
      detail: `la solicitud quedó en «${body?.data?.status ?? 'sin estado'}» y no en Alta`,
    };
  }

  const partnerId = body?.data?.panel?.partnerId;
  return {
    level: 'ok',
    detail: `plan ${body?.data?.plan ?? '?'} · panel habilitado${partnerId ? ` · ficha ${partnerId}` : ''}`,
  };
}

/** Cómo leer el registro del pago. */
export function judgePayment(status, body) {
  if (status !== 200 || body?.success !== true) {
    return { level: 'fail', detail: `HTTP ${status}: ${bodyError(body)}` };
  }
  return { level: 'ok', detail: 'pago del período registrado' };
}

/**
 * Cómo leer el alta ya pagada: `Operando`, con panel y ficha.
 *
 * Es el cierre del pipeline. Un alta `Alta` con el pago registrado significa que
 * la promoción falló en silencio, y el socio aparecería como cliente sin estar
 * operando.
 */
export function judgeOperando(alta) {
  if (!alta) return { level: 'fail', detail: 'el alta ya no se pudo leer de la base' };
  if (alta.status !== 'Operando') {
    return { level: 'fail', detail: `el alta quedó en «${alta.status}» y no en Operando` };
  }
  if (alta.panel_enabled !== true) {
    return { level: 'fail', detail: 'quedó en Operando pero el panel no está habilitado' };
  }
  if (!alta.partner_id) {
    return { level: 'fail', detail: 'quedó en Operando sin quedar vinculada a una ficha de socio' };
  }
  return { level: 'ok', detail: 'el alta quedó en Operando, con panel y ficha de socio' };
}

/**
 * Cómo leer la redirección de `/auth/confirm`.
 *
 * Un 307 al panel **sin** `error` es el enlace funcionando: el `token_hash` se
 * canjeó en el servidor y la sesión quedó en las cookies. Un redirect con error
 * es un enlace que no sirve, y un 200 significa que la ruta no redirigió: en los
 * dos casos el botón del correo dejaría a la persona afuera.
 */
export function judgeAccessLink(status, location) {
  if (status !== 307 && status !== 308) {
    return { level: 'fail', detail: `HTTP ${status}: el enlace no redirigió al panel` };
  }

  let target = null;
  try {
    target = new URL(String(location ?? ''));
  } catch {
    return { level: 'fail', detail: 'redirigió a una URL que no se puede leer' };
  }

  if (target.pathname !== '/socio') {
    return { level: 'fail', detail: `redirigió a ${target.pathname} y no a /socio` };
  }
  if (target.searchParams.get('error')) {
    return {
      level: 'fail',
      detail: `el enlace no se canjeó: ${target.searchParams.get('error_description') ?? target.searchParams.get('error')}`,
    };
  }
  if (target.hash) {
    return { level: 'fail', detail: 'redirigió con los tokens en el fragmento: la sesión no queda en cookies' };
  }

  return { level: 'ok', detail: '307 a /socio, sin tokens en la URL' };
}

/**
 * Cómo leer el panel con la sesión que dejó el enlace.
 *
 * Se pregunta por la API del panel y no por el HTML: `/socio` responde 200 con
 * o sin sesión —sin sesión muestra la pantalla de acceso—, así que el HTML no
 * distingue «entró» de «no entró». `requireMember` sí: 200 con la ficha del
 * socio quiere decir que la cookie vale y que la cuenta está vinculada.
 *
 * @param {number} status
 * @param {any} body
 * @param {string | null} [partnerId]  la ficha que creó el alta
 */
export function judgePanelSession(status, body, partnerId = null) {
  if (status === 401) {
    return { level: 'fail', detail: 'el enlace no dejó sesión: la API del panel respondió 401' };
  }
  if (status !== 200 || body?.success !== true) {
    return { level: 'fail', detail: `HTTP ${status}: ${bodyError(body)}` };
  }

  const linked = body?.data?.partnerId;
  if (!linked) return { level: 'fail', detail: 'la sesión abrió pero sin ficha de socio vinculada' };
  if (partnerId && linked !== partnerId) {
    return { level: 'fail', detail: `la sesión quedó vinculada a ${linked} y no a ${partnerId}` };
  }

  return { level: 'ok', detail: `sesión abierta y vinculada a la ficha ${linked}` };
}

/**
 * Período de facturación de la corrida, en UTC.
 *
 * Es el mismo criterio de `currentPeriod` en `lib/data/cobranza.ts`: el período
 * es el mes, y el pago de prueba se registra sobre el mes en curso.
 */
export function smokeBillingPeriod(now = Date.now()) {
  const date = new Date(now);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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

  const signupCleanup = report.steps.find((step) => step.label === SIGNUP_STEP_LABELS.cleanup);
  if (signupCleanup?.level === 'ok') {
    lines.push('  · La fila de prueba se borró: `public.signups` no acumula altas de smoke.');
  }

  if (report.bridge) {
    lines.push('  · El registro de prueba del puente se borró con su alta: no queda nada en el pipeline.');
  }

  if (report.alta) {
    // La limpieza se informa aparte: «completa» es el camino del socio, y el
    // borrado tiene su propia línea.
    const caminos = ALTA_ORDER.slice(0, -1);
    const completo = caminos.every(
      (label) => report.steps.find((step) => step.label === label)?.level === 'ok'
    );
    lines.push(
      completo
        ? '  ✓ El alta de prueba se recorrió completa (registro → propuesta → plan → pago → Operando) y el enlace del correo abrió el panel con sesión.'
        : '  · El alta completa no llegó al final: el paso en rojo de arriba dice dónde se cortó.'
    );
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
 * Acceso mínimo a la base para comprobar y borrar lo que escribe el smoke.
 *
 * El smoke es de caja negra salvo acá: la única forma de afirmar que el registro
 * se convirtió en un alta en `Calificado` es leerla, y la única forma de no dejar
 * basura —ni en el pipeline ni en la tabla de consentimientos— es borrarla. Se
 * usa la clave de servicio que ya vive en `.env.local` para las migraciones;
 * nunca se imprime.
 *
 * @param {{ url: string, key: string, fetchImpl?: typeof fetch }} options
 */
export function createSmokeStore({ url, key, fetchImpl = fetch }) {
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

  /** Escritura con la fila tocada de vuelta, para poder afirmar cuántas fueron. */
  async function write(pathAndQuery, method, body) {
    const response = await fetchImpl(`${base}/rest/v1/${pathAndQuery}`, {
      method,
      headers: { ...headers, Prefer: 'return=representation' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text().catch(() => '');
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { ok: response.ok, status: response.status, body: parsed };
  }

  /**
   * GoTrue con la clave de servicio: emitir sesiones y borrar cuentas.
   *
   * Va aparte del REST porque es otro servicio (`/auth/v1`). No se manda
   * `Authorization`: la API de auth se autentica con `apikey`, que es como
   * funciona la sesión de admin que ya usa el repositorio para estas pruebas.
   */
  async function auth(pathAndQuery, init = {}) {
    const response = await fetchImpl(`${base}/auth/v1/${pathAndQuery}`, {
      ...init,
      headers: { apikey: key, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await response.text().catch(() => '');
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { ok: response.ok, status: response.status, body: parsed };
  }

  /**
   * La cookie que espera `@supabase/ssr`: la sesión en base64, troceada.
   *
   * El cliente parte la cookie en trozos de 3.180 caracteres (`name`, `name.1`,
   * …) porque una cabecera no puede pasar de 4 kB; replicar el formato es lo que
   * permite que el servidor la reconozca como una sesión de verdad.
   */
  function sessionCookie(session) {
    const ref = base.replace(/^https:\/\/([^.]+)\..*$/, '$1');
    const name = `sb-${ref}-auth-token`;
    const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
    const chunks = [];
    for (let i = 0; i * 3180 < value.length; i += 1) {
      chunks.push([i === 0 ? name : `${name}.${i}`, value.slice(i * 3180, (i + 1) * 3180)]);
    }
    return chunks.map(([cookieName, chunk]) => `${cookieName}=${chunk}`).join('; ');
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

    /**
     * La fila del alta de prueba, si quedó guardada.
     *
     * Se busca por correo **y** nombre **y** desde el arranque de la corrida: las
     * tres condiciones juntas son las que impiden que algún día se lleve por
     * delante el alta real de quien use el mismo buzón con otro alias.
     */
    async findSignup({ email, name = SMOKE_NAME, since }) {
      const query = [
        'select=id,email,created_at',
        `email=eq.${encodeURIComponent(email)}`,
        `name=eq.${encodeURIComponent(name)}`,
        `created_at=gte.${encodeURIComponent(new Date(since).toISOString())}`,
        'order=created_at.desc',
        'limit=1',
      ].join('&');

      const found = await rest(`signups?${query}`);
      if (!found.ok) throw new Error(`GET signups → HTTP ${found.status}`);
      return found.body?.[0] ?? null;
    },

    /** Borra **una** fila por id: nunca por correo, para no llevarse otra cosa. */
    async deleteSignup(id) {
      const removed = await rest(`signups?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      });

      return {
        ok: removed.ok,
        status: removed.status,
        rows: Array.isArray(removed.body) ? removed.body.length : 0,
      };
    },

    /**
     * La ficha del alta por id, con lo que hace falta para juzgar el cierre.
     *
     * Se vuelve a leer después de cada paso en vez de confiar en la respuesta:
     * la pregunta que importa es qué quedó **guardado**, no qué se contestó.
     */
    async readAlta(altaId) {
      const id = encodeURIComponent(altaId);
      const alta = await rest(
        `kyb_applications?id=eq.${id}&select=id,status,panel_enabled,plan,partner_id,proposal`
      );
      return alta.body?.[0] ?? null;
    },

    /**
     * Escribe el hash de un token que el smoke conoce.
     *
     * El token en claro de un trámite solo existe en el correo —la base guarda
     * su SHA-256 a propósito— y el smoke no tiene bandeja. Después de que el
     * servidor emitió el suyo de verdad, acá se deja uno equivalente para poder
     * recorrer el resto del camino: la validación, el propósito, el vencimiento
     * y las transiciones que vienen después corren enteros contra producción.
     *
     * El token se genera con la misma forma y el mismo hash que
     * `lib/kyb/tokens.ts`; no se reutiliza ni se adivina ninguno real.
     */
    async setToken(altaId, purpose) {
      const token = randomBytes(32).toString('base64url');
      const patched = await write(
        `kyb_applications?id=eq.${encodeURIComponent(altaId)}`,
        'PATCH',
        {
          token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
          token_purpose: purpose,
          token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }
      );

      if (!patched.ok) {
        return { ok: false, error: `no se pudo escribir el token: HTTP ${patched.status}` };
      }
      return { ok: true, token };
    },

    /**
     * Una sesión de admin para llamar a los endpoints del panel.
     *
     * La propuesta comercial y la cobranza están detrás de `requireAdmin`, y el
     * smoke no tiene la contraseña de nadie. La sesión se firma con la clave de
     * servicio, que es la que administra las cuentas: se busca la cuenta con rol
     * admin y se le emite un enlace de un solo uso, igual que hace el panel de
     * administración. La cookie es la que espera `@supabase/ssr`.
     */
    async adminSession() {
      const users = await auth('admin/users?page=1&per_page=1000');
      if (!users.ok) {
        return { ok: false, error: `no se pudieron listar las cuentas: HTTP ${users.status}` };
      }

      const list = Array.isArray(users.body?.users) ? users.body.users : [];
      const admin = list.find((user) =>
        ['admin', 'administrator'].includes(
          String(user?.app_metadata?.role ?? '').trim().toLowerCase()
        )
      );
      if (!admin?.email) {
        return { ok: false, error: 'no hay ninguna cuenta con rol admin para firmar la propuesta' };
      }

      const generated = await auth('admin/generate_link', {
        method: 'POST',
        body: JSON.stringify({ type: 'magiclink', email: admin.email }),
      });
      const hashed = generated.body?.hashed_token ?? generated.body?.properties?.hashed_token;
      if (!generated.ok || !hashed) {
        return { ok: false, error: `no se pudo emitir la sesión de admin: HTTP ${generated.status}` };
      }

      const verified = await auth('verify', {
        method: 'POST',
        body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
      });
      if (!verified.ok || !verified.body?.access_token) {
        return { ok: false, error: `no se pudo canjear la sesión de admin: HTTP ${verified.status}` };
      }

      return { ok: true, cookie: sessionCookie(verified.body), email: admin.email };
    },

    /**
     * El enlace de acceso del alta, emitido por el mismo `generateLink` que usa
     * `provisioning`: es el `token_hash` que viaja en el correo del alta.
     */
    async mintMagicLink(email) {
      const generated = await auth('admin/generate_link', {
        method: 'POST',
        body: JSON.stringify({ type: 'magiclink', email }),
      });
      const hashed = generated.body?.hashed_token ?? generated.body?.properties?.hashed_token;
      if (!generated.ok || !hashed) {
        return { ok: false, error: `no se pudo emitir el enlace: HTTP ${generated.status}` };
      }
      return { ok: true, tokenHash: hashed };
    },

    /** La cuenta del socio por correo, para poder borrarla al final. */
    async deleteAccount(email) {
      const users = await auth('admin/users?page=1&per_page=1000');
      if (!users.ok) {
        return { ok: false, error: `no se pudieron listar las cuentas: HTTP ${users.status}` };
      }

      const list = Array.isArray(users.body?.users) ? users.body.users : [];
      const match = list.find(
        (user) => String(user?.email ?? '').toLowerCase() === String(email).toLowerCase()
      );
      if (!match) return { ok: true, deleted: 0, found: false };

      const removed = await auth(`admin/users/${encodeURIComponent(match.id)}`, { method: 'DELETE' });
      return { ok: removed.ok, deleted: removed.ok ? 1 : 0, found: true, status: removed.status };
    },

    /**
     * Borra todo lo que dejó el alta: cobranza, alta, registro y ficha.
     *
     * El orden importa: el alta referencia al registro y la cobranza a la ficha,
     * así que se borra de la punta hacia atrás. La cuenta se borra aparte, con
     * `deleteAccount`, porque vive en otro servicio.
     */
    async cleanupAlta({ altaId, solicitudId, partnerId }) {
      const counts = { billing: 0, alta: 0, solicitud: 0, partner: 0 };
      const errors = [];

      const remove = async (table, query, key) => {
        const removed = await write(`${table}?${query}`, 'DELETE');
        if (!removed.ok) {
          errors.push(`${table} HTTP ${removed.status}`);
          return;
        }
        counts[key] = Array.isArray(removed.body) ? removed.body.length : 0;
      };

      if (partnerId) {
        await remove('partner_billing', `partner_id=eq.${encodeURIComponent(partnerId)}`, 'billing');
      }
      if (altaId) {
        await remove('kyb_applications', `id=eq.${encodeURIComponent(altaId)}`, 'alta');
      }
      if (solicitudId) {
        await remove('solicitudes', `id=eq.${encodeURIComponent(solicitudId)}`, 'solicitud');
      }
      if (partnerId) {
        await remove('partners', `id=eq.${encodeURIComponent(partnerId)}`, 'partner');
      }

      return { ok: errors.length === 0, ...counts, errors };
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
 * El store del smoke con las claves del entorno, o `null` si no están.
 *
 * Primero `process.env` y después `.env.local`, el mismo orden que
 * `check-schema.mjs` y `db-push.mjs`: así funciona desde un `npm run` y desde el
 * release sin exportar nada a mano.
 */
export function smokeStoreFromEnv({
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

  return createSmokeStore({ url, key });
}

/**
 * Borra la fila que dejó el alta de prueba.
 *
 * Es la mitad que faltaba de `--write`: la tabla es solo-anexa, así que cada
 * corrida sumaba una fila de prueba al historial de consentimientos y nadie la
 * sacaba. Se comprueba que la fila esté y se borra **por id**; si faltan las
 * claves o la fila no aparece, el informe lo dice en vez de callarlo.
 *
 * Un detalle deliberado: que la fila no aparezca **no** cambia el veredicto de
 * persistencia. `--url` puede apuntar a un preview con otra base, así que la
 * ausencia local no desmiente lo que respondió el despliegue; solo significa que
 * acá no hay nada que borrar.
 *
 * @param {{ store: { findSignup: Function, deleteSignup: Function } | null, email: string | null, since: number, sleep?: (ms: number) => Promise<unknown> }} options
 * @returns {Promise<{ level: string, label: string, detail: string }>}
 */
export async function cleanupSignup({ store, email, since, sleep = wait }) {
  const label = SIGNUP_STEP_LABELS.cleanup;

  if (!store) {
    return {
      level: 'warn',
      label,
      detail: `queda la fila de prueba en public.signups: falta SUPABASE_SERVICE_ROLE_KEY (o NEXT_PUBLIC_SUPABASE_URL) para borrarla — se saca a mano con name = '${SMOKE_NAME}'`,
    };
  }

  let row = null;
  let failure = null;
  const from = since - SIGNUP_CLEANUP_CLOCK_MARGIN_MS;

  for (let attempt = 1; attempt <= SIGNUP_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      row = await store.findSignup({ email, name: SMOKE_NAME, since: from });
      failure = null;
    } catch (error) {
      row = null;
      failure = errorDetail(error);
    }
    if (row) break;
    if (attempt < SIGNUP_CLEANUP_ATTEMPTS) await sleep(SIGNUP_CLEANUP_DELAY_MS);
  }

  if (!row && failure) {
    return { level: 'fail', label, detail: `no se pudo buscar la fila de prueba: ${failure}` };
  }
  if (!row) {
    return {
      level: 'warn',
      label,
      detail: `el alta respondió «guardada» pero la fila no está en la base de este --url (${email}): no hay nada que borrar — ¿el despliegue usa otro Supabase?`,
    };
  }

  const removed = await store
    .deleteSignup(row.id)
    .catch((error) => ({ ok: false, rows: 0, error: errorDetail(error) }));

  if (removed?.ok && removed.rows === 1) {
    return {
      level: 'ok',
      label,
      detail: `se borró la fila de prueba ${String(row.id).slice(0, 8)}…: public.signups no acumula altas de smoke`,
    };
  }

  return {
    level: 'fail',
    label,
    detail: `quedó la fila ${row.id} de ${email}: borrala a mano (DELETE FROM public.signups WHERE id = '${row.id}')`,
  };
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
 * El alta completa: el camino que recorre un socio nuevo, punta a punta.
 *
 * Registro público → `Calificado` → propuesta comercial enviada desde el panel
 * → el candidato la acepta → elige plan y se habilita su panel → se registra el
 * pago y el alta queda en `Operando` → el enlace del correo abre `/socio` con
 * sesión. Todo contra el despliegue que se esté probando, con los endpoints y
 * las transiciones reales: si un paso se rompe en producción, el smoke lo dice
 * en ese paso y no en un «el alta anda» genérico.
 *
 * Dos cosas se hacen con la clave de servicio y conviene decirlas:
 *
 * - **La sesión de admin**, sin la que la propuesta y el pago no se pueden
 *   enviar (el smoke no tiene contraseñas). Se firma con la cuenta que ya tiene
 *   rol admin, igual que lo hace el panel de administración.
 * - **Los tokens de trámite**, después de que el servidor emitió los suyos y
 *   mandó los correos. El valor en claro solo existe en el correo y la base
 *   guarda su hash a propósito; el smoke no tiene bandeja, así que escribe el
 *   hash de uno propio para poder seguir. Lo que viene después corre entero
 *   contra producción.
 *
 * Y borra **todo** lo que creó: cobranza, alta, registro, ficha y cuenta. Un
 * pipeline con el alta de prueba de cada release no es una prueba, es basura
 * que alguien va a tener que limpiar a mano.
 *
 * @param {{ baseUrl?: string, email?: string | null, store?: { read: Function, readAlta: Function, setToken: Function, adminSession: Function, mintMagicLink: Function, cleanupAlta: Function, deleteAccount: Function } | null, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<unknown>, now?: number }} options
 * @returns {Promise<SmokeStep[]>}
 */
export async function runAltaCheck({
  baseUrl = DEFAULT_BASE_URL,
  email = null,
  store = null,
  fetchImpl = fetch,
  sleep = wait,
  now = Date.now(),
} = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const L = ALTA_STEP_LABELS;
  const steps = [];

  const done = (label, verdict) => steps.push({ label, ...verdict });
  // La limpieza no se anota acá: la escribe el `finally`, que es el único que
  // sabe qué llegó a crearse. Anotarla dos veces dejaría el paso repetido y el
  // primero —«no se intentó»— taparía el borrado real en el informe.
  const notTried = (labels) => {
    for (const label of labels) {
      if (label !== L.cleanup) done(label, { level: 'info', detail: 'no se intentó' });
    }
  };

  const postJson = async (path, body, extraHeaders = {}) => {
    const sent = await probe(fetchImpl, `${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
    if (!sent.ok) return { ok: false, error: sent.error };
    return {
      ok: true,
      status: sent.response.status,
      body: await sent.response.json().catch(() => null),
    };
  };

  const getJson = async (path, extraHeaders = {}) => {
    const got = await probe(fetchImpl, `${base}${path}`, { headers: extraHeaders });
    if (!got.ok) return { ok: false, error: got.error };
    return {
      ok: true,
      status: got.response.status,
      body: await got.response.json().catch(() => null),
    };
  };

  /** Lo que se creó, para poder borrarlo aunque un paso del medio falle. */
  const created = { solicitudId: null, altaId: null, partnerId: null, account: null };
  const destino = email ? altaEmailFor(email, now) : null;

  if (!email) {
    done(L.registro, {
      level: 'fail',
      detail: 'falta --email: el alta manda correos al solicitante en cada etapa',
    });
    notTried(ALTA_ORDER.slice(1));
    done(L.cleanup, { level: 'info', detail: 'no se creó nada' });
    return steps;
  }

  if (!store) {
    done(L.registro, {
      level: 'fail',
      detail:
        'falta SUPABASE_SERVICE_ROLE_KEY (o NEXT_PUBLIC_SUPABASE_URL): sin la base no se puede comprobar ni borrar el alta',
    });
    notTried(ALTA_ORDER.slice(1));
    done(L.cleanup, { level: 'info', detail: 'no se creó nada' });
    return steps;
  }

  try {
    // 1. El registro público, el mismo del formulario.
    const registro = await postJson('/api/solicitudes', {
      ...smokeRegistroPayload({ email: destino, rut: smokeTestRut(), now, name: SMOKE_ALTA_NAME }),
    });

    if (!registro.ok) {
      done(L.registro, { level: 'fail', detail: `no respondió: ${registro.error}` });
      notTried(ALTA_ORDER.slice(1));
      return steps;
    }

    const registration = judgeBridgeRegistro(registro.status, registro.body);
    created.solicitudId = typeof registro.body?.id === 'string' ? registro.body.id : null;
    done(L.registro, {
      level: registration.level,
      detail:
        registration.level === 'ok'
          ? `${registration.detail} · correo a ${destino}`
          : registration.detail,
    });

    if (registration.level !== 'ok' || !created.solicitudId) {
      notTried(ALTA_ORDER.slice(1));
      return steps;
    }

    // 2. El alta que nació del registro, con sus dos vínculos.
    const saved = await store
      .read(created.solicitudId)
      .catch((error) => ({ error: errorDetail(error) }));
    if (saved.error) {
      done(L.calificado, { level: 'fail', detail: `no se pudo leer lo guardado: ${saved.error}` });
      notTried(ALTA_ORDER.slice(2));
      return steps;
    }

    done(L.calificado, judgeBridgeAlta(saved, created.solicitudId));
    created.altaId = saved?.alta?.id ?? null;
    if (!created.altaId) {
      notTried(ALTA_ORDER.slice(2));
      return steps;
    }

    // 3. La sesión de admin y la propuesta comercial, por el endpoint real.
    const admin = await store.adminSession();
    if (!admin?.ok) {
      done(L.propuesta, { level: 'fail', detail: admin?.error ?? 'no se pudo firmar la sesión de admin' });
      notTried(ALTA_ORDER.slice(3));
      return steps;
    }

    const proposal = await postJson(
      `/api/kyb/${encodeURIComponent(created.altaId)}/proposal`,
      { plan: 'profesional', note: 'Propuesta de la prueba de humo: se borra al terminar.' },
      { Cookie: admin.cookie }
    );

    if (!proposal.ok) {
      done(L.propuesta, { level: 'fail', detail: `no respondió: ${proposal.error}` });
      notTried(ALTA_ORDER.slice(3));
      return steps;
    }

    const sent = judgeProposalSent(proposal.status, proposal.body);
    done(
      L.propuesta,
      sent.level === 'ok' && proposal.body?.email?.skipped === true
        ? { level: 'warn', detail: `${sent.detail} · correo saltado (falta RESEND_API_KEY)` }
        : sent
    );
    if (sent.level !== 'ok') {
      notTried(ALTA_ORDER.slice(3));
      return steps;
    }

    // 4. El candidato acepta. El token lo emitió el servidor y viajó en el
    //    correo; el smoke deja uno equivalente para poder seguir.
    const proposalToken = await store.setToken(created.altaId, 'proposal');
    if (!proposalToken.ok) {
      done(L.aceptacion, { level: 'fail', detail: proposalToken.error });
      notTried(ALTA_ORDER.slice(4));
      return steps;
    }

    const accepted = await postJson('/api/kyb/proposal', {
      token: proposalToken.token,
      decision: 'aceptada',
      ccaAccepted: true,
      ccaUf: 0,
      captacion: false,
    });

    if (!accepted.ok) {
      done(L.aceptacion, { level: 'fail', detail: `no respondió: ${accepted.error}` });
      notTried(ALTA_ORDER.slice(4));
      return steps;
    }

    const aceptacion = judgeProposalAccepted(accepted.status, accepted.body);
    done(L.aceptacion, aceptacion);
    if (aceptacion.level !== 'ok') {
      notTried(ALTA_ORDER.slice(4));
      return steps;
    }

    // 5. Elige plan: crea la ficha y la cuenta, y habilita el panel.
    const activationToken = await store.setToken(created.altaId, 'activation');
    if (!activationToken.ok) {
      done(L.plan, { level: 'fail', detail: activationToken.error });
      notTried(ALTA_ORDER.slice(5));
      return steps;
    }

    const activated = await postJson('/api/kyb/activate', {
      token: activationToken.token,
      plan: 'profesional',
    });

    if (!activated.ok) {
      done(L.plan, { level: 'fail', detail: `no respondió: ${activated.error}` });
      notTried(ALTA_ORDER.slice(5));
      return steps;
    }

    created.partnerId = activated.body?.data?.panel?.partnerId ?? null;
    created.account = activated.body?.data?.panel?.account ?? null;
    const activation = judgeActivation(activated.status, activated.body);
    done(
      L.plan,
      activation.level === 'ok' && !created.partnerId
        ? { level: 'fail', detail: 'el panel quedó habilitado pero sin ficha de socio' }
        : activation
    );
    if (activation.level !== 'ok' || !created.partnerId) {
      notTried(ALTA_ORDER.slice(5));
      return steps;
    }

    // 6. El pago del período: cierra el alta en `Operando`.
    const alta = await store.readAlta(created.altaId).catch(() => null);
    const monthly = lastProposalMonthly(alta?.proposal) ?? 14990;

    const paid = await postJson(
      '/api/admin/cobranza',
      {
        action: 'pago',
        partnerId: created.partnerId,
        period: smokeBillingPeriod(now),
        amountClp: monthly,
        note: 'Pago de la prueba de humo: se borra al terminar.',
      },
      { Cookie: admin.cookie }
    );

    if (!paid.ok) {
      done(L.pago, { level: 'fail', detail: `no respondió: ${paid.error}` });
      notTried(ALTA_ORDER.slice(6));
      return steps;
    }

    const payment = judgePayment(paid.status, paid.body);
    if (payment.level !== 'ok') {
      done(L.pago, payment);
      notTried(ALTA_ORDER.slice(6));
      return steps;
    }

    // La promoción a `Operando` la hace el servidor en la misma petición, pero
    // se lee de la base: lo que vale es lo que quedó guardado.
    let operando = { level: 'fail', detail: 'el alta no se pudo leer después del pago' };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const row = await store.readAlta(created.altaId).catch(() => null);
      operando = judgeOperando(row);
      if (operando.level === 'ok') break;
      if (attempt < 3) await sleep(SIGNUP_CLEANUP_DELAY_MS);
    }
    done(L.pago, operando);
    if (operando.level !== 'ok') {
      notTried(ALTA_ORDER.slice(6));
      return steps;
    }

    // 7. El enlace del correo del alta: canjea la sesión y abre el panel.
    const link = await store.mintMagicLink(destino);
    if (!link.ok) {
      done(L.acceso, { level: 'fail', detail: link.error });
      return steps;
    }

    const confirmUrl =
      `${base}/auth/confirm?token_hash=${encodeURIComponent(link.tokenHash)}` +
      `&type=magiclink&next=${encodeURIComponent('/socio')}`;
    const confirm = await probe(fetchImpl, confirmUrl);

    if (!confirm.ok) {
      done(L.acceso, { level: 'fail', detail: `no respondió: ${confirm.error}` });
      return steps;
    }

    const linkVerdict = judgeAccessLink(
      confirm.response.status,
      confirm.response.headers.get('location')
    );
    if (linkVerdict.level !== 'ok') {
      done(L.acceso, linkVerdict);
      return steps;
    }

    const session = (confirm.response.headers.getSetCookie?.() ?? [])
      .map((cookie) => cookie.split(';')[0])
      .filter(Boolean)
      .join('; ');

    if (!session) {
      done(L.acceso, {
        level: 'fail',
        detail: 'la redirección no dejó cookies: el enlace abriría el panel sin sesión',
      });
      return steps;
    }

    const panel = await getJson('/api/partner/access', { Cookie: session });
    if (!panel.ok) {
      done(L.acceso, { level: 'fail', detail: `no respondió: ${panel.error}` });
      return steps;
    }

    done(L.acceso, judgePanelSession(panel.status, panel.body, created.partnerId));
  } finally {
    steps.push(await cleanupAlta({ store, created, email: destino }));
  }

  return steps;
}

/**
 * Borra lo que dejó el alta y lo reporta con lo que se borró de verdad.
 *
 * Se exige la fila esperada de cada tabla: «la petición salió bien» no alcanza, porque
 * un borrado filtrado por una columna mal nombrada responde 200 sin llevarse nada.
 */
async function cleanupAlta({ store, created, email }) {
  const label = ALTA_STEP_LABELS.cleanup;
  const { altaId, solicitudId, partnerId, account } = created;

  if (!altaId && !solicitudId && !partnerId) {
    return { level: 'info', label, detail: 'no se creó nada' };
  }

  const removed = await store
    .cleanupAlta({ altaId, solicitudId, partnerId })
    .catch((error) => ({ ok: false, errors: [errorDetail(error)] }));

  // La cuenta se borra solo si la creó esta corrida: si el correo ya tenía
  // cuenta, el alta la reutilizó y borrarla sería llevarse la de alguien.
  const accountRemoved =
    account === 'created'
      ? await store
          .deleteAccount(email)
          .catch((error) => ({ ok: false, deleted: 0, error: errorDetail(error) }))
      : { ok: true, deleted: 0, found: false };

  const expectations = [
    ['alta', altaId, removed.alta],
    ['solicitud', solicitudId, removed.solicitud],
    ['ficha', partnerId, removed.partner],
  ].filter(([, id]) => Boolean(id));

  const missing = expectations.filter(([, , count]) => count !== 1).map(([name]) => name);
  const accountFailed = account === 'created' && accountRemoved.deleted !== 1;

  if (!removed.ok || missing.length || accountFailed) {
    const problems = [
      ...(removed.errors ?? []),
      ...missing.map((name) => `${name} sin borrar`),
      ...(accountFailed ? ['cuenta sin borrar'] : []),
    ];
    return {
      level: 'fail',
      label,
      detail: `quedó algo del alta de prueba (${problems.join(', ')}): sacalo a mano — ${SMOKE_ALTA_NAME}`,
    };
  }

  const parts = expectations.map(([name]) => name);
  return {
    level: 'ok',
    label,
    detail: `se borraron ${parts.join(', ')}${account === 'created' ? ' y la cuenta' : ''}: la producción no queda con datos de prueba`,
  };
}

/** El monto mensual de la última propuesta, para registrar un pago con sentido. */
function lastProposalMonthly(proposal) {
  if (!Array.isArray(proposal)) return null;
  for (let i = proposal.length - 1; i >= 0; i -= 1) {
    const value = proposal[i]?.monthlyClp;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * Corre todas las comprobaciones.
 *
 * `write` da de alta la visita de prueba (`/api/registro`) y borra la fila que
 * escribe; `alta` recorre el **alta completa** de un socio y borra todo lo que
 * crea; `bridge` recorre solo el camino registro de socio → alta en `Calificado`
 * y también limpia lo suyo. La CLI enciende `alta` con `--write` y `bridge` con
 * `--bridge`; separarlas permite probar cada escritura sin arrastrar las otras.
 * Todas dejan la base como estaba, así que el release puede pedir el puente sin
 * acumular nada.
 *
 * @param {{ baseUrl?: string, write?: boolean, alta?: boolean, email?: string | null, bridge?: boolean, store?: object | null, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<unknown>, now?: number }} options
 * @returns {Promise<SmokeReport>}
 */
export async function runSmoke({
  baseUrl = DEFAULT_BASE_URL,
  write = false,
  alta = false,
  email = null,
  bridge = false,
  store = null,
  fetchImpl = fetch,
  sleep = wait,
  now = Date.now(),
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
    // La hora de arranque es lo que acota la búsqueda de la fila que hay que
    // borrar: todo lo anterior a este instante es historial ajeno.
    const startedAt = now;
    const post = await probe(fetchImpl, `${base}/api/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(smokeSignupPayload(email)),
    });

    if (!post.ok) {
      steps.push({
        level: 'fail',
        label: SIGNUP_STEP_LABELS.post,
        detail: `no respondió: ${post.error}`,
      });
      persisted = false;
    } else {
      const body = await post.response.json().catch(() => null);
      const verdict = judgeSignup(post.response.status, body);
      steps.push({ label: SIGNUP_STEP_LABELS.post, ...verdict });
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
            label: SIGNUP_STEP_LABELS.correo,
            detail: `enviado a ${email} — revisa la bandeja (y el spam)`,
          });
        } else if (body?.email?.skipped === true) {
          steps.push({
            level: 'info',
            label: SIGNUP_STEP_LABELS.correo,
            detail: 'saltado: falta RESEND_API_KEY en este despliegue',
          });
        } else {
          steps.push({
            level: 'warn',
            label: SIGNUP_STEP_LABELS.correo,
            detail: 'el envío se intentó y falló (mira los registros del despliegue)',
          });
        }
      }

      // Y no se queda: la fila se comprueba y se borra. Si no quedó guardada no
      // hay nada que limpiar —el informe ya lo dice en el paso anterior—.
      if (persisted === true) {
        steps.push(await cleanupSignup({ store, email, since: startedAt, sleep }));
      }
    }
  }

  // ── El alta completa: el camino que recorre un socio nuevo ──
  // El puente corto deja de tener sentido cuando el alta corre: el alta ya pasa
  // por el mismo registro, y correr los dos dejaría dos altas de prueba y el
  // doble de correos para el mismo veredicto.
  if (alta) {
    steps.push(
      ...(await runAltaCheck({ baseUrl: base, email, store, fetchImpl, sleep, now }))
    );
  }

  // ── El puente: un registro de socio que tiene que nacer como alta ──
  if (bridge && !alta) {
    steps.push(...(await runBridgeCheck({ baseUrl: base, email, store, fetchImpl, now })));
  }

  const ok = !steps.some((step) => step.level === 'fail');
  return { baseUrl: base, ok, steps, persisted, hint, bridge, alta };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = {
    url: process.env.SMOKE_URL || DEFAULT_BASE_URL,
    write: false,
    email: null,
    // El puente no corre solo: escribe y manda correo, así que se pide. Sin
    // esto, `npm run smoke:prod` —la comprobación de que el deploy está vivo—
    // pedía `--email` para algo que nadie había autorizado.
    bridge: false,
    // `--signup` es la mitad de `--write`: solo la visita de prueba y su correo
    // de bienvenida. Lo usa `check:domain`, que necesita comprobar el envío sin
    // recorrer un alta entera.
    signup: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--signup') args.signup = true;
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
      '  npm run smoke:prod -- --write --email tu@correo.cl  # recorre el alta completa',
      '',
      'Opciones:',
      '  --url <url>     despliegue a probar (por defecto, producción; o SMOKE_URL)',
      '  --write         recorre el alta completa de un socio y borra todo lo que crea',
      '  --signup        solo la visita de prueba y su correo de bienvenida (mitad de --write)',
      '  --email <correo> a dónde mandar los correos de las pruebas (obligatorio al escribir)',
      '  --bridge        recorre solo registro de socio → Calificado y lo borra',
      '  --help          esto',
      '',
      'Con --write el smoke da un alta de prueba y recorre registro → Calificado →',
      'propuesta → aceptación → plan → pago (Operando) → enlace del correo, y',
      'después borra el alta, el registro, la ficha y la cuenta. El puente corto se',
      'pide aparte con --bridge. Los dos escriben y mandan correo real; si falta la',
      'clave de servicio, el informe dice qué quedó sin borrar.',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const signup = args.write || args.signup;

  if ((signup || args.bridge) && !args.email) {
    console.error(
      [
        '',
        `✗ ${args.write ? '--write' : args.signup ? '--signup' : '--bridge'} necesita --email <correo>.`,
        '',
        '  Las pruebas que escriben mandan correo real (bienvenida, las etapas del',
        '  alta y el resultado del registro), y una contra una dirección que no existe',
        '  rebota: eso le cuesta reputación al dominio del remitente. Usa tu propio',
        '  correo, que además te deja comprobar los correos de punta a punta. Los del',
        '  alta y del puente llegan a alias (+alta…, +puente…) del mismo buzón.',
        '',
        '  npm run smoke:prod -- --write --email tu@correo.cl',
        '  npm run smoke:prod -- --bridge --email tu@correo.cl',
        '',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }

  // Un solo store para las escrituras: solo hace falta si alguna va a correr.
  const store = signup || args.bridge ? smokeStoreFromEnv() : null;
  const report = await runSmoke({
    baseUrl: args.url,
    write: signup,
    // `--write` es el alta completa; además deja la fila de la visita de prueba.
    alta: args.write,
    email: args.email,
    bridge: args.bridge,
    store,
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
