import { AlertTriangle } from 'lucide-react';

import { periodLabel, SITUACION_LABELS } from '@/lib/data/cobranza';
import { situacionDePartner } from '@/lib/data/cobranzaStore';
import { requireMember } from '@/lib/supabase/auth-guard';

/**
 * Aviso de cobranza en el panel del socio.
 *
 * Es la bandera que pidió el equipo: mientras la situación del socio no esté al
 * día, el panel lo dice arriba de todo y con el monto, sin que tenga que abrir
 * ninguna pantalla. Cuando la morosidad está confirmada, además explica lo que
 * ya pasó con sus publicaciones —no se ven en el portal— porque eso es lo que
 * va a notar primero.
 *
 * Se calcula en el servidor con la misma regla que usa el panel de cobranza:
 * una sola definición de «moroso» para los dos lados.
 */
export default async function MorosidadBanner() {
  const guard = await requireMember();
  if (!guard.ok) return null;

  const situacion = await situacionDePartner(guard.partnerId);
  if (!situacion) return null;
  if (situacion.estado === 'al_dia' || situacion.estado === 'sin_facturar') return null;

  const money = new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(situacion.deudaClp);

  const moroso = situacion.estado === 'moroso';
  const periodos = situacion.periodosVencidos.map(periodLabel).join(', ');

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 border-b px-4 py-3 text-sm sm:px-6 lg:px-8 ${
        moroso
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-bold">
          {moroso ? 'Tu cuenta está morosa' : `Suscripción ${SITUACION_LABELS[situacion.estado].toLowerCase()}`}
        </p>
        <p className="mt-0.5 leading-relaxed">
          {moroso
            ? 'Tus publicaciones no se están mostrando en el portal. Regulariza el pago y vuelven a aparecer.'
            : 'Tienes un período pendiente de pago.'}{' '}
          {situacion.deudaClp > 0 && <>Deuda: <strong>{money}</strong>. </>}
          {periodos && <>Períodos: {periodos}. </>}
          {situacion.proximoVencimiento && <>Vence el {situacion.proximoVencimiento}.</>}
        </p>
        <p className="mt-1 text-[11px] opacity-80">
          Si ya pagaste, escríbenos a hola@rix7.cl y lo regularizamos.
        </p>
      </div>
    </div>
  );
}
