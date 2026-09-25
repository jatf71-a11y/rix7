/**
 * Rate limit por clave (normalmente la IP del cliente) en memoria del proceso.
 *
 * Nació dentro de `/api/pois` y se extrajo al aparecer una segunda ruta pública
 * que también necesita protegerse de abusos (`/api/leads`). Es el mismo
 * algoritmo, una sola implementación.
 *
 * Nota honesta sobre su alcance: el estado vive en el proceso, así que en un
 * despliegue con varias instancias (Vercel) el límite es **por instancia**, no
 * global. Frena ráfagas y scripts simples, que es su objetivo; para un límite
 * exacto haría falta un almacén compartido (Redis o una tabla).
 */

export interface RateLimiterOptions {
  /** Solicitudes permitidas dentro de la ventana. */
  max: number;
  /** Duración de la ventana, en milisegundos. */
  windowMs: number;
}

export interface RateLimiter {
  /** true si la clave superó el máximo dentro de la ventana. */
  isLimited(key: string): boolean;
  /** Vacía los contadores (para tests). */
  reset(): void;
}

export function createRateLimiter({ max, windowMs }: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, { count: number; windowStart: number }>();

  /** Limpieza perezosa: solo cuando el mapa crece, para no recorrerlo en cada request. */
  function sweep(now: number): void {
    if (buckets.size < 1000) return;
    for (const key of Array.from(buckets.keys())) {
      const bucket = buckets.get(key);
      if (bucket && now - bucket.windowStart >= windowMs) buckets.delete(key);
    }
  }

  return {
    isLimited(key: string): boolean {
      const now = Date.now();
      sweep(now);

      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart >= windowMs) {
        buckets.set(key, { count: 1, windowStart: now });
        return false;
      }

      bucket.count += 1;
      return bucket.count > max;
    },

    reset(): void {
      buckets.clear();
    },
  };
}

/**
 * IP del cliente según los encabezados del proxy.
 *
 * En Vercel `x-forwarded-for` trae la cadena completa, así que se toma la
 * primera entrada. Si no hay ninguna, se agrupa todo bajo `unknown`: preferimos
 * que un caso raro comparta cupo a que quede sin límite.
 */
export function clientIpFrom(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}
