import { describe, expect, it } from 'vitest';

import {
  normalizeSolicitud,
  normalizeSolicitudPatch,
  rowToSolicitud,
  solicitudDetails,
  solicitudPriceLabel,
  type Solicitud,
} from './solicitudes';

const LICITACION = {
  kind: 'licitacion',
  name: 'Ana Pérez',
  email: 'ana@example.cl',
  phone: '+56 9 1234 5678',
  consent: true,
  operation: 'sale',
  property_type: 'apartment',
  region: 'Región Metropolitana de Santiago',
  commune: 'Providencia',
  expected_price: '120000000',
  address: 'Av. Providencia 1234',
  rol: '15234-67',
  message: 'Departamento arrendado hasta marzo.',
};

const CORREDORA = {
  kind: 'corredora',
  name: 'Camila Rojas',
  email: 'camila@corredora.cl',
  phone: '+56 2 2345 6789',
  consent: true,
  company: 'Catedral Propiedades',
  rut: '76.123.456-7',
  role: 'Gerente comercial',
  region: 'Región Metropolitana de Santiago',
  commune: 'Santiago',
  website: 'https://catedral.cl',
};

describe('normalizeSolicitud', () => {
  it('normaliza una licitación con precio numérico', () => {
    const result = normalizeSolicitud(LICITACION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.solicitud).toMatchObject({
      kind: 'licitacion',
      name: 'Ana Pérez',
      company: null,
      consent: true,
      payload: {
        operation: 'sale',
        property_type: 'apartment',
        region: 'Región Metropolitana de Santiago',
        commune: 'Providencia',
        expected_price: 120_000_000,
        address: 'Av. Providencia 1234',
        rol: '15234-67',
      },
    });
  });

  it('acepta corredora e inmobiliaria con la empresa como obligatoria', () => {
    const corredora = normalizeSolicitud(CORREDORA);
    const inmobiliaria = normalizeSolicitud({ ...CORREDORA, kind: 'inmobiliaria' });

    expect(corredora.ok).toBe(true);
    expect(inmobiliaria.ok).toBe(true);
    if (!corredora.ok || !inmobiliaria.ok) return;

    expect(corredora.solicitud.company).toBe('Catedral Propiedades');
    expect(corredora.solicitud.payload).toMatchObject({
      rut: '76.123.456-7',
      website: 'https://catedral.cl',
    });
    expect(inmobiliaria.solicitud.kind).toBe('inmobiliaria');
  });

  it('exige el consentimiento de privacidad', () => {
    const result = normalizeSolicitud({ ...LICITACION, consent: false });

    expect(result).toEqual({ ok: false, error: 'Debes aceptar la política de privacidad.' });
  });

  it('rechaza un tipo de solicitud que no existe', () => {
    const result = normalizeSolicitud({ ...LICITACION, kind: 'otra' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Tipo de solicitud');
  });

  it('rechaza un correo mal formado sin llegar al store', () => {
    const result = normalizeSolicitud({ ...LICITACION, email: 'ana.example.cl' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('correo');
  });

  it('no acepta una licitación sin comuna ni tipo de propiedad', () => {
    const sinComuna = normalizeSolicitud({ ...LICITACION, commune: '' });
    const tipoInvalido = normalizeSolicitud({ ...LICITACION, property_type: 'castillo' });

    expect(sinComuna.ok).toBe(false);
    expect(tipoInvalido.ok).toBe(false);
  });

  it('exige una dirección exacta, no una referencia vacía', () => {
    const sinDireccion = normalizeSolicitud({ ...LICITACION, address: '' });
    const referenciaVaga = normalizeSolicitud({ ...LICITACION, address: '  ' });
    const demasiadoCorta = normalizeSolicitud({ ...LICITACION, address: 'Casa' });

    expect(sinDireccion.ok).toBe(false);
    expect(referenciaVaga.ok).toBe(false);
    expect(demasiadoCorta.ok).toBe(false);
    if (!sinDireccion.ok) expect(sinDireccion.error).toContain('dirección');
    if (!referenciaVaga.ok) expect(referenciaVaga.error).toContain('dirección');
    if (!demasiadoCorta.ok) expect(demasiadoCorta.error).toContain('calle');
  });

  it('acepta el precio como número, no solo como cadena del formulario', () => {
    const result = normalizeSolicitud({ ...LICITACION, expected_price: 120_000_000 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.solicitud.payload.expected_price).toBe(120_000_000);
  });

  it('un precio negativo no se guarda como si fuera válido', () => {
    const result = normalizeSolicitud({ ...LICITACION, expected_price: '-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('precio');
  });

  it('exige el precio esperado: ya no existe «a convenir»', () => {
    const vacio = normalizeSolicitud({ ...LICITACION, expected_price: '' });
    const cero = normalizeSolicitud({ ...LICITACION, expected_price: '0' });

    expect(vacio.ok).toBe(false);
    expect(cero.ok).toBe(false);
    if (!vacio.ok) expect(vacio.error).toContain('precio');
    if (!cero.ok) expect(cero.error).toContain('precio');
  });

  it('exige el ROL: no se puede enviar una licitación sin identificación', () => {
    const vacio = normalizeSolicitud({ ...LICITACION, rol: '' });
    const espacios = normalizeSolicitud({ ...LICITACION, rol: '  ' });

    expect(vacio.ok).toBe(false);
    expect(espacios.ok).toBe(false);
    if (!vacio.ok) expect(vacio.error).toContain('ROL');
    if (!espacios.ok) expect(espacios.error).toContain('ROL');
  });

  it('exige los detalles de la propiedad en una licitación', () => {
    const result = normalizeSolicitud({ ...LICITACION, message: '' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('mensaje');
  });

  it('rechaza un ROL con forma inválida', () => {
    const result = normalizeSolicitud({ ...LICITACION, rol: 'sin-rol' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ROL');
  });

  it('exige un sitio web con protocolo cuando se informa', () => {
    const result = normalizeSolicitud({ ...CORREDORA, website: 'catedral.cl' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('http');
  });

  it('una empresa sin nombre no se puede revisar', () => {
    const result = normalizeSolicitud({ ...CORREDORA, company: ' ' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('empresa');
  });
});

describe('rowToSolicitud y detalles', () => {
  const row = {
    id: 's1',
    kind: 'licitacion',
    name: 'Ana Pérez',
    email: 'ana@example.cl',
    phone: '+56 9 1234 5678',
    company: null,
    message: null,
    payload: {
      operation: 'sale',
      property_type: 'house',
      region: 'Región de Valparaíso',
      commune: 'Viña del Mar',
      expected_price: 90000000,
      address: null,
      rol: '15234-67',
    },
    consent: true,
    status: 'nueva',
    created_at: '2026-10-20T12:00:00.000Z',
  };

  it('traduce la fila y arma el detalle de una licitación', () => {
    const solicitud = rowToSolicitud(row);

    expect(solicitud.status).toBe('nueva');
    expect(solicitudDetails(solicitud)).toEqual([
      { label: 'Operación', value: 'Venta' },
      { label: 'Tipo', value: 'Casa' },
      { label: 'ROL', value: '15234-67' },
      { label: 'Ubicación', value: 'Viña del Mar, Región de Valparaíso' },
      { label: 'Precio esperado', value: '$90.000.000' },
    ]);
  });

  it('no inventa un precio cuando no lo informaron', () => {
    expect(solicitudPriceLabel(null)).toBeNull();
    expect(solicitudPriceLabel('90000000')).toBeNull();
  });

  it('arma el detalle de una empresa con sus campos propios', () => {
    const solicitud: Solicitud = {
      id: 's2',
      kind: 'inmobiliaria',
      name: 'Camila Rojas',
      email: 'camila@example.cl',
      phone: '+56 2 2345 6789',
      company: 'Inmobiliaria Los Andes',
      message: null,
      payload: {
        rut: '76.123.456-7',
        role: 'Gerente',
        region: null,
        commune: null,
        website: 'https://losandes.cl',
      },
      status: 'nueva',
      createdAt: '2026-10-20T12:00:00.000Z',
    };

    expect(solicitudDetails(solicitud)).toEqual([
      { label: 'Empresa', value: 'Inmobiliaria Los Andes' },
      { label: 'RUT', value: '76.123.456-7' },
      { label: 'Cargo', value: 'Gerente' },
      { label: 'Ubicación', value: '—' },
      { label: 'Sitio web', value: 'https://losandes.cl' },
    ]);
  });
});

describe('normalizeSolicitudPatch', () => {
  it('acepta un uuid y un estado del ciclo', () => {
    const uuid = '2c8f8e2a-1c7b-4f9d-9a1e-3b5c6d7e8f90';

    expect(normalizeSolicitudPatch({ id: uuid, status: 'en_revision' })).toEqual({
      ok: true,
      id: uuid,
      status: 'en_revision',
    });
  });

  it('acepta los ids de desarrollo sin Supabase', () => {
    expect(normalizeSolicitudPatch({ id: 'memoria-3', status: 'cerrada' })).toMatchObject({
      ok: true,
      id: 'memoria-3',
    });
  });

  it('recorta el id antes de usarlo', () => {
    expect(normalizeSolicitudPatch({ id: '  s1  ', status: 'contactada' })).toMatchObject({
      ok: true,
      id: 's1',
    });
  });

  it('rechaza un estado que no es del ciclo', () => {
    expect(normalizeSolicitudPatch({ id: 's1', status: 'pagada' })).toMatchObject({ ok: false });
    expect(normalizeSolicitudPatch({ id: 's1' })).toMatchObject({ ok: false });
  });

  it('rechaza un id vacío, demasiado largo o con caracteres raros', () => {
    expect(normalizeSolicitudPatch({ id: '', status: 'cerrada' })).toMatchObject({ ok: false });
    expect(normalizeSolicitudPatch({ id: 'x'.repeat(121), status: 'cerrada' })).toMatchObject({
      ok: false,
    });
    expect(normalizeSolicitudPatch({ id: "s1'; DROP TABLE", status: 'cerrada' })).toMatchObject({
      ok: false,
    });
    expect(normalizeSolicitudPatch({ status: 'cerrada' })).toMatchObject({ ok: false });
  });
});
