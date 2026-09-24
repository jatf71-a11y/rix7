import { describe, it, expect } from 'vitest';
import {
  buildShareReport,
  contactRate,
  rowToShareView,
  utcDay,
  windowStartDay,
  type ShareView,
} from './shareViews';

/** Instante fijo: sin esto el informe cambia de resultado según el día real. */
const NOW = new Date('2026-09-23T15:00:00.000Z');

const view = (over: Partial<ShareView> = {}): ShareView => ({
  propertyId: 'scl-depto-marco-polo',
  day: '2026-09-23',
  partnerId: 'catedral',
  views: 1,
  ...over,
});

const lead = (over: Partial<{ propertyId: string | null; partnerId: string | null; createdAt: string }> = {}) => ({
  propertyId: 'scl-depto-marco-polo',
  partnerId: 'catedral',
  createdAt: '2026-09-23T12:00:00.000Z',
  ...over,
});

describe('utcDay', () => {
  it('devuelve el día UTC, no el local', () => {
    // 23:30 en Chile (UTC-4) ya es el día siguiente en UTC, y la base guarda el
    // día UTC: si esto usara la fecha local, los bordes no coincidirían.
    expect(utcDay('2026-09-23T23:30:00-04:00')).toBe('2026-09-24');
  });

  it('devuelve cadena vacía con una fecha inválida', () => {
    expect(utcDay('no-es-una-fecha')).toBe('');
  });
});

describe('windowStartDay', () => {
  it('cuenta hoy dentro de la ventana', () => {
    expect(windowStartDay(30, NOW)).toBe('2026-08-25'); // 23/09 - 29 días
    expect(windowStartDay(1, NOW)).toBe('2026-09-23');
  });

  it('no acepta ventanas de cero o negativas', () => {
    expect(windowStartDay(0, NOW)).toBe('2026-09-23');
    expect(windowStartDay(-5, NOW)).toBe('2026-09-23');
  });
});

describe('contactRate', () => {
  it('es null sin aperturas: no se puede calcular, no es cero', () => {
    expect(contactRate(0, 0)).toBeNull();
    expect(contactRate(3, 0)).toBeNull();
  });

  it('es cero cuando hubo aperturas y ningún contacto', () => {
    expect(contactRate(0, 50)).toBe(0);
  });

  it('divide contactos por aperturas', () => {
    expect(contactRate(5, 20)).toBe(0.25);
  });
});

describe('rowToShareView', () => {
  it('descarta filas sin propiedad o sin día', () => {
    expect(rowToShareView({ property_id: null, day: '2026-09-23', partner_id: null, views: 1 })).toBeNull();
    expect(rowToShareView({ property_id: 'x', day: null, partner_id: null, views: 1 })).toBeNull();
  });

  it('normaliza el día a 10 caracteres y el contador a número', () => {
    const result = rowToShareView({
      property_id: 'p',
      day: '2026-09-23T00:00:00+00:00',
      partner_id: 'catedral',
      views: '7' as unknown as number,
    });
    expect(result).toEqual({ propertyId: 'p', day: '2026-09-23', partnerId: 'catedral', views: 7 });
  });

  it('nunca devuelve un contador negativo', () => {
    const result = rowToShareView({ property_id: 'p', day: '2026-09-23', partner_id: null, views: -4 });
    expect(result?.views).toBe(0);
  });
});

