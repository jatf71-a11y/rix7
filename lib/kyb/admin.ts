/**
 * Lógica de presentación de la sección de alta en el panel.
 *
 * El panel no decide nada del flujo: muestra el estado y la última evaluación
 * que ya calculó el motor. Lo que sí vive acá es la traducción de ese resultado
 * a algo legible (colores, conteos, fechas deterministas) para poder probarla
 * sin montar la página.
 */

import type { KybCoverage } from './application';
import type { KybCheck, KybStatus } from './status';

export type KybCheckStatus = KybCheck['status'];

export interface KybCheckTone {
  label: string;
  className: string;
}

/** Verde pasa, ámbar advierte, rojo falla. Mismo criterio que el motor. */
export const KYB_CHECK_TONES: Record<KybCheckStatus, KybCheckTone> = {
  pass: { label: 'Pasa', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  warn: { label: 'Advertencia', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
  fail: { label: 'Falla', className: 'bg-red-50 text-red-700 ring-red-100' },
};

export interface KybCheckSummary {
  pass: number;
  warn: number;
  fail: number;
  total: number;
}

export function checkSummary(checks: KybCheck[]): KybCheckSummary {
  const summary: KybCheckSummary = { pass: 0, warn: 0, fail: 0, total: checks.length };
  for (const check of checks) summary[check.status] += 1;
  return summary;
}

/** Puntaje 0..100 → tono. `null` es «todavía no se evaluó», no un cero. */
export function scoreTone(score: number | null): string {
  if (score === null) return 'bg-slate-100 text-slate-500';
  if (score >= 75) return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
  if (score >= 50) return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100';
  return 'bg-red-50 text-red-700 ring-1 ring-red-100';
}

/**
 * ¿Se puede pedir otra corrida del motor?
 *
 * `En_Alta` es terminal: la empresa ya tiene plan y panel, y volver a evaluar
 * solo podría moverla a un estado anterior. El endpoint responde 409 en ese
 * caso; el panel ni siquiera ofrece el botón.
 */
export function canReevaluate(status: KybStatus): boolean {
  return status !== 'En_Alta';
}

/**
 * Fecha determinista en UTC.
 *
 * El panel se renderiza en el servidor y se hidrata en el navegador; dos
 * implementaciones de `Intl` no coinciden en detalles y producen errores de
 * hidratación (el mismo motivo por el que `AdminShell` formatea su release así).
 */
export function formatKybDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Cobertura declarada, en una línea para la ficha del panel. */
export function coverageLabel(coverage: KybCoverage | null, regions: string[]): string {
  if (coverage === 'nacional') return 'Nacional';
  if (coverage === 'regional') {
    return regions.length > 0 ? regions.join(', ') : 'Regional (sin regiones)';
  }
  return 'Sin dato';
}
