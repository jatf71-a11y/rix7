#!/usr/bin/env node
/**
 * Copia las variables de Supabase desde un archivo local a **Vercel**, en los
 * tres entornos, sin imprimir ningún valor.
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
 *   npm run vercel:sync                        # .env.local → los 3 entornos
 *   npm run vercel:sync -- --dry-run           # dice qué haría, sin tocar nada
 *   npm run vercel:sync -- --only NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   npm run vercel:sync -- --env production    # solo un entorno
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
  const lines = ['', '== Variables de Supabase en Vercel ==', ''];
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
 * @param {{ steps: { name: string, environments: string[] }[], values: Record<string, string>, run?: (args: string[], input: string | null) => { status: number, stderr: string } }} params
 * @returns {{ done: { name: string, environment: string, ok: boolean, detail: string }[] }}
 */
export function applySync({ steps, values, run = defaultRun }) {
  const done = [];

  for (const step of steps) {
    for (const environment of step.environments) {
      run(['env', 'rm', step.name, environment, '--yes'], null);

      const result = run(['env', 'add', step.name, environment], values[step.name]);
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
      'Sincroniza las variables de Supabase de un archivo local con Vercel.',
      '',
      '  npm run vercel:sync                        # .env.local → production, preview, development',
      '  npm run vercel:sync -- --dry-run           # informa sin cambiar nada',
      '  npm run vercel:sync -- --only NEXT_PUBLIC_SUPABASE_URL',
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

  const { done } = applySync({ steps: plan.steps, values });
  console.log('');
  for (const step of done) {
    console.log(`  ${step.ok ? '✓' : '✗'} ${step.name} · ${step.environment} — ${step.detail}`);
  }
  if (done.some((step) => !step.ok)) process.exitCode = 1;
  else console.log('\n✓ Variables aplicadas. Desplegá con `npm run deploy:prod`.\n');
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main();
}
