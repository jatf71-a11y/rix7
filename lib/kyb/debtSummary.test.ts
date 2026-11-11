import { describe, expect, it } from 'vitest';

import { debtSummary } from './debtSummary';
import type { DebtReportAnalysis } from './debtReport';

function analysis(overrides: Partial<DebtReportAnalysis> = {}): DebtReportAnalysis {
  return {
    read: true,
    issuedAt: '2026-11-07',
    rut: '76.543.210-3',
    debtor: 'Catedral Propiedades SpA',
    totalDebtClp: 1_234_567,
    creditors: 3,
    currentClp: 1_234_567,
    overdueClp: 0,
    writtenOffClp: 0,
    summary: 'Sin deuda impaga.',
    notes: [],
    ...overrides,
  };
}

const NOW = new Date('2026-11-10T12:00:00.000Z');

describe('debtSummary', () => {
  it('sin informe no hay resumen', () => {
    expect(debtSummary(null, NOW)).toBeNull();
  });

  it('un informe limpio muestra total, impaga en cero y la fecha de emisión', () => {
    const summary = debtSummary(analysis(), NOW);

    expect(summary?.tone).toBe('clean');
    expect(summary?.total).toBe('$1.234.567');
    expect(summary?.overdue).toBe('$0');
    expect(summary?.issuedOn).toBe('07-11-2026');
    expect(summary?.outdated).toBe(false);
  });

  it('la deuda impaga o castigada advierte', () => {
    expect(debtSummary(analysis({ overdueClp: 250_000 }), NOW)?.tone).toBe('warning');
    expect(debtSummary(analysis({ writtenOffClp: 90_000 }), NOW)?.tone).toBe('warning');
    // La deuda vigente sola no advierte: un crédito es normal.
    expect(debtSummary(analysis({ currentClp: 900_000 }), NOW)?.tone).toBe('clean');
  });

  it('un informe de más de 30 días advierte aunque no haya mora', () => {
    const summary = debtSummary(analysis({ issuedAt: '2026-09-01' }), NOW);

    expect(summary?.tone).toBe('warning');
    expect(summary?.outdated).toBe(true);
    expect(summary?.issuedOn).toBe('01-09-2026');
  });

  it('un PDF sin texto o sin montos queda en «sin dato», no en cero', () => {
    const sinTexto = debtSummary(analysis({ read: false }), NOW);
    expect(sinTexto?.tone).toBe('unknown');
    expect(sinTexto?.total).toBe('sin dato');

    const sinMontos = debtSummary(analysis({ totalDebtClp: null, overdueClp: null }), NOW);
    expect(sinMontos?.tone).toBe('unknown');
    expect(sinMontos?.total).toBe('sin dato');
  });

  it('sin fecha legible lo dice en vez de inventar una', () => {
    expect(debtSummary(analysis({ issuedAt: null }), NOW)?.issuedOn).toBe('sin fecha');
  });
});
