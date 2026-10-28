#!/usr/bin/env node
/**
 * Copia variables de un archivo local a **Vercel**, en los tres entornos, sin
 * imprimir ningún valor.
 *
 * ¿Por qué existe? Porque el corte de base es el momento más delicado: hay que
 * cambiar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` en
 * Production, Preview y Development, y agregar el `SUPABASE_SERVICE_ROLE_KEY`
 * nuevo. Hecho a mano son seis comandos interactivos donde es fácil pegar una
 * clave en la consola —y en el historial—, dejarse un entorno sin cambiar, o
 * cambiar la URL y olvidar la clave, que deja el sitio con una base que no
 * responde.
 *
 * Acá los valores se leen del archivo y viajan por la entrada estándar de la
 * CLI: nunca pasan por los argumentos del proceso (donde los vería `ps`) ni por
 * la salida. Lo único que se imprime es el **nombre** de cada variable y su
 * largo.
 *
 * El alta va con `--yes --type …` porque `vercel env add` es interactivo: con un
 * nombre `NEXT_PUBLIC_` y un valor que parece credencial pregunta cómo guardarlo,
 * y cuando la entrada estándar es una tubería —no una terminal— el prompt se
 * queda sin respuesta, la CLI **sale con 0 y no crea nada**. Por eso, además, el
 * script **lee de vuelta** (`vercel env ls --json`) antes de decir que salió
 * bien: un corte que se informa «listo» sin haber escrito la anon key deja el
 * portal sin base, y eso no se nota hasta que alguien mira `/api/health`.
 *
 *   npm run vercel:sync                        # .env.local → los 3 entornos
 *   npm run vercel:sync -- --dry-run           # dice qué haría, sin tocar nada
 *   npm run vercel:sync -- --only NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   npm run vercel:sync -- --only EXA_API_KEY  # cualquier credencial de servidor
 *   npm run vercel:sync -- --env production    # solo un entorno
 *
 * El conjunto por defecto es el del corte de base; `--only` sirve para cualquier
 * otra credencial de servidor, que es la forma de publicar una clave nueva sin
 * que su valor pase por la terminal ni por el historial.
 *
 * Antes de correrlo de verdad: `npx vercel whoami` tiene que responder tu
 * usuario, y el proyecto tiene que estar enlazado (`.vercel/project.json`).
 * Después del corte hay que **desplegar** (`npm run deploy:prod`): las variables
 * `NEXT_PUBLIC_*` se incrustan en el build, así que cambiarlas no alcanza.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readEnvContent } from './check-auth-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** El archivo del que salen los valores, si no se pasa `--file`. */
export const DEFAULT_FILE = path.join(ROOT, '.env.local');

/**
 * Las variables que administra el corte de base, en el orden en que se aplican.
 *
 * - Las dos `NEXT_PUBLIC_*` llegan al navegador: son públicas por diseño.
 * - `SUPABASE_SERVICE_ROLE_KEY` es solo del servidor: **nunca** lleva
 *   `NEXT_PUBLIC_`, y es la que usa el job de alertas para leer las búsquedas de
 *   todas las personas. Con la URL nueva y esta clave vieja, el panel y los
 *   avisos fallan con 401: por eso van juntas en el mismo paso.
 */
export const MANAGED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

/** Los entornos de Vercel que el proyecto usa de verdad. */
export const ENVIRONMENTS = ['production', 'preview', 'development'];

/**
 * Con qué tipo se guarda cada variable.
 *
 * - Las `NEXT_PUBLIC_*` son públicas por diseño: `config`, que es legible en el
 *   panel (también viajan al navegador, así que ocultarlas sería un espejismo).
 * - El resto son credenciales de servidor: `secret`, que Vercel no vuelve a
 *   mostrar.
 *
 * No es cosmético: es lo que responde el prompt interactivo de `env add` sin
 * que nadie tenga que responderlo (ver la cabecera del archivo).
 *
 * @param {string} name
 * @returns {'config' | 'secret'}
 */
export function variableType(name) {
  return String(name).startsWith('NEXT_PUBLIC_') ? 'config' : 'secret';
}

