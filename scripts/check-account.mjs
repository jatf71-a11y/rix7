#!/usr/bin/env node
/**
 * ¿De quién es la **cuenta** a la que pertenece la base? — preguntado a Supabase.
 *
 * `lib/utils/supabaseOwner` contesta una pregunta más débil: «¿la URL de este
 * despliegue dice el proyecto que creemos que es el de la cuenta dueña?». Eso se
 * responde sin red y sin privilegios, pero **da por sentado** que esa referencia
 * pertenece a la cuenta correcta, porque esa pertenencia está escrita a mano
 * (`DEFAULT_OWNER_PROJECT_REF`). El 2026-10-13 el proyecto en vivo estaba
 * exactamente en ese estado: todo respondía, la referencia era la esperada, y la
 * cuenta dueña había quedado sin puerta de entrada. Un valor escrito a mano no
 * puede notar eso: si la base cambia de dueño, el valor sigue diciendo lo mismo.
 *
 * Acá se le pregunta a la **API de administración** de Supabase, que es el único
 * camino documentado: no hay forma de saber a qué organización pertenece un
 * proyecto `https://<ref>.supabase.co` con su URL y su clave pública. El camino:
 *
 * 1. `GET /v1/organizations` — las organizaciones que el token alcanza.
 * 2. El proyecto: por la vía de la cuenta (`GET /v1/projects`) y, si no aparece,
 *    recorriendo los proyectos de cada organización
 *    (`GET /v1/organizations/{slug}/projects`), que es el camino de un token de
 *    alcance mínimo —el recomendable—. Así se sabe **de qué organización es**.
 * 3. `GET /v1/organizations/{slug}/members` — quién es su dueño, con correo.
 *    Esto es lo que convierte «debería ser tu cuenta» en «es tu cuenta, lo dice
 *    Supabase». No existe un endpoint de perfil («¿de quién es este token?»), así
 *    que la identidad sale de la membresía de la organización y este paso no es
 *    opcional.
 *
 * ## Los tres finales, y por qué el color del job depende de ellos
 *
 * - **verificado** — se leyó el dueño de la organización del proyecto y es el
 *   esperado. Verde.
 * - **la base es de otra cuenta** — se leyó el dueño y no es el esperado. Rojo:
 *   es el incidente, probado, y es lo que este script existe para ver.
 * - **no se pudo comprobar** — token de otra cuenta, alcance insuficiente, sin
 *   permiso de miembros, la API no responde. No se prueba nada malo, pero
 *   **tampoco se aprobó nada**: sale con 2 y lo dice. Un «no sé» pintado de verde
 *   es la mentira que este subsistema viene a evitar.
 *
 * ## El token
 *
 * Necesita `SUPABASE_ACCESS_TOKEN` (`sbp_…`): vive en `.env.local` —nunca en
 * Vercel, que es donde va el de servicio— y, para que esto corra solo cada 6
 * horas, en los secretos del repositorio. Conviene que sea un token **de solo
 * lectura con alcance**: «Organization Projects → Read» y «Organization Members →
 * Read» alcanzan, y un token así no puede cambiar nada. Sin token el paso se
 * saltea en el CI (con un aviso, no en rojo): no tener la credencial no es una
 * caída, y un job rojo por algo que no está configurado se aprende a ignorar.
 *
 * ## Qué NO hace
 *
 * - **No deja pasar el token a ningún lado**: se usa para armar el encabezado
 *   `Authorization` y nada más. No entra al veredicto ni a las notas, así que el
 *   informe que se pega en un issue no puede filtrarlo (hay un test que lo
 *   comprueba).
 * - **No deja de mirar el reloj**: no es un test de la suite, es una sonda. La
 *   llama el workflow de salud (`check-account.mjs` → `cuenta.txt` → el aviso del
 *   issue) y se puede correr a mano con `npm run check:cuenta`.
 *
 * Uso:
 *   npm run check:cuenta
 *   npm run check:cuenta -- --json
 *   npm run check:cuenta -- --url https://xxxx.supabase.co
 *   npm run check:cuenta -- --ref xxxx --owner otra@cuenta.cl
 *
 * Salida: 0 = verificado (o nada que comprobar) · 1 = la base es de otra cuenta ·
 *         2 = no se pudo comprobar (que no es un «está bien»).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** El `.env.local` del proyecto: de ahí salen la URL y el token. Nunca se versiona. */
