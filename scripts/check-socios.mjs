#!/usr/bin/env node
/**
 * Aislamiento entre socios: que el panel de una corredora no se abra con la
 * cuenta de otra.
 *
 * Es la invariante de seguridad del producto y hasta hoy se verificaba a mano,
 * con dos cuentas reales y `curl` (así se descubrió que el rechazo respondía
 * 200). Una regresión acá no rompe una pantalla: filtra el panel de una empresa
 * a otra.
 *
 *   npm run check:socios                                   # sin escribir: rutas públicas
 *   npm run check:socios -- --write                        # matriz completa (crea y borra cuentas)
 *   npm run check:socios -- --url http://localhost:3000 --write
 *
 * Sin `--write` solo se piden las rutas sin sesión: que `/socio/<slug>` exista y
 * que el panel genérico responda. La matriz —propio 200, ajeno 403, subruta
 * ajena 403, `/socio` 200— necesita **dos cuentas de prueba**, porque no hay otra
 * forma de tener dos sesiones; se crean en el socio indicado, se les genera un
 * enlace de un solo uso (que no manda correo) y se borran al terminar, incluso
 * si algo falla.
 *
 * Códigos de salida: `0` = todo como debe · `1` = una comprobación falló o un
 * paso se rompió · `2` = el comando se usó mal y **nada se ejecutó**.
 */
import process from 'node:process';

import { readCredentials } from './socios-huerfanas.mjs';

export const DEFAULT_URL = 'https://rix7.cl';

/** Rutas que se comprueban con la sesión de cada cuenta de prueba. */
export function isolationMatrix({ own, foreign }) {
  return [
    { label: `propio /socio/${own}`, path: `/socio/${own}`, expect: 200 },
    { label: `ajeno /socio/${foreign}`, path: `/socio/${foreign}`, expect: 403 },
    { label: `ajeno /socio/${foreign}/publicar`, path: `/socio/${foreign}/publicar`, expect: 403 },
    { label: 'panel genérico /socio', path: '/socio', expect: 200 },
  ];
}

/**
 * @param {string[]} argv
 * @returns {{ url: string, write: boolean, help: boolean, error?: string }}
 */
export function parseArgs(argv) {
  const args = { url: DEFAULT_URL, write: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write' || arg === '--escribir') args.write = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--url') args.url = String(argv[++i] ?? '');
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else return { ...args, error: `Opción desconocida: ${arg}` };
  }

  args.url = args.url.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(args.url)) {
    return { ...args, error: `--url tiene que empezar con http:// o https:// (recibí «${args.url}»).` };
  }
  return args;
}

/**
 * La cookie que `@supabase/ssr` reconoce como sesión.
 *
 * `getUser()` en el middleware lee de acá, así que la comprobación usa el mismo
 * camino que un socio real: no hay atajo por encabezado `Authorization`.
 */
export function buildSessionCookie(supabaseUrl, session) {
  const ref = new URL(supabaseUrl).host.split('.')[0];
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  return { name: `sb-${ref}-auth-token`, value };
}

/**
 * ¿La matriz salió como debía? Devuelve los fallos, no un booleano suelto.
 *
 * @param {{ label: string, status: number, expect: number }[]} results
 * @returns {{ label: string, status: number, expect: number }[]}
 */
export function evaluate(results) {
  return results.filter((row) => row.status !== row.expect);
}

/** Los dos primeros socios del catálogo, que son las cuentas de la prueba. */
export function pickPartners(partners) {
  const usable = partners
    .filter((partner) => typeof partner?.id === 'string' && partner.id !== '')
    .sort((a, b) => a.id.localeCompare(b.id));
  return usable.length >= 2 ? [usable[0], usable[1]] : [];
}

