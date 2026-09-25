/**
 * Guard: recorre el código de cliente, encuentra **todas** las referencias
 * externas y las cruza contra el CSP real de `vercel.json`.
 *
 * Motivo: dos veces se descubrió un host bloqueado de a uno y ya en producción
 * —los tiles del mapa (faltaban en `connect-src`) y el video remoto de una ficha
 * (no había `media-src`)—. Los headers de `vercel.json` solo se aplican en
 * Vercel, así que un recurso sin permiso **no se nota en local**: se ve recién
 * al desplegar. Este test lo dice antes.
 *
 * Cómo extenderlo: si aparece un host nuevo sin clasificar, el test falla con su
 * archivo y su línea. Se agrega el patrón que corresponda a `RULES` y, si el
 * recurso lo pide el navegador, el host se suma a la directiva correcta en
 * `vercel.json`. Nunca se relaja el CSP para "hacer pasar" el test: eso
 * convierte el guard en un adorno.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkResource, parseCsp, type ResourceKind } from './cspAudit';

type Classification = ResourceKind | 'navigation' | 'ignore';

/**
 * Cómo se pide cada recurso, por patrón. **El orden importa**: gana el primero.
 * El contexto se toma hacia atrás hasta cerrarse la estructura (ver
 * `contextBefore`), así una URL hereda la clasificación de su arreglo.
 */
