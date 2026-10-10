/**
 * @vitest-environment node
 *
 * Tests de la capa pura de subida de media: tipo, límites y ruta en el bucket.
 * `uploadMedia` (la parte con red) solo se prueba en su rama sin proyecto,
 * que es la única determinista sin un Storage real.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  MEDIA_LIMITS,
  mediaExtension,
  mediaKindOf,
  mediaStoragePath,
  uploadMedia,
  validateMediaFile,
} from './uploadMedia';

describe('mediaKindOf', () => {
  it('clifica por MIME, sin importar mayúsculas', () => {
    expect(mediaKindOf('image/png')).toBe('image');
    expect(mediaKindOf('IMAGE/JPEG')).toBe('image');
    expect(mediaKindOf('video/mp4')).toBe('video');
    expect(mediaKindOf('application/pdf')).toBeNull();
    expect(mediaKindOf('')).toBeNull();
  });
});

describe('validateMediaFile', () => {
  it('acepta una imagen y un video dentro del límite', () => {
    expect(validateMediaFile({ name: 'a.jpg', type: 'image/jpeg', size: 1024 })).toEqual({
      ok: true,
      kind: 'image',
    });
    expect(validateMediaFile({ name: 'b.mp4', type: 'video/mp4', size: 1024 })).toEqual({
      ok: true,
      kind: 'video',
    });
  });

  it('rechaza formatos que no sean imagen ni video', () => {
    const result = validateMediaFile({ name: 'doc.pdf', type: 'application/pdf', size: 10 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Formato no soportado/);
  });

  it('rechaza archivos vacíos', () => {
    expect(validateMediaFile({ name: 'a.jpg', type: 'image/jpeg', size: 0 }).ok).toBe(false);
  });

  it('respeta los límites por tipo: imagen 10 MB, video 50 MB', () => {
    const justOverImage = MEDIA_LIMITS.image.maxBytes + 1;
    const justOverVideo = MEDIA_LIMITS.video.maxBytes + 1;

    const image = validateMediaFile({ name: 'a.jpg', type: 'image/jpeg', size: justOverImage });
    expect(image.ok).toBe(false);
    expect(image.error).toMatch(/10 MB/);

    // Un video de 20 MB pasa (imagen no lo haría): el límite es por tipo.
    const video = validateMediaFile({ name: 'b.mp4', type: 'video/mp4', size: 20 * 1024 * 1024 });
    expect(video.ok).toBe(true);

    const bigVideo = validateMediaFile({ name: 'b.mp4', type: 'video/mp4', size: justOverVideo });
    expect(bigVideo.ok).toBe(false);
    expect(bigVideo.error).toMatch(/50 MB/);
  });
});

describe('mediaExtension / mediaStoragePath', () => {
  it('prefiere la extensión del MIME y cae a la del nombre', () => {
    expect(mediaExtension('foto.JPG', 'image/jpeg')).toBe('jpg');
    expect(mediaExtension('clip.mov', 'video/quicktime')).toBe('mov');
    // MIME desconocido (pero aceptado por kind) → extensión del nombre.
    expect(mediaExtension('algo.webp', 'image/webp')).toBe('webp');
    expect(mediaExtension('sin-nombre', 'image/x-custom')).toBe('bin');
  });

  it('la ruta es carpeta por tipo + uuid + ext, sin el nombre original', () => {
    expect(mediaStoragePath('image', 'IMG 0001 (copia).jpg', 'image/jpeg', 'uuid-1')).toBe(
      'fotos/uuid-1.jpg'
    );
    expect(mediaStoragePath('video', 'viaje.mp4', 'video/mp4', 'uuid-2')).toBe('videos/uuid-2.mp4');
  });

  it('un nombre malicioso no escapa del bucket', () => {
    const path = mediaStoragePath('image', '../../etc/passwd.png', 'image/png', 'uuid-3');
    expect(path).toBe('fotos/uuid-3.png');
    expect(path).not.toContain('..');
  });
});

describe('uploadMedia (sin proyecto configurado)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('no finge la subida: informa que requiere Supabase y sugiere la URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');

    const file = { name: 'a.jpg', type: 'image/jpeg', size: 100 } as File;
    const result = await uploadMedia(file);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Supabase configurado/);
    expect(result.error).toMatch(/pega la URL/);
  });

  it('valida antes de mirar el entorno: un PDF no llega ni a comprobar proyecto', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proyecto-real.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');

    const file = { name: 'doc.pdf', type: 'application/pdf', size: 100 } as File;
    const result = await uploadMedia(file);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Formato no soportado/);
  });
});