/**
 * Los argumentos de un alta. El valor **no** va acá: viaja por la entrada
 * estándar, porque en los argumentos lo vería cualquiera con `ps`.
 *
 * @param {string} name
 * @param {string} environment
 * @returns {string[]}
 */
export function addArgs(name, environment) {
  return ['env', 'add', name, environment, '--yes', '--type', variableType(name)];
}

/** Los argumentos que leen de vuelta lo que quedó guardado en Vercel. */
export function listArgs() {
  return ['env', 'ls', '--json'];
}

/**
 * Cómo informa Vercel cada tipo al listar. `sensitive` es lo que la CLI llama
 * `secret` al agregar, y `encrypted` lo que llama `config`.
 */
export const REPORTED_TYPES = { config: 'encrypted', secret: 'sensitive' };

/**
 * Del JSON de `vercel env ls` saca **presencia y tipo**, por variable. Los
 * valores llegan cifrados y no se miran: alcanzan para saber si quedó aplicada.
 *
 * @param {string} stdout
 * @returns {Record<string, { environments: string[], type: string | null }>}
 */
export function parseEnvTargets(stdout) {
  try {
    const start = Math.min(
      ...[stdout.indexOf('['), stdout.indexOf('{')].filter((at) => at >= 0),
    );
    if (!Number.isFinite(start)) return {};

    const parsed = JSON.parse(stdout.slice(start));
    const list = Array.isArray(parsed) ? parsed : (parsed.envs ?? parsed.env ?? []);

    const listing = {};
    for (const entry of list) {
      const name = entry?.key ?? entry?.name;
      if (typeof name !== 'string') continue;

      const target = entry.target ?? entry.environments ?? entry.env;
      const environments = (Array.isArray(target) ? target : [target])
        .filter((environment) => typeof environment === 'string')
        .map((environment) => environment.trim().toLowerCase());

      const current = listing[name] ?? { environments: [], type: null };
      current.environments = [...new Set([...current.environments, ...environments])];
      current.type = typeof entry.type === 'string' ? entry.type : current.type;
      listing[name] = current;
    }

    return listing;
  } catch {
    return {};
  }
}

/**
 * Qué se va a hacer, sin hacerlo: qué variables están, cuáles faltan y en qué
 * entornos se aplican.
 *
 * @param {{ values: Record<string, string>, vars?: string[], environments?: string[] }} params
 * @returns {{ steps: { name: string, environments: string[] }[], missing: string[], environments: string[] }}
 */
export function planSync({ values, vars = MANAGED_VARS, environments = ENVIRONMENTS }) {
  const steps = [];
  const missing = [];

  for (const name of vars) {
    const value = values[name];
    if (!value) {
      missing.push(name);
      continue;
    }
    steps.push({ name, environments: [...environments] });
  }

  return { steps, missing, environments: [...environments] };
}

/**
 * El informe. **No incluye valores**: solo nombres y entornos. Está aparte para
 * que se pueda probar esa propiedad, que es la razón de ser del script.
 *
 * @param {{ steps: { name: string, environments: string[] }[], missing: string[], environments: string[], file: string }} plan
 * @param {{ apply?: boolean, ref?: string | null }} [options]
 * @returns {string}
 */
export function formatPlan(plan, { apply = false, ref = null } = {}) {
  const lines = ['', '== Variables en Vercel ==', ''];
  lines.push(`  Origen: ${plan.file}${ref ? ` · proyecto ${ref}` : ''}`);
  lines.push(`  Entornos: ${plan.environments.join(', ')}`);
  lines.push('');

  for (const step of plan.steps) {
    lines.push(`  · ${step.name} → ${step.environments.join(', ')}`);
  }

  if (plan.missing.length) {
    lines.push('');
    lines.push('  Sin valor en el archivo (no se tocan):');
    for (const name of plan.missing) lines.push(`    · ${name}`);
  }

  lines.push('');
  if (!plan.steps.length) {
    lines.push('  Nada para sincronizar.');
    return lines.join('\n');
  }

  lines.push(
    apply
      ? '  Aplicando: cada valor viaja por la entrada estándar de la CLI, no por los argumentos.'
      : '  --dry-run: no se cambió nada. Para aplicarlo, corré sin --dry-run.',
  );
  if (apply) {
    lines.push('  Y después se lee de vuelta (`vercel env ls`): el código de salida de la CLI no prueba que la variable haya quedado.');
    lines.push('  Después: npm run deploy:prod  (las NEXT_PUBLIC_* se incrustan en el build).');
  }
  return lines.join('\n');
}

