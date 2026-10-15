#!/usr/bin/env node
/**
 * Guarda el token personal de Supabase (`SUPABASE_ACCESS_TOKEN`) en `.env.local`
 * sin imprimirlo y sin tocar las demás variables.
 *
 * ¿Por qué existe? Porque la forma manual falló de dos maneras concretas:
 *
 * 1. El comando de una línea que se usó escribía con `>` —hubiera dejado
 *    `.env.local` con **una sola** variable, borrando la URL, la anon key y el
 *    token de Vercel—. Y como no era idempotente, la segunda pasada tampoco
 *    arreglaba el desastre.
 * 2. Un token pegado a mano queda en el historial del shell y en el buffer de la
 *    pantalla. Acá se lee sin eco y lo único que se informa es el largo: el
 *    valor no pasa por la salida ni por los argumentos del proceso.
 *
 * Uso:
 *
 *   npm run db:token                  # pide el token sin mostrarlo
 *   printf '%s' "$TOKEN" | npm run db:token     # desde una tubería
 *   node scripts/token-supabase.mjs --file /ruta/.env.local
 *
 * También guarda la otra clave del corte de base, sin eco:
 *
 *   npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY
 *
 * El token se emite en https://supabase.com/dashboard/account/tokens y **debe
 * pertenecer a una cuenta con acceso al proyecto**: la API de administración
 * solo ve los proyectos de esa cuenta. Ese es el motivo por el que este paso no
 * se puede saltear con un token de otra cuenta.
 *
 * Cuál es «esa cuenta» sale del propio `.env.local`: el script imprime la
 * referencia del proyecto de `NEXT_PUBLIC_SUPABASE_URL` antes de pedir el valor,
 * para poder cotejar que el token se emite desde la cuenta dueña de ese proyecto.
 * Desde el 2026-10-14 ese proyecto es `vsqkjimpssdvlvdwrtnh`, de
 * `jatf71@gmail.com` (registro de cuentas y servicios, §2 y §3).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** El archivo que leen `db:push`, `db:status`, `check:domain` y el resto. */
export const ENV_FILE = path.join(ROOT, '.env.local');

/** La variable que espera la API de administración de Supabase. */
export const TOKEN_VAR = 'SUPABASE_ACCESS_TOKEN';

/** La variable de la que se deduce a qué proyecto (y cuenta) pertenece el token. */
export const URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL';

/**
 * Forma de un token personal de Supabase. Se valida lo suficiente para atajar el
 * error real —pegar la anon key, la service role key o un token truncado— y no
 * tanto como para romperse si Supabase cambia el largo.
 */
export const TOKEN_PATTERN = /^sbp_[A-Za-z0-9_-]{16,}$/;

/**
 * Las otras dos claves que este guardador sabe recibir, con la forma que tiene
 * cada una y el error que ataja. `SUPABASE_SERVICE_ROLE_KEY` es la que necesita
 * el corte de base: sin ella, el panel y los avisos responden 401 en cuanto la
 * URL apunte al proyecto nuevo.
 *
 * @type {Record<string, { pattern: RegExp, alias?: string, hint: string }>}
 */
export const SECRET_RULES = {
  [TOKEN_VAR]: {
    pattern: TOKEN_PATTERN,
    alias: 'token personal (sirve para `db:push`, `db:status` y `db:copy`)',
    hint: 'debería empezar con "sbp_" (https://supabase.com/dashboard/account/tokens)',
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    // Clásica (`eyJ…`, un JWT de tres partes) o nueva (`sb_secret_…`).
    pattern: /^(?:eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]{16,})$/,
    alias: 'clave de servicio (solo servidor: nunca lleva NEXT_PUBLIC_)',
    hint: 'debería empezar con "eyJ" (clásica) o "sb_secret_" (nueva): no es la anon key',
  },
};

