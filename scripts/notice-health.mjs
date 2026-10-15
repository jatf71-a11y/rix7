#!/usr/bin/env node
/**
 * Lleva el rojo de la sonda a donde alguien lo vea: **un issue del repositorio**.
 *
 * El job de salud se pone rojo, y eso está bien —pero un rojo en la pestaña de
 * Actions es un lugar al que hay que ir: si nadie está mirando, no avisa. Un
 * issue sí: aparece en el feed de quien sigue el repo, manda correo, guarda el
 * motivo con su fecha y tiene un solo hilo donde discutirlo. (El correo lo manda
 * GitHub, así que no hay ninguna clave de correo en el CI: la regla del repo es
 * no copiar claves a GitHub, y acá no hace falta.)
 *
 * El contrato es un issue, siempre el mismo, buscado por **título exacto**:
 *
 *   · la sonda queda roja y no hay issue abierto → se **abre**, con el informe adentro;
 *   · sigue roja por el **mismo motivo**         → se **refresca** el cuerpo y nada más;
 *   · sigue roja por **otro motivo**             → **comenta** qué cambió y refresca;
 *   · vuelve a estar verde                       → se **cierra** solo, diciendo desde cuándo.
 *
 * Que no comente cada 6 horas por la misma causa es deliberado: un hilo que
 * crece solo con repeticiones es un hilo que se aprende a ignorar, que es
 * exactamente lo que este aviso existe para evitar.
 *
 * El «mismo motivo» no es un juicio humano: es la **huella**, un hash de las
 * líneas que las sondas marcan como fallo (`✗` y `::error::`), que viaja
 * escondida en el cuerpo del issue como `<!-- huella:… -->`. El «→ arreglo» que
 * la sonda agrega al final se descarta a propósito: es texto fijo y no forma
 * parte del motivo, así que dos corridas con el mismo problema dan la misma
 * huella aunque cambie la redacción del arreglo.
 *
 * ## Qué NO hace
 *
 * - **No decide nada cuando no le dijeron si hubo fallo.** Si no recibe ni el
 *   entorno del workflow ni sus banderas, se niega a actuar (salida 2) en vez de
 *   suponer que todo está bien: suponerlo **cerraría** un issue abierto por algo
 *   que sí pasó. Un aviso que se cierra porque faltó un dato es peor que no
 *   tener aviso.
 * - **No reemplaza al job rojo.** Corre con `if: always()` y solo agrega su
 *   línea: el job sigue rojo por la sonda, que es quien debe estar roja. Si el
 *   aviso no se puede entregar, sale con 1 y lo dice — no lo esconde.
 * - **No manda los correos de la aplicación.** Esos los sigue mandando `sendEmail`
 *   con Resend (ver `runbook-resend.md`); esto avisa de la salud del despliegue.
 *
 * ## Uso
 *
 *   node scripts/notice-health.mjs                  # en el workflow (lee el entorno)
 *   node scripts/notice-health.mjs --dry-run        # qué haría, sin tocar GitHub
 *   node scripts/notice-health.mjs --health-failed --dir .deploy-tmp --dry-run
 *
 * Salida: `0` el aviso quedó como corresponde (o no había nada que hacer) ·
 * `1` no se pudo entregar · `2` falta el dato con el que se decide (no se tocó nada).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Título exacto del issue: es la única clave con la que se lo encuentra. */
export const NOTICE_TITLE = 'Salud de producción en rojo';

/** Etiqueta para filtrarlo en la lista. Se crea sola (idempotente) si no existe. */
export const NOTICE_LABEL = 'salud-produccion';

/** De dónde sale cada sonda: el nombre del informe y cómo se la nombra en el aviso. */
export const PROBES = [
  { env: 'SALUD_FALLO', file: 'salud.txt', who: 'la sonda de /api/health' },
  { env: 'ESQUEMA_FALLO', file: 'esquema.txt', who: 'el esquema de la base' },
  { env: 'CUENTA_FALLO', file: 'cuenta.txt', who: 'la titularidad de la base' },
];