/** El ref del proyecto enlazado, para que quede en el informe. */
export function linkedProjectRef(projectJson) {
  try {
    const parsed = JSON.parse(String(projectJson ?? ''));
    return typeof parsed?.projectId === 'string' ? parsed.projectId : null;
  } catch {
    return null;
  }
}

/**
 * Aplica el plan contra la CLI de Vercel.
 *
 * `vercel env rm` antes de `add` porque `add` no sobrescribe: si la variable
 * existe, la CLI pregunta, y un script que espera una respuesta se cuelga con
 * el valor ya en la tubería. El borrado se ignora si la variable no estaba.
 *
 * Lo que devuelve son **intentos**, no un resultado: el código de salida de la
 * CLI no prueba que la variable haya quedado (un prompt sin respuesta sale con 0
 * y sin escribir). El resultado lo dice `verifySync`, que lee de vuelta.
 *
 * @param {{ steps: { name: string, environments: string[] }[], values: Record<string, string>, run?: (args: string[], input: string | null) => { status: number, stderr: string } }} params
 * @returns {{ done: { name: string, environment: string, ok: boolean, detail: string }[] }}
 */
export function applySync({ steps, values, run = defaultRun }) {
  const done = [];

  for (const step of steps) {
    for (const environment of step.environments) {
      run(['env', 'rm', step.name, environment, '--yes'], null);

      const result = run(addArgs(step.name, environment), values[step.name]);
      done.push({
        name: step.name,
        environment,
        ok: result.status === 0,
        detail: result.status === 0 ? `${values[step.name].length} caracteres` : result.stderr.trim().slice(0, 200),
      });
    }
  }

  return { done };
}

/**
 * El informe real: qué quedó, según lo que Vercel informa ahora.
 *
 * Un alta puede salir con 0 y no crear nada —es exactamente lo que pasó con la
 * anon key, que dejó producción sin base—, así que acá se informa por presencia
 * y no por código de salida. Si además quedó con otro tipo, se avisa: un
 * `NEXT_PUBLIC_*` guardado como `secret` es una señal de que algo se respondió
 * de más en el camino.
 *
 * @param {{ steps: { name: string, environments: string[] }[], values?: Record<string, string>, listing: Record<string, { environments: string[], type: string | null }>, attempts?: { name: string, environment: string, ok: boolean, detail: string }[] }} params
 * @returns {{ done: { name: string, environment: string, ok: boolean, detail: string }[], warnings: string[] }}
 */
export function verifySync({ steps, values = {}, listing, attempts = [] }) {
  const done = [];
  const warnings = [];
  const errors = new Map(
    attempts.filter((attempt) => !attempt.ok).map((attempt) => [`${attempt.name}|${attempt.environment}`, attempt.detail]),
  );

  for (const step of steps) {
    for (const environment of step.environments) {
      const found = listing[step.name] ?? null;
      const present = found?.environments.includes(environment) ?? false;
      const length = values[step.name]?.length;
      const wrongType = present && found.type && found.type !== REPORTED_TYPES[variableType(step.name)];

      if (!present) {
        const said = errors.get(`${step.name}|${environment}`);
        done.push({
          name: step.name,
          environment,
          ok: false,
          detail: said
            ? `no quedó aplicada — la CLI salió con error: ${said}`
            : 'no quedó aplicada: Vercel no la informa en ese entorno (un alta que sale con 0 sin escribir nada se ve así)',
        });
        continue;
      }

      done.push({
        name: step.name,
        environment,
        ok: true,
        detail: `${length ? `${length} caracteres` : 'presente'} · ${found.type ?? 'tipo desconocido'}`,
      });

      if (wrongType) {
        warnings.push(
          `${step.name} · ${environment}: quedó como «${found.type}» y se esperaba «${REPORTED_TYPES[variableType(step.name)]}».`,
        );
      }
    }
  }

  return { done, warnings };
}