/**
 * ¿Tiene forma de token personal de Supabase?
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlausibleToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value.trim());
}

/**
 * ¿Tiene forma de la variable que se pidió guardar?
 *
 * Una variable desconocida se acepta con solo no estar vacía: el script no
 * pretende ser el catálogo de todo lo que existe, solo atajar el error caro
 * —pegar la clave equivocada en el nombre equivocado—, que es el que deja un
 * despliegue sin funcionar y sin mensaje.
 *
 * @param {string} name
 * @param {unknown} value
 * @returns {{ ok: true } | { ok: false, hint: string }}
 */
export function isPlausibleSecret(name, value) {
  const rule = SECRET_RULES[name];
  const text = typeof value === 'string' ? value.trim() : '';

  if (!rule) return text ? { ok: true } : { ok: false, hint: 'llegó vacío' };
  if (rule.pattern.test(text)) return { ok: true };

  // Se informa la forma sin repetir el valor: alcanza para entender el error.
  return {
    ok: false,
    hint: `${rule.hint}${text.startsWith('eyJ') && name === TOKEN_VAR ? ' (eso parece una clave, no un token)' : ''}`,
  };
}

/**
 * Devuelve el contenido de un `.env` con `name=value` puesto al día.
 *
 * Reglas: reemplaza la línea existente **en su lugar** (no reordena el archivo),
 * o la agrega al final si no estaba; deja una sola definición de esa variable y
 * asegura el salto de línea final.
 *
 * @param {string} content
 * @param {string} name
 * @param {string} value
 * @returns {string}
 */
