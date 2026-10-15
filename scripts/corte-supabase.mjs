#!/usr/bin/env node
/**
 * El corte de base a Supabase en **un solo comando**: comprueba las claves antes
 * de tocar Vercel, aplica las tres variables y despliega. Se detiene en el
 * primer fallo, y el informe dice exactamente hasta dónde llegó.
 *
 * ¿Por qué existe? El corte son seis comandos encadenados a mano —guardar la
 * clave, cotejarla, planificar, aplicar, desplegar, verificar— y el orden es lo
 * único que impide un corte a ciegas:
 *
 * - Aplicar en Vercel una clave que no sirve deja el panel y los avisos en 401
 *   **recién después del deploy**, que es el peor momento para enterarse.
 * - Desplegar sin haber aplicado antes las variables publica un build con las
 *   claves viejas: el sitio queda igual que antes y parece que no pasó nada.
 *
 * Así que el comando ordena los pasos y los corta donde corresponde:
 *
 *   1. lee `.env.local` (o el `--file` que se pase) y valida **forma y
 *      pertenencia** de las tres variables sin usar la red;
 *   2. sondea la base con cada clave: la de servicio contra la API de
 *      administración (`/auth/v1/admin/users`, la misma que usa el panel) y la
 *      pública contra el catálogo. Las dos son de solo lectura;
 *   3. coteja que el proyecto enlazado en Vercel sea el que se espera;
 *   4. recién entonces aplica las variables (`vercel env`) y despliega
 *      (`release:prod --no-db`: build + deploy + verificación en vivo).
 *
 * Si algo falla antes del paso 4, **Vercel no se toca** y producción sigue como
 * estaba: el informe lo dice con todas las letras, porque «¿ya lo cambié?» es la
 * única pregunta que importa cuando algo sale mal.
 *
 * ## Por qué la pertenencia se puede afirmar sin adivinar
 *
 * Las claves clásicas de Supabase son JWT y llevan en su cuerpo (sin firmar)
 * `role` y `ref`. Eso alcanza para atajar los dos errores reales de copiar y
 * pegar: la anon key en el lugar de la de servicio (`role: "anon"`) y una clave
 * de **otro proyecto** (`ref` distinto al de la URL). No se verifica la firma ni
 * se pretende: para eso está la sonda, que le pregunta a la base.
 *
 * ## Uso
 *
 *   npm run corte:supabase                  # preflight + Vercel + deploy + verificación
 *   npm run corte:supabase -- --dry-run     # solo el preflight (sondas incluidas)
 *   npm run corte:supabase -- --no-deploy   # deja las variables aplicadas, sin publicar
 *   npm run corte:supabase -- --file .env.local.pre-migracion   # otro archivo de origen
 *
 * Salida: `0` = corte completo · `1` = un paso falló (el corte se detuvo ahí) ·
 * `2` = el comando se usó mal y **nada se ejecutó**.
 *
 * Núcleo puro (probado en `corte-supabase.test.ts`): el lector de claves, el
 * veredicto de cada sonda, el cotejo del proyecto enlazado y el informe. Nada de
 * eso necesita red ni procesos.
 *
 * Nada de este script imprime un valor: solo nombres, largos y el resultado de
 * cada sonda.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readEnvContent } from './check-auth-config.mjs';
import { MANAGED_VARS, formatPlan, linkedProjectRef, planSync } from './vercel-sync-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** De dónde salen los valores, si no se pasa `--file`. */
export const DEFAULT_FILE = path.join(ROOT, '.env.local');

/** Las dos variables públicas y la de servicio. Las mismas que sincroniza `vercel:sync`. */
export const URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL';
export const ANON_VAR = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';
export const SERVICE_VAR = 'SUPABASE_SERVICE_ROLE_KEY';

/**
 * El proyecto de Vercel al que el corte escribe. Escribir las variables en otro
 * proyecto no rompe nada visible —el build sale igual— y por eso hay que
 * cotejarlo: `.vercel/project.json` es el único lugar donde está dicho.
 *
 * Si algún día se re-enlaza el repo a otro proyecto, se pasa `--project prj_…`.
 */