const RULES: Array<{ kind: Classification | 'unknown'; test: RegExp }> = [
  // No son cargas de red: namespaces de SVG y textos de ayuda en un input.
  { kind: 'ignore', test: /xmlns|placeholder=/i },
  // Enlaces que abre el usuario, metadatos que lee un crawler y URLs canónicas.
  // Ninguno pasa por el CSP (son navegación o texto, no carga del documento).
  { kind: 'navigation', test: /<a\s|href=|website|canonical|og:|openGraph|twitter:|attribution|whatsapp|wa\.me|SITE_URL|mailto:/i },
  // MapLibre pide las teselas con fetch, así que van por `connect-src` — y esta
  // regla tiene que ir **antes** que la de imagen, porque su URL igual termina
  // en `.png` y se clasificaría mal. Es el error que este guard debe atrapar:
  // el mismo archivo pide el tile con fetch y con <img> según la librería.
  // El host de Supabase llega por variable de entorno, no literal en el código.
  { kind: 'connect', test: /tiles:\s*\[|tiles:\s*\{|fetch\(|axios|new WebSocket|wss:\/\/|supabase/i },
  // Leaflet las pide como <img> (su línea trae `tileLayer(`).
  { kind: 'image', test: /tileLayer\(|iconUrl|iconRetinaUrl|shadowUrl|poster|image|logo|avatar|thumbnail|background-image|\.png|\.jpe?g|\.svg|\.webp|\.ico/i },
  { kind: 'media', test: /<video|video_url|videoUrl|\.mp4|\.webm|\.mov|\.m3u8/i },
  { kind: 'font', test: /\.woff2?|\.ttf|\.otf/i },
  { kind: 'worker', test: /\bnew Worker\b|importScripts/ },
  { kind: 'script', test: /<script/i },
  { kind: 'unknown', test: /.*/ },
];

const SCAN_DIRS = ['app', 'components', 'lib', 'public'];
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.css', '.json', '.svg', '.html', '.webmanifest'];

/**
 * Código que solo corre en el servidor: sus URLs no pasan por el CSP, porque
 * quien las pide es Node. Se listan a mano y con motivo — una lista larga de
 * "esto no se audita" es una forma silenciosa de apagar el guard.
 */
const SERVER_ONLY = [
  'lib/email/sendEmail.ts', // API HTTP de Resend, con la clave secreta
  'lib/supabase/server.ts', // cliente de servidor
  'lib/supabase/config.ts', // configuración de servidor
];

/** Artefactos generados por `postinstall` (copias de dependencias), no código propio. */
const GENERATED = [/^public[\\/]maplibre-gl-(worker|shared)\.mjs$/];

/** Línea de comentario: una URL citada ahí no se carga nunca. */
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|<!--)/.test(line);

function isAuditable(path: string): boolean {
  const normalized = path.split('/').join(sep);
  if (normalized.startsWith(`app${sep}api${sep}`)) return false;
  if (normalized.startsWith(`scripts${sep}`)) return false;
  if (normalized.includes('.test.')) return false;
  // El auditor se cita a sí mismo en ejemplos y comentarios.
  if (/cspAudit|cspCoverage/.test(normalized)) return false;
  if (normalized.endsWith('.generated.json')) return false;
  if (SERVER_ONLY.some((entry) => normalized === entry.split('/').join(sep))) return false;
  if (GENERATED.some((pattern) => pattern.test(normalized))) return false;
  return true;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      out.push(...walk(full));
    } else if (SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
}

interface Reference {
  file: string;
  line: number;
  url: string;
  host: string;
  kind: Classification | 'unknown';
}

/**
 * Contexto hacia atrás **dentro de la misma estructura**: se corta en una línea
 * vacía o en un cierre de bloque.
 *
 * Hace falta porque las tres URLs de un arreglo `tiles: [` están a distinta
 * distancia de su declaración: con una ventana fija de líneas, la tercera se
 * clasificaba como imagen (por su `.png`) y el guard dejaba de ver el caso que
 * existe para atrapar.
 */
function contextBefore(lines: string[], index: number): string {
  const window: string[] = [];
  for (let cursor = index; cursor >= 0 && window.length < 12; cursor -= 1) {
    const line = lines[cursor];
    if (cursor !== index && (line.trim() === '' || /^\s*[\]{)]/.test(line))) break;
    window.unshift(line);
  }
  return window.join('\n');
}

function collect(): Reference[] {
  const found: Reference[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const path = relative(process.cwd(), file);
      if (!isAuditable(path)) continue;
      const content = readFileSync(file, 'utf8');
      if (content.length > 2_000_000) continue;
      const lines = content.split(/\r?\n/);
      lines.forEach((text, index) => {
        if (isComment(text)) return;
        // `Array.from` y no `for…of`: el proyecto compila con `target: es5`, sin
        // `downlevelIteration`, y el iterador de `matchAll` no es recorrible.
        Array.from(text.matchAll(/https?:\/\/[A-Za-z0-9._*{}-]+/g)).forEach((match) => {
          const raw = match[0].replace(/[.,)'"]+$/, '');
          // El subdominio de Leaflet (`{s}`) se resuelve en runtime: se audita
          // el subdominio real que la app termina pidiendo.
          const url = raw.replace('{s}', 'a');
          const context = contextBefore(lines, index);
          const rule = RULES.find((candidate) => candidate.test.test(text) || candidate.test.test(context));
          found.push({
            file: path,
            line: index + 1,
            url,
            host: hostOf(url),
            kind: rule?.kind ?? 'unknown',
          });
        });
      });
    }
  }
  return found;
}

function hostOf(url: string): string {
  try {
    return new URL(url.replace(/\{[a-z]\}/g, 'x')).hostname;
  } catch {
    return url;
  }
}

const SELF = 'https://rix7.vercel.app';

const cspHeader = (): string => {
  const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    headers: { headers: { key: string; value: string }[] }[];
  };
  return config.headers
    .flatMap((entry) => entry.headers)
    .find((entry) => entry.key === 'Content-Security-Policy')?.value ?? '';
};

describe('cobertura del CSP para los recursos externos del cliente', () => {
  const references = collect();

  it('encuentra referencias externas (el barrido no está vacío)', () => {
    expect(references.length).toBeGreaterThan(0);
  });

  it('clasifica todas las referencias', () => {
    const unclassified = references.filter((reference) => reference.kind === 'unknown');
    expect(
      unclassified.map((reference) => `${reference.file}:${reference.line} ${reference.url}`),
    ).toEqual([]);
  });

  it('el CSP real autoriza cada recurso en su directiva', () => {
    const policy = parseCsp(cspHeader());
    const loadable = references.filter(
      (reference) => reference.kind !== 'navigation' && reference.kind !== 'ignore',
    );
    const blocked = loadable
      .map((reference) => ({
        ...reference,
        check: checkResource(policy, reference.url, reference.kind as ResourceKind, SELF),
      }))
      .filter((reference) => !reference.check.allowed);

    expect(
      blocked.map(
        (reference) =>
          `${reference.host} (${reference.kind}) bloqueado por ${reference.check.decidedBy} — ${reference.file}:${reference.line}`,
      ),
    ).toEqual([]);
  });

  it('informa el inventario auditado', () => {
    const byHost = new Map<string, { kinds: Set<Classification | 'unknown'>; where: string[] }>();
    for (const reference of references) {
      const entry = byHost.get(reference.host) ?? { kinds: new Set(), where: [] };
      entry.kinds.add(reference.kind);
      const where = `${reference.file}:${reference.line}`;
      if (!entry.where.includes(where)) entry.where.push(where);
      byHost.set(reference.host, entry);
    }
    const rows = Array.from(byHost.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([host, entry]) => {
        const where = entry.where.slice(0, 2).join(', ') + (entry.where.length > 2 ? ` (+${entry.where.length - 2})` : '');
        return `${host.padEnd(30)} ${Array.from(entry.kinds).join('/').padEnd(11)} ${where}`;
      });
    console.log(`\nHosts externos auditados (${byHost.size}):\n${rows.join('\n')}\n`);
    expect(byHost.size).toBeGreaterThan(0);
  });
});