/** Lo que marca un fallo en la salida de las dos sondas. */
export const FAILURE_MARKER = /✗|::error::/;

/** Dónde viaja la huella dentro del cuerpo del issue. */
export const FINGERPRINT_IN_BODY = /<!--\s*huella:([0-9a-z-]+)\s*-->/;

/** Qué deja de funcionar mientras cada comprobación esté en rojo. */
const CONSEQUENCE = {
  'la sonda de /api/health':
    'sin el proyecto Supabase real el portal acepta altas y no las guarda, y una base que no es la del proyecto de la cuenta dueña puede quedar sin administración sin que nada más lo delate.',
  'el esquema de la base':
    'si la base no tiene las columnas o las funciones que el código usa, algunas pantallas dejan de guardar —o el buscador cae al catálogo del código— sin decir por qué.',
  'la titularidad de la base':
    'si la base pertenece a una cuenta que no es la dueña del proyecto, el portal funciona igual y nadie lo nota: el día que esa cuenta se pierda, queda una base viva que nadie puede administrar. Es el incidente del 2026-10-13, y por eso el rojo es exactamente lo que se quiere.',
};

/** Cuánto informe entra en el cuerpo. El resto se recorta **diciéndolo**. */
const MAX_REPORT_CHARS = 4000;

// ─────────────────────────────────────────────────────────── núcleo (sin red)

/**
 * La huella del motivo: un hash de las líneas que las sondas marcaron como fallo.
 *
 * Se normaliza el espacio y se corta en `→` porque las sondas terminan cada
 * motivo con su arreglo —texto fijo— y la huella tiene que responder «¿es el
 * mismo problema?», no «¿dice lo mismo el texto del arreglo?».
 *
 * @param {{ text?: string }[]} reports Informes crudos; los que no se pudieron leer vienen vacíos.
 * @returns {string} 12 caracteres hex, o `sin-motivo` si ningún informe marcó un fallo.
 */