export const EXPECTED_VERCEL_PROJECT = {
  projectId: 'prj_38HRJ2h2Q8lxjsXu4pRU6MkRpMD4',
  orgId: 'team_ZqliMBcJmzlw3EHnMBCRGbHi',
  name: 'rix7',
};

/** La misma ruta que usa el panel (`auth.admin.listUsers`): 200 solo la da una clave con permiso de administración. */
export const SERVICE_PROBE_PATH = '/auth/v1/admin/users?per_page=1';

/** El catálogo, que el portal lee con la clave pública. */
export const ANON_PROBE_PATH = '/rest/v1/properties?select=id&limit=1';

/** Los dos scripts que este comando encadena, tal como los llama `npm run`. */
export const SYNC_SCRIPT = 'scripts/vercel-sync-env.mjs';
export const RELEASE_SCRIPT = 'scripts/release-prod.mjs';

/**
 * Los pasos, en orden, con el `why` y el `hint` que viajan al informe. El orden
 * **es** la salvaguarda: los seis primeros no escriben nada, y solo después
 * vienen el `vercel env` y el deploy.
 *
 * @typedef {{ id: string, title: string, why: string, hint: string }} CutoverStep
 * @type {CutoverStep[]}
 */
export const CUTOVER_STEPS = [
  {
    id: 'file',
    title: 'Leer el archivo de variables',
    why: 'de acá salen los tres valores del corte; sin archivo no hay nada que sincronizar.',
    hint: 'el origen por defecto es `.env.local`: si el corte sale de otro archivo, pasá `--file <ruta>`.',
  },
  {
    id: 'keys',
    title: 'Forma y pertenencia de las claves',
    why: 'ataja sin red los dos errores caros de copiar y pegar: la anon key en el lugar de la de servicio, y una clave de otro proyecto.',
    hint: 'la clave de servicio sale del proyecto vsqkjimpssdvlvdwrtnh (cuenta jatf71@gmail.com), en Project Settings » API. Guardala con `npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY`.',
  },
  {
    id: 'service',
    title: 'Sonda de administración (clave de servicio)',
    why: 'es la misma API que usan el panel y `/api/alerts/run`: si acá no da 200, el corte deja esas rutas en 401.',
    hint: 'un 403 significa que la clave es la pública (válida, sin permiso de administración). Un 401, que es de otro proyecto. Volvé a copiarla de vsqkjimpssdvlvdwrtnh.',
  },
  {
    id: 'anon',
    title: 'Sonda del catálogo (clave pública)',
    why: 'la otra mitad del corte: la clave pública es la que el navegador usa para leer las propiedades.',
    hint: 'copiá la pública (publishable o anon) del mismo proyecto. Si la tabla responde 0 filas, revisá que los datos del catálogo se hayan copiado antes de cortar.',
  },
  {
    id: 'vercel-link',
    title: 'Proyecto enlazado en Vercel',
    why: 'escribir las variables en otro proyecto no rompe nada visible: el build sale igual y el corte queda hecho en el lugar equivocado.',
    hint: 'corré `npx vercel link` para enlazar rix7, o pasá `--project prj_…` si el corte va a otro proyecto a propósito.',
  },
  {
    id: 'plan',
    title: 'Plan de variables a sincronizar',
    why: 'avisar acá que falta una variable evita el corte a medias: `vercel:sync` aplica las que están y sigue.',
    hint: 'guardá la que falta con `npm run env:secret -- --name <VAR>` y volvé a correr el comando.',
  },
  {
    id: 'sync',
    title: 'Aplicar las variables en Vercel',
    why: 'las tres variables en los tres entornos; sin esto el deploy publica las claves viejas y parece que no pasó nada.',
    hint: 'mirá el detalle de cada variable en el informe de arriba; el sync borra y vuelve a agregar, así que re-ejecutarlo es seguro.',
  },
  {
    id: 'release',
    title: 'Build, deploy y verificación en vivo',
    why: 'las `NEXT_PUBLIC_*` se incrustan en el build: cambiar la variable sin desplegar no cambia nada.',
    hint: 'si falló el build o el deploy, mirá el informe de `release:prod` de arriba. Si el deploy se publicó y la verificación falló, el camino es el rollback (DEPLOY.md §8).',
  },
];

/** El título de un paso por su id, para el informe. */
export function stepTitle(id) {
  return CUTOVER_STEPS.find((step) => step.id === id)?.title ?? id;
}

