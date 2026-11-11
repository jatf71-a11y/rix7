import { describe, expect, it } from 'vitest';
import {
  debtReportDebtFinding,
  debtReportRutFinding,
  type DebtReportAnalysis,
} from './debtReport';

function analysis(overrides: Partial<DebtReportAnalysis> = {}): DebtReportAnalysis {
  return {
    read: true,
    issuedAt: '2026-11-01',
    rut: '76.543.210-3',
    debtor: 'CATEDRAL PROPIEDADES SPA',
    totalDebtClp: 12_000_000,
    creditors: 3,
    currentClp: 12_000_000,
    overdueClp: 0,
    writtenOffClp: 0,
    summary: 'Informe leído',
    notes: [],
    ...overrides,
  };
}

const NOW = new Date('2026-11-10T12:00:00Z');

describe('debtReportRutFinding', () => {
  it('pasa cuando el RUT del informe es el de la solicitud', () => {
    const finding = debtReportRutFinding(
      analysis({ rut: '76543210-3' }),
      '76.543.210-3'
    );

    expect(finding.status).toBe('pass');
    expect(finding.detail).toMatch(/corresponde al RUT/i);
    expect(finding.question).toBeUndefined();
  });

  it('falla cuando el informe es de otro RUT', () => {
    const finding = debtReportRutFinding(analysis({ rut: '12.345.678-5' }), '76.543.210-3');

    expect(finding.status).toBe('fail');
    expect(finding.detail).toMatch(/no corresponde al solicitante/i);
    expect(finding.question).toMatch(/12\.345\.678-5/);
    expect(finding.question).toMatch(/76\.543\.210-3/);
  });

  it('falla si el PDF no tiene texto legible: no se puede comprobar de quién es', () => {
    const finding = debtReportRutFinding(analysis({ read: false, rut: null }), '76.543.210-3');

    expect(finding.status).toBe('fail');
    expect(finding.question).toMatch(/no tiene texto legible/i);
  });

  it('falla si el informe no trae un RUT legible', () => {
    const finding = debtReportRutFinding(analysis({ rut: null }), '76.543.210-3');

    expect(finding.status).toBe('fail');
    expect(finding.detail).toMatch(/no trae un RUT legible/i);
  });
});

describe('debtReportDebtFinding', () => {
  it('pasa con deuda vigente y sin mora ni castigo', () => {
    const finding = debtReportDebtFinding(analysis(), NOW);

    expect(finding.status).toBe('pass');
    expect(finding.detail).toMatch(/sin deuda impaga ni castigada/i);
    expect(finding.facts).toContainEqual({
      label: 'Deuda vigente',
      value: expect.stringContaining('12.000.000'),
    });
  });

  it('advierte por deuda impaga y deja la pregunta', () => {
    const finding = debtReportDebtFinding(
      analysis({ overdueClp: 2_500_000, currentClp: 12_000_000 }),
      NOW
    );

    expect(finding.status).toBe('warn');
    expect(finding.detail).toMatch(/deuda impaga/i);
    expect(finding.question).toMatch(/regularización/i);
  });

  it('advierte por deuda castigada', () => {
    const finding = debtReportDebtFinding(analysis({ writtenOffClp: 900_000 }), NOW);

    expect(finding.status).toBe('warn');
    expect(finding.detail).toMatch(/castigada/i);
  });

  it('advierte cuando el informe ya es viejo, sin invalidarlo', () => {
    const finding = debtReportDebtFinding(analysis({ issuedAt: '2026-08-01' }), NOW);

    expect(finding.status).toBe('warn');
    expect(finding.detail).toMatch(/emitió hace/i);
  });

  it('no da por buena una deuda cuyo desglose de mora no se pudo leer', () => {
    const finding = debtReportDebtFinding(
      analysis({ totalDebtClp: 12_000_000, currentClp: null, overdueClp: null }),
      NOW
    );

    expect(finding.status).toBe('warn');
    expect(finding.detail).toMatch(/desglose de mora/i);
    expect(finding.question).toMatch(/desglose de mora/i);
  });

  it('advierte si se leyó pero no se reconocieron montos', () => {
    const finding = debtReportDebtFinding(
      analysis({ totalDebtClp: null, currentClp: null, creditors: null }),
      NOW
    );

    expect(finding.status).toBe('warn');
    expect(finding.question).toMatch(/no pudimos leer los montos/i);
  });
});
