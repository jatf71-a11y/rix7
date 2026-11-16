#!/usr/bin/env node
/**
 * Cuentas vinculadas a socios que ya no existen.
 *
 * Una cuenta de socio lleva su corredora en `app_metadata.partner_id`, y esa
 * ficha puede desaparecer —se borra un socio de prueba, se limpia una base,
 * alguien recrea el alta—. La cuenta queda apuntando a nadie: entra, el panel le
 * responde que no tiene corredora y aparece en la lista de «Cuentas de socios»
 * del panel del equipo sin empresa detrás. Limpiarlas a mano, una por una con la
 * API de administración, es lo que hicimos el 2026-11-16 con seis cuentas.
 *
 * Este comando las encuentra todas y, si se le pide, las desvincula y las borra.
 *
 *   npm run socios:huerfanas               # informe: solo lectura
 *   npm run socios:huerfanas -- --aplicar  # desvincula y borra
 *   npm run socios:huerfanas -- --help
 *
 * **Sin `--aplicar` no se escribe nada.** La primera corrida es un plan, y solo
 * la segunda toca algo: borrar una cuenta de acceso no es reversible.
 *
 * Códigos de salida: `0` = sin huérfanas o todo quedó limpio · `1` = algún paso
 * falló · `2` = el comando se usó mal y **nada se ejecutó**.
 *
 * No imprime credenciales: solo correos, que son datos de las cuentas que se
 * están limpiando.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readEnvContent } from './check-auth-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_FILE = path.join(ROOT, '.env.local');
export const URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL';
export const SERVICE_VAR = 'SUPABASE_SERVICE_ROLE_KEY';
const PARTNERS_PATH = '/rest/v1/partners?select=id&order=id.asc';
const USERS_PATH = '/auth/v1/admin/users';

/**
 * Interpreta los argumentos.
 *
 * @param {string[]} argv
 * @returns {{ apply: boolean, help: boolean, error?: string }}
 */
export function parseArgs(argv) {
  const args = { apply: false, help: false };
  for (const arg of argv) {
    if (arg === '--apply' || arg === '--aplicar') args.apply = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else return { ...args, error: `Opción desconocida: ${arg}` };
  }
  return args;
}

/**
 * Las cuentas cuya corredora ya no existe.
 *
 * Solo mira las que **tienen** `partner_id`: una cuenta sin vínculo es un
 * usuario del portal, no una huérfana.
 *
 * @param {{ id: string, email?: string | null, app_metadata?: Record<string, unknown> }[]} users
 * @param {string[] | Set<string>} partnerIds
 * @returns {{ id: string, email: string | null, partnerId: string }[]}
 */
export function findOrphans(users, partnerIds) {
  const known = partnerIds instanceof Set ? partnerIds : new Set(partnerIds);
  const orphans = [];

  for (const user of users) {
    const partnerId = user.app_metadata?.partner_id;
    if (typeof partnerId !== 'string' || partnerId === '') continue;
    if (known.has(partnerId)) continue;
    orphans.push({ id: user.id, email: user.email ?? null, partnerId });
  }

  return orphans.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
}

/** La metadata sin el vínculo: lo que queda si se desvincula la cuenta. */
export function withoutPartner(appMetadata) {
  const { partner_id: _partner, ...rest } = appMetadata ?? {};
  return rest;
}

/** Credenciales desde `process.env` y, si falta, desde `.env.local`. */
export function readCredentials({ file = DEFAULT_FILE, env = process.env } = {}) {
  const fromFile = existsSync(file) ? readEnvContent(readFileSync(file, 'utf8')) : {};
  const url = env[URL_VAR] || fromFile[URL_VAR];
  const key = env[SERVICE_VAR] || fromFile[SERVICE_VAR];
  if (!url || !key) {
    return { error: `Faltan ${URL_VAR} y ${SERVICE_VAR} (en el entorno o en ${path.basename(file)}).` };
  }
  return { url: url.replace(/\/+$/, ''), key };
}

function api(url, key) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return async (pathname, init = {}) => {
    const response = await fetch(`${url}${pathname}`, { ...init, headers });
    return response;
  };
}

async function listAllUsers(call) {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await call(`${USERS_PATH}?page=${page}&per_page=200`);
    if (!response.ok) throw new Error(`listar cuentas respondió ${response.status}`);
    const body = await response.json();
    const batch = body?.users ?? [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

function usage() {
  console.log(
    [
      '',
      'Cuentas vinculadas a socios que ya no existen.',
      '',
      '  npm run socios:huerfanas               informe, sin escribir nada',
      '  npm run socios:huerfanas -- --aplicar  desvincula y borra',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (args.error) {
    console.error(`✖ ${args.error}`);
    process.exit(2);
  }

  const credentials = readCredentials();
  if (credentials.error) {
    console.error(`✖ ${credentials.error}`);
    process.exit(1);
  }

  const call = api(credentials.url, credentials.key);
  const partnersResponse = await call(PARTNERS_PATH);
  if (!partnersResponse.ok) {
    console.error(`✖ No se pudo leer el catálogo de socios: HTTP ${partnersResponse.status}`);
    process.exit(1);
  }
  const partnerIds = (await partnersResponse.json()).map((partner) => partner.id);

  const users = await listAllUsers(call);
  const orphans = findOrphans(users, partnerIds);

  console.log(`\nSOCIOS: ${partnerIds.length} · CUENTAS: ${users.length}\n`);

  if (orphans.length === 0) {
    console.log('✓ Ninguna cuenta apunta a un socio inexistente.');
    process.exit(0);
  }

  console.log(`HUÉRFANAS (${orphans.length}):`);
  for (const orphan of orphans) console.log(`  · ${orphan.email ?? orphan.id} → ${orphan.partnerId}`);

  if (!args.apply) {
    console.log('\n· Sin --aplicar no se tocó nada. Volvé a correrlo con --aplicar para limpiarlas.\n');
    process.exit(0);
  }

  let failed = 0;
  for (const orphan of orphans) {
    // Primero el vínculo y después la baja: si la baja falla, la cuenta al menos
    // deja de aparecer como si tuviera corredora.
    const current = await call(`${USERS_PATH}/${orphan.id}`);
    const appMetadata = current.ok ? (await current.json()).app_metadata : {};
    const unlink = await call(`${USERS_PATH}/${orphan.id}`, {
      method: 'PUT',
      body: JSON.stringify({ app_metadata: withoutPartner(appMetadata) }),
    });
    const removal = await call(`${USERS_PATH}/${orphan.id}`, { method: 'DELETE' });
    const ok = unlink.ok && removal.ok;
    if (!ok) failed += 1;
    console.log(
      `  ${ok ? '✓' : '✖'} ${orphan.email ?? orphan.id} · vínculo ${unlink.status} · baja ${removal.status}`
    );
  }

  console.log(
    failed === 0
      ? '\n✓ Quedaron limpias.\n'
      : `\n✖ ${failed} cuenta(s) no se pudieron limpiar.\n`
  );
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`✖ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