/** La referencia del proyecto a partir de la URL (`<ref>.supabase.co`). */
export function supabaseRef(url) {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)\b/i.exec(String(url ?? '').trim());
  return match?.[1] ?? null;
}

/**
 * El cuerpo de un JWT, **sin verificar la firma**: alcanza para leer `role` y
 * `ref`, que es para lo único que se usa acá. Nunca se imprime el contenido.
 *
 * @param {unknown} token
 * @returns {Record<string, unknown> | null}
 */
export function decodeJwtPayload(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;

  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** ¿Tiene forma de clave pública (nueva o clásica)? */
export function looksLikeAnonKey(key) {
  const value = String(key ?? '').trim();
  return value.startsWith('sb_publishable_') || value.startsWith('eyJ');
}

/** ¿Tiene forma de clave de servicio (nueva o clásica)? */
export function looksLikeServiceKey(key) {
  const value = String(key ?? '').trim();
  return value.startsWith('sb_secret_') || value.startsWith('eyJ');
}

/**
 * Valida las tres variables **sin usar la red**: presencia, forma, y que cada
 * clave sea del proyecto de `NEXT_PUBLIC_SUPABASE_URL` y del rol que dice ser.
 *
 * Un problema se devuelve como `{ code, message, hint }`: el `code` es lo que
 * miran los tests, el `message` lo que se lee, y el `hint` qué hacer.
 *
 * @param {Record<string, string>} values
 * @returns {{ ok: boolean, ref: string | null, problems: { code: string, message: string, hint: string }[] }}
 */
export function inspectEnv(values) {
  const problems = [];
  const url = String(values?.[URL_VAR] ?? '').trim();
  const anon = String(values?.[ANON_VAR] ?? '').trim();
  const service = String(values?.[SERVICE_VAR] ?? '').trim();
  const ref = supabaseRef(url);

  const add = (code, message, hint) => problems.push({ code, message, hint });

  if (!url) {
    add('sin-url', `falta ${URL_VAR}`, 'la URL del proyecto nuevo: https://<ref>.supabase.co');
  } else if (!/^https?:\/\//i.test(url)) {
    add('url-invalida', `${URL_VAR} no es una URL`, `llegó algo que no empieza con http(s): revisá la línea ${URL_VAR} del archivo.`);
  } else if (/placeholder/i.test(url)) {
    add('url-placeholder', `${URL_VAR} apunta al placeholder`, 'es el valor de ejemplo: poné la URL real del proyecto.');
  }

  if (!anon) add('sin-anon', `falta ${ANON_VAR}`, 'la clave pública (publishable o anon) del mismo proyecto.');
  else if (!looksLikeAnonKey(anon)) {
    add('anon-forma', `${ANON_VAR} no tiene forma de clave pública`, 'empieza con "sb_publishable_" (nueva) o "eyJ" (clásica).');
  }

  if (!service) add('sin-service', `falta ${SERVICE_VAR}`, 'guardala con `npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY` (se pega sin eco).');
  else if (!looksLikeServiceKey(service)) {
    add('service-forma', `${SERVICE_VAR} no tiene forma de clave de servicio`, 'empieza con "sb_secret_" (nueva) o "eyJ" (clásica): una "sb_publishable_" es la pública.');
  }

  // La misma clave en los dos lugares: el modo de fallar silencioso de este
  // corte, porque el build y el deploy salen bien y el 401 aparece después.
  if (anon && service && anon === service) {
    add('claves-iguales', `${ANON_VAR} y ${SERVICE_VAR} tienen el mismo valor`, 'la pública se sincroniza al navegador: no puede ser la de servicio.');
  }

  const anonBody = decodeJwtPayload(anon);
  const serviceBody = decodeJwtPayload(service);

  if (anonBody && anonBody.role === 'service_role') {
    add('anon-es-servicio', `${ANON_VAR} lleva una clave con rol "service_role"`, 'esa clave salta RLS y viajaría al navegador: usá la pública.');
  }
  if (serviceBody && typeof serviceBody.role === 'string' && serviceBody.role !== 'service_role') {
    add('service-rol', `${SERVICE_VAR} tiene rol "${serviceBody.role}"`, 'la de servicio es la que dice "service_role". Si dice "anon", copiaste la pública.');
  }

  for (const [name, body] of [
    [ANON_VAR, anonBody],
    [SERVICE_VAR, serviceBody],
  ]) {
    const keyRef = typeof body?.ref === 'string' ? body.ref : null;
    if (ref && keyRef && keyRef !== ref) {
      add('otro-proyecto', `${name} es de otro proyecto (ref ${keyRef}, la URL dice ${ref})`, 'las tres variables tienen que ser del mismo proyecto.');
    }
  }

  return { ok: problems.length === 0, ref, problems };
}

/**
 * El veredicto de una sonda, sin red: se le pasa lo que respondió la base.
 *
 * @param {'service' | 'anon'} kind
 * @param {{ status?: number, body?: unknown, error?: string | null, rows?: number | null }} [response]
 * @returns {{ ok: boolean, detail: string, hint: string }}
 */
export function judgeProbe(kind, { status = 0, error = null, rows = null } = {}) {
  const what = kind === 'service' ? 'la clave de servicio' : 'la clave pública';

  if (error) {
    return {
      ok: false,
      detail: `no se pudo conectar con la base (${error})`,
      hint: '¿está activo el proyecto en el dashboard? ¿La URL de .env.local es la correcta? ¿Hay red?',
    };
  }

  if (status === 200) {
    if (kind === 'anon') {
      const detail = rows === null ? 'la clave pública lee el catálogo' : `la clave pública lee el catálogo (${rows} fila${rows === 1 ? '' : 's'})`;
      return { ok: true, detail, hint: '' };
    }
    return { ok: true, detail: 'la clave de servicio administra el proyecto (200 en /auth/v1/admin/users)', hint: '' };
  }

  if (status === 401) {
    return {
      ok: false,
      detail: `401 — ${what} no pertenece a ese proyecto`,
      hint: `copiala de nuevo del proyecto vsqkjimpssdvlvdwrtnh (cuenta jatf71@gmail.com): una clave de otro proyecto nunca pasa esta sonda.`,
    };
  }

  if (status === 403) {
    return {
      ok: false,
      detail:
        kind === 'service'
          ? '403 — la clave es válida pero no tiene permiso de administración: es la anon key'
          : '403 — la clave pública no puede leer el catálogo (¿RLS?)',
      hint:
        kind === 'service'
          ? 'en Project Settings » API está la service_role (pestaña Legacy si tus claves son JWT): no es la anon ni la publishable.'
          : 'revisá que las políticas RLS de `properties` estén aplicadas (`npm run check:schema`).',
    };
  }

  return {
    ok: false,
    detail: `HTTP ${status} — respuesta inesperada de la base`,
    hint: 'si el proyecto está pausado, reactivalo en el dashboard de Supabase y volvé a correr.',
  };
}

/**
 * ¿Es el proyecto de Vercel que se espera? Un `.vercel/project.json` de otro
 * proyecto es el error que este cotejo existe para atajar.
 *
 * @param {string | null | undefined} projectJson
 * @param {{ expected?: { projectId: string, orgId?: string, name?: string } }} [options]
 * @returns {{ ok: boolean, projectId: string | null, detail: string, hint: string }}
 */
export function checkVercelLink(projectJson, { expected = EXPECTED_VERCEL_PROJECT } = {}) {
  const fail = (detail, hint) => ({ ok: false, projectId: null, detail, hint });

  if (!projectJson) {
    return fail('no existe .vercel/project.json', 'corré `npx vercel link` en la raíz del repo (proyecto rix7) y volvé a intentar.');
  }

  let parsed;
  try {
    parsed = JSON.parse(String(projectJson));
  } catch {
    return fail('.vercel/project.json no se pudo leer', 'volvé a enlazar con `npx vercel link`.');
  }

  const projectId = typeof parsed?.projectId === 'string' ? parsed.projectId : null;
  if (!projectId) return fail('.vercel/project.json no declara projectId', 'volvé a enlazar con `npx vercel link`.');

  if (projectId !== expected.projectId) {
    return fail(
      `el proyecto enlazado es ${projectId}, y el corte espera ${expected.projectId}${expected.name ? ` (${expected.name})` : ''}`,
      'corré `npx vercel link` para enlazar el proyecto correcto, o pasá `--project prj_…` si el corte va a otro proyecto a propósito.',
    );
  }

  const orgId = typeof parsed?.orgId === 'string' ? parsed.orgId : null;
  if (expected.orgId && orgId && orgId !== expected.orgId) {
    return fail(`el proyecto está en el equipo ${orgId}, y el corte espera ${expected.orgId}`, 'revisá con qué cuenta está autenticada la CLI (`npx vercel whoami`).');
  }

  return { ok: true, projectId, detail: `${parsed.projectName ?? projectId} (${projectId})`, hint: '' };
}

/**
 * El informe del corte: un renglón por paso, y si algo falló, hasta dónde se
 * llegó. No incluye valores: solo nombres, largos y veredictos.
 *
 * @param {{ steps: { id: string, ok: boolean, detail: string }[], stop?: { id: string, detail: string, hint: string } | null, dryRun?: boolean, deployed?: boolean, applied?: boolean }} result
 * @returns {string}
 */
export function formatOutcome({ steps, stop = null, dryRun = false, deployed = false, applied = false }) {
  const lines = ['', '== Corte de base a Supabase ==', ''];

  for (const step of steps) lines.push(`  ${step.ok ? '✓' : '✗'} ${stepTitle(step.id)} — ${step.detail}`);

  lines.push('');

  if (stop) {
    lines.push(`✗ Paso «${stepTitle(stop.id)}» falló: ${stop.detail}`);
    lines.push(
      applied
        ? '  Las variables de Vercel YA se aplicaron: lo que falta es el despliegue.'
        : stop.id === 'sync'
          ? '  Las variables de Vercel pueden haber quedado a medias. El sync borra y vuelve a agregar, así que volver a correr este comando es seguro.'
          : '  Vercel NO se tocó: producción sigue con las claves que ya tenía.',
    );
    lines.push(`  → ${stop.hint}`);
    return lines.join('\n');
  }

  if (dryRun) {
    lines.push('Preflight completo: las dos claves responden contra la base de esa URL.');
    lines.push('  --dry-run: no se tocó Vercel ni se desplegó nada. Para hacer el corte, corré el comando sin `--dry-run`.');
    return lines.join('\n');
  }

  if (!deployed) {
    lines.push('✓ Variables aplicadas en Vercel (production, preview y development).');
    lines.push('  Falta publicar: npm run corte:supabase  (o `npm run release:prod -- --no-db`). Las NEXT_PUBLIC_* viajan dentro del build.');
    return lines.join('\n');
  }

  lines.push('✓ Corte completo: variables aplicadas, desplegado y verificado en vivo.');
  return lines.join('\n');
}

/**
 * El checklist que ningún comando puede hacer solo: lo que hay que mirar con
 * ojos humanos después del corte (y por qué).
 *
 * @returns {string}
 */
export function formatManualChecklist() {
  return [
    '',
    'Queda a mano (no lo puede afirmar este comando):',
    '  · /admin/empresas y /admin/registros abren con la sesión de administración.',
    '  · npm run smoke:prod -- --write --email <tu correo>  →  persisted: true  (da de alta una fila de prueba real).',
    '  · Las cuentas de socias y corredoras: npm run accesos:socias (las crea con su rol y su corredora, y manda el enlace de acceso; plan en docs/runbook-accesos-socias.md).',
    '',
  ].join('\n');
}

/**
 * Los argumentos. Una bandera que no se reconoce **detiene el comando**: en un
 * comando que publica, un `--dryrun` mal escrito no puede terminar aplicando las
 * variables y desplegando como si nada.
 *
 * @param {string[]} argv
 * @returns {{ file: string | null, dryRun: boolean, deploy: boolean, expected: { projectId: string, orgId?: string, name?: string }, help: boolean, error?: string }}
 */
export function parseCutoverArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    dryRun: false,
    deploy: true,
    expected: EXPECTED_VERCEL_PROJECT,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--file') {
      const value = argv[++i];
      if (value === undefined) return { ...args, file: null, error: 'Falta la ruta después de --file.' };
      args.file = path.resolve(value);
    } else if (arg === '--project') {
      const value = String(argv[++i] ?? '').trim();
      if (!value) return { ...args, error: 'Falta el identificador después de --project.' };
      args.expected = { ...EXPECTED_VERCEL_PROJECT, projectId: value };
    } else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--no-deploy') args.deploy = false;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('-')) return { ...args, error: `No reconozco la bandera «${arg}».` };
  }

  return args;
}

