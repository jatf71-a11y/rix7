import { describe, expect, it } from 'vitest';

import { buildPartnerEngagement } from './partnerEngagement';
import type { Lead } from './leads';
import type { ShareEvent } from './shareEvents';
import type { ShareView } from './shareViews';

/** Instante fijo para que la ventana no dependa del reloj del CI. */
const NOW = new Date('2026-10-20T12:00:00Z');

const view = (
  propertyId: string,
  day: string,
  views = 1,
  partnerId = 'catedral'
): ShareView => ({ propertyId, day, partnerId, views });

const share = (
  id: string,
  propertyId: string,
  createdAt: string,
  channel: ShareEvent['channel'] = 'whatsapp'
): ShareEvent => ({
  id,
  propertyId,
  partnerId: 'catedral',
  channel,
  source: 'ficha',
  name: 'Ana Pérez',
  email: 'ana@example.com',
  phone: null,
  shareUrl: 'https://rix7.cl/compartir/p1',
  createdAt,
});

const lead = (overrides: Partial<Lead> & { id: string; createdAt: string }): Lead => ({
  propertyId: 'p1',
  partnerId: 'catedral',
  name: 'Bruno Díaz',
  email: 'bruno@example.com',
  phone: '+56911111111',
  channel: 'form',
  source: 'landing',
  message: null,
  ...overrides,
});

describe('buildPartnerEngagement — ventana y totales', () => {
  it('suma compartidos, aperturas y contactos de la ventana', () => {
    const report = buildPartnerEngagement(
      {
        views: [view('p1', '2026-10-19', 4), view('p2', '2026-10-18', 2)],
        leads: [lead({ id: 'l1', createdAt: '2026-10-19T15:00:00Z' })],
        events: [
          share('e1', 'p1', '2026-10-19T10:00:00Z'),
          share('e2', 'p1', '2026-10-19T11:00:00Z', 'copy'),
          share('e3', 'p2', '2026-10-18T09:00:00Z', 'share'),
        ],
      },
      { days: 30, now: NOW }
    );

    expect(report.since).toBe('2026-09-21');
    expect(report.totals).toMatchObject({
      shares: 3,
      views: 6,
      contacts: 1,
      properties: 2,
    });
    // 1 contacto / 3 compartidos.
    expect(report.totals.conversion).toBeCloseTo(1 / 3);
  });

  it('deja fuera de las tablas lo anterior a la ventana', () => {
    const report = buildPartnerEngagement(
      {
        views: [view('p1', '2026-08-01', 10)],
        leads: [lead({ id: 'viejo', createdAt: '2026-08-01T10:00:00Z' })],
        events: [share('viejo', 'p1', '2026-08-01T09:00:00Z')],
      },
      { days: 7, now: NOW }
    );

    expect(report.totals).toMatchObject({ shares: 0, views: 0, contacts: 0 });
    expect(report.byLink).toEqual([]);
    expect(report.recentShares).toEqual([]);
  });

  it('sin compartidos la conversión es null, no 0 %', () => {
    const report = buildPartnerEngagement(
      {
        views: [view('p1', '2026-10-19', 5)],
        leads: [lead({ id: 'l1', createdAt: '2026-10-19T12:00:00Z' })],
        events: [],
      },
      { days: 30, now: NOW }
    );

    expect(report.totals.conversion).toBeNull();
    expect(report.byLink[0]).toMatchObject({ shares: 0, views: 5, contacts: 1, conversion: null });
    expect(report.byChannel).toEqual([]);
  });
});

describe('buildPartnerEngagement — por enlace', () => {
  it('ordena por contactos y luego por compartidos', () => {
    const report = buildPartnerEngagement(
      {
        views: [],
        leads: [
          lead({ id: 'l1', propertyId: 'p1', createdAt: '2026-10-19T12:00:00Z' }),
          lead({ id: 'l2', propertyId: 'p2', createdAt: '2026-10-19T12:10:00Z' }),
          lead({ id: 'l3', propertyId: 'p2', createdAt: '2026-10-19T12:20:00Z' }),
        ],
        events: [
          share('e1', 'p1', '2026-10-19T09:00:00Z'),
          share('e2', 'p2', '2026-10-19T09:00:00Z'),
          share('e3', 'p2', '2026-10-19T09:30:00Z'),
        ],
      },
      { days: 30, now: NOW }
    );

    expect(report.byLink.map((row) => row.propertyId)).toEqual(['p2', 'p1']);
    expect(report.byLink[0]).toMatchObject({ shares: 2, contacts: 2, conversion: 1 });
    expect(report.byLink[1]).toMatchObject({ shares: 1, contacts: 1, conversion: 1 });
  });

  it('incluye la propiedad con aperturas aunque no tenga contactos', () => {
    const report = buildPartnerEngagement(
      {
        views: [view('p9', '2026-10-19', 3)],
        leads: [],
        events: [share('e1', 'p9', '2026-10-19T10:00:00Z')],
      },
      { days: 30, now: NOW }
    );

    expect(report.byLink).toEqual([
      { propertyId: 'p9', shares: 1, views: 3, contacts: 0, conversion: 0 },
    ]);
  });
});