describe('buildShareReport', () => {
  it('agrupa por corredora y suma las aperturas de todos los días', () => {
    const report = buildShareReport(
      [
        view({ day: '2026-09-23', views: 3 }),
        view({ day: '2026-09-22', views: 2 }),
      ],
      [],
      { now: NOW }
    );

    expect(report.partners).toHaveLength(1);
    expect(report.partners[0]).toMatchObject({ partnerId: 'catedral', views: 5, viewsTotal: 5 });
  });

  it('deja fuera de la ventana lo viejo, sin perder el total histórico', () => {
    const report = buildShareReport(
      [
        view({ day: '2026-09-23', views: 4 }),
        view({ day: '2026-01-05', views: 100 }),
      ],
      [],
      { now: NOW, days: 30 }
    );

    const row = report.partners[0];
    expect(row.views).toBe(4);
    expect(row.viewsTotal).toBe(104);
    // El «último día con aperturas» es histórico: responde «¿alguna vez se abrió?».
    expect(row.lastViewDay).toBe('2026-09-23');
  });

  it('cruza los contactos de la corredora con sus aperturas', () => {
    const report = buildShareReport(
      [view({ views: 40 })],
      [lead(), lead({ createdAt: '2026-09-20T10:00:00.000Z' })],
      { now: NOW }
    );

    expect(report.partners[0].contacts).toBe(2);
    expect(report.partners[0].contactRate).toBeCloseTo(2 / 40);
    expect(report.totals.contactRate).toBeCloseTo(2 / 40);
  });

  it('no cuenta los contactos fuera de la ventana, pero sí en el total', () => {
    const report = buildShareReport([view({ views: 10 })], [lead({ createdAt: '2026-06-01T10:00:00.000Z' })], {
      now: NOW,
    });

    expect(report.partners[0].contacts).toBe(0);
    expect(report.partners[0].contactsTotal).toBe(1);
    expect(report.partners[0].contactRate).toBe(0);
  });

  it('agrupa bajo "sin corredora" lo que no tiene atribución', () => {
    const report = buildShareReport(
      [view({ partnerId: null, views: 2 })],
      [lead({ partnerId: null })],
      { now: NOW }
    );

    const sinCorredora = report.partners.find((p) => p.partnerId === null);
    expect(sinCorredora).toMatchObject({ views: 2, contacts: 1 });
  });

  it('un contacto sin propiedad cuenta para la corredora, no para un enlace', () => {
    const report = buildShareReport([view({ views: 5 })], [lead({ propertyId: null })], { now: NOW });

    expect(report.partners[0].contacts).toBe(1);
    // La fila de la propiedad se creó por las aperturas, y no se le suma un
    // contacto del que no se sabe de qué propiedad vino.
    expect(report.properties[0].contacts).toBe(0);
  });

  it('no deja que un contacto sin corredora borre la atribución del enlace', () => {
    const report = buildShareReport([view({ views: 3 })], [lead({ partnerId: null })], { now: NOW });

    expect(report.properties[0].partnerId).toBe('catedral');
  });

  it('ordena por aperturas y desempata por contactos', () => {
    const report = buildShareReport(
      [
        view({ partnerId: 'a', views: 10 }),
        view({ partnerId: 'b', views: 10 }),
        view({ partnerId: 'c', views: 1 }),
      ],
      [lead({ partnerId: 'b' })],
      { now: NOW }
    );

    expect(report.partners.map((p) => p.partnerId)).toEqual(['b', 'a', 'c']);
  });

  it('el orden es estable cuando todo empata', () => {
    const views = [view({ partnerId: 'zeta', views: 2 }), view({ partnerId: 'alfa', views: 2 })];
    const first = buildShareReport(views, [], { now: NOW });
    const second = buildShareReport([...views].reverse(), [], { now: NOW });

    expect(first.partners.map((p) => p.partnerId)).toEqual(['alfa', 'zeta']);
    expect(second.partners.map((p) => p.partnerId)).toEqual(['alfa', 'zeta']);
  });

  it('cuenta cuántos enlaces distintos movió cada corredora', () => {
    const report = buildShareReport(
      [
        view({ propertyId: 'p1', views: 5 }),
        view({ propertyId: 'p2', views: 3 }),
        view({ propertyId: 'p2', day: '2026-09-22', views: 1 }),
      ],
      [],
      { now: NOW }
    );

    expect(report.partners[0].properties).toBe(2);
    expect(report.properties.map((p) => p.propertyId)).toEqual(['p1', 'p2']);
    expect(report.properties[1].views).toBe(4);
  });

  it('no existe sin actividad', () => {
    const report = buildShareReport([], [], { now: NOW });

    expect(report.partners).toHaveLength(0);
    expect(report.properties).toHaveLength(0);
    expect(report.totals.views).toBe(0);
    // Sin aperturas el total tampoco puede tener tasa: no es 0 %, es "no hay dato".
    expect(report.totals.contactRate).toBeNull();
    expect(report.windowDays).toBe(30);
    expect(report.since).toBe('2026-08-25');
  });
});
