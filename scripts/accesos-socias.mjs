#!/usr/bin/env node
/**
 * Devuelve el acceso a socias y corredoras **después del corte**, sin pedir
 * restablecimientos uno por uno.
 *
 * ## El problema, que no es «contraseñas perdidas»
 *
 * El portal no tiene contraseñas: se entra con **Google** o con un **enlace de
 * un solo uso** al correo (`AuthModal` → `signInWithOtp`). Y el rol y la
 * corredora de una cuenta viven en `app_metadata`, que **solo el servidor**
 * escribe (`lib/data/socioAccounts.ts`, migración 0014).
 *
 * Después de cortar a una base nueva no hay ninguna cuenta, así que el primer
 * ingreso de una socia crearía una cuenta **sin rol y sin corredora**: entraría,
 * sí, pero a `/socio` le responderían «sin corredora vinculada» y no vería sus
 * publicaciones. Arreglar eso a mano es exactamente el «uno por uno» que este
 * comando evita: se **pre-crean** las cuentas con su rol y su corredora ya
 * escritos, y recién después se avisa a cada persona.
 *
 * ## Por qué el correo no sale por Supabase
 *
 * El proveedor de correo integrado de Supabase está limitado a **2 correos por
 * hora** por proyecto: un aviso masivo por ahí no existe. Pero generar el enlace
 * **no** manda ningún correo (`POST /auth/v1/admin/generate_link` no envía), así
 * que los enlaces se generan con la API de administración y los manda el
 * remitente propio del proyecto —**Resend**, el mismo `RESEND_API_KEY` de los
 * avisos— en lotes de hasta 100, que es lo que hace posible avisar a todas sin
 * depender de nadie.
 *
 * ## La pieza que este comando no inventa
 *
 * **Los correos de las personas.** El catálogo trae uno por corredora
 * (`partners.contact_email`), que alcanza para las 11 corredoras y no para
 * equipos con dos o tres personas. Cuando el correo no es ese, se pasa un
 * archivo propio: `--cuentas <archivo>` (CSV o JSON). Sin correo no hay a quién
 * avisarle, y el informe lo dice en vez de inventar una dirección.
 *
 * ## Uso
 *
 *   npm run accesos:socias                          # plan: solo lectura
 *   npm run accesos:socias -- --aplicar             # crea/vincula las cuentas
 *   npm run accesos:socias -- --aplicar --enviar    # además manda los enlaces
 *   npm run accesos:socias -- --aplicar --enviar --solo yo@correo.cl
 *   npm run accesos:socias -- --cuentas docs/cuentas.csv
 *
 * Salida: `0` = lo pedido quedó hecho · `1` = un paso falló (se detuvo ahí) ·
 * `2` = el comando se usó mal y **nada se ejecutó**.
 *
 * **Sin `--aplicar` no se escribe nada**, ni en la base ni en el correo: la
 * primera corrida es un plan, y solo la segunda toca algo. Núcleo puro probado en
 * `accesos-socias.test.ts` —incluso la equivalencia con las reglas del panel—.
 *
 * Este script no imprime ninguna credencial. Los enlaces de un solo uso son
 * secretos de un uso: no salen por pantalla, y si se piden (`--enlaces`) se
 * escriben en `.accesos/`, que está fuera del control de versiones.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readEnvContent } from './check-auth-config.mjs';
import { decodeJwtPayload, looksLikeAnonKey, looksLikeServiceKey, supabaseRef } from './corte-supabase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** De dónde salen las credenciales, igual que el resto de las herramientas. */
export const DEFAULT_FILE = path.join(ROOT, '.env.local');

/** El estado de este comando: quién ya está listo y a quién ya se le avisó. */
export const DEFAULT_STATE_DIR = path.join(ROOT, '.accesos');
export const LEDGER_NAME = 'estado.json';
export const LINKS_NAME = 'enlaces.json';

export const URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL';
export const ANON_VAR = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';
export const SERVICE_VAR = 'SUPABASE_SERVICE_ROLE_KEY';
/** El remitente y la clave del correo: los mismos que usan los avisos (runbook-resend.md). */
export const FROM_VAR = 'ALERTS_FROM_EMAIL';
export const DEFAULT_FROM = 'Rix7 <avisos@rix7.cl>';
export const RESEND_VAR = 'RESEND_API_KEY';

/** El catálogo de corredoras es de lectura pública: alcanza la clave anónima. */
export const PARTNERS_PATH = '/rest/v1/partners?select=id,name,contact_email&order=sort_order.asc';
/** La misma API que usa el panel: listar cuentas, crearlas y editar su metadata. */
export const ACCOUNTS_PATH = '/auth/v1/admin/users';
export const GENERATE_LINK_PATH = '/auth/v1/admin/generate_link';
export const RESEND_BATCH_ENDPOINT = 'https://api.resend.com/emails/batch';

/** Tope por llamada del endpoint por lotes de Resend. */
export const BATCH_SIZE = 100;
/** Cuentas por página de la API de administración. */
export const ACCOUNTS_PER_PAGE = 200;
/** Tope de páginas al listar cuentas (4000). Más que eso no es este portal. */
export const MAX_ACCOUNT_PAGES = 20;
/** Pausa entre lotes: el límite de Resend es 10 peticiones por segundo. */
export const BATCH_PAUSE_MS = 250;

/**
 * Lo que se hace con cada persona, en orden. El `why` explica por qué importa y
 * el `hint` qué hacer cuando ese paso se cae.
 *
 * @typedef {{ id: string, title: string, why: string, hint: string }} AccessStep
 * @type {AccessStep[]}
 */
export const ACCESS_STEPS = [
  {
    id: 'file',
    title: 'Leer el archivo de credenciales',
    why: 'de acá salen la URL, la clave pública (para leer el catálogo de corredoras) y la de servicio (para administrar las cuentas).',
    hint: 'el origen por defecto es `.env.local`; si las credenciales están en otro lado, pasá `--file <ruta>`.',
  },
  {
    id: 'roster',
    title: 'Armar la lista de personas',
    why: 'sin correo no hay a quién avisarle: este paso dice cuántas corredoras tienen correo de contacto y cuáles no, antes de mandar nada.',
    hint: 'las que no tienen correo se completan en `/admin/empresas` (campo de contacto), o se pasan a mano con `--cuentas <archivo.csv>`.',
  },
  {
    id: 'keys',
    title: 'Forma y pertenencia de las claves',
    why: 'ataja sin red el error caro: la clave pública en el lugar de la de servicio. Administrar cuentas con la pública da 403 después de haberle contado a todo el mundo que ya estaba.',
    hint: 'la de servicio sale del proyecto vsqkjimpssdvlvdwrtnh (cuenta jatf71@gmail.com), en Project Settings » API. Se guarda con `npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY`.',
  },
  {
    id: 'accounts',
    title: 'Leer las cuentas que ya existen',
    why: 'es lo que decide si hay que crear la cuenta o solo completarle el rol y la corredora; una lista incompleta haría crear cuentas que ya existen.',
    hint: 'si el proyecto está pausado, reactivalo en el dashboard y volvé a correr. Un error de red acá no escribe nada.',
  },
  {
    id: 'plan',
    title: 'Plan de cuentas',
    why: 'dice exactamente quién se crea, a quién se le completa el vínculo y quién ya estaba listo, antes de tocar ninguna cuenta.',
    hint: 'las líneas marcadas «sin corredora» o «corredora desconocida» no se aplican: se corrigen en la lista y se vuelve a correr.',
  },
  {
    id: 'apply',
    title: 'Crear y vincular las cuentas',
    why: 'el rol y la corredora tienen que estar escritos ANTES del primer ingreso: si la persona entra primero, su cuenta queda de visita y el panel no le muestra nada.',
    hint: 'el informe de arriba dice qué cuenta falló y con qué respuesta de la base. Volver a correr es seguro: crear y vincular son idempotentes.',
  },
  {
    id: 'verify',
    title: 'Verificar que todas quedaron listas',
    why: 'se vuelve a leer la base y se comprueba cuenta por cuenta: mandar el enlace a alguien cuyo vínculo no quedó escrito la deja entrando a un panel vacío.',
    hint: 'si alguna quedó sin rol o sin corredora, se corrige y se vuelve a correr sin `--enviar`: el correo sale recién cuando todas están listas.',
  },
  {
    id: 'send',
    title: 'Generar y mandar los enlaces',
    why: 'el enlace lo genera la API de administración (no manda correo) y lo manda Resend en lotes: es lo que evita depender del correo de Supabase, limitado a 2 por hora.',
    hint: 'sin RESEND_API_KEY no se envía ninguno y el informe lo dice; con `--enlaces <archivo>` los enlaces quedan guardados para entregarlos a mano.',
  },
];

