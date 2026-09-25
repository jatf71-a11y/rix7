/**
 * Tests del cruce de recursos externo vs CSP.
 *
 * Además de la lógica pura, el último bloque corre contra el `vercel.json`
 * **real**: es el guard que evita que un cambio de CSP vuelva a dejar un
 * recurso de la app sin permiso sin que nadie se entere hasta verlo roto en
 * producción (que es exactamente lo que pasó con los tiles del mapa).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIRECTIVE_FOR_KIND,
  checkResource,
  effectiveDirective,
  parseCsp,
  sourceMatches,
} from './cspAudit';

const SELF = 'https://rix7.vercel.app';
const TILE = 'https://a.tile.openstreetmap.org/10/311/613.png';

describe('parseCsp', () => {
  it('separa directivas y sus fuentes', () => {
    const policy = parseCsp("default-src 'self'; connect-src 'self' https://api.ejemplo.cl; frame-ancestors 'none'");
    expect(policy.directives['default-src']).toEqual(["'self'"]);
    expect(policy.directives['connect-src']).toEqual(["'self'", 'https://api.ejemplo.cl']);
    expect(policy.directives['frame-ancestors']).toEqual(["'none'"]);
  });

  it('tolera espacios y directivas sin valores', () => {
    const policy = parseCsp("  default-src   'self' ;  upgrade-insecure-requests ;  img-src 'self'  ");
    expect(policy.directives['default-src']).toEqual(["'self'"]);
    expect(policy.directives['upgrade-insecure-requests']).toEqual([]);
    expect(policy.directives['img-src']).toEqual(["'self'"]);
  });
});

describe('cada tipo de recurso tiene su directiva', () => {
  it('el mismo host puede pasar por una y ser rechazado por la otra', () => {
    // El bug original, reducido a su forma mínima: el CSP trae el tile solo en
    // `img-src` —que es como lo pide Leaflet— pero MapLibre lo pide con fetch.
    const policy = parseCsp("default-src 'self'; img-src 'self' https://*.tile.openstreetmap.org");

    expect(checkResource(policy, TILE, 'image', SELF).allowed).toBe(true);
    const asConnect = checkResource(policy, TILE, 'connect', SELF);
    expect(asConnect.allowed).toBe(false);
    // Sin `connect-src` declarado decide `default-src`; el reporte lo nombra
    // porque "bloqueado por default-src" y "por connect-src" se arreglan distinto.
    expect(asConnect.decidedBy).toBe('default-src');
  });

  it('nombra la directiva declarada cuando existe', () => {
    const policy = parseCsp("default-src 'self'; connect-src 'self' https://*.supabase.co");
    const asConnect = checkResource(policy, TILE, 'connect', SELF);
    expect(asConnect.allowed).toBe(false);
    expect(asConnect.decidedBy).toBe('connect-src');
  });

  it('un video remoto sin `media-src` lo decide `default-src`', () => {
    const policy = parseCsp("default-src 'self'; img-src 'self' data:");
    const video = checkResource(policy, 'https://storage.googleapis.com/x/clip.mp4', 'media', SELF);
    expect(video.allowed).toBe(false);
    expect(video.decidedBy).toBe('default-src');
  });

  it('`media-src` declarado autoriza el video y no toca las imágenes', () => {
    const policy = parseCsp("default-src 'self'; media-src 'self' https://storage.googleapis.com");
    expect(checkResource(policy, 'https://storage.googleapis.com/x/clip.mp4', 'media', SELF).allowed).toBe(true);
    expect(checkResource(policy, 'https://storage.googleapis.com/x/foto.jpg', 'image', SELF).allowed).toBe(false);
  });

  it('mapea cada tipo a la directiva que le toca', () => {
    expect(DIRECTIVE_FOR_KIND.connect).toBe('connect-src');
    expect(DIRECTIVE_FOR_KIND.image).toBe('img-src');
    expect(DIRECTIVE_FOR_KIND.media).toBe('media-src');
    expect(DIRECTIVE_FOR_KIND.worker).toBe('worker-src');
  });
});

describe('coincidencia de fuentes', () => {
  const url = (u: string) => {
    const p = new URL(u);
    return {
      scheme: p.protocol.replace(':', ''),
      host: p.hostname,
      port: p.port,
      path: p.pathname + p.search,
      origin: `${p.protocol}//${p.host}`,
    };
  };

  it("el comodín NO cubre el dominio raíz (medido en Chrome, no deducido)", () => {
    expect(sourceMatches('https://*.tile.openstreetmap.org', url(TILE), SELF)).toBe(true);
    expect(sourceMatches('https://*.tile.openstreetmap.org', url('https://tile.openstreetmap.org/10/311/613.png'), SELF)).toBe(false);
  });

  it('sin comodín solo el host exacto', () => {
    expect(sourceMatches('images.unsplash.com', url('https://images.unsplash.com/photo-1'), SELF)).toBe(true);
    expect(sourceMatches('images.unsplash.com', url('https://otro.unsplash.com/photo-1'), SELF)).toBe(false);
  });

  it("'self' exige mismo origen, no solo el mismo host", () => {
    expect(sourceMatches("'self'", url('https://rix7.vercel.app/compartir/x'), SELF)).toBe(true);
    expect(sourceMatches("'self'", url('http://rix7.vercel.app/compartir/x'), SELF)).toBe(false);
    expect(sourceMatches("'self'", url('https://otro.vercel.app/'), SELF)).toBe(false);
  });

  it('las fuentes de esquema cubren data:, blob: y wss:', () => {
    expect(sourceMatches('data:', url('data:image/png;base64,AAA'), SELF)).toBe(true);
    expect(sourceMatches('blob:', url('blob:https://rix7.vercel.app/abc'), SELF)).toBe(true);
    expect(sourceMatches('wss://*.supabase.co', url('wss://xyz.supabase.co/realtime/v1'), SELF)).toBe(true);
    expect(sourceMatches('https://*.supabase.co', url('wss://xyz.supabase.co/realtime/v1'), SELF)).toBe(false);
  });

  it('un puerto explícito se respeta y el path actúa como prefijo', () => {
    expect(sourceMatches('https://ejemplo.cl:8443', url('https://ejemplo.cl:9000/x'), SELF)).toBe(false);
    expect(sourceMatches('https://ejemplo.cl:8443', url('https://ejemplo.cl:8443/x'), SELF)).toBe(true);
    expect(sourceMatches('https://ejemplo.cl/api/', url('https://ejemplo.cl/api/v1'), SELF)).toBe(true);
    expect(sourceMatches('https://ejemplo.cl/api/', url('https://ejemplo.cl/otro'), SELF)).toBe(false);
  });

  it("'none' no autoriza nada", () => {
    expect(sourceMatches("'none'", url(TILE), SELF)).toBe(false);
  });
});

describe('cadena de respaldo', () => {
  it('`worker-src` cae a `child-src` y luego a `script-src`', () => {
    const policy = parseCsp("default-src 'self'; script-src 'self' blob:");
    const effective = effectiveDirective(policy, 'worker');
    expect(effective.directive).toBe('script-src');
    expect(checkResource(policy, 'blob:https://rix7.vercel.app/1', 'worker', SELF).allowed).toBe(true);
  });

  it('sin nada declarado, ninguna fuente autoriza', () => {
    const effective = effectiveDirective(parseCsp("img-src 'self'"), 'connect');
    expect(effective.directive).toBe('connect-src');
    expect(effective.sources).toEqual([]);
  });
});

describe('el CSP real de vercel.json cubre lo que la app carga', () => {
  const raw = readFileSync(join(process.cwd(), 'vercel.json'), 'utf8');
  const header = (JSON.parse(raw) as { headers: { headers: { key: string; value: string }[] }[] }).headers
    .flatMap((entry) => entry.headers)
    .find((h) => h.key === 'Content-Security-Policy');
  const policy = parseCsp(header?.value ?? '');

  it('sirve una CSP declarada', () => {
    expect(header).toBeDefined();
    expect(Object.keys(policy.directives).length).toBeGreaterThan(5);
  });

  it('cubre los recursos externos del navegador en su directiva correcta', () => {
    const cases: Array<[string, Parameters<typeof checkResource>[2]]> = [
      // MapLibre pide los tiles con fetch; Leaflet con <img>. Son dos directivas.
      ['https://a.tile.openstreetmap.org/10/311/613.png', 'connect'],
      ['https://a.tile.openstreetmap.org/10/311/613.png', 'image'],
      ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688', 'image'],
      ['https://xyz.supabase.co/rest/v1/partners', 'connect'],
      ['wss://xyz.supabase.co/realtime/v1', 'connect'],
      // Los videos: el local que ya existe y, cuando las corredoras suban los
      // suyos, los que sirve Supabase Storage.
      ['https://rix7.vercel.app/videos/promo-marco-polo.mp4', 'media'],
      ['https://xyz.supabase.co/storage/v1/object/public/videos/ficha.mp4', 'media'],
      ['https://rix7.vercel.app/leaflet/marker-icon.png', 'image'],
      ['https://rix7.vercel.app/maplibre-gl-worker.mjs', 'worker'],
      ['https://rix7.vercel.app/manifest.json', 'manifest'],
    ];
    const blocked = cases
      .map(([url, kind]) => ({ url, kind, check: checkResource(policy, url, kind, SELF) }))
      .filter((entry) => !entry.check.allowed);
    expect(blocked).toEqual([]);
  });

  it('ya no depende de cdnjs para los iconos de Leaflet', () => {
    expect(checkResource(policy, 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png', 'image', SELF).allowed).toBe(false);
  });
});