export function upsertEnvVar(content, name, value) {
  const lines = String(content ?? '').split('\n');
  // `split` deja un último elemento vacío cuando el archivo termina en salto:
  // se descarta acá y el salto se repone al final, para no acumular líneas.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const assignment = `${name}=${value}`;
  const at = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith(`${name}=`) && !trimmed.startsWith('#');
  });

  if (at === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push(assignment);
  } else {
    lines[at] = assignment;
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Escribe el token (o la clave que se pida) en el archivo indicado.
 *
 * @param {{ file?: string, name?: string, token: string, readFile?: (file: string) => string, writeFile?: (file: string, content: string) => void }} params
 * @returns {{ file: string, name: string, length: number, replaced: boolean }}
 */
export function saveToken({
  file = ENV_FILE,
  name = TOKEN_VAR,
  token,
  readFile = (target) => (existsSync(target) ? readFileSync(target, 'utf8') : ''),
  writeFile = (target, content) => writeFileSync(target, content, 'utf8'),
}) {
  const before = readFile(file);
  const replaced = before.split('\n').some((line) => line.trim().startsWith(`${name}=`));

  writeFile(file, upsertEnvVar(before, name, token));

  return { file, name, length: token.length, replaced };
}

/**
 * Lo único que se imprime. Nunca incluye el valor: solo el largo y qué se hizo.
 *
 * @param {{ name?: string, length: number, replaced: boolean, file: string }} result
 * @returns {string}
 */
export function successMessage({ name = TOKEN_VAR, length, replaced, file }) {
  const action = replaced ? 'actualizado' : 'guardado';
  return `OK: ${name} ${action} en ${file} (${length} caracteres). El valor no se imprimió ni quedó en el historial.`;
}

/**
 * La línea que dice **de qué proyecto** es el token que se va a pedir, leída del
 * `.env` que se va a usar.
 *
 * Existe por el error que el script no puede detectar solo: un token válido de
 * **otra cuenta**. La API de administración solo ve los proyectos de la cuenta
 * del token, así que `db:push` responde «no se pudo deducir la referencia»
 * aunque el token sea perfecto. Nombrar la referencia antes de pedir el valor
 * deja cotejar contra qué cuenta se emite, sin mostrar ningún secreto: lo único
 * que imprime es la URL pública que ya está en el repo.
 *
 * @param {unknown} content Contenido de un `.env`.
 * @returns {string | null} `null` si el archivo no declara la URL.
 */
export function projectLine(content) {
  const line = String(content ?? '')
    .split('\n')
    .map((raw) => raw.trim())
    .find((raw) => raw.startsWith(`${URL_VAR}=`));

  const url = line?.slice(URL_VAR.length + 1).trim().replace(/^["']|["']$/g, '');
  if (!url) return null;

  // La ref es el subdominio (`<ref>.supabase.co`): es el dato que pide `db:push --ref`.
  const ref = /^https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)\b/i.exec(url)?.[1] ?? null;
  const project = ref ? `${ref} (${url})` : url;

  return `Proyecto de .env.local: ${project}. El token tiene que emitirse desde la cuenta dueña de ese proyecto.`;
}

/** Lee todo lo que venga por la entrada estándar (el caso de la tubería). */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

/** Pide el token sin reflejarlo en pantalla. */
async function askHidden(prompt) {
  if (!process.stdin.isTTY) return readStdin();

  process.stdout.write(prompt);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  // Lo único que se ve en pantalla es el texto que ya se imprimió: el eco del
  // token queda anulado mientras dure la pregunta.
  rl._writeToOutput = () => {};
  const answer = await new Promise((resolve) => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return String(answer).trim();
}

/**
 * El paso siguiente que conviene imprimir después de guardar, según qué se
 * guardó. Es lo único que se sugiere: el script no ejecuta nada.
 *
 * @param {string} name
 * @returns {string[]}
 */
export function nextSteps(name) {
  if (name === TOKEN_VAR) {
    return ['Siguiente paso:  npm run db:status   (informa, no toca nada)', '                 npm run db:push     (aplica lo que falte)'];
  }
  if (name === 'SUPABASE_SERVICE_ROLE_KEY') {
    return [
      'Siguiente paso:  npm run corte:supabase            (comprueba las claves, aplica en Vercel y despliega)',
      '  o paso a paso: npm run vercel:sync -- --dry-run   (dice qué cambiaría, sin tocar nada)',
      '                 npm run vercel:sync               (aplica las variables en Vercel)',
      '                 npm run deploy:prod               (las NEXT_PUBLIC_* van dentro del build)',
    ];
  }
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  const pick = (flag) => {
    const at = args.lastIndexOf(flag);
    return at === -1 ? null : (args[at + 1] ?? null);
  };

  const name = pick('--name') || TOKEN_VAR;
  const fileAt = args.includes('--file');
  const file = fileAt ? pick('--file') : ENV_FILE;

  if (fileAt && !file) {
    console.error('Falta la ruta después de --file.');
    process.exitCode = 2;
    return;
  }

  const rule = SECRET_RULES[name];

  // Qué proyecto se está configurando: es lo que permite cotejar que el valor
  // sale de la cuenta dueña. Solo la URL pública, nunca una clave.
  if (name === TOKEN_VAR) {
    const hint = projectLine(existsSync(file) ? readFileSync(file, 'utf8') : '');
    if (hint) console.log(hint);
  }

  const token = await askHidden(`Pegá ${name} y Enter (no se muestra): ${rule?.alias ? `(${rule.alias}) ` : ''}`);

  if (!token) {
    console.error(
      '\nNo llegó ningún valor.\n' +
        '  · Si lo pegaste y no apareció nada: eso es lo esperado (no se muestra).\n' +
        '  · El token personal se emite en https://supabase.com/dashboard/account/tokens,\n' +
        '    desde la cuenta dueña del proyecto de NEXT_PUBLIC_SUPABASE_URL.\n' +
        '  · La clave de servicio, en Project Settings » API del proyecto.\n',
    );
    process.exitCode = 1;
    return;
  }

  const plausible = isPlausibleSecret(name, token);
  if (!plausible.ok) {
    // Se informa la forma sin repetir ni el largo exacto: alcanza para entender
    // el error y no agrega nada del valor a la pantalla.
    console.error(`\nEso no parece ${name}: ${plausible.hint}.\nNada se escribió.\n`);
    process.exitCode = 1;
    return;
  }

  const result = saveToken({ file, name, token });
  console.log(`\n${successMessage(result)}`);
  const steps = nextSteps(name);
  if (steps.length) console.log(`\n${steps.join('\n')}`);
  console.log('');
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