const ENV_FILE = path.join(ROOT, '.env.local');

/** La API de administración: lo único que puede decir de quién es un proyecto. */
export const MANAGEMENT_API = 'https://api.supabase.com';

/** Cuánto se espera cada respuesta. Son peticiones de panel, no del portal. */
export const ACCOUNT_TIMEOUT_MS = 15000;

/**
 * Techo de organizaciones que se recorren buscando el proyecto: una red de
 * seguridad contra el límite de tasa (120 peticiones por minuto documentadas).
 * Si se llega al techo, se informa como nota en vez de callarse.
 */
export const MAX_ORGS_SCANNED = 20;

/**
 * El correo que se espera como dueño de la organización del proyecto, cuando nada
 * lo dice: el de la cuenta A del registro (`lib/utils/supabaseOwner`).
 *
 * Está acá **y** allá a propósito: aquel módulo es TypeScript y lo usa el runtime
 * del portal, este es una sonda de Node sin compilar. Un test comprueba que los
 * dos valores coincidan, así que la duplicación no puede quedarse callada.
 */
export const DEFAULT_OWNER_ACCOUNT_EMAIL = 'jatf71@gmail.com';

/**
 * La referencia del proyecto a partir de la URL, o `null`. La misma regla que
 * `lib/utils/supabaseOwner.projectRefFromUrl`: acepta los dos dominios
 * (`supabase.co` y `supabase.in`) y exige que la URL empiece con el proyecto.
 *
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function projectRefFromUrl(url) {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)(?:\/|$)/i.exec(String(url ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}

function str(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * La lista de objetos de una respuesta, sin adivinar el sobre.
 *
 * Los ejemplos de la documentación son arrays pelados, pero el sobre no está
 * confirmado para todos los endpoints, así que se acepta lo razonable
 * (`{ data: [...] }`, `{ items: [...] }`…) en vez de fallar por una envoltura. Un
 * objeto con forma de error **no** se lee como lista vacía: `[]` significa «la API
 * no listó nada», y eso se informa como tal.
 */
