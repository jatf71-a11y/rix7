import { describe, it, expect } from 'vitest';

import {
  DEBT_OVERDUE_RISK_CLP,
  debtReportDebtFinding,
  debtRisk,
  type DebtReportAnalysis,
} from './debtReport';

/**
 * La política de riesgo es lo que decide si un registro con deuda se acepta
 * solo o queda para revisión. Se prueba el límite exacto y las dos formas de
 * superarlo —mora grande y castigada— porque un `>` mal puesto deja pasar justo
 * el caso que se quería frenar.
 */

const analysis = (overrides: Partial<DebtReportAnalysis> = {}): DebtReportAnalysis => ({
  read: true,
  issuedAt: '2026-11-01',
  rut: '12.345.678-5',
  debtor: 'ANA PÉREZ SOTO',
  totalDebtClp: 1_000_000,
  creditors: 1,
  currentClp: 1_000_000,
  overdueClp: 0,
  writtenOffClp: 0,
  summary: '',
  notes: [],
  ...overrides,
});

describe('debtRisk', () => {
  it('sin mora no hay riesgo, aunque haya deuda vigente', () => {
    expect(debtRisk(analysis())).toEqual({ risk: 'none', detail: null });
    // Un crédito hipotecario es deuda, no mora.
    expect(debtRisk(analysis({ currentClp: 80_000_000, totalDebtClp: 80_000_000 })).risk).toBe(
      'none'
    );
  });

  it('la mora por debajo del máximo se advierte y no frena', () => {
    expect(debtRisk(analysis({ overdueClp: 1 })).risk).toBe('watch');
    expect(debtRisk(analysis({ overdueClp: DEBT_OVERDUE_RISK_CLP })).risk).toBe('watch');
  });

  it('la mora por encima del máximo frena el registro', () => {
    const risk = debtRisk(analysis({ overdueClp: DEBT_OVERDUE_RISK_CLP + 1 }));

    expect(risk.risk).toBe('block');
    expect(risk.detail).toContain('supera el máximo');
  });

  it('cualquier deuda castigada frena, aunque la mora sea cero', () => {
    const risk = debtRisk(analysis({ overdueClp: 0, writtenOffClp: 1 }));

    expect(risk.risk).toBe('block');
    expect(risk.detail).toContain('castigada');
  });

  it('un PDF sin texto no afirma riesgo ni ausencia de riesgo', () => {
    expect(debtRisk(analysis({ read: false, overdueClp: 90_000_000 }))).toEqual({
      risk: 'none',
      detail: null,
    });
  });
});

describe('debtReportDebtFinding con la política aplicada', () => {
  it('la mora sobre el máximo deja la verificación en rojo y sin pregunta', () => {
    const finding = debtReportDebtFinding(analysis({ overdueClp: 27_042_540 }));

    expect(finding.status).toBe('fail');
    expect(finding.detail).toContain('Riesgo de crédito');
    expect(finding.detail).toContain('revisión del equipo');
    // No hay nada que la persona pueda responder: el documento se corrige
    // subiendo otro, y el caso lo decide el equipo.
    expect(finding.question).toBeUndefined();
  });

  it('la deuda castigada también queda en rojo', () => {
    expect(debtReportDebtFinding(analysis({ writtenOffClp: 3_500_000 })).status).toBe('fail');
  });

  it('la mora chica sigue advirtiendo y pidiendo una explicación', () => {
    const finding = debtReportDebtFinding(analysis({ overdueClp: 1_200_000 }));

    expect(finding.status).toBe('warn');
    expect(finding.detail).toContain('impaga');
    expect(finding.question).toBeTruthy();
  });

  it('un informe limpio pasa', () => {
    const finding = debtReportDebtFinding(analysis({ overdueClp: 0, writtenOffClp: 0 }));

    expect(finding.status).toBe('pass');
  });
});
