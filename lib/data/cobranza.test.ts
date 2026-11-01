import { describe, it, expect } from 'vitest';

import {
  BILLING_DUE_DAY,
  BILLING_GRACE_DAYS,
  SITUACION_LABELS,
  currentPeriod,
  dueDateFor,
  isValidPeriod,
  normalizePago,
  periodLabel,
  periodState,
  situacionDe,
  type BillingPeriod,
} from './cobranza';

/**
 * Reglas de la cobranza.
 *
 * Los bordes que se prueban acá son los que se rompen en silencio: el día de
 * gracia (un pago del 11 no es deuda), el cambio de año y la diferencia entre
 * «vencido» —un hecho de la base— y «moroso» —una decisión del equipo—.
 */

const today = new Date('2026-11-15T12:00:00Z');

function pago(overrides: Partial<BillingPeriod> = {}): BillingPeriod {
  return {
    partnerId: 'catedral',
    period: '2026-11',
    amountClp: 19990,
    dueDate: '2026-11-10',
    paidAt: null,
    note: null,
    ...overrides,
  };
}

describe('períodos', () => {
  it('el período en curso sale del mes de la fecha', () => {
    expect(currentPeriod(new Date('2026-11-15T12:00:00Z'))).toBe('2026-11');
    expect(currentPeriod(new Date('2027-01-02T00:00:00Z'))).toBe('2027-01');
  });

  it('valida el formato y los meses imposibles', () => {
    expect(isValidPeriod('2026-11')).toBe(true);
    expect(isValidPeriod('2026-1')).toBe(false);
    expect(isValidPeriod('2026-13')).toBe(false);
    expect(isValidPeriod('noviembre')).toBe(false);
    expect(isValidPeriod(null)).toBe(false);
  });

  it('el vencimiento es el día fijo del mes del período', () => {
    expect(dueDateFor('2026-11')).toBe(`2026-11-${String(BILLING_DUE_DAY).padStart(2, '0')}`);
    expect(dueDateFor('2026-11')).toBe('2026-11-10');
  });

  it('el período se lee en castellano', () => {
    expect(periodLabel('2026-11')).toBe('noviembre de 2026');
    expect(periodLabel('2026-01')).toBe('enero de 2026');
    expect(periodLabel('raro')).toBe('raro');
  });
});

describe('estado de un período', () => {
  it('con pago, está pagado aunque haya vencido hace meses', () => {
    expect(periodState(pago({ paidAt: '2026-11-09T12:00:00Z' }), today)).toBe('pagado');
  });

  it('dentro de la gracia todavía no es deuda', () => {
    // Vence el 10 y hoy es 15: con 5 días de gracia, el 15 es el último día.
    expect(periodState(pago(), today)).toBe('pendiente');
    const unDiaDespues = new Date('2026-11-16T12:00:00Z');
    expect(periodState(pago(), unDiaDespues)).toBe('vencido');
    expect(BILLING_GRACE_DAYS).toBe(5);
  });
});

describe('situación del socio', () => {
  it('sin períodos facturados no se lo puede declarar al día', () => {
    const situacion = situacionDe({ periods: [], moroso: false, today });
    expect(situacion.estado).toBe('sin_facturar');
    expect(situacion.deudaClp).toBe(0);
  });

  it('con el período del mes pagado está al día', () => {
    const situacion = situacionDe({
      periods: [pago({ paidAt: '2026-11-05T12:00:00Z' })],
      moroso: false,
      today,
    });
    expect(situacion.estado).toBe('al_dia');
    expect(situacion.deudaClp).toBe(0);
    expect(situacion.proximoVencimiento).toBeNull();
  });

  it('con el período del mes impago pero en plazo, está por vencer', () => {
    const situacion = situacionDe({ periods: [pago()], moroso: false, today });
    expect(situacion.estado).toBe('por_vencer');
    expect(situacion.deudaClp).toBe(19990);
    expect(situacion.proximoVencimiento).toBe('2026-11-10');
  });

  it('pasada la gracia está vencido y suma la deuda de todos los impagos', () => {
    const situacion = situacionDe({
      periods: [
        pago({ period: '2026-09', dueDate: '2026-09-10' }),
        pago({ period: '2026-10', dueDate: '2026-10-10', amountClp: 10000 }),
        pago({ paidAt: '2026-08-05T12:00:00Z', period: '2026-08', dueDate: '2026-08-10' }),
      ],
      moroso: false,
      today,
    });

    expect(situacion.estado).toBe('vencido');
    expect(situacion.periodosVencidos).toEqual(['2026-09', '2026-10']);
    expect(situacion.deudaClp).toBe(19990 + 10000);
    // El vencimiento más viejo es al que hay que ir a mirar.
    expect(situacion.proximoVencimiento).toBe('2026-09-10');
  });

  it('la morosidad confirmada manda sobre el cálculo de fechas', () => {
    const situacion = situacionDe({
      periods: [pago({ paidAt: '2026-11-05T12:00:00Z' })],
      moroso: true,
      today,
    });
    expect(situacion.estado).toBe('moroso');
    // La deuda igual se informa: en este caso, ninguna.
    expect(situacion.deudaClp).toBe(0);
  });
});

describe('registro de un pago', () => {
  it('acepta un período válido con monto entero', () => {
    const result = normalizePago({ period: '2026-11', amountClp: 19990 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ period: '2026-11', amountClp: 19990, note: null });
  });

  it('rechaza un período que no es un mes', () => {
    const result = normalizePago({ period: '2026-13', amountClp: 19990 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/AAAA-MM/);
  });

  it('rechaza montos vacíos, decimales, cero o negativos', () => {
    for (const amountClp of [undefined, ' ', 1.5, 0, -100]) {
      expect(normalizePago({ period: '2026-11', amountClp }).ok).toBe(false);
    }
  });

  it('la nota vacía queda en null, no en cadena vacía', () => {
    const result = normalizePago({ period: '2026-11', amountClp: 1000, note: '   ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.note).toBeNull();
  });
});

describe('etiquetas', () => {
  it('cada situación tiene su texto', () => {
    expect(SITUACION_LABELS.moroso).toBe('Moroso');
    expect(SITUACION_LABELS.al_dia).toBe('Al día');
    expect(SITUACION_LABELS.por_vencer).toBe('Por vencer');
  });
});
