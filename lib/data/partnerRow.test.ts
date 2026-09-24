import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PARTNER_COLOR,
  partnerPatchToRow,
  partnerToRow,
  rowToPartner,
  type PartnerRow,
} from './partnerRow';
import type { Partner } from './partners';

const row: PartnerRow = {
  id: 'catedral',
  slug: 'catedral',
  name: 'Catedral Propiedades',
  logo: '/logos/catedral.png',
  description: 'Corredora de propiedades',
  website: 'https://catedralpropiedades.cl',
  color: '#3B82F6',
  contact_phone: '+56 2 2000 0001',
  contact_whatsapp: '+56 9 0000 0001',
  contact_email: 'contacto@catedralpropiedades.cl',
  sort_order: 0,
};

const partner: Partner = {
  id: 'catedral',
  slug: 'catedral',
  name: 'Catedral Propiedades',
  logo: '/logos/catedral.png',
  description: 'Corredora de propiedades',
  website: 'https://catedralpropiedades.cl',
  color: '#3B82F6',
  contact: {
    phone: '+56 2 2000 0001',
    whatsapp: '+56 9 0000 0001',
    email: 'contacto@catedralpropiedades.cl',
  },
};

describe('rowToPartner', () => {
  it('conserva los tres datos de contacto, que son los que habilitan los botones', () => {
    const result = rowToPartner(row);
    expect(result.contact).toEqual({
      phone: '+56 2 2000 0001',
      whatsapp: '+56 9 0000 0001',
      email: 'contacto@catedralpropiedades.cl',
    });
  });

  it('normaliza los nulos en vez de propagarlos', () => {
    const result = rowToPartner({
      ...row,
      logo: null,
      description: null,
      website: null,
      color: null,
      contact_phone: null,
      contact_whatsapp: null,
      contact_email: null,
    });

    expect(result.logo).toBe('');
    expect(result.description).toBe('');
    expect(result.website).toBeUndefined();
    expect(result.color).toBe(DEFAULT_PARTNER_COLOR);
    expect(result.contact).toEqual({ phone: '', whatsapp: '', email: '' });
  });

  it('usa el id como slug cuando la fila no trae slug', () => {
    expect(rowToPartner({ ...row, slug: '' }).slug).toBe('catedral');
  });

  it('conserva el id con punto de Portal Inmobiliario sin tocar el slug', () => {
    const result = rowToPartner({ ...row, id: '.portal-inmobiliario', slug: 'portal-inmobiliario' });
    expect(result.id).toBe('.portal-inmobiliario');
    expect(result.slug).toBe('portal-inmobiliario');
  });
});

describe('partnerToRow', () => {
  it('escribe los datos de contacto en sus columnas', () => {
    expect(partnerToRow(partner)).toMatchObject({
      id: 'catedral',
      slug: 'catedral',
      contact_phone: '+56 2 2000 0001',
      contact_whatsapp: '+56 9 0000 0001',
      contact_email: 'contacto@catedralpropiedades.cl',
    });
  });

  it('convierte un sitio web ausente en NULL', () => {
    expect(partnerToRow({ ...partner, website: undefined }).website).toBeNull();
  });

  it('tolera una corredora sin contacto (datos antiguos del catálogo)', () => {
    const sinContacto = { ...partner, contact: undefined as unknown as Partner['contact'] };
    expect(partnerToRow(sinContacto)).toMatchObject({
      contact_phone: '',
      contact_whatsapp: '',
      contact_email: '',
    });
  });
});

describe('partnerPatchToRow', () => {
  it('solo escribe las claves presentes: editar el nombre no borra los teléfonos', () => {
    const patch = partnerPatchToRow({ name: 'Catedral Propiedades SpA' });
    expect(patch).toEqual({ name: 'Catedral Propiedades SpA' });
    expect(patch).not.toHaveProperty('contact_phone');
    expect(patch).not.toHaveProperty('contact_whatsapp');
    expect(patch).not.toHaveProperty('contact_email');
  });

  it('escribe los tres contactos juntos cuando vienen', () => {
    expect(
      partnerPatchToRow({ contact: { phone: 'a', whatsapp: 'b', email: 'c' } })
    ).toEqual({ contact_phone: 'a', contact_whatsapp: 'b', contact_email: 'c' });
  });

  it('un sitio web vacío se guarda como NULL y un color vacío usa el por defecto', () => {
    expect(partnerPatchToRow({ website: '', color: '' })).toEqual({
      website: null,
      color: DEFAULT_PARTNER_COLOR,
    });
  });

  it('no incluye el id: el id identifica la fila, no se reescribe', () => {
    expect(partnerPatchToRow({ id: 'otro', name: 'X' })).toEqual({ name: 'X' });
  });
});
