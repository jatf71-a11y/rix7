import { describe, it, expect } from 'vitest';
import {
  LEAD_LIMITS,
  leadChannelLabel,
  leadSourceLabel,
  normalizeLead,
  rowToLead,
  type LeadRow,
} from './leads';

const valido = {
  property_id: 'scl-depto-marco-polo',
  partner_id: 'catedral',
  name: 'Javier Torres',
  email: 'javier@example.cl',
  phone: '+56 9 1111 2222',
  channel: 'whatsapp',
};

/** Atajo: el lead válido o el error, como string, para leer mejor los asserts. */
function errorOf(input: unknown): string | null {
  const result = normalizeLead(input);
  return result.ok ? null : result.error;
}

describe('normalizeLead', () => {
  it('acepta un contacto completo y normaliza los espacios', () => {
    const result = normalizeLead({ ...valido, name: '  Javier   Torres  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead).toEqual({
      property_id: 'scl-depto-marco-polo',
      partner_id: 'catedral',
      name: 'Javier Torres',
      email: 'javier@example.cl',
      phone: '+56 9 1111 2222',
      channel: 'whatsapp',
      // Sin `source`, el contacto es de la ficha: el comportamiento de siempre.
      source: 'ficha',
      message: null,
    });
  });

  it('exige nombre, correo, teléfono y canal', () => {
    expect(errorOf({ ...valido, name: '' })).toMatch(/nombre/i);
    expect(errorOf({ ...valido, email: undefined })).toMatch(/correo/i);
    expect(errorOf({ ...valido, phone: '   ' })).toMatch(/teléfono/i);
    expect(errorOf({ ...valido, channel: undefined })).toMatch(/canal/i);
  });

  it('rechaza un correo con formato inválido', () => {
    expect(errorOf({ ...valido, email: 'javier@ejemplo' })).toMatch(/formato/i);
    expect(errorOf({ ...valido, email: 'javier ej@example.cl' })).toMatch(/formato/i);
  });

  it('exige al menos 9 dígitos de teléfono, ignorando el formato', () => {
    expect(errorOf({ ...valido, phone: '+56 9 111' })).toMatch(/teléfono/i);
    expect(normalizeLead({ ...valido, phone: '(56) 9111-2222' }).ok).toBe(true);
  });

  it('solo acepta los canales conocidos', () => {
    for (const channel of ['form', 'call', 'whatsapp', 'mail']) {
      expect(normalizeLead({ ...valido, channel }).ok).toBe(true);
    }
    expect(errorOf({ ...valido, channel: 'telegram' })).toMatch(/canal/i);
    expect(errorOf({ ...valido, channel: 'FORM' })).toMatch(/canal/i);
  });

  it('registra el origen del contacto y rechaza uno inventado', () => {
    for (const source of ['ficha', 'landing', 'panel']) {
      const result = normalizeLead({ ...valido, source });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.lead.source).toBe(source);
    }

    expect(normalizeLead({ ...valido, source: undefined }).ok).toBe(true);
    expect(errorOf({ ...valido, source: 'whatsapp' })).toMatch(/origen/i);
  });

  it('rechaza cuerpos que no son objetos', () => {
    expect(errorOf(null)).toBeTruthy();
    expect(errorOf('texto')).toBeTruthy();
    expect(errorOf(['a'])).toBeTruthy();
    expect(errorOf(42)).toBeTruthy();
  });

  it('no acepta tipos raros en los campos de texto', () => {
    expect(errorOf({ ...valido, name: { $ne: null } })).toMatch(/nombre/i);
    expect(errorOf({ ...valido, email: ['a@b.cl'] })).toMatch(/correo/i);
    expect(errorOf({ ...valido, phone: 91112222 })).toMatch(/teléfono/i);
  });

  it('rechaza los campos demasiado largos, que son el vector de basura', () => {
    expect(errorOf({ ...valido, name: 'a'.repeat(LEAD_LIMITS.name + 1) })).toMatch(/largo/i);
    expect(errorOf({ ...valido, email: `${'a'.repeat(LEAD_LIMITS.email)}@b.cl` })).toMatch(/largo/i);
  });

  it('recorta el mensaje en silencio en vez de perder el contacto', () => {
    const result = normalizeLead({ ...valido, message: 'x'.repeat(1000) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.message?.length).toBe(LEAD_LIMITS.message);
  });

  it('acepta un contacto sin propiedad ni corredora (alta desde otra superficie)', () => {
    const result = normalizeLead({ ...valido, property_id: null, partner_id: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.property_id).toBeNull();
    expect(result.lead.partner_id).toBeNull();
  });

  it('recorta los identificadores en lugar de rechazar el contacto', () => {
    const result = normalizeLead({ ...valido, property_id: 'p'.repeat(300) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.property_id?.length).toBe(LEAD_LIMITS.id);
  });
});

describe('rowToLead', () => {
  const row: LeadRow = {
    id: '11111111-1111-1111-1111-111111111111',
    property_id: 'scl-depto-marco-polo',
    partner_id: 'catedral',
    name: 'Javier Torres',
    email: 'javier@example.cl',
    phone: '+56 9 1111 2222',
    channel: 'whatsapp',
    source: 'landing',
    message: null,
    created_at: '2026-09-23T14:00:00Z',
  };

  it('mapea la fila al objeto del panel', () => {
    expect(rowToLead(row)).toEqual({
      id: row.id,
      propertyId: 'scl-depto-marco-polo',
      partnerId: 'catedral',
      name: 'Javier Torres',
      email: 'javier@example.cl',
      phone: '+56 9 1111 2222',
      channel: 'whatsapp',
      source: 'landing',
      message: null,
      createdAt: '2026-09-23T14:00:00Z',
    });
  });

  it('un canal desconocido se muestra como formulario, no rompe la lista', () => {
    expect(rowToLead({ ...row, channel: 'paloma-mensajera' }).channel).toBe('form');
  });
});

describe('leadChannelLabel', () => {
  it('etiqueta cada canal para el panel', () => {
    expect(leadChannelLabel('form')).toBe('Formulario');
    expect(leadChannelLabel('call')).toBe('Llamada');
    expect(leadChannelLabel('whatsapp')).toBe('WhatsApp');
    expect(leadChannelLabel('mail')).toBe('Correo');
  });
});

describe('leadSourceLabel', () => {
  it('distingue la ficha de la landing y del panel', () => {
    expect(leadSourceLabel('ficha')).toBe('Ficha');
    expect(leadSourceLabel('landing')).toBe('Landing compartida');
    expect(leadSourceLabel('panel')).toBe('Panel');
  });

  it('una fuente desconocida se lee como ficha, no rompe la lista', () => {
    const base: LeadRow = {
      id: 'x',
      property_id: null,
      partner_id: null,
      name: 'Ana',
      email: 'ana@example.cl',
      phone: '+56 9 1111 2222',
      channel: 'form',
      source: 'desconocida',
      message: null,
      created_at: '2026-09-23T14:00:00Z',
    };
    expect(rowToLead(base).source).toBe('ficha');
  });
});
