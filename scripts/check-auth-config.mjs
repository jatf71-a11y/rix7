#!/usr/bin/env node
/**
 * Verifica la configuración del acceso con enlace mágico.
 *
 * El acceso depende de cosas que **no viven en el repositorio** —SMTP propio,
 * URLs de redirección y la plantilla del correo—, así que es fácil dar por hecho
 * que están bien cuando no lo están: con el proveedor de correo integrado de
 * Supabase, por ejemplo, el acceso funciona y deja de funcionar al tercer intento
 * de la hora. Este script las comprueba y, si se le pide, **manda un enlace
 * real** para poder verificarlo de punta a punta.
 *
 *   npm run check:auth                      # solo diagnóstico
 *   npm run check:auth -- --email tu@correo.cl
 *   npm run check:auth -- --email tu@correo.cl --url https://rix7.cl/properties/x
 *
 * Lo que el script **no** puede comprobar (y dice que hay que mirar a mano):
 *
 * - Si el correo llegó, si está en español y si trae la marca: eso se ve en la
 *   bandeja de entrada.
 * - Si el enlace vuelve a la página correcta: se ve al hacer clic. Es la única
 *   prueba real de que las *Redirect URLs* están bien.
 * - Si el SMTP es propio o el integrado: Supabase no expone esa configuración
 *   por la API pública. Un SMTP mal puesto devuelve error al enviar; el
 *   integrado no, simplemente limita a 2 correos por hora.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env.local');

/** Límite del proveedor de correo integrado de Supabase: 2 por hora. */
export const BUILT_IN_EMAIL_LIMIT_PER_HOUR = 2;

/**
 * Tipos del informe, en JSDoc: es un script en JS puro (corre en Node sin
 * cargador de TypeScript), y así los tests en `.ts` lo consumen tipado.
 *
 * @typedef {{ level: 'ok' | 'error' | 'warn' | 'info', label: string, detail: string }} CheckStep
 * @typedef {{ settings: string, otp: string }} AuthEndpoints
 * @typedef {object} AuthCheckReport
 * @property {boolean} ok
 * @property {boolean} configured  ¿Hay un proyecto real con el que hablar?
 * @property {CheckStep[]} steps
 * @property {string[]} checklist    Qué mirar a mano (vacío si no se mandó nada)
 * @property {string | null} sentTo  Correo al que se mandó el enlace
 * @property {AuthEndpoints} [endpoints]
 * @property {boolean} [needsEmail]  Faltó `--email` para probar el envío
 */

/** Destino de prueba por defecto: una ficha, que es donde se pide el enlace. */
export const DEFAULT_REDIRECT = 'http://localhost:3000/properties/scl-depto-marco-polo';

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en check-auth-config.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Lector de `.env` sin dependencias: `CLAVE=valor`, comillas y comentarios.
 *
 * @param {string | null} content
 * @returns {Record<string, string>}
 */
export function readEnvContent(content) {
  const result = {};
  if (!content) return result;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Comillas simples o dobles: se quitan, y dentro de comillas un `#` es parte
    // del valor, no un comentario.
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) {
      value = quoted[2];
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    if (key) result[key] = value;
  }

  return result;
}

/**
 * ¿Sirve esta URL para hablar con un proyecto de verdad?
 *
 * Se rechaza el placeholder (el caso que hay que detectar) y lo que no sea una
 * URL utilizable. Un dominio propio (`auth.rix7.cl`) se acepta: es una
 * configuración legítima de Supabase, solo que no se puede deducir de ahí la
 * referencia del proyecto.
 */
export function classifySupabaseUrl(url) {
  if (!url) {
    return { ok: false, reason: 'Falta NEXT_PUBLIC_SUPABASE_URL.' };
  }
  if (url.includes('placeholder')) {
    return {
      ok: false,
      reason: `Sigue el placeholder de desarrollo (${url}). Hay que poner la URL del proyecto real.`,
    };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `No es una URL válida: ${url}` };
  }

  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLocal) {
    return { ok: false, reason: `Tiene que ser https: ${url}` };
  }

  const match = /^([a-z0-9-]+)\.supabase\.(co|in)$/.exec(parsed.hostname);
  if (!match) {
    return {
      ok: true,
      reason: 'ok',
      ref: null,
      note: `Dominio propio (${parsed.hostname}): se acepta, pero no se puede deducir la referencia del proyecto.`,
    };
  }

  return { ok: true, reason: 'ok', ref: match[1] };
}

