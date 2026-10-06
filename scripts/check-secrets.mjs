#!/usr/bin/env node
/**
 * Guardia de secretos (check:secrets).
 *
 * Existe por un riesgo concreto y ya visto en este proyecto: durante la puesta
 * en marcha de Supabase real, el token personal (`sbp_…`) vivió un rato en
 * `.env.local` y el deploy lo copiaba al árbol de publicación sin filtrarlo.
 * Nada de eso llegó a un commit, pero dependía de que nadie se equivocara. Este
 * chequeo convierte esa suerte en una regla: si un secreto entra al repositorio,
 * el CI se pone rojo antes que un `git push`.
 *
 * Mira **solo lo que `git` podría llevarse**: los archivos rastreados más los
 * que no están ignorados (`ls-files --cached --others --exclude-standard`). Así
 * `.env.local` —que está en `.gitignore` y guarda secretos a propósito— no
 * molesta, pero un archivo al que le quitaron el ignore o que se forzó con
 * `git add -f` sí se ve. En el CI el árbol es el checkout, así que equivale a
 * revisar el repositorio entero.
 *
 * Dos reglas:
 *
 * 1. **Ningún `.env*` rastreado salvo la plantilla.** Un `.env.example` con
 *    marcadores es documentación; un `.env.local` con valores reales es una
 *    fuga. La lista blanca es solo `\.env\.example(\.…)`.
 * 2. **Ninguna forma de secreto de alta confianza.** Se buscan patrones que un
 *    valor de verdad cumple y un marcador o un fixture no: el token personal de
 *    Supabase, la clave secreta de Supabase, la clave de Resend, los JWT cuyo
 *    payload dice `role: "service_role"` (una clave *anónima* es pública y no se
 *    marca: el rol la distingue) y, además, lo que sueltan los proveedores con
 *    los que se suele integrar: los tokens de GitHub (`ghp_`, `github_pat_`…),
 *    las claves secretas de Stripe (`sk_live_`…), las de API de Google (`AIza…`),
 *    los tokens de Sentry (`sntrys_`) y cualquier bloque de clave privada PEM.
 *
 * A propósito **no** se buscan cadenas cortas ni genéricas: un detector que
 * grita por `re_...` en `share_views` o por la clave `anon` —que es pública—
 * se aprende a ignorar en una semana, y un check que se ignora no protege nada.
 * Ante la duda se calla; para lo que sí ve, sale con 1.
 *
 * Uso:
 *   npm run check:secrets
 *   node scripts/check-secrets.mjs --help
 *
 * Corre además como paso previo de `npm run dev` y `npm run deploy:prod`
 * (`assertNoSecrets`): un secreto no debería circular ni por el servidor de
 * desarrollo ni, menos, viajar al deployment.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Los archivos más grandes que esto no se leen (el video promocional pesa 29 MB). */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Patrones de **alta confianza**. Cada uno exige el largo y el alfabeto reales,
 * de modo que los marcadores (`sbp_...`, `re_tu_clave`) y los fixtures de los
 * tests (`re_abcdefghijklmnopqrstuvwxyz`) no coincidan.
 *
 * @type {{ id: string, label: string, regex: RegExp }[]}
 */
export const SECRET_PATTERNS = [
  {
    id: 'supabase-pat',
    label: 'Token personal de Supabase (sbp_)',
    // El token real es `sbp_` + 40 hex. `sbp_tu_token` no coincide: `_` no es hex.
    regex: /\bsbp_[0-9a-f]{32,}/,
  },
  {
    id: 'supabase-secret',
    label: 'Clave secreta de Supabase (sb_secret_)',
    regex: /\bsb_secret_[A-Za-z0-9_-]{28,}/,
  },
  {
    id: 'resend-key',
    label: 'Clave de Resend (re_)',
    // `\b` evita que `share_views` o `fire_station` cuenten como `re_…`.
    // Se admiten `_` y `-` porque las claves reales de Resend los traen
    // (`re_Ab1Cd2Ef_3Gh…`); sin ellos la clave de producción no era hallazgo.
    regex: /\bre_[A-Za-z0-9_-]{28,}/,
  },
  {
    id: 'github-token',
    label: 'Token de GitHub (ghp_/gho_/ghu_/ghs_/ghr_)',
    // Los clásicos son `gh<letra>_` + 36 alfanuméricos; un marcador (`ghp_…`)
    // no llega al largo.
    regex: /\bgh[pousr]_[A-Za-z0-9]{36}\b/,
  },
  {
    id: 'github-fine-grained-token',
    label: 'Token fino de GitHub (github_pat_)',
    regex: /\bgithub_pat_[A-Za-z0-9_]{22,}/,
  },
  {
    id: 'stripe-secret-key',
    label: 'Clave secreta de Stripe (sk_/rk_)',
    // Solo las secretas: `pk_` es publicable y queda fuera.
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/,
  },
  {
    id: 'google-api-key',
    label: 'Clave de API de Google (AIza…)',
    // Sin `\b` final: una clave real puede terminar en `-` o `_`, que no
    // forman frontera de palabra. El lookahead evita cortar una cadena más larga.
    regex: /\bAIza[0-9A-Za-z_-]{35}(?![\w-])/,
  },
  {
    id: 'sentry-token',
    label: 'Token de Sentry (sntrys_)',
    regex: /\bsntrys_[A-Za-z0-9_+/=.-]{20,}/,
  },
  {
    id: 'private-key-block',
    // El bloque va precedido por su cabecera PEM; basta con reconocerla.
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
    label: 'Bloque de clave privada PEM',
  },
];