export function fingerprintOf(reports = []) {
  const lines = reports
    .flatMap((report) => String(report?.text ?? '').split(/\r?\n/))
    .filter((line) => FAILURE_MARKER.test(line))
    .map((line) => line.split('→')[0].replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (lines.length === 0) return 'sin-motivo';

  const unique = [...new Set(lines)].sort();
  return createHash('sha256').update(unique.join('\n')).digest('hex').slice(0, 12);
}

/**
 * Lee los informes que dejó el workflow. Un archivo que no está no es un error:
 * significa que esa comprobación no corrió (p. ej. el esquema se saltea sin las
 * claves públicas), y el aviso tiene que poder darse igual.
 *
 * @param {string} dir
 * @returns {{ file: string, who: string, text: string }[]}
 */
export function readReports(dir, probes = PROBES) {
  return probes
    .map(({ file, who }) => {
      const full = path.join(dir, file);
      return { file, who, text: existsSync(full) ? readFileSync(full, 'utf8') : '' };
    })
    .filter((report) => report.text.trim() !== '');
}

/**
 * Qué hacer con el issue: **las cinco situaciones, sin adivinar ninguna**.
 *
 * @param {{ failed: boolean, fingerprint: string, existing: { number?: number, fingerprint?: string | null } | null }} input
 * @returns {{ action: 'open' | 'refresh' | 'comment' | 'close' | 'nothing', reason: string }}
 */
export function planNotice({ failed, fingerprint, existing }) {
  if (failed) {
    if (!existing) return { action: 'open', reason: 'la sonda quedó roja y no había ningún aviso abierto' };
    if (existing.fingerprint === fingerprint) {
      return { action: 'refresh', reason: 'sigue roja por el mismo motivo' };
    }
    return { action: 'comment', reason: 'el motivo cambió desde el último aviso' };
  }

  if (existing) return { action: 'close', reason: 'la sonda volvió a estar verde' };
  return { action: 'nothing', reason: 'todo verde y sin aviso abierto' };
}

/**
 * El aviso abierto, si lo hay: mismo título exacto. La huella se lee de su cuerpo.
 *
 * @param {{ number: number, title?: string, body?: string, url?: string }[]} issues
 * @returns {{ number: number, title?: string, body?: string, url?: string, fingerprint: string | null } | null}
 */
export function findNotice(issues = [], title = NOTICE_TITLE) {
  const match = issues.find((issue) => String(issue?.title ?? '').trim() === title.trim());
  if (!match) return null;
  return { ...match, fingerprint: String(match.body ?? '').match(FINGERPRINT_IN_BODY)?.[1] ?? null };
}

/**
 * Si hubo fallo —y en qué— leyendo el entorno del workflow. `known: false`
 * significa **no se sabe**, y con eso el script se niega a actuar: ver la cabecera.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ known: boolean, failed: boolean, who: string[] }}
 */
export function readFailedState(env = {}) {
  const given = PROBES.map((probe) => ({ ...probe, raw: env[probe.env] })).filter(
    (probe) => probe.raw !== undefined && probe.raw !== null
  );

  if (given.length === 0) return { known: false, failed: false, who: [] };

  const parsed = given.map((probe) => ({ ...probe, value: readBool(probe.raw) }));
  // Un valor que no se entiende no se interpreta como «todo bien»: deja el
  // estado en desconocido y el script no toca nada. `false` acá cerraría un
  // aviso abierto por una variable mal escrita.
  if (parsed.some((probe) => probe.value === null)) return { known: false, failed: false, who: [] };

  return {
    known: true,
    failed: parsed.some((probe) => probe.value === true),
    who: parsed.filter((probe) => probe.value === true).map((probe) => probe.who),
  };
}

/** `true`/`1`/`sí` → true · `false`/`0`/`''` → false · ausente o raro → null (no se sabe). */
function readBool(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().toLowerCase();
  if (text === '') return false;
  if (['true', '1', 'si', 'sí', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  return null;
}

/** El informe de cada sonda que falló, recortado si es largo —diciendo que se recortó—. */
function reportBlock(reports) {
  if (reports.length === 0) return '_Sin informe: la corrida no dejó ninguno._';

  return reports
    .map(({ who, text }) => {
      const trimmed = text.trim();
      const body =
        trimmed.length > MAX_REPORT_CHARS
          ? `${trimmed.slice(0, MAX_REPORT_CHARS)}\n… (informe recortado)`
          : trimmed;
      return `### ${who}\n\n\`\`\`text\n${body}\n\`\`\``;
    })
    .join('\n\n');
}

/**
 * El cuerpo del issue.
 *
 * @param {{ who: string[], reports: { who: string, text: string }[], fingerprint: string, now: string, runUrl?: string | null }} input
 * @returns {string}
 */
export function issueBody({ who, reports, fingerprint, now, runUrl = null }) {
  const failing = who.length > 0 ? who : ['una comprobación crítica'];

  const lines = [
    'La sonda de salud de producción quedó **en rojo** en la corrida del reloj (cada 6 horas).',
    '',
    `- **Qué falló:** ${failing.join(' · ')}`,
    `- **Cuándo:** ${now}`,
  ];
  if (runUrl) lines.push(`- **Corrida:** ${runUrl}`);

  lines.push('', 'Por qué importa:', '');
  for (const item of failing) {
    lines.push(`- **${item}:** ${CONSEQUENCE[item] ?? 'es una comprobación crítica: mientras falle, algo del portal no funciona.'}`);
  }

  lines.push(
    '',
    reportBlock(reports),
    '',
    'Este issue se cierra solo cuando la sonda vuelva a estar verde. Para verlo desde tu máquina, `npm run check:health`; el resto del camino está en `DEPLOY.md` §9.',
    '',
    `<!-- huella:${fingerprint} -->`,
    ''
  );

  return lines.join('\n');
}

/**
 * El comentario cuando el motivo cambió: qué se está viendo ahora y desde cuándo.
 *
 * @param {{ who: string[], fingerprint: string, now: string, runUrl?: string | null }} input
 * @returns {string}
 */
export function commentBody({ who, fingerprint, now, runUrl = null }) {
  const lines = [`El motivo cambió (${now}).`];
  if (who.length > 0) lines.push('', `Ahora falla ${who.join(' · ')}.`);
  if (runUrl) lines.push('', `Corrida: ${runUrl}`);
  lines.push('', `<!-- huella:${fingerprint} -->`);
  return lines.join('\n');
}

/**
 * El comentario al cerrarlo: cuándo se recuperó.
 *
 * @param {{ now: string, runUrl?: string | null }} input
 * @returns {string}
 */
export function recoveryComment({ now, runUrl = null }) {
  const lines = [`La sonda volvió a estar verde (${now}): no queda ningún subsistema crítico sin configurar.`];
  if (runUrl) lines.push('', `Corrida: ${runUrl}`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────── CLI (con `gh`)

function parseArgs(argv) {
  const state = readFailedState(process.env);
  const args = {
    dir: process.env.AVISO_DIR || process.env.RUNNER_TEMP || os.tmpdir(),
    runUrl: process.env.RUN_URL || null,
    state,
    dryRun: false,
    help: false,
  };

  // Las banderas mandan sobre el entorno: sirven para probar desde la terminal.
  const forced = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--dir') args.dir = argv[++i] ?? args.dir;
    else if (arg.startsWith('--dir=')) args.dir = arg.slice('--dir='.length);
    else if (arg === '--run-url') args.runUrl = argv[++i] ?? args.runUrl;
    else if (arg.startsWith('--run-url=')) args.runUrl = arg.slice('--run-url='.length);
    else if (arg === '--health-failed') forced.push(PROBES[0].who);
    else if (arg === '--schema-failed') forced.push(PROBES[1].who);
    else if (arg === '--account-failed') forced.push(PROBES[2].who);
  }

  if (forced.length > 0) args.state = { known: true, failed: true, who: forced };

  return args;
}

function usage() {
  console.log(
    [
      '',
      'Avisa en un issue cuando la sonda de salud queda roja, y lo cierra cuando vuelve.',
      '',
      '  node scripts/notice-health.mjs            # en el workflow: lee SALUD_FALLO / ESQUEMA_FALLO',
      '  node scripts/notice-health.mjs --dry-run  # dice qué haría, sin tocar GitHub',
      '',
      'Opciones:',
      '  --dir <dir>       dónde están los informes (salud.txt, esquema.txt)',
      '  --run-url <url>   enlace de la corrida, para el cuerpo',
      '  --health-failed   la sonda de /api/health falló',
      '  --schema-failed   el esquema de la base falló',
      '  --account-failed  la titularidad de la base falló',
      '  --dry-run         muestra el aviso y no toca GitHub',
      '  --help            esto',
      '',
      'Sin banderas ni variables del entorno se niega a actuar (salida 2): no sabe si',
      'hubo fallo, y suponer que no lo hubo cerraría un aviso legítimo.',
      '',
    ].join('\n')
  );
}

/** Ejecuta `gh`. Falla con el motivo si no puede: entregar el aviso es el trabajo. */
function gh(args, { input } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input, env: process.env });
  if (result.error) throw new Error(`no se pudo ejecutar \`gh\`: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(`\`gh ${args.slice(0, 2).join(' ')}\` salió con ${result.status}: ${detail}`);
  }
  return result.stdout ?? '';
}

/** Los issues abiertos con su cuerpo: de ahí sale la huella del aviso anterior. */
function openIssues() {
  return JSON.parse(gh(['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,body,url']));
}

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
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (!args.state.known) {
    console.error('✖ No sé si la sonda falló: falta `SALUD_FALLO`/`ESQUEMA_FALLO` (o `--health-failed`/`--schema-failed`).');
    console.error('  Sin ese dato no toco nada: suponer que todo está bien cerraría un aviso legítimo.');
    process.exitCode = 2;
    return;
  }

  const now = new Date().toISOString();
  const allReports = readReports(args.dir);
  const failing = args.state.who;
  // Solo el informe de lo que falló: el cuerpo del issue es para leer el motivo.
  const reports = allReports.filter((report) => failing.length === 0 || failing.includes(report.who));

  const fingerprint = fingerprintOf(reports);
  const who = failing.length > 0 ? failing : reports.map((report) => report.who);

  let existing = null;
  try {
    existing = findNotice(openIssues());
  } catch (error) {
    // En `--dry-run` una máquina sin sesión de `gh` no debería impedir el ensayo:
    // lo que se quiere ver es el aviso, no el listado.
    if (!args.dryRun) throw error;
    console.warn('⚠ No se pudieron listar los issues (¿`gh` sin sesión?):', error instanceof Error ? error.message : error);
  }

  const plan = planNotice({ failed: args.state.failed, fingerprint, existing });
  const body = issueBody({ who, reports, fingerprint, now, runUrl: args.runUrl });
  const comment = commentBody({ who, fingerprint, now, runUrl: args.runUrl });
  const recovery = recoveryComment({ now, runUrl: args.runUrl });

  if (args.dryRun) {
    console.log(`→ Aviso: ${plan.action} — ${plan.reason}`);
    console.log(`  aviso abierto: ${existing ? `#${existing.number} (huella ${existing.fingerprint ?? 'sin leer'})` : 'ninguno'}`);
    console.log(`  huella de esta corrida: ${fingerprint}`);
    console.log('');
    console.log('--- cuerpo del issue ---');
    console.log(body);
    if (plan.action === 'comment') {
      console.log('--- comentario (además del cuerpo) ---');
      console.log(comment);
    }
    if (plan.action === 'close') {
      console.log('--- comentario de cierre ---');
      console.log(recovery);
    }
    return;
  }

  if (plan.action === 'nothing') {
    console.log(`→ Aviso: nada que hacer (${plan.reason}).`);
    await appendSummary(`\n**Salud de producción:** sin novedades (${plan.reason}).\n`);
    return;
  }

  let number = existing?.number ?? null;
  let url = existing?.url ?? null;

  if (plan.action === 'open') {
    // La etiqueta es cosmética: si no se puede crear, el issue se abre igual.
    const label = spawnSync(
      'gh',
      ['label', 'create', NOTICE_LABEL, '--color', 'B60205', '--description', 'La sonda de salud de producción lo abre (y lo cierra solo)', '--force'],
      { encoding: 'utf8', env: process.env }
    );
    if (label.status !== 0) console.warn('⚠ No se pudo asegurar la etiqueta; el issue se abre sin ella.');

    const created = gh(
      ['issue', 'create', '--title', NOTICE_TITLE, '--body-file', '-', ...(label.status === 0 ? ['--label', NOTICE_LABEL] : [])],
      { input: body }
    );
    number = Number(created.match(/\/issues\/(\d+)/)?.[1] ?? 0) || null;
    url = created.trim().split('\n').find((line) => line.includes('/issues/'))?.trim() ?? null;
  } else if (plan.action === 'comment') {
    gh(['issue', 'comment', String(number), '--body-file', '-'], { input: comment });
    gh(['issue', 'edit', String(number), '--body-file', '-'], { input: body });
  } else if (plan.action === 'refresh') {
    gh(['issue', 'edit', String(number), '--body-file', '-'], { input: body });
  } else if (plan.action === 'close') {
    gh(['issue', 'close', String(number), '--comment', recovery]);
  }

  const where = number ? `#${number}${url ? ` — ${url}` : ''}` : '(sin número)';
  console.log(`→ Aviso: ${plan.action} — ${plan.reason} · ${where}`);
  await appendSummary(`\n**Salud de producción:** ${plan.reason}. Aviso: ${where}.\n`);
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(`✖ No se pudo dejar el aviso: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