function usage() {
  console.log(
    [
      '',
      'Aislamiento entre socios en el panel.',
      '',
      '  npm run check:socios                            rutas públicas, sin escribir',
      '  npm run check:socios -- --write                 matriz completa (crea y borra cuentas)',
      '  npm run check:socios -- --url http://localhost:3000 --write',
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

  const { url: supabaseUrl, key } = credentials;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const partnersResponse = await fetch(`${supabaseUrl}/rest/v1/partners?select=id&order=id.asc`, {
    headers,
  });
  if (!partnersResponse.ok) {
    console.error(`✖ No se pudo leer el catálogo de socios: HTTP ${partnersResponse.status}`);
    process.exit(1);
  }
  const partners = pickPartners(await partnersResponse.json());
  if (partners.length < 2) {
    console.error('✖ Hacen falta al menos dos socios para comprobar el aislamiento.');
    process.exit(1);
  }

  console.log(`\n== Aislamiento de socios · ${args.url}\n`);

  let failures = 0;
  const anonymous = await fetch(`${args.url}/socio/${partners[0].id}`, { redirect: 'manual' });
  const anonymousOk = anonymous.status === 200;
  if (!anonymousOk) failures += 1;
  console.log(
    `  ${anonymousOk ? '✓' : '✖'} sin sesión /socio/${partners[0].id} — ${anonymous.status} (se espera 200, pantalla de entrada)`
  );

  if (!args.write) {
    console.log('\n· Sin --write solo se miraron las rutas públicas: la matriz de permisos no se comprobó.');
    console.log('  Volvé a correrlo con --write para crear dos cuentas de prueba y comprobarla.\n');
    process.exit(failures === 0 ? 0 : 1);
  }

  const stamp = Date.now();
  const created = [];

  try {
    for (const [index, partner] of partners.entries()) {
      const email = `pruebas+socios-${stamp}-${index}@rix7.cl`;
      const createdUser = await (
        await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            email,
            email_confirm: true,
            app_metadata: { role: 'member', partner_id: partner.id },
          }),
        })
      ).json();
      if (!createdUser?.id) throw new Error(`no se pudo crear la cuenta de prueba en ${partner.id}`);

      const link = await (
        await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ type: 'magiclink', email }),
        })
      ).json();
      const verified = await (
        await fetch(`${supabaseUrl}/auth/v1/verify`, {
          method: 'POST',
          headers: { apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
        })
      ).json();
      if (!verified?.access_token) throw new Error(`no se pudo iniciar sesión como ${email}`);

      created.push({
        id: createdUser.id,
        email,
        partnerId: partner.id,
        cookie: buildSessionCookie(supabaseUrl, {
          access_token: verified.access_token,
          token_type: 'bearer',
          expires_in: verified.expires_in,
          expires_at: Math.floor(Date.now() / 1000) + verified.expires_in,
          refresh_token: verified.refresh_token,
          user: verified.user,
        }),
      });
    }

    const [a, b] = created;
    const runs = [
      ...isolationMatrix({ own: a.partnerId, foreign: b.partnerId }).map((row) => ({ ...row, account: a })),
      ...isolationMatrix({ own: b.partnerId, foreign: a.partnerId }).map((row) => ({ ...row, account: b })),
    ];

    const results = [];
    for (const row of runs) {
      const response = await fetch(`${args.url}${row.path}`, {
        headers: { cookie: `${row.account.cookie.name}=${row.account.cookie.value}` },
        redirect: 'manual',
      });
      results.push({ ...row, status: response.status });
      const ok = response.status === row.expect;
      if (!ok) failures += 1;
      console.log(
        `  ${ok ? '✓' : '✖'} [${row.account.partnerId}] ${row.label} — ${response.status} (se espera ${row.expect})`
      );
    }

    const mismatches = evaluate(results);
    console.log(
      mismatches.length === 0
        ? '\n✓ Cada socio ve solo su panel; el ajeno responde 403.\n'
        : `\n✖ ${mismatches.length} comprobación(es) no coinciden.\n`
    );
  } finally {
    for (const account of created) {
      const removal = await fetch(`${supabaseUrl}/auth/v1/admin/users/${account.id}`, {
        method: 'DELETE',
        headers,
      }).catch(() => null);
      if (!removal?.ok) console.error(`  ⚠ no se pudo borrar ${account.email} (HTTP ${removal?.status ?? '—'})`);
    }
  }

  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('check-socios.mjs')) {
  main().catch((error) => {
    console.error(`✖ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