/** Candidato a JWT: tres segmentos base64url separados por puntos. */
export const JWT_REGEX = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

/**
 * El rol de un JWT, leído del payload. Devuelve `null` si no es un JWT legible
 * (los fixtures de los tests no lo son, y por eso no se marcan).
 *
 * @param {string} token
 * @returns {string | null}
 */
export function jwtRole(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Un `.env.example` (o `.env.example.algo`) es plantilla y no se marca por su
 * nombre. Cualquier otro `.env*` rastreado sí.
 *
 * @param {string} basename
 * @returns {boolean}
 */
export function isAllowedEnvFile(basename) {
  return /^\.env\.example(\.|$)/.test(basename);
}

/** ¿Es un nombre de archivo `.env*`? */
export function isEnvFile(basename) {
  return /^\.env(\.|$)/.test(basename);
}

/**
 * Convierte el contenido de un archivo a texto, o `null` si es un binario.
 *
 * Se contempla UTF-16 con BOM porque el repositorio guarda algún informe así
 * (`_audit/fase1-report.txt`): sin esto, ese archivo caería en el descarte por
 * binario y **no se revisaría**, que es justo el hueco que este guardia cierra.
 * Un binario de verdad (una imagen, el video) se reconoce por sus bytes nulos.
 *
 * @param {Buffer} buffer
 * @returns {{ text: string } | null}
 */
export function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.toString('utf16le', 2) };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return { text: swapped.toString('utf16le') };
  }
  if (buffer.includes(0x00)) return null;
  const text = buffer.toString('utf8');
  return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
}

/**
 * Un secreto nunca se imprime entero: se enseña lo justo para ubicarlo.
 *
 * @param {string} value
 * @returns {string}
 */
export function mask(value) {
  if (value.length <= 10) return `${'•'.repeat(value.length)} (${value.length} caracteres)`;
  return `${value.slice(0, 7)}…${'•'.repeat(Math.min(value.length - 9, 12))} (${value.length} caracteres)`;
}

/**
 * @typedef {object} Finding
 * @property {string} id      identificador del patrón (o 'env-file')
 * @property {string} label   descripción legible
 * @property {number} line    1-indexado
 * @property {number} column  1-indexado
 * @property {string} masked  el secreto, recortado
 */

/**
 * Busca secretos en el texto de un archivo. Puro: la línea y la columna salen
 * del propio texto, sin tocar el disco, para poder probarlo con cadenas.
 *
 * @param {string} text
 * @returns {Finding[]}
 */
export function findSecretsInText(text) {
  /** @type {Finding[]} */
  const findings = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    for (const pattern of SECRET_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, 'g');
      for (const match of line.matchAll(regex)) {
        findings.push({
          id: pattern.id,
          label: pattern.label,
          line: i + 1,
          column: (match.index ?? 0) + 1,
          masked: mask(match[0]),
        });
      }
    }

    // JWT: solo si el payload confirma que es una clave de servicio. La anónima
    // es pública por diseño y no se marca.
    const jwtRegex = new RegExp(JWT_REGEX.source, 'g');
    for (const match of line.matchAll(jwtRegex)) {
      if (jwtRole(match[0]) === 'service_role') {
        findings.push({
          id: 'supabase-service-role-jwt',
          label: 'Clave service_role de Supabase (JWT)',
          line: i + 1,
          column: (match.index ?? 0) + 1,
          masked: mask(match[0]),
        });
      }
    }
  }

  return findings;
}

/**
 * @typedef {object} FileReport
 * @property {string} file
 * @property {Finding[]} findings
 * @property {number} bytes
 */

/**
 * Revisa una lista de archivos relativos a la raíz del repositorio.
 *
 * @param {string} root
 * @param {string[]} files
 * @returns {{ reports: FileReport[], skipped: string[], envFiles: string[] }}
 */
