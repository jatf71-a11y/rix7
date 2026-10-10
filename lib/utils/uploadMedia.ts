/**
 * Subida de fotos y videos del panel al bucket `properties-media`.
 *
 * El bucket ya existe desde la migración 0004 (lectura pública, escritura para
 * autenticados), así que la URL resultante sirve directo en la ficha sin
 * transformaciones: el CSP ya permite `*.supabase.co` en `img-src`, `media-src`
 * y `connect-src` (lo comprueba `cspCoverage.test.ts`).
 *
 * La **validación es pura** (límites, tipo, ruta) y vive al lado para poder
 * probarla sin red ni proyecto real; `uploadMedia` es solo el trozo que habla
 * con Storage. Dos reglas que no se delegan al servidor:
 *
 * - **Tamaño acotado en el cliente** (10 MB imagen / 50 MB video): el límite de
 *   Storage es 50 MB — subir un video de 300 MB para que lo rechace tarda
 *   minutos en una conexión lenta. El error se explica en español.
 * - **La ruta se arma con UUID**, nunca con el nombre del archivo: dos fotos
 *   `IMG_0001.jpg` no se pisan y un nombre con `../` no escapa del bucket.
 *
 * Sin Supabase configurado (desarrollo) la subida no se finge: informa que
 * requiere proyecto y sugiere pegar la URL, que es lo que sí funciona.
 */
import { isSupabaseConfigured } from '@/lib/supabase/config';

export type MediaKind = 'image' | 'video';

/** Límites por tipo. El de video = límite del propio Storage (50 MB). */
export const MEDIA_LIMITS: Record<MediaKind, { maxBytes: number; label: string }> = {
  image: { maxBytes: 10 * 1024 * 1024, label: 'La imagen' },
  video: { maxBytes: 50 * 1024 * 1024, label: 'El video' },
};

/** Bucket público de medios de las propiedades (0004). */
export const MEDIA_BUCKET = 'properties-media';

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/** Clase de archivo según el MIME: imagen, video o nada. */
export function mediaKindOf(type: string): MediaKind | null {
  const mime = type.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

export interface MediaValidation {
  ok: boolean;
  kind?: MediaKind;
  error?: string;
}

/** Validación pura del archivo antes de subirlo (tipo, tamaño, vacío). */
export function validateMediaFile(file: { name: string; type: string; size: number }): MediaValidation {
  const kind = mediaKindOf(file.type);
  if (!kind) {
    return {
      ok: false,
      error: 'Formato no soportado: solo imágenes (JPG, PNG, WebP, AVIF) o videos (MP4, WebM, MOV).',
    };
  }
  if (file.size <= 0) {
    return { ok: false, error: 'El archivo está vacío.' };
  }
  const { maxBytes, label } = MEDIA_LIMITS[kind];
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, error: `${label} pesa más de ${mb} MB. Comprímela antes de subirla.` };
  }
  return { ok: true, kind };
}

/** Extensión saneada: la del MIME si la conocemos, si no la del nombre. */
export function mediaExtension(fileName: string, type: string): string {
  const byType = EXT_BY_TYPE[type.toLowerCase()];
  if (byType) return byType;
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(fileName);
  return match ? match[1].toLowerCase() : 'bin';
}

/**
 * Ruta final en el bucket: `<fotos|videos>/<uuid>.<ext>`.
 * El nombre original no viaja (privacidad + colisiones + path traversal).
 */
export function mediaStoragePath(
  kind: MediaKind,
  fileName: string,
  type: string,
  uuid: string
): string {
  const folder = kind === 'image' ? 'fotos' : 'videos';
  return `${folder}/${uuid}.${mediaExtension(fileName, type)}`;
}

export interface UploadResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * Sube el archivo a Storage y devuelve su URL pública.
 * Nunca lanza: todo caso de error vuelve como `{ ok: false, error }` legible.
 */
export async function uploadMedia(file: File): Promise<UploadResult> {
  const check = validateMediaFile(file);
  if (!check.ok || !check.kind) return { ok: false, error: check.error };

  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error:
        'La subida de archivos requiere un proyecto Supabase configurado. En este entorno, pega la URL del archivo.',
    };
  }

  try {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const path = mediaStoragePath(check.kind, file.name, file.type, crypto.randomUUID());

    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

    if (error) {
      // El bucket exige sesión (RLS de 0004): es el fallo más probable y el
      // mensaje técnico de Supabase no le dice nada a la persona.
      if (/row-level security|not authorized|JWT|401/i.test(error.message)) {
        return { ok: false, error: 'Para subir archivos hay que iniciar sesión.' };
      }
      if (/too large|exceed|payload/i.test(error.message)) {
        const mb = Math.round(MEDIA_LIMITS[check.kind].maxBytes / (1024 * 1024));
        return { ok: false, error: `El archivo supera el límite de ${mb} MB.` };
      }
      return { ok: false, error: `No se pudo subir el archivo: ${error.message}` };
    }

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Error inesperado al subir el archivo.',
    };
  }
}
