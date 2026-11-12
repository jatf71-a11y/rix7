'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Crown, Loader2, MailPlus, RotateCcw, UserX, Users } from 'lucide-react';

import type { PartnerUser, PartnerUsersRead, PartnerUserRole } from '@/lib/data/partnerUsers';

/**
 * Gestión de usuarios de la cuenta.
 *
 * El socio ve quiénes entran a su empresa, cuánto lugar le queda y puede sumar,
 * cambiar de rol y dar de baja. El tope no se decide acá: la pantalla lo muestra
 * y el servidor lo aplica, porque un plan es una regla de negocio y no un botón
 * deshabilitado.
 *
 * Dos cosas que la pantalla no disimula:
 * - El **titular** (el correo del alta) aparece marcado y sin acciones: es el
 *   dueño de la cuenta y no se revoca desde la lista.
 * - Una invitación **ocupa lugar** aunque la persona todavía no haya entrado:
 *   aceptar otra de más dejaría a alguien sin acceso después de prometérselo.
 */

const ROLE_LABELS: Record<PartnerUserRole, string> = {
  admin: 'Administra la cuenta',
  editor: 'Publica propiedades',
};

const ROLE_OPTIONS: PartnerUserRole[] = ['admin', 'editor'];

const STATUS_LABELS: Record<PartnerUser['status'], string> = {
  activo: 'Con acceso',
  invitado: 'Invitado',
  revocado: 'Sin acceso',
};

const STATUS_STYLES: Record<PartnerUser['status'], string> = {
  activo: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  invitado: 'border-blue-200 bg-blue-50 text-blue-700',
  revocado: 'border-slate-200 bg-slate-100 text-slate-500',
};

export default function PartnerUsersPanel() {
  const [data, setData] = useState<PartnerUsersRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PartnerUserRole>('editor');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/partner/users', { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No pudimos leer los usuarios de tu cuenta.');
        return;
      }
      setData(body.data as PartnerUsersRead);
      setError(null);
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const target = email.trim();
    if (!target) return;

    setBusy('invite');
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/partner/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target, role }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudo enviar la invitación.');
        return;
      }

      setEmail('');
      // El correo puede no haber salido (falta la clave de Resend): la
      // invitación existe y el acceso también, así que se dice exactamente eso.
      setNotice(
        body.email?.sent
          ? `Invitación enviada a ${target}.`
          : `Invitación guardada y acceso creado para ${target}, pero el correo no salió${
              body.email?.error ? ` (${body.email.error})` : ''
            }. Puedes reenviarla desde el enlace de acceso del panel.`
      );
      await load();
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setBusy(null);
    }
  }

  async function mutate(user: PartnerUser, action: 'role' | 'revoke' | 'reactivate', nextRole?: PartnerUserRole) {
    setBusy(user.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/partner/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, action, ...(nextRole ? { role: nextRole } : {}) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudo actualizar el usuario.');
        return;
      }
      await load();
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setBusy(null);
    }
  }

  const capacity = data?.capacity;
  const full = !!capacity?.full;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Users className="h-4 w-4 text-slate-400" />
          Usuarios
        </h2>
        {capacity && (
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              full ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {capacity.used} de {capacity.limit} usados
            {full ? ' · plan completo' : ` · ${capacity.remaining} disponible${capacity.remaining === 1 ? '' : 's'}`}
          </span>
        )}
      </div>

      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-500">
        Cada usuario entra con su propio correo y ve las publicaciones de la empresa. El titular es
        tu cuenta, la que quedó vinculada al alta, y no se puede dar de baja desde acá.
      </p>

      {data?.warning && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {data.warning}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando usuarios…
        </div>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-slate-100">
            {(data?.users ?? []).map((user) => (
              <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
                    {user.isOwner && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    {user.email}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {user.isOwner ? 'Titular de la cuenta' : ROLE_LABELS[user.role]}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[user.status]}`}
                  >
                    {STATUS_LABELS[user.status]}
                  </span>

                  {!user.isOwner && (
                    <>
                      <select
                        value={user.role}
                        disabled={busy === user.id || user.status === 'revocado'}
                        onChange={(event) =>
                          void mutate(user, 'role', event.target.value as PartnerUserRole)
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                        aria-label={`Rol de ${user.email}`}
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {ROLE_LABELS[option]}
                          </option>
                        ))}
                      </select>

                      {user.status === 'revocado' ? (
                        <button
                          type="button"
                          disabled={busy === user.id || full}
                          onClick={() => void mutate(user, 'reactivate')}
                          title={full ? 'El plan no tiene lugar libre' : 'Devolver el acceso'}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                        >
                          <RotateCcw className="h-3 w-3" /> Reactivar
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy === user.id}
                          onClick={() => void mutate(user, 'revoke')}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
                        >
                          <UserX className="h-3 w-3" /> Dar de baja
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <form onSubmit={invite} className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold text-slate-800">Sumar a alguien del equipo</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Le llega un correo con un enlace de un solo uso. Queda como invitado hasta que entra.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="correo@empresa.cl"
                disabled={full || busy === 'invite' || !!data?.migrationPending}
                className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:opacity-50"
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as PartnerUserRole)}
                disabled={full || busy === 'invite' || !!data?.migrationPending}
                className="rounded-lg border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                aria-label="Rol del invitado"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={full || busy === 'invite' || !!data?.migrationPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40"
              >
                {busy === 'invite' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MailPlus className="h-3.5 w-3.5" />
                )}
                Invitar
              </button>
            </div>
            {full && (
              <p className="mt-2 text-[11px] font-semibold text-amber-800">
                Tu plan no tiene lugares libres. Da de baja a alguien para invitar a otra persona.
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}