/** ¿La anon key parece real? La validez la comprueba el servidor. */
export function classifyAnonKey(key) {
  if (!key) {
    return { ok: false, reason: 'Falta NEXT_PUBLIC_SUPABASE_ANON_KEY.' };
  }
  if (key.includes('placeholder')) {
    return { ok: false, reason: 'Sigue la anon key del placeholder de desarrollo.' };
  }
  // Las claves nuevas empiezan con `sb_publishable_`; las clásicas son un JWT.
  if (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ')) {
    return { ok: false, reason: 'La anon key no tiene la forma esperada.' };
  }

  return { ok: true, reason: 'ok' };
}

/**
 * Traduce `/auth/v1/settings` a lo que importa para el enlace mágico.
 *
 * Es la única parte de la configuración que se puede leer con la clave pública,
 * así que se aprovecha: dice si el correo está habilitado —sin eso no se puede
 * pedir ningún enlace— y si Google lo está (el botón del modal).
 */
export function summarizeSettings(settings) {
  const external = settings?.external ?? {};

  const notes = [];
  if (external.email === false) {
    notes.push(
      'El proveedor de correo está DESHABILITADO: hay que habilitarlo en Authentication » Providers » Email.'
    );
  }
  if (settings?.disable_signup === true) {
    notes.push(
      'Las altas están deshabilitadas: alguien que todavía no tiene cuenta no va a poder entrar.'
    );
  }
  if (settings?.mailer_autoconfirm === true) {
    notes.push(
      'La confirmación por correo está en automático: el enlace mágico se sigue enviando, pero conviene revisar si es lo que se quiere.'
    );
  }

  return {
    emailEnabled: external.email !== false,
    googleEnabled: external.google === true,
    signupsDisabled: settings?.disable_signup === true,
    autoconfirm: settings?.mailer_autoconfirm === true,
    notes,
  };
}

/**
 * Cuerpo que espera `/auth/v1/otp` para mandar un enlace de acceso.
 *
 * @param {{ email: string, redirectTo?: string | null }} params
 *
 * **Sin PKCE a propósito.** La web usa PKCE, donde el enlace solo lo puede
 * canjear el navegador que guardó el `code_verifier`; un enlace pedido desde
 * este script no tendría ese verificador y fallaría por una razón que no tiene
 * nada que ver con la configuración, haciendo pensar que algo está mal. Sin
 * PKCE, el enlace clásico entra desde cualquier navegador — que es justo lo que
 * se quiere comprobar acá: SMTP, plantilla y redirecciones.
 */
export function buildOtpPayload({ email, redirectTo }) {
  const payload = {
    email,
    create_user: true,
    gotrue_meta_security: {},
  };

  if (redirectTo) payload.redirect_to = redirectTo;

  return payload;
}

/**
 * Endpoints del proyecto (se imprimen para poder repetirlo con curl).
 *
 * @param {string} supabaseUrl
 * @returns {AuthEndpoints}
 */
export function authEndpoints(supabaseUrl) {
  const base = supabaseUrl.replace(/\/$/, '');
  return {
    settings: `${base}/auth/v1/settings`,
    otp: `${base}/auth/v1/otp`,
  };
}

/**
 * Qué revisar a mano después de mandar el enlace: es donde se verifica de verdad.
 *
 * @param {{ email: string, redirectTo?: string | null }} params
 * @returns {string[]}
 */
