'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CalendarClock, CreditCard, Loader2 } from 'lucide-react';

import { formatPlanPrice } from '@/lib/kyb/plans';
import type { PartnerAccount } from '@/lib/data/partnerAccount';
import MfaPanel from './MfaPanel';
import PartnerUsersPanel from './PartnerUsersPanel';

/**
 * Mi cuenta: la suscripción que el socio está pagando.
 *
 * El alta define el plan y la cantidad de usuarios, y la persona tiene que poder
 * ver eso sin preguntar. La pantalla muestra los montos vigentes de **Planes**
 * —no los de la propuesta—, desde cuándo está activa, hasta cuándo corre el
 * período y cuántos usuarios entran. El CCA va aparte, en su propia tarjeta del
 * panel de publicaciones: son dos conceptos distintos de la misma factura.
 *
 * La gestión de usuarios es la pieza que sigue: acá se muestra el cupo real del
 * plan y el estado vacío, para no prometer una pantalla que todavía no existe.
 */

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function CuentaPage() {
  const [account, setAccount] = useState<PartnerAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/partner/account', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !body?.success) {
          setError(body?.error ?? 'No pudimos leer tu cuenta.');
          return;
        }
        setAccount(body.data as PartnerAccount);
      })
      .catch(() => {
        if (!cancelled) setError('Sin conexión con el servidor.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando tu cuenta…
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="max-w-4xl">
        <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6">
          <h1 className="text-lg font-black text-slate-900">Mi cuenta</h1>
          <p className="mt-2 text-sm text-slate-600">{error ?? 'No encontramos tu suscripción.'}</p>
          <Link
            href="/socio"
            className="mt-4 inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Volver a mis publicaciones
          </Link>
        </div>
        {/* La seguridad no depende de tener una suscripción legible: si la
            lectura falla, el 2FA se sigue pudiendo activar desde acá. */}
        <MfaPanel />
      </div>
    );
  }

  const active = account.status === 'Operando' && account.panelEnabled;

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Mi cuenta</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tu suscripción, el estado del alta y los usuarios que incluye tu plan.
        </p>
      </div>

      {account.warning && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {account.warning}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <CreditCard className="h-4 w-4 text-slate-400" />
            Suscripción
          </h2>
          <p className="mt-3 text-xl font-black text-slate-900">
            {account.planName ?? 'Sin plan asignado'}
          </p>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Alta inicial</dt>
              <dd className="font-bold text-slate-900">
                {account.altaClp === null ? '—' : formatPlanPrice(account.altaClp)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Mensualidad</dt>
              <dd className="font-bold text-slate-900">
                {account.monthlyClp === null ? '—' : formatPlanPrice(account.monthlyClp)}
                <span className="ml-1 text-[11px] font-medium text-slate-400">/mes</span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Facturación</dt>
              <dd className="font-semibold text-slate-700">{account.billing}, sin prorrateo</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Usuarios incluidos</dt>
              <dd className="font-bold text-slate-900">{account.usersIncluded ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
            El CCA se factura todos los meses junto a tu mensualidad, sobre tu cartera de
            publicaciones, y lo ves en la tarjeta
            «Tu CCA» del panel de publicaciones.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <BadgeCheck className="h-4 w-4 text-slate-400" />
            Estado del alta
          </h2>
          <p className="mt-3">
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                active
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {account.status}
            </span>
          </p>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Panel</dt>
              <dd className="font-semibold text-slate-700">
                {account.panelEnabled ? 'Habilitado' : 'Pendiente'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Fecha de alta</dt>
              <dd className="font-semibold text-slate-700">{formatDate(account.activatedAt)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="flex items-center gap-1 text-slate-500">
                <CalendarClock className="h-3 w-3" /> Primer período
              </dt>
              <dd className="font-semibold text-slate-700">
                hasta {formatDate(account.periodEndsAt)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Cobro del CCA</dt>
              <dd className="font-semibold text-slate-700">
                {account.ccaAuthorizedAt
                  ? `Autorizado el ${formatDate(account.ccaAuthorizedAt)}`
                  : 'Sin autorizar'}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <MfaPanel />

      <PartnerUsersPanel />
    </div>
  );
}