describe('buildPartnerEngagement — atribución por canal (último toque)', () => {
  it('atribuye el contacto al compartido más reciente anterior a su alta', () => {
    const report = buildPartnerEngagement(
      {
        views: [],
        leads: [lead({ id: 'l1', createdAt: '2026-10-19T13:00:00Z' })],
        events: [
          share('e1', 'p1', '2026-10-19T10:00:00Z', 'whatsapp'),
          share('e2', 'p1', '2026-10-19T12:00:00Z', 'copy'),
        ],
      },
      { days: 30, now: NOW }
    );

    expect(report.byChannel).toEqual([
      { channel: 'whatsapp', shares: 1, contacts: 0, conversion: 0 },
      { channel: 'copy', shares: 1, contacts: 1, conversion: 1 },
    ]);
    expect(report.totals).toMatchObject({ attributedContacts: 1, unattributedContacts: 0 });
  });

  it('no atribuye un contacto anterior al primer compartido del enlace', () => {
    const report = buildPartnerEngagement(
      {
        views: [],
        leads: [lead({ id: 'l1', createdAt: '2026-10-19T09:00:00Z' })],
        events: [share('e1', 'p1', '2026-10-19T10:00:00Z')],
      },
      { days: 30, now: NOW }
    );

    expect(report.byChannel[0]).toMatchObject({ channel: 'whatsapp', contacts: 0 });
    expect(report.totals).toMatchObject({ attributedContacts: 0, unattributedContacts: 1 });
  });

  it('un compartido futuro no explica un contacto pasado', () => {
    const report = buildPartnerEngagement(
      {
        views: [],
        leads: [lead({ id: 'l1', createdAt: '2026-10-19T09:00:00Z' })],
        events: [share('e1', 'p1', '2026-10-19T11:00:00Z')],
      },
      { days: 30, now: NOW }
    );

    expect(report.totals.unattributedContacts).toBe(1);
    expect(report.byChannel[0]?.contacts).toBe(0);
  });

  it('un compartido de otro enlace no atribuye el contacto', () => {
    const report = buildPartnerEngagement(
      {
        views: [],
        leads: [lead({ id: 'l1', propertyId: 'p2', createdAt: '2026-10-19T13:00:00Z' })],
        events: [share('e1', 'p1', '2026-10-19T10:00:00Z')],
      },
      { days: 30, now: NOW }
    );

    expect(report.totals.unattributedContacts).toBe(1);
    expect(report.byChannel[0]?.contacts).toBe(0);
  });

  it('un compartido fuera de la ventana todavía puede atribuir un contacto dentro', () => {
    // El enlace se mandó una vez hace dos meses y el interesado apareció esta
    // semana: el contacto es de la ventana y el canal que lo movió sigue siendo
    // el mismo.
    const report = buildPartnerEngagement(
      {
        views: [],
        leads: [lead({ id: 'l1', createdAt: '2026-10-19T13:00:00Z' })],
        events: [share('e1', 'p1', '2026-08-01T10:00:00Z', 'whatsapp')],
      },
      { days: 7, now: NOW }
    );

    expect(report.totals.shares).toBe(0);
    expect(report.totals).toMatchObject({ attributedContacts: 1, unattributedContacts: 0 });
  });

  it('los contactos sin propiedad quedan sin atribuir', () => {
    const report = buildPartnerEngagement(
      {
        views: [],
        leads: [lead({ id: 'l1', propertyId: null, createdAt: '2026-10-19T13:00:00Z' })],
        events: [share('e1', 'p1', '2026-10-19T10:00:00Z')],
      },
      { days: 30, now: NOW }
    );

    expect(report.totals.unattributedContacts).toBe(1);
  });
});

describe('buildPartnerEngagement — desgloses y listas', () => {
  it('cuenta canales de contacto y superficie de origen', () => {
    const report = buildPartnerEngagement(
      {
        views: [],
        leads: [
          lead({ id: 'l1', createdAt: '2026-10-19T12:00:00Z', channel: 'whatsapp', source: 'landing' }),
          lead({ id: 'l2', createdAt: '2026-10-19T12:10:00Z', channel: 'whatsapp', source: 'ficha' }),
          lead({ id: 'l3', createdAt: '2026-10-19T12:20:00Z', channel: 'call', source: 'landing' }),
        ],
        events: [],
      },
      { days: 30, now: NOW }
    );

    expect(report.contactChannels).toEqual([
      { channel: 'form', count: 0 },
      { channel: 'call', count: 1 },
      { channel: 'whatsapp', count: 2 },
      { channel: 'mail', count: 0 },
    ]);
    expect(report.contactSources).toEqual([
      { source: 'ficha', count: 1 },
      { source: 'landing', count: 2 },
      { source: 'panel', count: 0 },
    ]);
  });

  it('devuelve los movimientos de la ventana del más reciente al más antiguo', () => {
    const report = buildPartnerEngagement(
      {
        views: [],
        leads: [
          lead({ id: 'l1', createdAt: '2026-10-19T12:00:00Z' }),
          lead({ id: 'l2', createdAt: '2026-10-20T08:00:00Z' }),
        ],
        events: [
          share('e1', 'p1', '2026-10-18T10:00:00Z'),
          share('e2', 'p1', '2026-10-19T18:00:00Z'),
        ],
      },
      { days: 30, now: NOW }
    );

    expect(report.recentShares.map((event) => event.id)).toEqual(['e2', 'e1']);
    expect(report.recentContacts.map((contact) => contact.id)).toEqual(['l2', 'l1']);
  });
});