export function inboxChecklist({ email, redirectTo }) {
  return [
    `Mira la bandeja de ${email} (y la carpeta de spam).`,
    'El asunto debe decir «Tu enlace para entrar a Rix7» y el correo estar EN ESPAÑOL con la marca: eso prueba que la plantilla quedó pegada.',
    'Si el correo está en inglés y sin marca, la plantilla no se guardó en Supabase.',
    redirectTo
      ? `Al hacer clic debe volver a ${redirectTo} (no al inicio). Si vuelve al inicio, esa URL no está en Redirect URLs.`
      : 'Al hacer clic debe volver a la misma página desde la que se pidió el enlace. Si vuelve al inicio, esa URL no está en Redirect URLs.',
    'Si no llega ningún correo y el script dijo "enviado", el problema es el SMTP (o el límite de 2 por hora del integrado).',
    'Prueba también el botón «Continuar con Google»: es la única forma de saber si el proveedor quedó habilitado.',
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
// Verificación (con la red inyectable, para poder probarla)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Corre la verificación completa y devuelve un informe.
 *
 * Nunca lanza: los fallos de red se convierten en pasos con `level: 'error'`,
 * porque el objetivo del script es informar, no morir con un stacktrace.
 *
 * @param {{ supabaseUrl?: string, anonKey?: string, email?: string | null, redirectTo?: string | null, fetchImpl?: typeof fetch }} options
 * @returns {Promise<AuthCheckReport>}
 */
export async function runAuthCheck({
  supabaseUrl,
  anonKey,
  email = null,
  redirectTo = null,
  fetchImpl = fetch,
}) {
  const steps = [];

  const urlCheck = classifySupabaseUrl(supabaseUrl);
  const keyCheck = classifyAnonKey(anonKey);

  steps.push({
    level: urlCheck.ok ? 'ok' : 'error',
    label: 'NEXT_PUBLIC_SUPABASE_URL',
    detail: urlCheck.ok
      ? urlCheck.ref || new URL(supabaseUrl).hostname
      : urlCheck.reason,
  });
  if (urlCheck.ok && urlCheck.note) {
    steps.push({ level: 'warn', label: 'URL', detail: urlCheck.note });
  }
  steps.push({
    level: keyCheck.ok ? 'ok' : 'error',
    label: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    detail: keyCheck.ok ? 'presente' : keyCheck.reason,
  });

  if (!urlCheck.ok || !keyCheck.ok) {
    return { ok: false, configured: false, steps, checklist: [], sentTo: null };
  }

  const endpoints = authEndpoints(supabaseUrl);
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

  // ── 2. Proveedores habilitados ──
  let settingsSummary = null;
  try {
    const res = await fetchImpl(endpoints.settings, { headers });
    if (!res.ok) {
      steps.push({
        level: 'error',
        label: 'GET /auth/v1/settings',
        detail: `HTTP ${res.status}. Revisa que la URL y la anon key sean del proyecto.`,
      });
    } else {
      const settings = await res.json();
      settingsSummary = summarizeSettings(settings);

      steps.push({
        level: settingsSummary.emailEnabled ? 'ok' : 'error',
        label: 'Acceso por correo (enlace mágico)',
        detail: settingsSummary.emailEnabled ? 'habilitado' : 'DESHABILITADO',
      });
      steps.push({
        level: settingsSummary.googleEnabled ? 'ok' : 'warn',
        label: 'Acceso con Google',
        detail: settingsSummary.googleEnabled
          ? 'habilitado: el botón del modal va a funcionar'
          : 'deshabilitado: el modal lo avisa y ofrece el enlace al correo',
      });
      for (const note of settingsSummary.notes) {
        steps.push({ level: 'warn', label: 'aviso', detail: note });
      }
    }
  } catch (error) {
    steps.push({
      level: 'error',
      label: 'GET /auth/v1/settings',
      detail: `no se pudo conectar: ${error instanceof Error ? error.message : 'error desconocido'}`,
    });
  }

  // ── 3. Lo que no se puede leer por API ──
  steps.push({
    level: 'info',
    label: 'Redirect URLs y plantilla',
    detail: 'no se pueden leer por API: se comprueban al hacer clic y en la bandeja de entrada',
  });

  if (!email) {
    return {
      ok: steps.every((s) => s.level !== 'error'),
      configured: true,
      steps,
      checklist: [],
      sentTo: null,
      endpoints,
      needsEmail: true,
    };
  }

  // ── 4. Envío real ──
  try {
    const res = await fetchImpl(endpoints.otp, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOtpPayload({ email, redirectTo })),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      steps.push({
        level: 'error',
        label: `POST /auth/v1/otp (${email})`,
        detail: `HTTP ${res.status} ${detail.slice(0, 200)}`,
      });

      return {
        ok: false,
        configured: true,
        steps,
        checklist: [],
        sentTo: null,
        endpoints,
      };
    }

    steps.push({
      level: 'ok',
      label: `POST /auth/v1/otp (${email})`,
      detail: 'Supabase aceptó el envío; el correo debería estar en camino',
    });

    return {
      ok: true,
      configured: true,
      steps,
      checklist: inboxChecklist({ email, redirectTo }),
      sentTo: email,
      endpoints,
    };
  } catch (error) {
    steps.push({
      level: 'error',
      label: `POST /auth/v1/otp (${email})`,
      detail: `no se pudo enviar: ${error instanceof Error ? error.message : 'error desconocido'}`,
    });

    return { ok: false, configured: true, steps, checklist: [], sentTo: null, endpoints };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Presentación
// ═════════════════════════════════════════════════════════════════════════════

const MARK = { ok: '✓', error: '✗', warn: '!', info: '·' };

/**
 * Texto del informe, listo para imprimir. Separado para poder probarlo.
 *
 * @param {AuthCheckReport} report
 * @returns {string}
 */
export function formatReport(report) {
  const lines = [];
  const section = (title) => lines.push('', title);

  section('1. Credenciales del proyecto');
  for (const step of report.steps.filter((s) =>
    ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'URL'].includes(s.label)
  )) {
    lines.push(`  ${MARK[step.level]} ${step.label} — ${step.detail}`);
  }

  if (!report.configured) {
    lines.push(
      '',
      'Sin un proyecto Supabase real no se puede comprobar nada más: el enlace mágico,',
      'Google y todo lo que cuelga de la cuenta (favoritos, búsquedas guardadas) no',
      'funcionan con el placeholder.',
      '',
      'Qué hacer:',
      '  1. Crear el proyecto en https://supabase.com y copiar de Project Settings » API',
      '     la URL y la anon key.',
      '  2. Ponerlas en .env.local (local) y en Vercel (producción).',
      '  3. Volver a correr este script.'
    );
    return lines.join('\n');
  }

  section('2. Proveedores habilitados');
  for (const step of report.steps.filter(
    (s) => !['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'URL'].includes(s.label)
  )) {
    lines.push(`  ${MARK[step.level]} ${step.label} — ${step.detail}`);
  }

  if (report.endpoints) {
    lines.push('', '  Endpoints usados (para repetirlo con curl):');
    lines.push(`    · ${report.endpoints.settings}`);
    lines.push(`    · ${report.endpoints.otp}`);
  }

  if (report.needsEmail) {
    lines.push(
      '',
      'No se mandó ningún correo (falta --email).',
      '',
      'Para verificar de punta a punta:',
      '  npm run check:auth -- --email tu@correo.cl',
      '',
      'Ojo: cada envío gasta 1 del límite del proveedor de correo (el integrado',
      `permite ${BUILT_IN_EMAIL_LIMIT_PER_HOUR} por hora).`
    );
    return lines.join('\n');
  }

  if (report.sentTo) {
    section('3. Qué revisar ahora (esto es lo que verifica de verdad)');
    for (const item of report.checklist) lines.push(`  · ${item}`);
    lines.push(
      '',
      '  Nota: el script manda el enlace por el flujo clásico del servidor, que sirve',
      '  al hacer clic desde cualquier navegador. El que manda el botón de la web usa',
      '  PKCE y solo funciona en el navegador que lo pidió: probar los dos es lo que',
      '  cubre el camino completo.'
    );
  }

  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = { email: null, url: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--email') args.email = argv[++i] ?? null;
    else if (arg.startsWith('--email=')) args.email = arg.slice('--email='.length);
    else if (arg === '--url') args.url = argv[++i] ?? null;
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
  }

  return args;
}

function usage() {
  console.log(
    [
      '',
      'Verifica la configuración del acceso con enlace mágico.',
      '',
      '  npm run check:auth                          # diagnóstico, no manda nada',
      '  npm run check:auth -- --email tu@correo.cl  # manda un enlace real',
      '  npm run check:auth -- --email a@b.cl --url https://rix7.cl/properties/mi-ficha',
      '',
      'Opciones:',
      '  --email <correo>  manda un enlace real (gasta 1 del límite del proveedor)',
      '  --url <url>       a dónde debe volver el enlace; por defecto, el sitio local',
      '  --help            esto',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  console.log('\n== Verificación del acceso con enlace mágico ==');

  const envFromFile = existsSync(ENV_FILE)
    ? readEnvContent(readFileSync(ENV_FILE, 'utf8'))
    : {};
  if (!existsSync(ENV_FILE)) {
    console.log('  ! .env.local no existe: se usa lo que haya en el entorno');
  }

  const report = await runAuthCheck({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || envFromFile.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envFromFile.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    email: args.email,
    redirectTo: args.url || (args.email ? DEFAULT_REDIRECT : null),
  });

  console.log(formatReport(report));

  if (!report.ok) process.exitCode = 1;
}

// Solo corre al ejecutarse: así los tests pueden importar el núcleo.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
