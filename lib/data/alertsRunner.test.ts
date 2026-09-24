/**
 * @vitest-environment node
 *
 * Tests del job de alertas (`runPropertyAlerts`).
 *
 * Es la pieza con más riesgo del aviso por correo: un error acá significa
 * mandarle a alguien la misma propiedad cada día, o peor, nada y sin que nadie
 * se entere. Se prueba con búsquedas y propiedades **inyectadas** (sin base) y
 * con el correo y el store mockeados, para poder recorrer todas las ramas.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Property } from '@/lib/types/property';
import type { SavedSearch, SavedSearchFilters } from './savedSearches';

const getUserEmail = vi.fn();
const listSearchesToNotify = vi.fn();
const markSearchNotified = vi.fn();
const sendEmail = vi.fn();

vi.mock('./savedSearchesStore', () => ({
  getUserEmail: (...args: unknown[]) => getUserEmail(...args),
  listSearchesToNotify: (...args: unknown[]) => listSearchesToNotify(...args),
  markSearchNotified: (...args: unknown[]) => markSearchNotified(...args),
}));

vi.mock('@/lib/email/sendEmail', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  isEmailConfigured: () => true,
}));

import { runPropertyAlerts } from './alertsRunner';

const SITE = 'https://rix7.cl';

/** Búsqueda base: arriendo de departamentos en Providencia. */
function searchOf(overrides: Partial<SavedSearch> = {}): SavedSearch {
  const filters: SavedSearchFilters = {
    operation: 'for_rent',
    propertyType: 'apartment',
    newPropertyType: null,
    commune: 'Providencia',
    region: null,
    searchQuery: '',
    minPrice: null,
    maxPrice: null,
    minBedrooms: 2,
    minBathrooms: null,
    minPrivates: null,
  };

  return {
    id: 's1',
    userId: 'u1',
    filters,
    label: 'Arriendo · Departamento · en Providencia · 2 dormitorios',
    notify: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    lastNotifiedAt: null,
    ...overrides,
  };
}

function propertyOf(id: string, overrides: Partial<Property> = {}): Property {
  return {
    id,
    title: `Departamento ${id}`,
    description: '',
    price: 700000,
    property_type: 'apartment',
    status: 'for_rent',
    bedrooms: 2,
    bathrooms: 2,
    area_sqm: 60,
    parking_spots: 1,
    address: `Calle ${id} 100`,
    city: 'Providencia',
    images: [],
    features: [],
    lat: -33.43,
    lng: -70.61,
    ...overrides,
  };
}

/** Coincide con `searchOf()` y es más nueva que la línea base. */
const NUEVA = propertyOf('nueva', { created_at: '2026-09-10T00:00:00.000Z' });
/** Coincide, pero ya existía cuando se fijó la línea base. */
const VIEJA = propertyOf('vieja', { created_at: '2026-08-01T00:00:00.000Z' });
/** No coincide: es de otra comuna. */
const OTRA_COMUNA = propertyOf('otra', {
  city: 'Maipú',
  address: 'Av. Maipú 1',
  created_at: '2026-09-10T00:00:00.000Z',
});

beforeEach(() => {
  getUserEmail.mockReset().mockResolvedValue('persona@example.cl');
  listSearchesToNotify.mockReset().mockResolvedValue([]);
  markSearchNotified.mockReset().mockResolvedValue(true);
  sendEmail.mockReset().mockResolvedValue({ sent: true, skipped: false });
});

