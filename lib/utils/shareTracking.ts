import { reportError } from '@/lib/monitoring/reportError';
import type { ShareChannel, ShareSource } from '@/lib/data/shareEvents';

/**
 * Avisa al servidor que una visita registrada compartió una propiedad.
 *
 * Se manda **sin esperar** y con `keepalive`, por dos motivos concretos:
 *
 * 1. La acción real (abrir WhatsApp, copiar, la hoja del sistema) es lo que la
 *    persona pidió; el registro no puede demorarla ni hacerla fallar.
 * 2. Algunos canales abandonan la página (`tel:`, `mailto:`, una pestaña nueva).
 *    `keepalive` hace que la petición sobreviva a ese cierre.
 *
 * Si el servidor no guarda el evento, se reporta al monitoreo: es un dato que
 * el equipo usa para atribuir los enlaces, así que no puede desaparecer en
 * silencio. La persona no ve nada, porque su acción ya ocurrió.
 *
 * Sin identidad no se manda nada: el registro es, justamente, de un visitante
 * registrado. Las acciones están detrás del candado, así que en la práctica
 * `registration` siempre existe cuando esta función se llama con éxito.
 */
export interface TrackShareInput {
  propertyId: string;
  partnerId?: string | null;
  channel: ShareChannel;
  source: ShareSource;
  registration: { name: string; email: string; phone?: string } | null;
  shareUrl?: string | null;
}

export function trackShareEvent({
  propertyId,
  partnerId,
  channel,
  source,
  registration,
  shareUrl,
}: TrackShareInput): void {
  if (typeof window === 'undefined') return;
  if (!registration?.name?.trim() || !registration.email?.trim()) return;

  const body = {
    property_id: propertyId,
    partner_id: partnerId ?? null,
    channel,
    source,
    name: registration.name.trim(),
    email: registration.email.trim(),
    phone: registration.phone?.trim() || null,
    share_url: shareUrl ?? null,
  };

  try {
    void fetch('/api/share/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    })
      .then((response) => {
        if (response.ok) return;
        void reportError(new Error(`No se pudo registrar el compartido (HTTP ${response.status})`), {
          extra: { propertyId, channel, source },
        });
      })
      .catch((error) => {
        void reportError(error, { extra: { propertyId, channel, source } });
      });
  } catch {
    // Sin `fetch` o sin red: el compartido ocurrió igual y la persona no debe
    // enterarse de un fallo interno del portal.
  }
}