/** El título de un paso por su id, para el informe. */
export function stepTitle(id) {
  return ACCESS_STEPS.find((step) => step.id === id)?.title ?? id;
}

/** El `hint` declarado del paso, para los fallos que no traen uno propio. */
export function stepHint(id) {
  return ACCESS_STEPS.find((step) => step.id === id)?.hint ?? 'mirá el informe de arriba.';
}

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro: roster, decisiones, correo, lotes y registro
// ═════════════════════════════════════════════════════════════════════════════

/** Tope de correo aceptado. El mismo criterio que `lib/data/socioAccounts.ts`. */
const MAX_EMAIL_LENGTH = 200;

/**
 * Normaliza un correo para comparar y para guardar: recorta, pasa a minúsculas y
 * exige forma mínima. Devuelve `null` si no sirve — nunca una cadena vacía, para
 * que quien llame decida qué responder.
 *
 * Es la misma regla que `normalizeEmail` del panel: emparejar «a@b» con «A@B» a
 * medias sería peor que no emparejar (ver la prueba de equivalencia).
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Los alias de rol que acepta el producto (`ROLE_ALIASES` en `lib/utils/roles.ts`).
 *
 * Son **los mismos y ni uno más**: si acá se aceptara «corredora» y en el panel
 * no, una cuenta creada por este comando tendría un rol que el producto no
 * reconoce. La prueba de equivalencia lo cuida.
 */
const ROLE_ALIASES = {
  admin: 'admin',
  administrator: 'admin',
  member: 'member',
  client: 'member',
  cliente: 'member',
  miembro: 'member',
};

/**
 * El rol de una cuenta o de una fila de la lista, con las mismas tolerancias que
 * el producto: nada que no sea un rol conocido asciende a nadie (devuelve
 * `visitor`).
 *
 * @param {unknown} value
 * @returns {'visitor' | 'member' | 'admin'}
 */
export function resolveRoleLike(value) {
  if (typeof value !== 'string') return 'visitor';
  return ROLE_ALIASES[value.trim().toLowerCase()] ?? 'visitor';
}

/** El rol de una cuenta de Supabase, leído de `app_metadata`. */
function accountRole(user) {
  const metadata = user?.app_metadata;
  const raw = metadata && typeof metadata === 'object' ? metadata.role : undefined;
  return resolveRoleLike(raw);
}

/** La corredora de una cuenta de Supabase, leída de `app_metadata`. */
function accountPartnerId(user) {
  const metadata = user?.app_metadata;
  const raw = metadata && typeof metadata === 'object' ? metadata.partner_id : undefined;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/**
 * El `app_metadata` de una cuenta vinculada a una corredora.
 *
 * **Misma regla que `linkMetadata` del panel**, y no por casualidad: si acá se
 * escribiera distinto, una cuenta creada por este comando y otra vinculada
 * después desde la UI no se comportarían igual. `--test` lo comprueba contra la
 * función real (`accesos-socias.test.ts`).
 *
 * Dos invariantes: vincular **no degrada a un admin** (el equipo conserva su rol
 * y solo gana el vínculo) y se conserva el resto de claves de la metadata.
 *
 * @param {unknown} existing
 * @param {{ role?: string, partnerId: string }} input
 * @returns {Record<string, unknown>}
 */
export function accessMetadata(existing, { role = 'member', partnerId }) {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { .../** @type {Record<string, unknown>} */ (existing) }
      : {};

  const wanted = resolveRoleLike(role) === 'admin' ? 'admin' : 'member';
  const current = resolveRoleLike(base.role);

  return {
    ...base,
    role: current === 'admin' ? 'admin' : wanted,
    partner_id: partnerId,
  };
}

/**
 * Detecta el separador de un CSV chico: el que más se repite en las dos
 * primeras líneas con contenido. Se acepta `,`, `;` y tabulador porque una
 * planilla exportada en Chile trae `;` más veces de las que uno cree.
 *
 * @param {string[]} lines
 * @returns {string}
 */
export function detectSeparator(lines) {
  const candidates = [',', ';', '\t'];
  const sample = lines.filter((line) => line.trim()).slice(0, 2);
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = sample.reduce((total, line) => total + line.split(candidate).length - 1, 0);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Lee la lista de personas de un CSV.
 *
 * Encabezado opcional (`correo, nombre, rol, corredora`), comentarios con `#` y
 * líneas vacías ignoradas. Los nombres de columna se reconocen en español y en
 * inglés porque el archivo lo escribe una persona, no un programa.
 *
 * @param {string} text
 * @returns {{ entries: Record<string, string>[], problems: string[] }}
 */
export function parseRosterCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const separator = detectSeparator(lines);
  const rows = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(separator).map((cell) => cell.trim().replace(/^"(.*)"$/, '$1')));

  if (!rows.length) return { entries: [], problems: ['el archivo no tiene ninguna línea con datos'] };

  const ALIASES = {
    email: ['correo', 'email', 'e-mail', 'mail'],
    name: ['nombre', 'name', 'persona'],
    role: ['rol', 'role'],
    partnerId: ['corredora', 'partner', 'partner_id', 'empresa'],
  };
  const match = (cell) => {
    const value = String(cell ?? '').trim().toLowerCase();
    return Object.entries(ALIASES).find(([, names]) => names.includes(value))?.[0] ?? null;
  };

  const header = rows[0].map(match);
  const hasHeader = header.some(Boolean);
  const columns = hasHeader ? header : ['email', 'name', 'role', 'partnerId'];
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const entries = [];
  const problems = [];
  dataRows.forEach((cells, index) => {
    /** @type {Record<string, string>} */
    const entry = {};
    cells.forEach((cell, column) => {
      const key = columns[column];
      if (key && cell) entry[key] = cell;
    });
    if (!entry.email) {
      problems.push(`línea ${index + (hasHeader ? 2 : 1)}: sin correo (columnas: ${cells.length})`);
      return;
    }
    entries.push(entry);
  });

  return { entries, problems };
}