describe('runPropertyAlerts', () => {
  it('en la primera corrida fija la línea base y no manda correo', async () => {
    const report = await runPropertyAlerts({
      siteUrl: SITE,
      searches: [searchOf()],
      properties: [NUEVA],
    });

    expect(report.entries[0].outcome).toBe('baseline');
    expect(report.sent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    // Marca la fecha aunque no envíe: la persona acaba de ver esos resultados
    // en pantalla, avisarle de lo mismo sería ruido.
    expect(markSearchNotified).toHaveBeenCalledWith('s1', expect.any(Date));
  });

  it('avisa solo de las propiedades publicadas después del último aviso', async () => {
    const report = await runPropertyAlerts({
      siteUrl: SITE,
      searches: [searchOf({ lastNotifiedAt: '2026-09-05T00:00:00.000Z' })],
      properties: [NUEVA, VIEJA, OTRA_COMUNA],
    });

    expect(report.entries[0].outcome).toBe('sent');
    expect(report.entries[0].matched).toBe(1);
    expect(report.sent).toBe(1);

    const [mail] = sendEmail.mock.calls[0];
    expect(mail.to).toBe('persona@example.cl');
    expect(mail.text).toContain('Departamento nueva');
    // La vieja y la de otra comuna no aparecen: el aviso es sobre lo nuevo.
    expect(mail.text).not.toContain('Departamento vieja');
    expect(mail.text).not.toContain('Departamento otra');
    expect(markSearchNotified).toHaveBeenCalledWith('s1', expect.any(Date));
  });

  it('sin novedades no manda correo, pero avanza la fecha', async () => {
    const report = await runPropertyAlerts({
      siteUrl: SITE,
      searches: [searchOf({ lastNotifiedAt: '2026-09-20T00:00:00.000Z' })],
      properties: [NUEVA],
    });

    expect(report.entries[0].outcome).toBe('no-matches');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(markSearchNotified).toHaveBeenCalled();
  });

  it('una propiedad sin fecha de creación no se avisa (no se puede saber si es nueva)', async () => {
    const report = await runPropertyAlerts({
      siteUrl: SITE,
      searches: [searchOf({ lastNotifiedAt: '2026-09-05T00:00:00.000Z' })],
      properties: [propertyOf('sin-fecha')],
    });

    expect(report.entries[0].outcome).toBe('no-matches');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('si no se puede resolver el correo no se avanza la fecha, para reintentar', async () => {
    getUserEmail.mockResolvedValue(null);

    const report = await runPropertyAlerts({
      siteUrl: SITE,
      searches: [searchOf({ lastNotifiedAt: '2026-09-05T00:00:00.000Z' })],
      properties: [NUEVA],
    });

    expect(report.entries[0].outcome).toBe('no-recipient');
    expect(report.sent).toBe(0);
    expect(markSearchNotified).not.toHaveBeenCalled();
  });

  it('si el envío falla no se avanza la fecha: el aviso no se pierde', async () => {
    sendEmail.mockResolvedValue({ sent: false, skipped: false, error: 'Resend respondió 500' });

    const report = await runPropertyAlerts({
      siteUrl: SITE,
      searches: [searchOf({ lastNotifiedAt: '2026-09-05T00:00:00.000Z' })],
      properties: [NUEVA],
    });

    expect(report.entries[0].outcome).toBe('error');
    expect(report.entries[0].detail).toContain('500');
    expect(markSearchNotified).not.toHaveBeenCalled();
  });

  it('distingue "sin proveedor de correo" de un error real', async () => {
    sendEmail.mockResolvedValue({ sent: false, skipped: true, error: 'Falta RESEND_API_KEY' });

    const report = await runPropertyAlerts({
      siteUrl: SITE,
      searches: [searchOf({ lastNotifiedAt: '2026-09-05T00:00:00.000Z' })],
      properties: [NUEVA],
    });

    expect(report.entries[0].outcome).toBe('email-skipped');
    expect(markSearchNotified).not.toHaveBeenCalled();
  });

  it('ignora las búsquedas silenciadas o que no acotan nada', async () => {
    const sinFiltros = searchOf({
      id: 's2',
      notify: true,
      filters: {
        ...searchOf().filters,
        commune: null,
        propertyType: 'all',
        operation: 'all',
        minBedrooms: null,
      },
    });
    const silenciada = searchOf({ id: 's3', notify: false });

    const report = await runPropertyAlerts({
      siteUrl: SITE,
      searches: [sinFiltros, silenciada],
      properties: [NUEVA],
    });

    expect(report.entries.map((e) => e.outcome)).toEqual(['skipped', 'skipped']);
    expect(report.searches).toBe(2);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('usa las búsquedas del store cuando no se inyectan', async () => {
    listSearchesToNotify.mockResolvedValue([searchOf()]);

    const report = await runPropertyAlerts({ siteUrl: SITE, properties: [NUEVA] });

    expect(listSearchesToNotify).toHaveBeenCalled();
    expect(report.searches).toBe(1);
  });

  it('en dry-run informa lo que enviaría sin enviar ni tocar fechas', async () => {
    const report = await runPropertyAlerts({
      siteUrl: SITE,
      dryRun: true,
      searches: [searchOf()],
      properties: [NUEVA, VIEJA],
    });

    // Sin línea base previa, igual reporta: en seco se quiere ver qué saldría hoy.
    expect(report.entries[0].outcome).toBe('sent');
    expect(report.entries[0].detail).toContain('persona@example.cl');
    expect(report.dryRun).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(markSearchNotified).not.toHaveBeenCalled();
  });

  it('el informe cuenta las búsquedas y coincidencias evaluadas', async () => {
    const report = await runPropertyAlerts({
      siteUrl: SITE,
      searches: [searchOf({ lastNotifiedAt: '2026-09-05T00:00:00.000Z' }), searchOf({ id: 's2' })],
      properties: [NUEVA, VIEJA],
    });

    expect(report.searches).toBe(2);
    // Una coincide y se envía; la otra fija línea base y no cuenta coincidencias.
    expect(report.matched).toBe(1);
    expect(report.sent).toBe(1);
    // El total cuadra con el detalle: así el informe se puede leer entero.
    expect(report.matched).toBe(report.entries.reduce((sum, e) => sum + e.matched, 0));
    expect(report.source).toBe('catalog');
    expect(report.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