/**
 * Lee de vuelta lo que hay en Vercel. Devuelve `null` si no se pudo leer: sin
 * esta lectura el script no puede afirmar nada, y afirmar de más es el error
 * que este archivo existe para no repetir.
 *
 * @param {(args: string[], input: string | null) => { status: number, stdout?: string }} run
 * @returns {Record<string, { environments: string[], type: string | null }> | null}
 */
export function readBack(run = defaultRun) {
  const result = run(listArgs(), null);
  if (result.status !== 0) return null;

  const listing = parseEnvTargets(result.stdout ?? '');
  return Object.keys(listing).length ? listing : null;
}

/**
 * Los argumentos para la CLI de Vercel, armados aparte para poder probarlos.
 *
 * @param {...string} args
 * @returns {string[]}
 */
export function vercelArgs(...args) {
  return ['--no-install', 'vercel', ...args];
}

function defaultRun(args, input) {
  const result = spawnSync('npx', vercelArgs(...args), {
    cwd: ROOT,
    input: input === null ? undefined : input,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function parseArgs(argv) {
  const args = { file: DEFAULT_FILE, vars: MANAGED_VARS, environments: ENVIRONMENTS, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') args.file = path.resolve(argv[++i] ?? '');
    else if (arg === '--only') args.vars = String(argv[++i] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--env') args.environments = String(argv[++i] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    [
      '',
      'Sincroniza variables de un archivo local con Vercel.',
      '',
      '  npm run vercel:sync                        # .env.local → production, preview, development',
      '  npm run vercel:sync -- --dry-run           # informa sin cambiar nada',
      '  npm run vercel:sync -- --only NEXT_PUBLIC_SUPABASE_URL',
      '  npm run vercel:sync -- --only EXA_API_KEY   # cualquier credencial de servidor',
      '  npm run vercel:sync -- --env production --file .env.produccion.local',
      '',
      'Los valores nunca se imprimen: solo el nombre de cada variable y su largo.',
      'Después del corte hace falta desplegar: npm run deploy:prod',
      '',
    ].join('\n'),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (!existsSync(args.file)) {
    console.error(`\n✗ No existe ${args.file}. Es de donde salen los valores.\n`);
    process.exitCode = 2;
    return;
  }

  const values = readEnvContent(readFileSync(args.file, 'utf8'));
  const plan = planSync({ values, vars: args.vars, environments: args.environments });

  const projectJson = existsSync(path.join(ROOT, '.vercel', 'project.json'))
    ? readFileSync(path.join(ROOT, '.vercel', 'project.json'), 'utf8')
    : null;
  const ref = linkedProjectRef(projectJson);

  console.log(formatPlan({ ...plan, file: path.relative(ROOT, args.file) }, { apply: !args.dryRun, ref }));

  if (args.dryRun || !plan.steps.length) return;
  if (plan.missing.length) {
    console.log('');
    console.log('  ! Hay variables del corte sin valor: se aplican las demás, pero el corte queda a medias.');
  }

  const { done: attempts } = applySync({ steps: plan.steps, values });

  // Lo que se informa sale de acá, no de los intentos: un alta sin respuesta
  // (prompt sin terminal) sale con 0 y no escribe nada.
  const listing = readBack();
  if (!listing) {
    console.error(
      '\n✗ No se pudo leer de vuelta `vercel env ls`: sin eso no hay forma de saber si las variables quedaron.\n' +
        '  Comprobalo con `npx vercel env ls` antes de desplegar.\n',
    );
    process.exitCode = 1;
    return;
  }

  const { done, warnings } = verifySync({ steps: plan.steps, values, listing, attempts });
  console.log('');
  for (const step of done) {
    console.log(`  ${step.ok ? '✓' : '✗'} ${step.name} · ${step.environment} — ${step.detail}`);
  }
  for (const warning of warnings) console.log(`  ! ${warning}`);

  if (done.some((step) => !step.ok)) {
    console.log('');
    console.log('  Las ✗ no están en Vercel: el corte sigue a medias. Volvé a correrlo y, si se repite,');
    console.log('  agregalas a mano en el panel (Project » Settings » Environment Variables) y volvé a leer.');
    process.exitCode = 1;
    return;
  }

  console.log('\n✓ Variables aplicadas y confirmadas en Vercel. Desplegá con `npm run deploy:prod`.\n');
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main();
}