/**
 * Lee la lista de personas de un JSON: un arreglo de objetos con `correo`/`email`,
 * `nombre`/`name`, `rol`/`role` y `corredora`/`partner_id`. Es el formato en el
 * que llegaría una exportación del proyecto viejo.
 *
 * @param {string} text
 * @returns {{ entries: Record<string, string>[], problems: string[] }}
 */
export function parseRosterJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch (error) {
    return { entries: [], problems: [`el JSON no se pudo leer: ${error.message}`] };
  }

  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.personas) ? parsed.personas : null;
  if (!list) return { entries: [], problems: ['el JSON no es un arreglo de personas'] };

  const entries = [];
  const problems = [];
  list.forEach((row, index) => {
    if (!row || typeof row !== 'object') {
      problems.push(`elemento ${index + 1}: no es un objeto`);
      return;
    }
    const pick = (...keys) => {
      for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    };
    const email = pick('correo', 'email');
    if (!email) {
      problems.push(`elemento ${index + 1}: sin correo`);
      return;
    }
    entries.push({
      email,
      name: pick('nombre', 'name'),
      role: pick('rol', 'role'),
      partnerId: pick('corredora', 'partner', 'partner_id'),
    });
  });

  return { entries, problems };
}

/**
 * Lee la lista de personas del archivo que se pase: CSV por defecto, JSON si
 * empieza con `[` o `{`. Detectar por el contenido y no por la extensión permite
 * pegar cualquiera de los dos en un archivo con cualquier nombre.
 *
 * @param {string} text
 * @returns {{ entries: Record<string, string>[], problems: string[] }}
 */
export function readRoster(text) {
  const trimmed = String(text ?? '').trim();
  return trimmed.startsWith('[') || trimmed.startsWith('{')
    ? parseRosterJson(trimmed)
    : parseRosterCsv(trimmed);
}

/**
 * Las personas que salen del catálogo: una por corredora, con su correo de
 * contacto y su `id` como vínculo.
 *
 * `partners.contact_email` es el correo que la corredora ya publicó en el
 * portal: es el único que el proyecto conoce sin preguntar. Sirve para la
 * corredora; para un equipo con varias personas se pasa su propia lista.
 *
 * @param {unknown} rows
 * @returns {{ entries: Record<string, string>[], withoutEmail: { id: string, name: string }[] }}
 */
export function rosterFromPartners(rows) {
  const entries = [];
  const withoutEmail = [];

  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!id) continue;
    const name = typeof raw.name === 'string' ? raw.name : '';

    if (normalizeEmail(raw.contact_email)) {
      entries.push({ email: String(raw.contact_email), name, role: 'member', partnerId: id });
    } else {
      withoutEmail.push({ id, name: name || id });
    }
  }

  return { entries, withoutEmail };
}

/**
 * Junta las listas, normaliza y saca duplicados.
 *
 * El emparejamiento es por correo en minúsculas: la misma persona anotada dos
 * veces —una por corredora y otra en el archivo— es **una** sola cuenta. Gana la
 * primera aparición que traiga corredora; si ninguna la trae, queda
 * «sin corredora» y el plan no la aplica.
 *
 * @param {{ entries: Record<string, string>[], partners?: Iterable<string>, problems?: string[] }} input
 * @returns {{ people: { email: string, name: string, role: 'member' | 'admin', partnerId: string | null }[], problems: string[] }}
 */
export function normalizeRoster({ entries, partners = [], problems = [] }) {
  const known = new Set(partners);
  const seen = new Map();
  const issues = [...problems];

  for (const entry of entries) {
    const email = normalizeEmail(entry.email);
    if (!email) {
      issues.push(`correo inválido: «${String(entry.email ?? '').slice(0, 60)}»`);
      continue;
    }

    const role = resolveRoleLike(entry.role) === 'admin' ? 'admin' : 'member';
    const partnerId = typeof entry.partnerId === 'string' && entry.partnerId.trim() ? entry.partnerId.trim() : null;

    if (partnerId && known.size && !known.has(partnerId)) {
      issues.push(`${email}: la corredora «${partnerId}» no existe en la base`);
    }

    const current = seen.get(email);
    if (current) {
      if (!current.partnerId && partnerId) current.partnerId = partnerId;
      if (current.role !== 'admin' && role === 'admin') current.role = 'admin';
      if (!current.name && entry.name) current.name = String(entry.name);
      issues.push(`${email}: aparece más de una vez (queda una sola cuenta)`);
      continue;
    }

    seen.set(email, {
      email,
      name: typeof entry.name === 'string' ? entry.name.trim() : '',
      role,
      partnerId,
    });
  }

  return {
    people: [...seen.values()].sort((a, b) => a.email.localeCompare(b.email)),
    problems: issues,
  };
}

/**
 * @typedef {{ email: string, name: string, role: string, partnerId: string | null, accountId: string | null, state: 'crear' | 'vincular' | 'listo' | 'sin-corredora' | 'corredora-desconocida', detail: string }} AccessPlanRow
 */

/**
 * La decisión para cada persona, cruzando la lista con las cuentas que ya
 * existen. **No toca nada**: es lo que el plan muestra.
 *
 * @param {{ people: { email: string, name: string, role: 'member' | 'admin', partnerId: string | null }[], accounts: unknown[], partners?: Iterable<string> }} input
 * @returns {AccessPlanRow[]}
 */
export function planAccounts({ people, accounts, partners = [] }) {
  const known = new Set(partners);
  const byEmail = new Map();

  for (const raw of Array.isArray(accounts) ? accounts : []) {
    if (!raw || typeof raw !== 'object') continue;
    const email = normalizeEmail(raw.email);
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!email || !id) continue;
    byEmail.set(email, raw);
  }

  const rows = [];
  for (const person of people) {
    const account = byEmail.get(person.email) ?? null;
    const row = {
      email: person.email,
      name: person.name,
      role: person.role,
      partnerId: person.partnerId,
      accountId: account && typeof account.id === 'string' ? account.id : null,
      state: 'crear',
      detail: '',
    };

    if (!person.partnerId) {
      row.state = 'sin-corredora';
      row.detail = 'la lista no dice a qué corredora pertenece: no se aplica';
      rows.push(row);
      continue;
    }
    if (known.size && !known.has(person.partnerId)) {
      row.state = 'corredora-desconocida';
      row.detail = `«${person.partnerId}» no está en la tabla de corredoras`;
      rows.push(row);
      continue;
    }

    if (!account) {
      row.state = 'crear';
      row.detail = `se crea con rol ${person.role}${person.partnerId ? ` y la corredora ${person.partnerId}` : ''}`;
      rows.push(row);
      continue;
    }

    const currentRole = accountRole(account);
    const currentPartner = accountPartnerId(account);
    const wantedRole = currentRole === 'admin' ? 'admin' : person.role;

    if (currentRole === wantedRole && currentPartner === person.partnerId) {
      row.state = 'listo';
      row.detail = `ya tiene rol ${currentRole} y la corredora ${currentPartner}`;
      rows.push(row);
      continue;
    }

    row.state = 'vincular';
    row.detail =
      currentRole === 'admin' && person.role !== 'admin'
        ? `es del equipo (rol admin): conserva el rol y se le agrega la corredora ${person.partnerId}`
        : `pasa de ${currentRole}${currentPartner ? `/${currentPartner}` : ''} a ${wantedRole}/${person.partnerId}`;
    rows.push(row);
  }

  return rows;
}