function asArray(payload) {
  const inside = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      for (const key of ['data', 'items', 'results']) {
        if (Array.isArray(value[key])) return value[key];
      }
    }
    return null;
  };

  const list = inside(payload);
  if (!list) return [];

  return list.filter((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

/** Los roles de un miembro cuando vienen como objetos (`roles[].name`, API v2). */
function rolesOf(item) {
  if (!Array.isArray(item.roles)) return null;

  const names = item.roles
    .map((role) => (typeof role === 'string' ? role : str(role?.name)))
    .filter(Boolean);

  return names.length ? names.join(' · ') : null;
}

/** Los proyectos de una respuesta (`ref` en la de organización, `id` en la de cuenta). */
export function readProjects(payload) {
  return asArray(payload)
    .map((item) => ({
      ref: str(item.ref) ?? str(item.id) ?? '',
      name: str(item.name) ?? null,
      organizationId: str(item.organization_id) ?? str(item.organizationId) ?? null,
    }))
    .filter((project) => project.ref !== '');
}

/** Las organizaciones del token. Sin `slug` no se pueden pedir sus proyectos ni sus miembros. */
export function readOrganizations(payload) {
  return asArray(payload)
    .map((item) => {
      const id = str(item.id) ?? str(item.slug) ?? '';
      return { id, slug: str(item.slug) ?? id, name: str(item.name) ?? null };
    })
    .filter((organization) => organization.id !== '');
}

/** Los miembros, con correo y rol vengan como vengan (`role_name` en v1, `roles[]` en v2). */
export function readMembers(payload) {
  return asArray(payload).map((item) => ({
    email: str(item.email) ?? str(item.primary_email) ?? null,
    name: str(item.user_name) ?? str(item.username) ?? str(item.name) ?? null,
    role: str(item.role_name) ?? str(item.role) ?? rolesOf(item),
  }));
}

/** El proyecto con esa referencia, o `null`. */
export function findProject(projects, ref) {
  return projects.find((project) => project.ref === ref) ?? null;
}

/** La organización con ese identificador, o `null`. */
export function findOrganization(organizations, id) {
  if (!id) return null;
  return organizations.find((organization) => organization.id === id) ?? null;
}

/**
 * Los correos de quienes figuran como **dueños** de la organización.
 *
 * El rol se busca por texto (`/owner/i`) a propósito: la API lo llama `role_name`
 * con valores como `Owner`, y una comparación exacta se rompería con la primera
 * variante de mayúsculas. Un miembro sin correo no cuenta: no se puede comparar
 * con lo esperado, y contarlo sería aprobar de gusto.
 *
 * @param {Array<{ email?: string | null, role?: string | null }>} members
 * @returns {string[]} correos en minúscula, sin repetir
 */
export function ownerEmails(members) {
  const emails = members
    .filter((member) => Boolean(member.role) && /owner/i.test(String(member.role)))
    .map((member) => member.email)
    .filter(Boolean)
    .map((email) => email.toLowerCase());

  return [...new Set(emails)];
}

/**
 * El veredicto, con nombres para los tests y para quien lo consuma.
 *
 * @typedef {object} AccountVerdict
 * @property {'verified' | 'mismatch' | 'unconfirmed'} state
 * @property {boolean} ok                        `true` solo con `state: 'verified'`
 * @property {string} projectRef
 * @property {string} expectedOwnerEmail
 * @property {{ id: string, slug: string, name: string | null } | null} organization
 * @property {string[]} ownerEmails              los dueños **según la API**
 * @property {string | null} reason              nunca contiene el token
 * @property {string[]} notes
 * @property {number} requests
 */

/**
 * Qué se llegó a averiguar en la API. Es la entrada de `judgeAccountOwnership`:
 * separar el veredicto de la red permite probar cada final sin levantar nada.
 *
 * @param {{ projectRef: string, expectedOwnerEmail: string, project: object | null, organization: object | null, owners: string[] | null, obstacle: string | null, notes?: string[], requests?: number }} evidence
 * @returns {AccountVerdict}
 */
export function judgeAccountOwnership({
  projectRef,
  expectedOwnerEmail,
  project,
  organization,
  owners,
  obstacle,
  notes = [],
  requests = 0,
}) {
  // Los correos se normalizan acá y no solo en `ownerEmails`: el veredicto tiene
  // que ser el mismo venga de donde venga la lista, y comparar `JATF71@Gmail.com`
  // contra `jatf71@gmail.com` como si fueran distintos sería un falso «es de otra
  // cuenta» —justo la alarma que no se puede dar de gusto—.
  const ownerList = (owners ?? [])
    .map((email) => String(email).trim().toLowerCase())
    .filter(Boolean);

  const base = {
    projectRef,
    expectedOwnerEmail,
    organization,
    ownerEmails: ownerList,
    requests,
  };
  const expected = String(expectedOwnerEmail ?? '').trim().toLowerCase();

  if (obstacle) {
    return { ...base, state: 'unconfirmed', ok: false, reason: obstacle, notes };
  }

  if (!project) {
    return {
      ...base,
      state: 'unconfirmed',
      ok: false,
      reason: `El token de administración no ve el proyecto ${projectRef} entre los suyos: o el token salió de otra cuenta, o su alcance no incluye ese proyecto.`,
      notes,
    };
  }

  if (!organization) {
    return {
      ...base,
      state: 'unconfirmed',
      ok: false,
      reason: `El proyecto ${projectRef} no se pudo ubicar en ninguna de las organizaciones del token: no se sabe de quién es.`,
      notes,
    };
  }

  if (owners === null || ownerList.length === 0) {
    return {
      ...base,
      state: 'unconfirmed',
      ok: false,
      reason: `No se pudo leer quién es el dueño de la organización «${organization.name ?? organization.slug}»: ningún miembro con correo figura con rol de dueño.`,
      notes,
    };
  }

  const ownersText = ownerList.join(', ');
  const where = `«${organization.name ?? organization.slug}» (${organization.slug})`;

  if (ownerList.includes(expected)) {
    return {
      ...base,
      state: 'verified',
      ok: true,
      reason: null,
      notes: [...notes, `La organización ${where} tiene como dueño a ${ownersText}, según la API de administración.`],
    };
  }

  return {
    ...base,
    state: 'mismatch',
    ok: false,
    reason: `La base ${projectRef} pertenece a la organización ${where}, cuyo dueño es ${ownersText}; el dueño esperado es ${expectedOwnerEmail}.`,
    notes,
  };
}

/**
 * Qué código de salida le corresponde a cada final. Es el contrato con el
 * workflow, y por eso está aislado y probado: ahí, «1» es el rojo que abre el
 * issue y «2» es «hay token y aun así no se pudo comprobar», que también hay que
 * mirar —un token con el alcance mal puesto no comprueba nada aunque no haya
 * nada roto—.
 *
 * @param {'verified' | 'mismatch' | 'unconfirmed'} state
 * @returns {0 | 1 | 2}
 */
export function exitCodeFor(state) {
  if (state === 'verified') return 0;
  if (state === 'mismatch') return 1;
  return 2;
}

/** Cómo se cuenta cada fallo: el arreglo de cada uno es distinto. */
export function describeApiFailure(status, error) {
  if (status === 0) return `no hubo respuesta (${error ?? 'error de red'})`;
  if (status === 401) return 'el token no es válido o fue revocado (HTTP 401)';
  if (status === 403) return 'al token le falta permiso para esto (HTTP 403)';
  if (status === 404) return 'el recurso no existe para este token (HTTP 404)';
  if (status === 429) return 'la API aplicó su límite de tasa (HTTP 429)';
  if (status >= 500) return `la API de administración falló (HTTP ${status})`;
  return `HTTP ${status}`;
}

/**
 * Pregunta a la API de administración de quién es el proyecto.
 *
 * **Nunca lanza** por un fallo de la API: eso es «no se pudo comprobar» con el
 * motivo, no una excepción que tumbe la sonda. `fetchImpl` se inyecta para poder
 * probarlo contra un servidor falso; sin eso, lo único verificable sería el texto
 * de los mensajes.
 *
 * @param {{ projectRef: string, expectedOwnerEmail: string, token: string, apiBase?: string, fetchImpl?: typeof fetch, timeoutMs?: number, maxOrganizations?: number }} options
 * @returns {Promise<AccountVerdict>} el veredicto
 */
export async function verifyAccountOwnership({
  projectRef,
  expectedOwnerEmail,
  token,
  apiBase = MANAGEMENT_API,
  fetchImpl = fetch,
  timeoutMs = ACCOUNT_TIMEOUT_MS,
  maxOrganizations = MAX_ORGS_SCANNED,
}) {
  let requests = 0;

  const call = async (route) => {
    requests += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(`${apiBase}${route}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: controller.signal,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      return { status: response.status, payload, error: null };
    } catch (error) {
      return {
        status: 0,
        payload: null,
        error: error instanceof Error ? error.message : 'error desconocido',
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const evidence = (extra) => ({
    projectRef,
    expectedOwnerEmail,
    project: null,
    organization: null,
    owners: null,
    obstacle: null,
    requests,
    ...extra,
  });

  const ok = (result) => result.status >= 200 && result.status < 300;

  const organizationsCall = await call('/v1/organizations');
  if (!ok(organizationsCall)) {
    return judgeAccountOwnership(
      evidence({
        obstacle: `No se pudieron listar las organizaciones del token: ${describeApiFailure(organizationsCall.status, organizationsCall.error)}.`,
      })
    );
  }

  const organizations = readOrganizations(organizationsCall.payload);
  if (organizations.length === 0) {
    return judgeAccountOwnership(
      evidence({
        obstacle:
          'El token no alcanza ninguna organización: revisá que salga de la cuenta dueña y que su alcance incluya la organización del proyecto.',
      })
    );
  }

  const notes = [];
  const scanned = organizations.slice(0, maxOrganizations);
  if (scanned.length < organizations.length) {
    notes.push(
      `Se recorrieron ${scanned.length} de ${organizations.length} organizaciones (techo de ${maxOrganizations}, para no acercarse al límite de tasa de la API).`
    );
  }

  // Vía 1: la cuenta entera. Una petición, y trae la organización del proyecto.
  const projectsCall = await call('/v1/projects');
  let project = ok(projectsCall) ? findProject(readProjects(projectsCall.payload), projectRef) : null;
  let organization = project ? findOrganization(organizations, project.organizationId) : null;

  // Vía 2: organización por organización. Es la que funciona con un token de
  // alcance mínimo (solo «Organization Projects → Read»), que es el que conviene
  // crear: menos permiso, menos daño si se filtra.
  if (!project) {
    for (const candidate of scanned) {
      const orgProjects = await call(`/v1/organizations/${candidate.slug}/projects`);
      if (!ok(orgProjects)) continue;

      const found = findProject(readProjects(orgProjects.payload), projectRef);
      if (found) {
        project = found;
        organization = candidate;
        break;
      }
    }
  }

  if (!project) {
    const why = ok(projectsCall)
      ? 'el token no lo lista entre sus proyectos'
      : `no se pudo listar los proyectos (${describeApiFailure(projectsCall.status, projectsCall.error)})`;
    return judgeAccountOwnership(evidence({ obstacle: `El proyecto ${projectRef} no aparece: ${why}.`, notes }));
  }

  if (!organization) {
    return judgeAccountOwnership(evidence({ project, notes }));
  }

  const membersCall = await call(`/v1/organizations/${organization.slug}/members`);
  if (!ok(membersCall)) {
    return judgeAccountOwnership(
      evidence({
        project,
        organization,
        obstacle: `Se supo de qué organización es el proyecto, pero no quién es su dueño: ${describeApiFailure(membersCall.status, membersCall.error)}. Hace falta el permiso «Organization Members → Read» en el token.`,
        notes,
      })
    );
  }

  return judgeAccountOwnership(
    evidence({ project, organization, owners: ownerEmails(readMembers(membersCall.payload)), notes })
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Las claves del entorno: primero `process.env` (lo que ya está exportado),
 * después `.env.local` —el mismo orden que `check-schema.mjs` y `db-push.mjs`—
 * para que funcione desde un `npm run` y desde el workflow sin exportar nada.
 *
 * @param {{ env?: Record<string, string | undefined>, envFile?: string, exists?: (p: string) => boolean, read?: (p: string) => string }} [options]
 */
export function readCredentials({
  env = process.env,
  envFile = ENV_FILE,
  exists = existsSync,
  read = (filePath) => readFileSync(filePath, 'utf8'),
} = {}) {
  const content = exists(envFile) ? read(envFile) : '';
  const fromFile = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals < 1) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fromFile[key] = value;
  }

  const readEnv = (key) => env[key] || fromFile[key] || null;

  return {
    url: readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    token: readEnv('SUPABASE_ACCESS_TOKEN'),
    owner: readEnv('SUPABASE_OWNER_ACCOUNT_EMAIL'),
  };
}

/**
 * El informe legible para la consola. Sin token, sin encabezados, sin valores.
 *
 * @param {{ ref: string | null, verdict: AccountVerdict | null, skipped?: string | null }} input
 * @returns {string}
 */
export function formatReport({ ref, verdict, skipped = null }) {
  const lines = ['', `== Titularidad de la base · ${ref ?? '(sin proyecto)'} ==`, ''];

  if (skipped) {
    lines.push(`  · ${skipped}`, '');
    return lines.join('\n');
  }

  if (verdict.state === 'verified') {
    lines.push(`  ✓ La base ${verdict.projectRef} es de la cuenta esperada.`);
  } else if (verdict.state === 'mismatch') {
    lines.push(`  ✗ La base ${verdict.projectRef} es de OTRA cuenta.`);
  } else {
    lines.push(`  ? No se pudo comprobar de quién es la base ${verdict.projectRef}.`);
  }

  if (verdict.reason) lines.push(`      ${verdict.reason}`);
  for (const note of verdict.notes) lines.push(`      · ${note}`);
  lines.push(`      · API de administración de Supabase: ${verdict.requests} petición(es).`);
  lines.push('');

  return lines.join('\n');
}

/**
 * El bloque de Markdown que se adjunta al resumen de la corrida de CI.
 *
 * @param {{ ref: string | null, verdict: AccountVerdict | null, skipped?: string | null, exitCode: number }} input
 * @returns {string}
 */
export function summaryMarkdown({ ref, verdict, skipped = null, exitCode }) {
  const icon = skipped ? 'ℹ️' : exitCode === 0 ? '✅' : exitCode === 1 ? '❌' : '⚠️';
  const lines = [`## ${icon} Titularidad de la base`, '', `- Proyecto: \`${ref ?? '—'}\``];

  if (skipped) {
    lines.push(`- No comprobado: ${skipped}`, '');
    return lines.join('\n');
  }

  const state =
    verdict.state === 'verified'
      ? 'verificada contra la API de administración'
      : verdict.state === 'mismatch'
        ? '**de otra cuenta**'
        : 'sin poder comprobar';
  lines.push(`- Estado: ${state}`);

  if (verdict.organization) {
    lines.push(`- Organización: \`${verdict.organization.slug}\`${verdict.organization.name ? ` (${verdict.organization.name})` : ''}`);
  }
  if (verdict.ownerEmails.length > 0) {
    lines.push(`- Dueño según la API: ${verdict.ownerEmails.join(', ')}`);
  }
  lines.push(`- Dueño esperado: ${verdict.expectedOwnerEmail}`);

  if (verdict.reason) lines.push('', `> ${verdict.reason}`);
  if (verdict.notes.length > 0) {
    lines.push('');
    for (const note of verdict.notes) lines.push(`- ${note}`);
  }

  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv, defaults) {
  const args = {
    ref: null,
    url: defaults.url,
    owner: defaults.owner,
    token: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--ref') args.ref = argv[++i] ?? null;
    else if (arg.startsWith('--ref=')) args.ref = arg.slice('--ref='.length);
    else if (arg === '--url') args.url = argv[++i] ?? null;
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else if (arg === '--owner') args.owner = argv[++i] ?? null;
    else if (arg.startsWith('--owner=')) args.owner = arg.slice('--owner='.length);
  }

  return args;
}

function usage() {
  console.log(
    [
      '',
      'Comprueba, contra la API de administración de Supabase, de qué cuenta es la',
      'base del despliegue: la organización dueña y el correo de su dueño.',
      '',
      '  npm run check:cuenta',
      '  npm run check:cuenta -- --json',
      '  npm run check:cuenta -- --url https://xxxx.supabase.co',
      '  npm run check:cuenta -- --ref xxxx --owner otra@cuenta.cl',
      '',
      'Opciones:',
      '  --url <url>     proyecto a comprobar (por defecto, NEXT_PUBLIC_SUPABASE_URL de .env.local)',
      '  --ref <ref>     la referencia del proyecto, si no hay URL',
      '  --owner <mail>  el correo que debería ser el dueño (por defecto, SUPABASE_OWNER_ACCOUNT_EMAIL)',
      '  --json          el veredicto en JSON, para encadenar con otras herramientas',
      '  --help          esto',
      '',
      'Necesita SUPABASE_ACCESS_TOKEN (sbp_…) en .env.local o en el entorno: es el',
      'único camino documentado para saber de quién es un proyecto. Conviene que sea',
      'un token de solo lectura con alcance («Organization Projects → Read» y',
      '«Organization Members → Read»).',
      '',
      'Salida: 0 = verificado (o nada que comprobar) · 1 = la base es de otra cuenta ·',
      '        2 = no se pudo comprobar, que no es un «está bien».',
      '',
    ].join('\n')
  );
}

/**
 * Añade el bloque de Markdown al resumen de la corrida, si `GITHUB_STEP_SUMMARY`
 * está definido. Va en try/catch: no poder escribir el resumen no puede cambiar el
 * veredicto, que es lo que decide el color del job.
 */
async function appendSummary(markdown) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  try {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(target, markdown);
  } catch (error) {
    console.warn('⚠ No se pudo escribir el resumen de la corrida:', error instanceof Error ? error.message : error);
  }
}

async function main() {
  const credentials = readCredentials();
  const args = parseArgs(process.argv.slice(2), {
    url: credentials.url,
    owner: credentials.owner ?? DEFAULT_OWNER_ACCOUNT_EMAIL,
  });
  if (args.help) return usage();

  const ref = args.ref ?? projectRefFromUrl(args.url);
  if (!ref) {
    // Sin proyecto declarado no hay nada que comprobar: no es un fallo de la
    // base, es que este repositorio todavía no dice cuál es su proyecto. El paso
    // que ya avisa de eso es el del esquema; repetirlo acá sería contarlo dos veces.
    const why = args.url
      ? `NEXT_PUBLIC_SUPABASE_URL no apunta a un proyecto de Supabase (${String(args.url).slice(0, 80)}).`
      : 'No hay NEXT_PUBLIC_SUPABASE_URL con la que saber qué proyecto comprobar.';
    console.log(formatReport({ ref: null, verdict: null, skipped: why }));
    console.log(`::notice::Titularidad de la base: ${why}`);
    await appendSummary(summaryMarkdown({ ref: null, verdict: null, skipped: why, exitCode: 0 }));
    return;
  }

  const token = args.token ?? credentials.token;
  if (!token) {
    // Con token, esto decide entre «verificado» y «no sé». Sin token no hay
    // veredicto posible: sale 2 y dice dónde conseguirlo, en vez de fingir un verde.
    console.error('✖ Falta SUPABASE_ACCESS_TOKEN: es el único camino documentado para saber de quién es un proyecto.');
    console.error('  Está en supabase.com/dashboard/account/tokens — la cuenta dueña del proyecto — y vive en .env.local (nunca en Vercel).');
    console.error('  Conviene que sea un token de solo lectura con alcance: «Organization Projects → Read» y «Organization Members → Read».');
    process.exitCode = 2;
    return;
  }

  const verdict = await verifyAccountOwnership({
    projectRef: ref,
    expectedOwnerEmail: args.owner,
    token,
  });

  const exitCode = exitCodeFor(verdict.state);

  if (args.json) {
    // Sin el token, por construcción: el veredicto nunca lo lleva adentro.
    console.log(JSON.stringify({ ref, exitCode, ...verdict }, null, 2));
  } else {
    console.log(formatReport({ ref, verdict }));
  }

  await appendSummary(summaryMarkdown({ ref, verdict, exitCode }));

  if (exitCode === 1) {
    console.error(`::error::Titularidad de la base: ${verdict.reason}`);
  } else if (exitCode === 2) {
    // `::error::` también acá, y no un aviso suelto: el aviso del issue arma su
    // huella con las líneas `✗` y `::error::`, así que un «no se pudo comprobar»
    // sin esa marca dejaría el job rojo sin motivo legible en el issue.
    console.error(`::error::Titularidad de la base sin comprobar: ${verdict.reason}`);
  }

  process.exitCode = exitCode;
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`✖ No se pudo comprobar la titularidad: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 2;
  });
}
