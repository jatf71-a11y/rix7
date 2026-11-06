import { escapeHtml } from './alertEmail';
import { formatPlanPrice } from '@/lib/kyb/plans';

/**
 * Aviso de cambio del CCA mensual.
 *
 * El CCA se factura junto a la mensualidad y depende de la cartera del socio,
 * así que cada cambio de monto tiene que llegarle antes de la factura: es la
 * diferencia entre un cargo explicado y uno sorpresivo. El correo muestra la
 * cuenta completa —cartera, CCA en UF, `%CCA` y monto— y el valor anterior, para
 * que el salto se entienda.
 *
 * No es un aviso de cobro: nada se debitó acá. El monto se suma a la
 * mensualidad del período, que se confirma aparte.
 */

export interface BuiltCcaEmail {
  subject: string;
  text: string;
  html: string;
}

function dateLabel(value: Date): string {
  return value.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatUf(value: number): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value);
}

function shell({
  siteUrl,
  title,
  intro,
  body,
}: {
  siteUrl: string;
  title: string;
  intro: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:#0f172a;padding:26px 24px">
        <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-.02em">
          Rix<span style="color:#3b82f6">7</span>
        </div>
        <div style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-top:6px">
          Tu cuenta profesional
        </div>
      </div>
      <div style="padding:26px 24px 8px">
        <h1 style="margin:0 0 8px;font-size:21px;color:#0f172a">${escapeHtml(title)}</h1>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.65">${intro}</p>
      </div>
      <div style="padding:18px 24px 28px">${body}</div>
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px">
        <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.7">
          Recibes este correo porque tu cuenta de socio en Rix7 tiene un CCA calculado sobre tus publicaciones.
          <br />
          <a href="${siteUrl}/legal/privacidad" style="color:#64748b">Privacidad</a>
          ·
          <a href="${siteUrl}/" style="color:#64748b">rix7.cl</a>
        </p>
      </div>
    </div>
  </body>
</html>`;
}

export function buildCcaChangeEmail({
  partnerName,
  amountClp,
  previousAmountClp,
  stockClp,
  ccaUf,
  ufClp,
  ccaPct,
  siteUrl,
  now = new Date(),
}: {
  partnerName: string;
  amountClp: number;
  /** `null` = es la primera vez que la cuenta tiene un monto. */
  previousAmountClp: number | null;
  stockClp: number;
  ccaUf: number;
  ufClp: number;
  ccaPct: number;
  siteUrl: string;
  now?: Date;
}): BuiltCcaEmail {
  const first = previousAmountClp === null;
  const up = !first && amountClp > previousAmountClp;
  const amount = formatPlanPrice(amountClp);
  const previous = previousAmountClp === null ? null : formatPlanPrice(previousAmountClp);
  const panelUrl = `${siteUrl.replace(/\/+$/, '')}/socio`;

  const subject = first
    ? `Tu CCA mensual en Rix7: ${amount}`
    : `Tu CCA mensual cambió: ${amount}`;

  const changeLine = first
    ? `Este es el primer monto de tu cuenta: ${amount} al mes.`
    : `El monto pasó de ${previous} a ${amount} al mes (${up ? 'subió' : 'bajó'}).`;

  const text = [
    `Hola, ${partnerName}.`,
    '',
    'El CCA de tu cuenta cambió porque cambió el valor de tu cartera o el factor %CCA',
    'que aplica Rix7.',
    '',
    changeLine,
    '',
    'La cuenta, con los datos de hoy:',
    `- Cartera publicada: ${formatPlanPrice(stockClp)}`,
    `- CCA en UF: ${formatUf(ccaUf)} UF (valor de la UF: ${formatPlanPrice(ufClp)})`,
    `- %CCA aplicado: ${formatUf(ccaPct)}%`,
    `- Monto mensual por CCA: ${amount}`,
    '',
    'La fórmula es: $CCA = CCA × valor de la UF ÷ 1.000.000 × %CCA.',
    'No se cobra por publicación: se cobra el CCA, y se factura junto a la mensualidad',
    'de tu plan. No hay ningún cobro en este correo.',
    '',
    `Puedes ver el detalle y el historial en tu panel: ${panelUrl}`,
    '',
    `Rix7 — Cuenta profesional · ${dateLabel(now)}`,
    siteUrl,
  ].join('\n');

  const changeColor = first ? '#0f172a' : up ? '#b45309' : '#047857';

  return {
    subject,
    text,
    html: shell({
      siteUrl,
      title: first ? 'Tu CCA ya tiene monto' : 'Tu CCA mensual cambió',
      intro: `Actualizamos la cuenta de <strong>${escapeHtml(partnerName)}</strong>. ${escapeHtml(
        changeLine
      )}`,
      body: `
        <div style="margin:0 0 20px;padding:18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b">
            CCA mensual
          </div>
          <div style="font-size:26px;font-weight:900;color:${changeColor};margin-top:4px">
            ${escapeHtml(amount)}
          </div>
          ${
            previous
              ? `<div style="margin-top:4px;font-size:12px;color:#64748b">Antes: ${escapeHtml(previous)}</div>`
              : ''
          }
        </div>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;color:#334155">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #e2e8f0">Cartera publicada</td>
            <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700">${escapeHtml(
              formatPlanPrice(stockClp)
            )}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #e2e8f0">CCA en UF</td>
            <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700">${escapeHtml(
              formatUf(ccaUf)
            )} UF</td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #e2e8f0">Valor de la UF</td>
            <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700">${escapeHtml(
              formatPlanPrice(ufClp)
            )}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #e2e8f0">%CCA aplicado</td>
            <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700">${escapeHtml(
              formatUf(ccaPct)
            )}%</td>
          </tr>
        </table>
        <p style="margin:18px 0 0;color:#475569;font-size:13px;line-height:1.65">
          La fórmula es <strong>$CCA = CCA × valor de la UF ÷ 1.000.000 × %CCA</strong>.
          No se cobra por publicación: se cobra el CCA, y se factura junto a la mensualidad de tu plan.
          Este correo no genera ningún cobro.
        </p>
        <div style="margin:20px 0 0">
          <a href="${escapeHtml(panelUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
            Ver mi cuenta
          </a>
        </div>`,
    }),
  };
}
