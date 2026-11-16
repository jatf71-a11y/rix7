import type { Metadata } from 'next';

import { listRecentEmails, type EmailStatus } from '@/lib/data/emailLog';
import { requireAdmin } from '@/lib/supabase/auth-guard';

/**
 * Los últimos correos que salieron del portal.
 *
 * Existe por una pregunta concreta: «el socio dice que no le llegó». Antes había
 * que entrar a Resend o a los logs del despliegue, y ninguno de los dos dice qué
 * plantilla se intentó mandar ni si el envío se saltó por falta de
 * configuración. Acá se ve en una tabla, con el motivo cuando falló.
 *
 * No guarda el cuerpo del correo —lleva enlaces de un solo uso—, solo qué se
 * mandó, a quién y con qué resultado.
 */
export const metadata: Metadata = {
  title: 'Correos | Rix7',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<EmailStatus, { label: string; className: string }> = {
  sent: { label: 'Enviado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  failed: { label: 'Falló', className: 'bg-red-50 text-red-700 border-red-200' },
  skipped: { label: 'Sin enviar', className: 'bg-amber-50 text-amber-700 border-amber-200' },
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminEmailsPage() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-base font-black text-slate-900">Correos enviados</h1>
        <p className="mt-2 text-sm text-slate-500">Inicia sesión como equipo para ver la bitácora.</p>
      </div>
    );
  }

  const rows = await listRecentEmails(80).catch(() => []);
  const failures = rows.filter((row) => row.status !== 'sent').length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-black text-slate-900">Correos enviados</h1>
        <p className="mt-1 text-xs text-slate-500">
          Últimos {rows.length} envíos. «Sin enviar» es falta de configuración, no un error de
          Resend.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Todavía no hay envíos registrados. La bitácora empieza a llenarse con el próximo correo.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
              {rows.length} en total
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
              {failures} sin salir
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold">Destinatario</th>
                  <th className="px-3 py-2 font-semibold">Asunto</th>
                  <th className="px-3 py-2 font-semibold">Plantilla</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 font-semibold">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.skipped;
                  return (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                        {formatDate(row.created_at)}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{row.to_email}</td>
                      <td className="px-3 py-2 text-slate-700">{row.subject}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-500">
                        {row.template ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${style.className}`}>
                          {style.label}
                        </span>
                      </td>
                      <td className="max-w-[280px] px-3 py-2 text-[10px] text-slate-500">
                        {row.error ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