/**
 * Escapa lo que venga de la lista antes de meterlo en HTML (mismo criterio que
 * `lib/email/alertEmail.ts`).
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * El correo que recibe cada persona: **sin contraseñas**, con un enlace de un
 * solo uso y la salida por Google con el mismo correo.
 *
 * El texto lo dice explícitamente porque es lo que evita el soporte por teléfono:
 * «no hay contraseña que recordar ni que restablecer». Si el enlace vence (una
 * hora), la persona pide otro desde la misma página sin ayuda de nadie.
 *
 * @param {{ name?: string, link: string, siteUrl?: string, partner?: string }} input
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildAccessEmail({ name = '', link, siteUrl = 'https://rix7.cl', partner = '' }) {
  const greeting = name ? `Hola ${name},` : 'Hola,';
  const base = String(siteUrl ?? '').replace(/\/+$/, '') || 'https://rix7.cl';
  const panel = `${base}/socio`;
  const subject = 'Tu acceso al panel de Rix7 ya está listo';

  const text = [
    greeting,
    '',
    `Tu cuenta${partner ? ` de ${partner}` : ''} ya está creada en el portal, con acceso al panel de publicaciones.`,
    'Para entrar, abre este enlace (es de un solo uso y vence en una hora):',
    '',
    link,
    '',
    `También puedes entrar cuando quieras a ${panel} y usar «Continuar con Google» con este mismo correo.`,
    'El portal no usa contraseñas: si el enlace vence, pide otro desde esa misma página y llegará en minutos.',
    '',
    'Si no esperabas este correo, ignóralo: nadie puede entrar sin ese enlace.',
    '',
    'Rix7 — Portal inmobiliario inteligente',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="padding:24px 24px 8px">
        <div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#1d4ed8;text-transform:uppercase">Rix7</div>
        <h1 style="margin:8px 0 4px;font-size:20px;color:#0f172a">Tu acceso ya está listo</h1>
        <p style="margin:0;color:#475569;font-size:14px">
          ${escapeHtml(greeting)} tu cuenta${partner ? ` de <strong>${escapeHtml(partner)}</strong>` : ''} ya está
          creada, con acceso al panel de publicaciones.
        </p>
      </div>
      <div style="padding:16px 24px 8px">
        <a href="${escapeHtml(link)}"
           style="display:inline-block;background:#1d4ed8;color:#ffffff;font-size:14px;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none">
          Entrar a mi panel
        </a>
      </div>
      <div style="padding:8px 24px 24px">
        <p style="margin:0 0 8px;color:#475569;font-size:13px;line-height:1.6">
          El enlace es de <strong>un solo uso</strong> y vence en una hora. También puedes entrar en
          cualquier momento a <a href="${escapeHtml(panel)}" style="color:#1d4ed8">${escapeHtml(panel)}</a>
          y usar «Continuar con Google» con este mismo correo.
        </p>
        <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6">
          El portal no usa contraseñas: no hay nada que recordar ni que restablecer. Si el enlace vence,
          pide otro desde la misma página. Si no esperabas este correo, ignóralo.
        </p>
      </div>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Reparte a las personas en lotes del tamaño que acepta Resend.
 *
 * Se salta a quien ya tiene un envío anotado en el registro: volver a correr el
 * comando después de un corte de red no vuelve a escribirle a nadie. `--reenviar`
 * es la única forma de que un envío anotado se repita, y es explícita.
 *
 * @param {{ people: { email: string }[], ledger?: Record<string, { link?: { state?: string } }>, size?: number, resend?: boolean }} input
 * @returns {{ batches: { email: string }[][], skipped: string[] }}
 */
export function planBatches({ people, ledger = {}, size = BATCH_SIZE, resend = false }) {
  const pending = [];
  const skipped = [];

  for (const person of people) {
    if (!resend && ledger?.[person.email]?.link?.state === 'sent') skipped.push(person.email);
    else pending.push(person);
  }

  const batches = [];
  for (let index = 0; index < pending.length; index += size) {
    batches.push(pending.slice(index, index + size));
  }

  return { batches, skipped };
}

/**
 * Anota en el registro lo que pasó con cada persona. El registro es lo que
 * permite reanudar sin repetir: se guarda **estado**, no secretos, y los enlaces
 * de un solo uso solo si se piden aparte.
 *
 * @param {Record<string, Record<string, unknown>>} ledger
 * @param {{ email: string, role?: string, partnerId?: string | null, accountId?: string | null, state?: string, link?: { state: string, at?: string, id?: string | null, error?: string } }[]} updates
 * @param {{ at?: string }} [options]
 * @returns {Record<string, Record<string, unknown>>}
 */
export function mergeLedger(ledger, updates, { at = new Date().toISOString() } = {}) {
  const next = { ...(ledger ?? {}) };

  for (const update of updates) {
    const email = normalizeEmail(update.email);
    if (!email) continue;
    const current = next[email] && typeof next[email] === 'object' ? next[email] : {};
    next[email] = {
      ...current,
      ...(update.role ? { role: update.role } : {}),
      ...(update.partnerId !== undefined ? { partnerId: update.partnerId } : {}),
      ...(update.accountId !== undefined ? { accountId: update.accountId } : {}),
      ...(update.state ? { state: update.state } : {}),
      ...(update.link ? { link: { ...update.link, at: update.link.at ?? at } } : {}),
    };
  }

  return next;
}

/**
 * Valida el archivo de credenciales **sin red**: presencia, forma y pertenencia.
 * Es la misma comprobación que hace el corte, con una diferencia: acá la clave
 * de servicio es la única que administra cuentas, así que la pública en su lugar
 * se ataja con nombre y apellido.
 *
 * @param {Record<string, string>} values
 * @returns {{ ok: boolean, ref: string | null, problems: { code: string, message: string, hint: string }[] }}
 */
