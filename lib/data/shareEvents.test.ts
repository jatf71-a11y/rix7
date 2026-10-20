import { describe, it, expect } from 'vitest';
import {
  SHARE_LIMITS,
  normalizeShareEvent,
  rowToShareEvent,
  shareChannelLabel,
  shareSourceLabel,
  type ShareEventRow,
} from './shareEvents';

const valido = {
  property_id: 'scl-depto-marco-polo',
  partner_id: 'catedral',
  channel: 'whatsapp',
  source: 'ficha',
  name: 'Ana Prueba',
  email: 'ana.prueba@example.com',
  phone: '+56 9 1111 1111',
  share_url: 'https://rix7.cl/compartir/scl-depto-marco-polo',
};

/** Atajo: el error de validación como string, para leer mejor los asserts. */
function errorOf(input: unknown): string | null {
  const result = normalizeShareEvent(input);
  return result.ok ? null : result.error;
}

describe('normalizeShareEvent', () => {
  it('acepta un compartido completo y normaliza los espacios', () => {
    const result = normalizeShareEvent({
      ...valido,
      name: '  Ana   Prueba  ',
      email: '  ana.prueba@example.com ',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toEqual({
      property_id: 'scl-depto-marco-polo',
      partner_id: 'catedral',
      channel: 'whatsapp',
      source: 'ficha',
      name: 'Ana Prueba',
      email: 'ana.prueba@example.com',
      phone: '+56 9 1111 1111',
      share_url: 'https://rix7.cl/compartir/scl-depto-marco-polo',
    });
  });

  it('exige la propiedad, el canal y la identidad', () => {
    expect(errorOf({ ...valido, property_id: undefined })).toMatch(/propiedad/i);
    expect(errorOf({ ...valido, property_id: '   ' })).toMatch(/propiedad/i);
    expect(errorOf({ ...valido, channel: undefined })).toMatch(/canal/i);
    expect(errorOf({ ...valido, name: '' })).toMatch(/nombre/i);
    expect(errorOf({ ...valido, name: 'A' })).toMatch(/nombre/i);
    expect(errorOf({ ...valido, email: undefined })).toMatch(/correo/i);
  });

  it('rechaza una propiedad con forma de ruta o de texto libre', () => {
    expect(errorOf({ ...valido, property_id: '../../etc/passwd' })).toMatch(/no es válida/i);
    expect(errorOf({ ...valido, property_id: 'scl depto' })).toMatch(/no es válida/i);
    expect(errorOf({ ...valido, property_id: 'p'.repeat(SHARE_LIMITS.id + 1) })).toMatch(/largo/i);
  });

  it('solo acepta canales y orígenes conocidos', () => {
    for (const channel of ['whatsapp', 'copy', 'share', 'card']) {
      expect(normalizeShareEvent({ ...valido, channel }).ok).toBe(true);
    }
    expect(errorOf({ ...valido, channel: 'telegram' })).toMatch(/canal/i);

    for (const source of ['ficha', 'landing', 'panel']) {
      expect(normalizeShareEvent({ ...valido, source }).ok).toBe(true);
    }
    expect(errorOf({ ...valido, source: 'whatsapp' })).toMatch(/origen/i);
  });

  it('sin origen se asume la ficha, que es el comportamiento anterior', () => {
    const result = normalizeShareEvent({ ...valido, source: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.source).toBe('ficha');
  });

  it('rechaza un correo inválido y los textos demasiado largos', () => {
    expect(errorOf({ ...valido, email: 'ana@ejemplo' })).toMatch(/formato/i);
    expect(errorOf({ ...valido, name: 'a'.repeat(SHARE_LIMITS.name + 1) })).toMatch(/largo/i);
  });

  it('descarta un teléfono demasiado corto en vez de perder el evento', () => {
    const result = normalizeShareEvent({ ...valido, phone: '123' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.phone).toBeNull();
  });

  it('recorta el teléfono y deja null los campos opcionales vacíos', () => {
    const result = normalizeShareEvent({
      ...valido,
      phone: '+56 9 1111 1111'.repeat(5),
      partner_id: '   ',
      share_url: '   ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.phone?.length).toBe(SHARE_LIMITS.phone);
    expect(result.event.partner_id).toBeNull();
    expect(result.event.share_url).toBeNull();
  });

  it('no guarda un enlace que no sea http(s)', () => {
    for (const share_url of ['javascript:alert(1)', 'rix7.cl/compartir/x', '   ']) {
      const result = normalizeShareEvent({ ...valido, share_url });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.event.share_url).toBeNull();
    }
  });

  it('rechaza cuerpos que no son objetos', () => {
    expect(errorOf(null)).toBeTruthy();
    expect(errorOf('texto')).toBeTruthy();
    expect(errorOf(['a'])).toBeTruthy();
    expect(errorOf(42)).toBeTruthy();
  });
});

describe('rowToShareEvent', () => {
  const row: ShareEventRow = {
    id: '11111111-1111-1111-1111-111111111111',
    property_id: 'scl-depto-marco-polo',
    partner_id: 'catedral',
    channel: 'copy',
    source: 'landing',
    name: 'Ana Prueba',
    email: 'ana.prueba@example.com',
    phone: '+56 9 1111 1111',
    share_url: 'https://rix7.cl/compartir/scl-depto-marco-polo',
    created_at: '2026-10-19T12:00:00Z',
  };

  it('mapea la fila al objeto del panel', () => {
    expect(rowToShareEvent(row)).toEqual({
      id: row.id,
      propertyId: 'scl-depto-marco-polo',
      partnerId: 'catedral',
      channel: 'copy',
      source: 'landing',
      name: 'Ana Prueba',
      email: 'ana.prueba@example.com',
      phone: '+56 9 1111 1111',
      shareUrl: 'https://rix7.cl/compartir/scl-depto-marco-polo',
      createdAt: '2026-10-19T12:00:00Z',
    });
  });

  it('un canal o un origen desconocido no rompe la lista', () => {
    const mapped = rowToShareEvent({ ...row, channel: 'paloma', source: 'fax' });
    expect(mapped.channel).toBe('share');
    expect(mapped.source).toBe('ficha');
    expect(rowToShareEvent({ ...row, source: null }).source).toBe('ficha');
  });
});

describe('etiquetas', () => {
  it('etiqueta cada canal para el panel', () => {
    expect(shareChannelLabel('whatsapp')).toBe('WhatsApp');
    expect(shareChannelLabel('copy')).toBe('Enlace copiado');
    expect(shareChannelLabel('share')).toBe('Compartir');
    expect(shareChannelLabel('card')).toBe('Tarjeta');
  });

  it('etiqueta cada origen para el panel', () => {
    expect(shareSourceLabel('ficha')).toBe('Ficha');
    expect(shareSourceLabel('landing')).toBe('Landing compartida');
    expect(shareSourceLabel('panel')).toBe('Panel del socio');
  });
});
