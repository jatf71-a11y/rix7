'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, KeyRound, Link2, Loader2, ShieldAlert, UserMinus } from 'lucide-react';
import type { Partner } from '@/lib/data/partners';

/**
 * Cuentas de socios: vincular una **cuenta** del portal con una **corredora**.
 *
 * Es la mitad que faltaba de `/admin/empresas`: la página ya administraba las
 * corredoras (sus datos, su contacto, su feed), pero no había forma de decir
 * **qué cuenta** entra al panel de publicaciones —el rol `member` y el
 * `app_metadata.partner_id` que exige `/socio`—. Sin eso, el panel estaba
 * desplegado y era inalcanzable.
 *
 * Tres cosas que la interfaz dice en vez de esconder:
 *
 * - **La cuenta tiene que existir primero.** La persona crea su cuenta (Google o
 *   enlace mágico) y recién después se vincula: el alta no crea cuentas ni manda
 *   invitaciones.
 * - **El cambio llega al iniciar sesión otra vez.** El rol viaja en el token, así
 *   que un navegador con la sesión abierta sigue viendo el portal como Visita
 *   hasta que la refresque. La respuesta de la API lo recuerda y acá se muestra.
 * - **Si el despliegue no puede escribir el rol, se dice.** `app_metadata` se
 *   escribe con la clave de servicio; sin ella la API responde 503 y el panel
 *   muestra ese motivo con el enlace a `/api/health`, en vez de un error genérico
 *   o —peor— un «listo» que no pasó.
 */

interface SocioAccount {
  id: string;
  email: string;
  role: 'visitor' | 'member' | 'admin';
  partnerId: string | null;
}

export default function SocioAccounts({ partners }: { partners: Partner[] }) {
  const [accounts, setAccounts] = useState<SocioAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const [email, setEmail] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);

  const partnerName = useCallback(
    (id: string | null) => (id ? partners.find((p) => p.id === id)?.name ?? id : '—'),
    [partners]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/socios', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? 'No se pudieron cargar las cuentas.');
        setAccounts([]);
        return;
      }
      setError(null);
      setAccounts(Array.isArray(body.data) ? body.data : []);
      setTruncated(!!body.truncated);
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleLink(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/socios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), partner_id: partnerId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setFeedback({ type: 'error', message: body?.error ?? 'No se pudo vincular la cuenta.' });
        return;
      }
      setFeedback({
        type: 'ok',
        message: body.already
          ? `${email.trim()} ya estaba vinculada a ${partnerName(partnerId)}.`
          : `${email.trim()} ahora publica como ${partnerName(partnerId)}. ${body.note ?? ''}`.trim(),
      });
      setEmail('');
      await load();
    } catch {
      setFeedback({ type: 'error', message: 'Sin conexión con el servidor.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink(account: SocioAccount) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/socios?email=${encodeURIComponent(account.email)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setFeedback({ type: 'error', message: body?.error ?? 'No se pudo desvincular la cuenta.' });
        return;
      }
      setFeedback({
        type: 'ok',
        message: `${account.email} quedó como Visita: su panel de publicaciones deja de estar disponible.`,
      });
      await load();
    } catch {
      setFeedback({ type: 'error', message: 'Sin conexión con el servidor.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-6 py-5 border-b border-slate-100">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <KeyRound className="w-4 h-4 text-slate-400" />
          Cuentas de socios
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Qué cuenta entra al panel de publicaciones de cada corredora. La persona crea su
          cuenta primero (Google o enlace mágico) y recién después se vincula acá; entra a
          publicar desde <span className="font-mono text-slate-600">/socio</span>.
        </p>
      </div>

      <div className="px-6 py-5">
        {error && (
          <div className="flex items-start gap-2 px-4 py-3 mb-5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
            <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold">No se pudieron administrar las cuentas</p>
              <p className="mt-0.5 text-amber-700">
                {error} El estado de la configuración del despliegue está en{' '}
                <a href="/api/health" className="underline font-medium">
                  /api/health
                </a>
                .
              </p>
            </div>
          </div>
        )}

        {truncated && !error && (
          <div className="flex items-start gap-2 px-4 py-3 mb-5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>
              Hay más cuentas de las que se recorren en una búsqueda. Las vinculaciones de acá
              siguen funcionando, pero una cuenta muy antigua podría no aparecer en el listado.
            </p>
          </div>
        )}

        {feedback && (
          <div
            className={`flex items-center gap-2 px-4 py-3 mb-5 rounded-lg border text-sm ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Alta del vínculo */}
        <form onSubmit={handleLink} className="flex flex-col sm:flex-row gap-3 sm:items-end mb-6">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5" htmlFor="socio-email">
              Correo de la cuenta
            </label>
            <input
              id="socio-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="corredora@ejemplo.cl"
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5" htmlFor="socio-partner">
              Corredora
            </label>
            <select
              id="socio-partner"
              required
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Elegí una corredora…</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy || !email.trim() || !partnerId}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg shadow-sm shadow-blue-500/20 transition-all"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Vincular cuenta
          </button>
        </form>

        {/* Listado */}
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando cuentas…
          </div>
        ) : accounts.length === 0 && !error ? (
          <p className="py-8 text-sm text-slate-500 text-center">
            Todavía no hay ninguna cuenta vinculada. Ninguna corredora puede entrar al panel de
            publicaciones hasta que vincules la suya.
          </p>
        ) : (
          accounts.length > 0 && (
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {accounts.map((account) => (
                <li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{account.email}</p>
                    <p className="text-xs text-slate-500">
                      {account.role === 'admin' ? 'Equipo Rix7' : partnerName(account.partnerId)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      account.role === 'admin'
                        ? 'bg-slate-100 text-slate-600 border-slate-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}
                  >
                    {account.role === 'admin' ? 'Admin' : 'Socia'}
                  </span>
                  <button
                    onClick={() => handleUnlink(account)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                    title="Quitar el vínculo y devolver la cuenta a Visita"
                  >
                    <UserMinus className="w-3.5 h-3.5" />
                    Desvincular
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </section>
  );
}