export function scanRepository(root, files) {
  /** @type {FileReport[]} */
  const reports = [];
  /** @type {string[]} */
  const skipped = [];
  /** @type {string[]} */
  const envFiles = [];

  for (const file of files) {
    const basename = path.basename(file);

    if (isEnvFile(basename) && !isAllowedEnvFile(basename)) {
      envFiles.push(file);
      continue;
    }

    const absolute = path.join(root, file);
    let size;
    try {
      size = statSync(absolute).size;
    } catch {
      continue; // desapareció en el camino (borrado sin commitear)
    }
    if (size > MAX_FILE_BYTES) {
      skipped.push(file);
      continue;
    }

    let buffer;
    try {
      buffer = readFileSync(absolute);
    } catch {
      continue;
    }
    const decoded = decodeText(buffer);
    if (decoded === null) {
      skipped.push(file); // binario (imagen, video): no hay texto que revisar
      continue;
    }

    const findings = findSecretsInText(decoded.text);
    if (findings.length > 0) reports.push({ file, findings, bytes: size });
  }

  return { reports, skipped, envFiles };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

/** Los archivos que `git add` podría incluir, relativos a la raíz del repo. */
export function listCandidateFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
  );
  return output.split('\0').filter(Boolean);
}

export function repositoryRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function usage() {
  console.log(
    [
      '',
      'Revisa el repositorio en busca de secretos y sale con 1 si encuentra alguno.',
      '',
      '  npm run check:secrets',
      '',
      'Mira los archivos rastreados y los no ignorados. Falla por:',
      '  · un `.env*` versionado que no sea la plantilla `.env.example`;',
      '  · un token personal de Supabase (sbp_);',
      '  · una clave secreta de Supabase (sb_secret_) o un JWT service_role;',
      '  · una clave de Resend (re_);',
      '  · un token de GitHub (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_);',
      '  · una clave secreta de Stripe (sk_live_/sk_test_/rk_);',
      '  · una clave de API de Google (AIza…);',
      '  · un token de Sentry (sntrys_);',
      '  · un bloque de clave privada PEM (-----BEGIN … PRIVATE KEY-----).',
      '',
    ].join('\n')
  );
}

/**
 * Corre la guardia e imprime el mismo informe que ve el CI. Devuelve cuántos
 * hallazgos hubo (0 = limpio); no decide el código de salida, para que el CLI y
 * los wrappers que la usan como paso previo (`dev.mjs`, `deploy-prod.mjs`)
 * compartan el comportamiento sin repetirlo.
 *
 * @param {{ log?: (...args: unknown[]) => void, error?: (...args: unknown[]) => void }} [sinks]
 * @returns {number}
 */
export function runSecretGuard({ log = console.log, error = console.error } = {}) {
  const root = repositoryRoot();
  const files = listCandidateFiles();
  const { reports, skipped, envFiles } = scanRepository(root, files);

  log(`\n== Guardia de secretos · ${files.length} archivos ==\n`);

  for (const file of envFiles) {
    error(`  ✗ ${file} — un archivo .env* versionado (solo .env.example debería estarlo)`);
    error(`::error file=${file}::Archivo .env* versionado. Los .env* con valores reales no van al repositorio.`);
  }

  for (const report of reports) {
    for (const finding of report.findings) {
      error(
        `  ✗ ${report.file}:${finding.line}:${finding.column} — ${finding.label} (${finding.masked})`
      );
      error(
        `::error file=${report.file},line=${finding.line}::${finding.label}. Rota el secreto y quitálo del árbol.`
      );
    }
  }

  if (skipped.length > 0) {
    log(`  · Omitidos por tamaño o por binarios (${skipped.length}): ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}`);
  }

  const total = reports.length + envFiles.length;
  if (total > 0) {
    error(`\n  ${total === 1 ? 'Un hallazgo' : `${total} hallazgos`}: no lo subas. Rotá el secreto y pasalo por variable de entorno.\n`);
  } else {
    log('  ✓ Sin secretos en el árbol de trabajo.\n');
  }
  return total;
}

/**
 * Paso previo para otro script: corre la guardia y resume el veredicto. Si no
 * se puede correr (p. ej. sin `git`), avisa y devuelve `false`: un fallo del
 * propio chequeo nunca debe dejar pasar un secreto.
 *
 * @param {{ action: string, sinks?: { log?: (...args: unknown[]) => void, error?: (...args: unknown[]) => void } }} options
 *   `action` describe lo que se evita, p. ej. «desplegar a producción».
 * @returns {boolean} `true` si el árbol está limpio.
 */
export function assertNoSecrets({ action, sinks }) {
  let total;
  try {
    total = runSecretGuard(sinks);
  } catch (error) {
    console.error(`✖ No se pudo correr la guardia de secretos: ${error instanceof Error ? error.message : error}`);
    return false;
  }
  if (total > 0) {
    console.error(`✖ Hay secretos en el árbol de trabajo; no ${action}.`);
    return false;
  }
  return true;
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    return usage();
  }
  if (runSecretGuard() > 0) process.exitCode = 1;
}

// Solo corre como CLI: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (error) {
    console.error('::error::La guardia de secretos no pudo correr:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