function usage() {
  console.log(
    [
      '',
      'El corte de base a Supabase en un solo comando, con preflight.',
      '',
      '  npm run corte:supabase                     # preflight + Vercel + deploy + verificación',
      '  npm run corte:supabase -- --dry-run        # solo el preflight (lee la base, no escribe nada)',
      '  npm run corte:supabase -- --no-deploy      # deja las variables aplicadas, sin publicar',
      '  npm run corte:supabase -- --file .env.local.pre-migracion',
      '  npm run corte:supabase -- --project prj_…  # otro proyecto de Vercel (a propósito)',
      '',
      'Los pasos 1 a 6 no escriben nada: si uno falla, Vercel queda intacto.',
      'Ningún valor se imprime: solo nombres, largos y el veredicto de cada sonda.',
      '',
    ].join('\n'),
  );
}

/** Corre un script del repo y devuelve su código de salida, con la salida en vivo. */
function defaultRunScript(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(`✖ No se pudo lanzar ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

/**
 * Una sonda de solo lectura contra la base. Se usa `fetch` porque el proyecto ya
 * lo usa en los scripts de verificación, y no se reintenta: un corte no debería
 * seguir adelante por una respuesta que llegó tarde.
 */
async function probe({ url, path: probePath, key, fetchImpl = fetch }) {
  const target = `${String(url).replace(/\/+$/, '')}${probePath}`;

  try {
    const response = await fetchImpl(target, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return { status: response.status, body };
  } catch (err) {
    return { status: 0, error: err?.name === 'TimeoutError' ? 'timeout' : (err?.message ?? String(err)) };
  }
}

/**
 * El corte entero. Devuelve el informe y hasta dónde llegó; no imprime por su
 * cuenta más que los informes de los scripts que encadena.
 *
 * Se detiene en el primer paso que falla —no sigue «por las dudas»— porque a
 * partir del paso 7 cada cosa que corre deja producción en un estado distinto.
 *
 * @param {{ file?: string, projectFile?: string, dryRun?: boolean, deploy?: boolean, expected?: { projectId: string, orgId?: string, name?: string }, fetchImpl?: typeof fetch, runScript?: (script: string, args?: string[]) => number, log?: (...args: unknown[]) => void }} [options]
 * @returns {Promise<{ ok: boolean, steps: { id: string, ok: boolean, detail: string }[], stop: { id: string, detail: string, hint: string } | null, dryRun: boolean, applied: boolean, deployed: boolean }>}
 */
export async function runCutover({
  file = DEFAULT_FILE,
  projectFile = path.join(ROOT, '.vercel', 'project.json'),
  dryRun = false,
  deploy = true,
  expected = EXPECTED_VERCEL_PROJECT,
  fetchImpl = fetch,
  runScript = defaultRunScript,
  log = console.log,
} = {}) {
  const steps = [];
  const record = (id, ok, detail) => {
    steps.push({ id, ok, detail });
  };
  /**
   * El informe de un fallo. `applied` sale de lo que ya se registró: si el paso
   * de sincronización quedó verde, las variables **ya están** en Vercel y el
   * informe puede decirlo en vez de dejar la duda.
   */
  const stop = (id, detail, hint) => ({
    ok: false,
    steps,
    stop: { id, detail, hint },
    dryRun,
    applied: steps.some((step) => step.id === 'sync' && step.ok),
    deployed: false,
  });

  // 1 · Archivo
  if (!existsSync(file)) {
    return stop('file', `no existe ${path.relative(ROOT, file)}`, 'el corte lee los valores de `.env.local`: creálo con la URL y la clave pública, y guardá la de servicio con `npm run env:secret`.');
  }
  const values = readEnvContent(readFileSync(file, 'utf8'));
  record('file', true, `${path.relative(ROOT, file)} (${Object.keys(values).length} variables)`);

  // 2 · Forma y pertenencia, sin red
  const inspected = inspectEnv(values);
  if (!inspected.ok) {
    const first = inspected.problems[0];
    return stop('keys', `${inspected.problems.length} problema(s): ${first.message}`, first.hint);
  }
  const ref = inspected.ref;
  record('keys', true, `las tres variables tienen forma y pertenecen a ${ref ?? 'la URL indicada'}`);

  // 3 y 4 · Sondas (solo lectura)
  const url = values[URL_VAR];
  const service = await probe({ url, path: SERVICE_PROBE_PATH, key: values[SERVICE_VAR], fetchImpl });
  const serviceJudge = judgeProbe('service', service);
  record('service', serviceJudge.ok, serviceJudge.detail);
  if (!serviceJudge.ok) return stop('service', serviceJudge.detail, serviceJudge.hint);

  const anon = await probe({ url, path: ANON_PROBE_PATH, key: values[ANON_VAR], fetchImpl });
  const rows = Array.isArray(anon.body) ? anon.body.length : null;
  const anonJudge = judgeProbe('anon', { ...anon, rows });
  record('anon', anonJudge.ok, anonJudge.detail);
  if (!anonJudge.ok) return stop('anon', anonJudge.detail, anonJudge.hint);

  // 5 · El proyecto de Vercel
  const projectJson = existsSync(projectFile) ? readFileSync(projectFile, 'utf8') : null;
  const link = checkVercelLink(projectJson, { expected });
  record('vercel-link', link.ok, link.detail);
  if (!link.ok) return stop('vercel-link', link.detail, link.hint);

  // 6 · Plan
  const plan = planSync({ values: Object.fromEntries(MANAGED_VARS.map((name) => [name, values[name]])) });
  if (plan.missing.length) {
    return stop('plan', `sin valor para ${plan.missing.join(', ')}`, 'guardá la que falta con `npm run env:secret -- --name <VAR>` y volvé a correr el comando.');
  }
  record('plan', true, `${plan.steps.length} variables × ${plan.environments.length} entornos`);

  log(formatPlan({ ...plan, file: path.relative(ROOT, file) }, { apply: !dryRun, ref: linkedProjectRef(projectJson) }));

  if (dryRun) return { ok: true, steps, stop: null, dryRun: true, applied: false, deployed: false };

  // 7 · Aplicar en Vercel
  const syncCode = runScript(SYNC_SCRIPT, file === DEFAULT_FILE ? [] : ['--file', file]);
  if (syncCode !== 0) {
    record('sync', false, `la CLI de Vercel salió con ${syncCode}`);
    return stop('sync', `la sincronización salió con ${syncCode}`, stepHint('sync'));
  }
  record('sync', true, 'aplicadas en production, preview y development');

  if (!deploy) return { ok: true, steps, stop: null, dryRun: false, applied: true, deployed: false };

  // 8 · Build, deploy y verificación (sin `db:push`: el esquema de la base nueva ya está aplicado y lo comprueba `check-schema`)
  const releaseCode = runScript(RELEASE_SCRIPT, ['--no-db']);
  if (releaseCode !== 0) {
    record('release', false, `release:prod salió con ${releaseCode}`);
    return stop('release', `el release salió con ${releaseCode}`, stepHint('release'));
  }
  record('release', true, 'build, deploy y verificación en vivo');

  return { ok: true, steps, stop: null, dryRun: false, applied: true, deployed: true };
}

/** El `hint` declarado del paso, para los fallos que solo tienen código de salida. */
function stepHint(id) {
  return CUTOVER_STEPS.find((step) => step.id === id)?.hint ?? 'mirá el informe de arriba.';
}

async function main() {
  const args = parseCutoverArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (args.error || !args.file) {
    console.error(`✖ ${args.error ?? 'Falta la ruta después de --file.'}`);
    console.error('  Nada se ejecutó ni se tocó Vercel. `npm run corte:supabase -- --help` lista las banderas.');
    process.exitCode = 2;
    return;
  }

  console.log('');
  console.log('→ Corte de base a Supabase. Los pasos 1 a 6 no escriben nada.');

  const result = await runCutover(args);

  console.log(formatOutcome(result));
  if (!result.ok) process.exitCode = 1;
  else if (!result.dryRun && result.deployed) console.log(formatManualChecklist());
  console.log('');
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  await main();
}
