/**
 * Lógica de presentación de la sección de alta en el panel.
 *
 * El panel no decide nada del flujo: muestra el estado y la última evaluación
 * que ya calculó el motor. Lo que sí vive acá es la traducción de ese resultado
 * a algo legible (colores, conteos, fechas deterministas) para poder probarla
 * sin montar la página.
 */

import type { KybCoverage } from './application';
import {
  canEvaluate,
  type KybCheck,
  type KybCheckEvidence,
  type KybEvidenceSource,
  type KybStatus,
} from './status';

export type KybCheckStatus = KybCheck['status'];

export interface KybCheckTone {
  label: string;
  className: string;
}

/** Verde OK, ámbar advierte, rojo falla. Mismo criterio que el motor. */
export const KYB_CHECK_TONES: Record<KybCheckStatus, KybCheckTone> = {
  pass: { label: 'OK', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
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
 * Origen de cada verificación, en una línea.
 *
 * Existe por un caso concreto: en producción, sin `KYB_SEARCH_URL`, la
 * advertencia de reputación **no** sale de una búsqueda real, y leer «3 reseñas
 * negativas públicas» sin ese dato es creerle a una simulación. El panel tiene
 * que poder decirlo, y también marcar cuáles de las seis verificaciones solo
 * releen la solicitud en vez de comprobar algo afuera.
 */
export const KYB_EVIDENCE_LABELS: Record<KybEvidenceSource, string> = {
  declared: 'Lo declarado en la solicitud',
  sii: 'Registro del SII',
  search: 'Búsqueda real en la web',
  simulated: 'Simulación local: no hay proveedor externo configurado',
};

/**
 * URL de una mención, solo si es `http(s)`.
 *
 * El enlace lo aporta un proveedor externo y termina en un `href`: un
 * `javascript:` devuelto por el buscador se muestra como texto, no como enlace.
 */
export function evidenceHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function evidenceLabel(evidence: KybCheckEvidence): string {
  return KYB_EVIDENCE_LABELS[evidence.source];
}

/**
 * ¿Se puede pedir otra corrida del motor?
 *
 * Se delega en `canEvaluate` para no tener dos listas de estados válidos: la
 * tabla de transiciones ya dice que solo `Recibida`, `En_Evaluacion` y
 * `Pendiente_Informacion` admiten una corrida, y `En_Alta` y `Rechazada` son
 * terminales. El endpoint responde 409 en esos casos; el panel ni siquiera
 * ofrece el botón.
 */
export function canReevaluate(status: KybStatus): boolean {
  return canEvaluate(status);
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