export function inspectAccessEnv(values) {
  const problems = [];
  const url = String(values?.[URL_VAR] ?? '').trim();
  const anon = String(values?.[ANON_VAR] ?? '').trim();
  const service = String(values?.[SERVICE_VAR] ?? '').trim();
  const ref = supabaseRef(url);
  const add = (code, message, hint) => problems.push({ code, message, hint });

  if (!url) add('sin-url', `falta ${URL_VAR}`, 'la URL del proyecto nuevo: https://<ref>.supabase.co');
  else if (!/^https?:\/\//i.test(url)) add('url-invalida', `${URL_VAR} no es una URL`, 'revisá esa línea del archivo de credenciales.');
  else if (/placeholder/i.test(url)) add('url-placeholder', `${URL_VAR} apunta al placeholder`, 'poné la URL real del proyecto.');

  if (!anon) add('sin-anon', `falta ${ANON_VAR}`, 'la clave pública del mismo proyecto: es la que lee el catálogo de corredoras.');
  else if (!looksLikeAnonKey(anon)) add('anon-forma', `${ANON_VAR} no tiene forma de clave pública`, 'empieza con "sb_publishable_" (nueva) o "eyJ" (clásica).');

  if (!service) {
    add(
      'sin-service',
      `falta ${SERVICE_VAR}`,
      'sin ella no se puede leer ni escribir el rol de las cuentas. Guardala con `npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY`.',
    );
  } else if (!looksLikeServiceKey(service)) {
    add('service-forma', `${SERVICE_VAR} no tiene forma de clave de servicio`, 'empieza con "sb_secret_" (nueva) o "eyJ" (clásica).');
  } else if (anon && service === anon) {
    add('claves-iguales', `${ANON_VAR} y ${SERVICE_VAR} tienen el mismo valor`, 'la de servicio es otra: la pública no administra cuentas.');
  }

  const serviceBody = decodeJwtPayload(service);
  if (serviceBody && typeof serviceBody.role === 'string' && serviceBody.role !== 'service_role') {
    add('service-rol', `${SERVICE_VAR} tiene rol «${serviceBody.role}»`, 'la de servicio es la que dice "service_role": si dice "anon", copiaste la pública.');
  }
  const keyRef = typeof serviceBody?.ref === 'string' ? serviceBody.ref : null;
  if (ref && keyRef && keyRef !== ref) {
    add('otro-proyecto', `${SERVICE_VAR} es de otro proyecto (ref ${keyRef}, la URL dice ${ref})`, 'las claves tienen que ser del mismo proyecto que la URL.');
  }

  return { ok: problems.length === 0, ref, problems };
}

/**
 * El plan, en una tabla. Los correos se muestran enteros a propósito: es una
 * herramienta local, la lista es de personas que el operador conoce, y un plan
 * con los correos acortados no se puede revisar.
 *
 * @param {AccessPlanRow[]} rows
 * @returns {string}
 */
export function formatPlanTable(rows) {
  const lines = ['', '== Plan de accesos ==', ''];
  const counts = new Map();

  for (const row of rows) {
    counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
    lines.push(`  ${row.state.padEnd(22)} ${row.email.padEnd(34)} ${row.partnerId ?? '—'}`);
    if (row.detail) lines.push(`    ${row.detail}`);
  }

  if (!rows.length) lines.push('  (no hay ninguna persona en la lista)');

  lines.push('');
  for (const [state, count] of counts) lines.push(`  ${count} × ${state}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * El informe final: un renglón por paso, el plan y qué pasó con los correos. Si
 * algo falló, dice **hasta dónde se llegó**, que es la única pregunta que importa
 * cuando una corrida se corta a la mitad.
 *
 * @param {{ steps: { id: string, ok: boolean, detail: string }[], stop?: { id: string, detail: string, hint: string } | null, applied?: boolean, sent?: { sent: number, skipped: number, failed: number } | null, dryRun?: boolean }} result
 * @returns {string}
 */
export function formatAccessOutcome({ steps, stop = null, applied = false, sent = null, dryRun = true }) {
  const lines = ['', '== Accesos de socias y corredoras ==', ''];

  for (const step of steps) lines.push(`  ${step.ok ? '✓' : '✗'} ${stepTitle(step.id)} — ${step.detail}`);
  lines.push('');

  if (stop) {
    lines.push(`✗ Paso «${stepTitle(stop.id)}» falló: ${stop.detail}`);
    if (applied) lines.push('  Las cuentas YA se crearon o vincularon. Volver a correr es seguro: crear y vincular son idempotentes.');
    else lines.push('  No se creó ni se vinculó ninguna cuenta, y no salió ningún correo.');
    lines.push(`  → ${stop.hint}`);
    return lines.join('\n');
  }

  if (dryRun) {
    lines.push('Plan completo: el de arriba es el trabajo que haría este comando.');
    lines.push('  Sin `--aplicar` no se escribe nada, ni en la base ni en el correo.');
    return lines.join('\n');
  }

  if (sent) {
    lines.push(`✓ Enlaces: ${sent.sent} enviado(s), ${sent.skipped} saltado(s), ${sent.failed} con error.`);
    if (sent.skipped > 0) lines.push('  Los saltados ya tenían envío anotado (para repetirlos: `--reenviar`).');
  } else {
    lines.push('✓ Cuentas listas. Falta avisar: volvé a correr con `--enviar`.');
  }

  return lines.join('\n');
}

/**
 * Lo que ningún comando puede afirmar: la comprobación con ojos humanos.
 *
 * @returns {string}
 */
export function formatManualChecklist() {
  return [
    '',
    'Queda a mano (no lo puede afirmar este comando):',
    '  · Abrir uno de los correos enviados y entrar desde ahí: el enlace deja la sesión abierta en /socio.',
    '  · Entrar con Google usando el mismo correo y comprobar que cae en la misma cuenta.',
    '  · Confirmar que en /socio se ven las publicaciones de su corredora.',
    '',
  ].join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// Argumentos
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Los argumentos. Una bandera que no se reconoce **detiene el comando**: en un
 * comando que le escribe a personas reales, un `--enviar` mal escrito no puede
 * terminar mandando correos, y una contradicción (`--dry-run --aplicar`) tampoco
 * se resuelve a favor de la escritura.
 *
 * @param {string[]} argv
 * @returns {{ file: string, rosterFile: string | null, apply: boolean, send: boolean, only: string | null, limit: number | null, resend: boolean, linksFile: string | null, redirect: string | null, help: boolean, error?: string }}
 */
export function parseAccessArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    rosterFile: null,
    apply: false,
    send: false,
    only: null,
    limit: null,
    resend: false,
    linksFile: null,
    redirect: null,
    help: false,
  };

  const value = (index, flag) => {
    const raw = argv[index + 1];
    if (raw === undefined || raw.startsWith('--')) return { error: `Falta el valor después de ${flag}.` };
    return { value: raw };
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--file' || arg === '--cuentas' || arg === '--solo' || arg === '--limite' || arg === '--enlaces' || arg === '--redirect') {
      const read = value(i, arg);
      if (read.error) return { ...args, error: read.error };
      i += 1;
      if (arg === '--file') args.file = path.resolve(read.value);
      else if (arg === '--cuentas') args.rosterFile = path.resolve(read.value);
      else if (arg === '--solo') {
        const email = normalizeEmail(read.value);
        if (!email) return { ...args, error: `--solo espera un correo válido (llegó «${read.value}»).` };
        args.only = email;
      } else if (arg === '--limite') {
        const limit = Number(read.value);
        if (!Number.isInteger(limit) || limit <= 0) return { ...args, error: '--limite espera un número entero mayor que cero.' };
        args.limit = limit;
      } else if (arg === '--enlaces') args.linksFile = path.resolve(read.value);
      else {
        if (!/^https?:\/\//i.test(read.value)) return { ...args, error: '--redirect espera una URL http(s) completa.' };
        args.redirect = read.value;
      }
    } else if (arg === '--aplicar') args.apply = true;
    else if (arg === '--enviar') args.send = true;
    else if (arg === '--reenviar') args.resend = true;
    else if (arg === '--dry-run') args.dryRunFlag = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('-')) return { ...args, error: `No reconozco la bandera «${arg}».` };
  }

  if (args.dryRunFlag && (args.apply || args.send)) {
    return { ...args, error: '--dry-run no se combina con --aplicar ni con --enviar: elegí una de las dos cosas.' };
  }
  if (args.send && !args.apply && !args.dryRunFlag) {
    // Mandar el enlace sin haber preparado la cuenta la deja entrando como
    // visita: el correo sale con el panel vacío. Se exige el paso anterior.
    return { ...args, error: '--enviar necesita --aplicar: primero se deja la cuenta lista y recién después se avisa.' };
  }

  delete args.dryRunFlag;
  return args;
}

function usage() {
  console.log(
    [
      '',
      'Devuelve el acceso a socias y corredoras después del corte, en un comando.',
      '',
      '  npm run accesos:socias                              # plan: solo lectura',
      '  npm run accesos:socias -- --aplicar                 # crea y vincula las cuentas',
      '  npm run accesos:socias -- --aplicar --enviar        # además manda los enlaces',
      '  npm run accesos:socias -- --aplicar --enviar --solo yo@correo.cl   # probar con uno mismo',
      '  npm run accesos:socias -- --cuentas docs/cuentas.csv               # lista propia',
      '',
      'Opciones:',
      '  --aplicar            escribe rol y corredora en las cuentas (sin esto no se escribe nada)',
      '  --enviar             manda el enlace de un solo uso a cada persona (necesita --aplicar)',
      '  --solo <correo>      trabaja solo con esa persona (para probar de punta a punta)',
      '  --limite <n>         trabaja solo con las primeras n personas de la lista',
      '  --cuentas <archivo>  lista propia en CSV o JSON, además del catálogo de corredoras',
      '  --reenviar           vuelve a mandar el enlace a quien ya lo tenía anotado como enviado',
      '  --enlaces <archivo>  guarda los enlaces generados (secretos de un uso: no salen por pantalla)',
      '  --redirect <url>     a dónde vuelve el enlace (por defecto, <sitio>/socio)',
      '  --file <ruta>        otro archivo de credenciales (por defecto `.env.local`)',
      '',
      'Los pasos 1 a 5 no escriben nada: si algo falla, la base y los buzones quedan igual.',
      '',
    ].join('\n'),
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Red
// ═════════════════════════════════════════════════════════════════════════════

/** Una llamada a la base o a Resend, sin reintentos: acá nada se decide por una respuesta tardía. */
async function request({ url, method = 'GET', key, body, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });

    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error?.name === 'TimeoutError' ? 'timeout' : (error?.message ?? String(error)),
    };
  }
}

const trimBase = (url) => String(url ?? '').replace(/\/+$/, '');

/** El catálogo público de corredoras: alcanza la clave anónima. */
export async function fetchPartners({ url, key, fetchImpl = fetch }) {
  const result = await request({ url: `${trimBase(url)}${PARTNERS_PATH}`, key, fetchImpl });
  if (!result.ok || !Array.isArray(result.body)) {
    return { ok: false, error: result.error ?? `HTTP ${result.status}`, rows: [] };
  }
  return { ok: true, rows: result.body };
}

/**
 * Todas las cuentas del proyecto, paginadas. La API de administración no sabe
 * buscar por correo, así que se recorre; si se alcanza el tope, se dice: una
 * lista incompleta haría crear cuentas que ya existen.
 */
export async function fetchAccounts({ url, key, fetchImpl = fetch, perPage = ACCOUNTS_PER_PAGE, maxPages = MAX_ACCOUNT_PAGES }) {
  const users = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await request({ url: `${trimBase(url)}${ACCOUNTS_PATH}?page=${page}&per_page=${perPage}`, key, fetchImpl });
    if (!result.ok) return { ok: false, error: result.error ?? `HTTP ${result.status}`, users };

    const batch = Array.isArray(result.body?.users) ? result.body.users : [];
    users.push(...batch);
    if (batch.length < perPage) return { ok: true, users, truncated: false };
  }

  return { ok: true, users, truncated: true };
}

/** Crea una cuenta confirmada, con su rol y su corredora ya escritos. */
export async function createAccount({ url, key, email, metadata, fetchImpl = fetch }) {
  return request({
    url: `${trimBase(url)}${ACCOUNTS_PATH}`,
    method: 'POST',
    key,
    body: { email, email_confirm: true, app_metadata: metadata },
    fetchImpl,
  });
}

/** Reescribe el `app_metadata` de una cuenta que ya existe. */
export async function updateAccountMetadata({ url, key, id, metadata, fetchImpl = fetch }) {
  return request({
    url: `${trimBase(url)}${ACCOUNTS_PATH}/${encodeURIComponent(id)}`,
    method: 'PUT',
    key,
    body: { app_metadata: metadata },
    fetchImpl,
  });
}

/**
 * Genera el enlace de un solo uso. **No manda ningún correo**: por eso se puede
 * generar uno por persona sin chocar con el límite de 2 correos por hora del
 * proveedor integrado de Supabase.
 *
 * @param {{ url: string, key: string, email: string, redirectTo?: string | null, fetchImpl?: typeof fetch }} options
 */
export async function generateAccessLink({ url, key, email, redirectTo = null, fetchImpl = fetch }) {
  const result = await request({
    url: `${trimBase(url)}${GENERATE_LINK_PATH}`,
    method: 'POST',
    key,
    body: { type: 'magiclink', email, ...(redirectTo ? { redirect_to: redirectTo } : {}) },
    fetchImpl,
  });

  const link = typeof result.body?.action_link === 'string' ? result.body.action_link : null;
  if (!result.ok || !link) {
    return { ok: false, error: result.error ?? `HTTP ${result.status} sin action_link`, link: null };
  }
  return { ok: true, link };
}

/**
 * Manda un lote de correos: un elemento por persona, cada uno con su enlace.
 *
 * Resend acepta hasta 100 elementos por llamada, pero **si un elemento es
 * inválido falla la petición entera**: por eso los correos se arman acá
 * completo (remitente, destinatario, asunto y cuerpo) antes de mandar nada.
 */
export async function sendAccessBatch({ apiKey, messages, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(RESEND_BATCH_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(20_000),
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error?.name === 'TimeoutError' ? 'timeout' : (error?.message ?? String(error)),
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// El comando
// ═════════════════════════════════════════════════════════════════════════════

/** Lee el registro de la corrida anterior (si existe). Nunca lanza: un registro roto es un registro vacío. */
export function readLedger(file) {
  try {
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * El comando entero. Devuelve el informe y hasta dónde llegó; no imprime por su
 * cuenta más que el plan y los informes de los lotes.
 *
 * Se detiene en el primer paso que falla. A partir de `apply` cada cosa que corre
 * deja cuentas escritas, y a partir de `send` hay correos en buzones ajenos: nada
 * de eso se deshace solo, así que no se sigue «por las dudas».
 *
 * @param {{
 *   file?: string, rosterFile?: string | null, apply?: boolean, send?: boolean,
 *   only?: string | null, limit?: number | null, resend?: boolean, linksFile?: string | null,
 *   redirect?: string | null, stateDir?: string, ledger?: Record<string, Record<string, unknown>>,
 *   fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, now?: () => Date, env?: Record<string, string | undefined>, log?: (...args: unknown[]) => void, writeFile?: (file: string, content: string) => void
 * }} [options]
 * @returns {Promise<{ ok: boolean, steps: { id: string, ok: boolean, detail: string }[], stop: { id: string, detail: string, hint: string } | null, plan: AccessPlanRow[], ledger: Record<string, unknown>, applied: boolean, sent: { sent: number, skipped: number, failed: number } | null }>}
 */
export async function runAccessRecovery({
  file = DEFAULT_FILE,
  rosterFile = null,
  apply = false,
  send = false,
  only = null,
  limit = null,
  resend = false,
  linksFile = null,
  redirect = null,
  stateDir = DEFAULT_STATE_DIR,
  ledger = null,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => new Date(),
  env = process.env,
  log = console.log,
  writeFile = (target, content) => writeFileSync(target, content, 'utf8'),
} = {}) {
  const steps = [];
  const record = (id, ok, detail) => steps.push({ id, ok, detail });

  const stop = (id, detail, hint, extra = {}) => ({
    ok: false,
    steps,
    stop: { id, detail, hint },
    plan: [],
    ledger: ledger ?? {},
    applied: extra.applied ?? steps.some((step) => step.id === 'apply' && step.ok),
    sent: extra.sent ?? null,
  });

  const fileValues = {};
  // 1 · Archivo
  if (!existsSync(file)) {
    return stop('file', `no existe ${path.relative(ROOT, file)}`, stepHint('file'));
  }
  Object.assign(fileValues, readEnvContent(readFileSync(file, 'utf8')));
  record('file', true, `${path.relative(ROOT, file)} (${Object.keys(fileValues).length} variables)`);

  const values = { ...fileValues, ...env };
  const url = String(values[URL_VAR] ?? '').trim();
  const anon = String(values[ANON_VAR] ?? '').trim();
  const service = String(values[SERVICE_VAR] ?? '').trim();

  // 2 · La lista de personas: primero el catálogo (solo lectura, clave pública).
  const catalogue = await fetchPartners({ url, key: anon, fetchImpl });
  if (!catalogue.ok) {
    return stop(
      'roster',
      `no se pudo leer el catálogo de corredoras (${catalogue.error})`,
      '¿está activo el proyecto? ¿La URL y la clave pública son las del proyecto nuevo?',
    );
  }

  const fromCatalogue = rosterFromPartners(catalogue.rows);
  let entries = [...fromCatalogue.entries];
  const problems = [];

  if (rosterFile) {
    if (!existsSync(rosterFile)) {
      return stop('roster', `no existe la lista ${path.relative(ROOT, rosterFile)}`, 'revisá la ruta que pasaste en --cuentas.');
    }
    const parsed = readRoster(readFileSync(rosterFile, 'utf8'));
    entries = [...entries, ...parsed.entries];
    problems.push(...parsed.problems.map((problem) => `${path.relative(ROOT, rosterFile)}: ${problem}`));
  }

  const partners = catalogue.rows.map((row) => (typeof row?.id === 'string' ? row.id : '')).filter(Boolean);
  const normalized = normalizeRoster({ entries, partners, problems });
  let people = normalized.people;

  if (only) people = people.filter((person) => person.email === only);
  if (limit) people = people.slice(0, limit);

  if (fromCatalogue.withoutEmail.length || normalized.problems.length) {
    log('\n== Avisos de la lista ==');
    for (const entry of fromCatalogue.withoutEmail) {
      log(`  · ${entry.id} (${entry.name}): sin correo de contacto, no hay a quién avisarle`);
    }
    for (const problem of normalized.problems) log(`  · ${problem}`);
  }

  record(
    'roster',
    true,
    [
      `${people.length} persona(s)`,
      fromCatalogue.withoutEmail.length ? `${fromCatalogue.withoutEmail.length} corredora(s) sin correo de contacto (${fromCatalogue.withoutEmail.map((entry) => entry.id).join(', ')})` : '',
      normalized.problems.length ? `${normalized.problems.length} aviso(s) de la lista` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );

  // 3 · Las claves, sin red
  const inspected = inspectAccessEnv(values);
  if (!inspected.ok) {
    const first = inspected.problems[0];
    return stop('keys', `${inspected.problems.length} problema(s): ${first.message}`, first.hint);
  }
  record('keys', true, `la clave de servicio y la pública pertenecen a ${inspected.ref ?? 'la URL indicada'}`);

  // 4 · Las cuentas que ya existen
  const listed = await fetchAccounts({ url, key: service, fetchImpl });
  if (!listed.ok) {
    return stop('accounts', `no se pudieron leer las cuentas (${listed.error})`, stepHint('accounts'));
  }
  if (listed.truncated) {
    return stop('accounts', `hay más de ${ACCOUNTS_PER_PAGE * MAX_ACCOUNT_PAGES} cuentas: no se puede decidir sin la lista completa`, stepHint('accounts'));
  }
  record('accounts', true, `${listed.users.length} cuenta(s) en el proyecto`);

  // 5 · El plan
  const plan = planAccounts({ people, accounts: listed.users, partners });
  const byEmail = new Map(plan.map((row) => [row.email, row]));
  const ready = plan.filter((row) => row.state === 'listo').length;
  const toWrite = plan.filter((row) => row.state === 'crear' || row.state === 'vincular');
  const blocked = plan.filter((row) => row.state === 'sin-corredora' || row.state === 'corredora-desconocida');

  log(formatPlanTable(plan));
  if (blocked.length) {
    log(`  ${blocked.length} persona(s) fuera del plan por falta de corredora: se corrigen en la lista.`);
  }
  record('plan', true, `${toWrite.length} por escribir (${toWrite.filter((row) => row.state === 'crear').length} nuevas) · ${ready} ya listas · ${blocked.length} fuera del plan`);

  const currentLedger = ledger ?? readLedger(path.join(stateDir, LEDGER_NAME));
  let nextLedger = currentLedger;

  if (!apply) {
    return { ok: true, steps, stop: null, plan, ledger: nextLedger, applied: false, sent: null };
  }

  // 6 · Crear y vincular
  const applied = [];
  const failures = [];
  for (const row of toWrite) {
    const person = people.find((candidate) => candidate.email === row.email);
    const metadata = accessMetadata(
      row.accountId ? listed.users.find((user) => user?.id === row.accountId)?.app_metadata : undefined,
      { role: person?.role ?? 'member', partnerId: row.partnerId },
    );

    const result = row.state === 'crear'
      ? await createAccount({ url, key: service, email: row.email, metadata, fetchImpl })
      : await updateAccountMetadata({ url, key: service, id: row.accountId, metadata, fetchImpl });

    if (!result.ok) {
      failures.push(`${row.email}: ${result.error ?? `HTTP ${result.status}`}`);
      continue;
    }

    applied.push({
      email: row.email,
      role: String(metadata.role),
      partnerId: row.partnerId,
      accountId: result.body?.id ?? row.accountId ?? null,
      state: 'ready',
    });
  }

  nextLedger = mergeLedger(nextLedger, applied, { at: now().toISOString() });
  const ledgerPath = path.join(stateDir, LEDGER_NAME);
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  writeFile(ledgerPath, `${JSON.stringify({ version: 1, updatedAt: now().toISOString(), people: nextLedger }, null, 2)}\n`);

  if (failures.length) {
    record('apply', false, `${failures.length} de ${toWrite.length} fallaron`);
    return stop('apply', failures[0], stepHint('apply'), { applied: applied.length > 0 });
  }
  record('apply', true, `${applied.length} cuenta(s) escritas · registro en ${path.relative(ROOT, ledgerPath)}`);

  // 7 · Verificar contra la base
  const verified = await fetchAccounts({ url, key: service, fetchImpl });
  if (!verified.ok) {
    return stop('verify', `no se pudo releer las cuentas (${verified.error})`, stepHint('verify'), { applied: true });
  }
  const stillMissing = planAccounts({ people, accounts: verified.users, partners }).filter(
    (row) => row.state !== 'listo' && row.state !== 'sin-corredora' && row.state !== 'corredora-desconocida',
  );
  if (stillMissing.length) {
    record('verify', false, `${stillMissing.length} cuenta(s) siguen sin rol o sin corredora`);
    return stop('verify', `${stillMissing[0].email}: ${stillMissing[0].detail}`, stepHint('verify'), { applied: true });
  }
  record('verify', true, `las ${plan.length} cuenta(s) del plan tienen rol y corredora`);

  if (!send) {
    return { ok: true, steps, stop: null, plan, ledger: nextLedger, applied: true, sent: null };
  }

  // 8 · Enlaces y correos
  const resendKey = String(values[RESEND_VAR] ?? '').trim();
  const from = String(values[FROM_VAR] ?? '').trim() || DEFAULT_FROM;
  const siteUrl = String(values.NEXT_PUBLIC_SITE_URL ?? '').trim() || 'https://rix7.cl';
  const target = redirect ?? `${siteUrl.replace(/\/+$/, '')}/socio`;

  const { batches, skipped } = planBatches({
    people: plan.filter((row) => row.state === 'crear' || row.state === 'vincular' || row.state === 'listo'),
    ledger: nextLedger,
    resend,
  });
  if (skipped.length && !resend) log(`  ${skipped.length} persona(s) ya tenían envío anotado: no se les vuelve a escribir.`);

  /** @type {{ email: string, accountId: string | null, link: string, message: { subject: string, text: string, html: string } }[]} */
  const generated = [];
  const linkFailures = [];
  for (const person of batches.flat()) {
    const row = byEmail.get(person.email);
    const link = await generateAccessLink({ url, key: service, email: person.email, redirectTo: target, fetchImpl });
    if (!link.ok) {
      linkFailures.push(`${person.email}: ${link.error}`);
      continue;
    }
    const account = verified.users.find((user) => normalizeEmail(user?.email) === person.email);
    const message = buildAccessEmail({
      name: row?.name ?? '',
      link: link.link,
      siteUrl,
      partner: partnerName(catalogue.rows, row?.partnerId),
    });
    generated.push({ email: person.email, accountId: account?.id ?? null, link: link.link, message });
  }

  if (linkFailures.length) {
    record('send', false, `${linkFailures.length} enlace(s) no se pudieron generar`);
    return stop('send', linkFailures[0], stepHint('send'), { applied: true });
  }

  if (linksFile) {
    const dir = path.dirname(linksFile);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFile(
      linksFile,
      `${JSON.stringify({ generatedAt: now().toISOString(), redirectTo: target, links: generated.map(({ email, link }) => ({ email, link })) }, null, 2)}\n`,
    );
    log(`  Enlaces guardados en ${path.relative(ROOT, linksFile)} (secretos de un solo uso: no se versiona).`);
  }

  if (!resendKey) {
    record('send', false, `${generated.length} enlace(s) generados, ninguno enviado: falta ${RESEND_VAR}`);
    return stop(
      'send',
      `no salió ningún correo: falta ${RESEND_VAR}`,
      'poné RESEND_API_KEY (Resend → API Keys, con No expiration) y volvé a correr con `--enviar`. Los enlaces ya generados se regeneran solos.',
      { applied: true, sent: { sent: 0, skipped: skipped.length, failed: 0 } },
    );
  }

  const generatedByEmail = new Map(generated.map((entry) => [entry.email, entry]));
  let sentCount = 0;
  let failedCount = 0;

  for (const batch of batches) {
    const messages = batch
      .map((person) => generatedByEmail.get(person.email))
      .filter(Boolean)
      .map((entry) => ({ from, to: [entry.email], subject: entry.message.subject, text: entry.message.text, html: entry.message.html }));

    if (!messages.length) continue;

    const result = await sendAccessBatch({ apiKey: resendKey, messages, fetchImpl });
    if (!result.ok) {
      failedCount += messages.length;
      record('send', false, `${messages.length} correo(s) rechazados (${result.error ?? `HTTP ${result.status}`})`);
      return stop(
        'send',
        `Resend rechazó un lote de ${messages.length}: ${result.error ?? `HTTP ${result.status}`}`,
        'el remitente tiene que estar verificado en Resend (runbook-resend.md §4) y la clave ser válida. Los envíos ya aceptados quedaron anotados: volver a correr no los repite.',
        { applied: true, sent: { sent: sentCount, skipped: skipped.length, failed: failedCount } },
      );
    }

    sentCount += messages.length;
    nextLedger = mergeLedger(
      nextLedger,
      batch.map((person) => ({ email: person.email, link: { state: 'sent', at: now().toISOString() } })),
      { at: now().toISOString() },
    );
    writeFile(ledgerPath, `${JSON.stringify({ version: 1, updatedAt: now().toISOString(), people: nextLedger }, null, 2)}\n`);
    log(`  lote enviado: ${messages.length} correo(s) (${sentCount} en total)`);
    if (batches.length > 1) await sleep(BATCH_PAUSE_MS);
  }

  record('send', true, `${sentCount} correo(s) enviados a través de Resend (${skipped.length} ya tenían envío anotado)`);
  return { ok: true, steps, stop: null, plan, ledger: nextLedger, applied: true, sent: { sent: sentCount, skipped: skipped.length, failed: 0 } };
}

/** El nombre de la corredora, para saludar por su nombre en el correo. */
function partnerName(rows, partnerId) {
  if (!partnerId) return '';
  const row = rows.find((candidate) => candidate?.id === partnerId);
  return typeof row?.name === 'string' ? row.name : '';
}

async function main() {
  const args = parseAccessArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (args.error) {
    console.error(`✖ ${args.error}`);
    console.error('  Nada se ejecutó: no se tocó ninguna cuenta ni salió ningún correo. `npm run accesos:socias -- --help` lista las banderas.');
    process.exitCode = 2;
    return;
  }

  console.log('');
  console.log('→ Accesos de socias y corredoras. Los pasos 1 a 5 no escriben nada.');

  const result = await runAccessRecovery(args);

  console.log(formatAccessOutcome({
    steps: result.steps,
    stop: result.stop,
    applied: result.applied,
    sent: result.sent,
    dryRun: !args.apply,
  }));
  if (!result.ok) process.exitCode = 1;
  else if (args.apply && args.send) console.log(formatManualChecklist());
  console.log('');
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  await main();
}
