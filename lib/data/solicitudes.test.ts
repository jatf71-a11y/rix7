import { describe, expect, it } from 'vitest';

import {
  normalizeSolicitud,
  normalizeSolicitudPatch,
  rowToSolicitud,
  solicitudDetails,
  solicitudPriceLabel,
  type Solicitud,
} from './solicitudes';

const PROPUESTAS = {
  kind: 'propuestas',
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
  rut: '76.123.456-0',
  role: 'Gerente comercial',
  coverage: 'regional',
  regions: ['Región Metropolitana de Santiago'],
  website: 'https://catedral.cl',
};

const AGENTE = {
  kind: 'agente',
  name: 'Diego Soto',
  email: 'diego@example.cl',
  phone: '+56 9 8765 4321',
  consent: true,
  rut: '12.345.678-5',
  coverage: 'nacional',
};

describe('normalizeSolicitud', () => {
  it('normaliza una solicitud de propuestas con precio numérico', () => {
    const result = normalizeSolicitud(PROPUESTAS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.solicitud).toMatchObject({
      kind: 'propuestas',
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
      rut: '76.123.456-0',
      website: 'https://catedral.cl',
      coverage: 'regional',
      regions: ['Región Metropolitana de Santiago'],
    });
    expect(inmobiliaria.solicitud.kind).toBe('inmobiliaria');
  });

  it('exige el RUT en corredora, inmobiliaria y agente', () => {
    const sinRut = normalizeSolicitud({ ...CORREDORA, rut: '' });
    const soloEspacios = normalizeSolicitud({ ...CORREDORA, rut: '   ' });
    const agente = normalizeSolicitud({ ...AGENTE, rut: undefined });

    expect(sinRut.ok).toBe(false);
    expect(soloEspacios.ok).toBe(false);
    expect(agente.ok).toBe(false);
    if (!sinRut.ok) expect(sinRut.error).toContain('RUT');
    if (!agente.ok) expect(agente.error).toContain('RUT');
  });

  it('rechaza un RUT con dígito verificador inválido', () => {
    const result = normalizeSolicitud({ ...CORREDORA, rut: '76.123.456-7' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('RUT');
  });

  it('guarda el RUT en forma canónica, sin importar cómo lo escribieron', () => {
    const result = normalizeSolicitud({ ...CORREDORA, rut: '761234560' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.solicitud.payload.rut).toBe('76.123.456-0');
  });

  it('exige el alcance geográfico en los tres registros', () => {
    const sinAlcance = normalizeSolicitud({ ...CORREDORA, coverage: '' });
    const inventado = normalizeSolicitud({ ...AGENTE, coverage: 'global' });

    expect(sinAlcance.ok).toBe(false);
    expect(inventado.ok).toBe(false);
    if (!sinAlcance.ok) expect(sinAlcance.error).toContain('alcance');
  });

  it('un alcance regional exige al menos una región válida', () => {
    const sinRegiones = normalizeSolicitud({ ...CORREDORA, regions: [] });
    const noEsLista = normalizeSolicitud({ ...CORREDORA, regions: 'Valparaíso' });
    const desconocida = normalizeSolicitud({ ...CORREDORA, regions: ['Marte'] });

    expect(sinRegiones.ok).toBe(false);
    expect(noEsLista.ok).toBe(false);
    expect(desconocida.ok).toBe(false);
    if (!sinRegiones.ok) expect(sinRegiones.error).toContain('región');
    if (!desconocida.ok) expect(desconocida.error).toContain('regiones');
  });

  it('ordena y deduplica las regiones, e ignora la lista si el alcance es nacional', () => {
    const regional = normalizeSolicitud({
      ...CORREDORA,
      regions: ['Valparaíso', 'Región Metropolitana de Santiago', 'Valparaíso'],
    });
    const nacional = normalizeSolicitud({
      ...AGENTE,
      coverage: 'nacional',
      regions: ['Valparaíso'],
    });

    expect(regional.ok).toBe(true);
    expect(nacional.ok).toBe(true);
    if (regional.ok) {
      expect(regional.solicitud.payload.regions).toEqual([
        'Región Metropolitana de Santiago',
        'Valparaíso',
      ]);
    }
    if (nacional.ok) expect(nacional.solicitud.payload.regions).toEqual([]);
  });

  it('exige el consentimiento de privacidad', () => {
    const result = normalizeSolicitud({ ...PROPUESTAS, consent: false });

    expect(result).toEqual({ ok: false, error: 'Debes aceptar la política de privacidad.' });
  });

  it('rechaza un tipo de solicitud que no existe', () => {
    const result = normalizeSolicitud({ ...PROPUESTAS, kind: 'otra' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Tipo de solicitud');
  });

  it('rechaza un correo mal formado sin llegar al store', () => {
    const result = normalizeSolicitud({ ...PROPUESTAS, email: 'ana.example.cl' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('correo');
  });

  it('no acepta una solicitud de propuestas sin comuna ni tipo de propiedad', () => {
    const sinComuna = normalizeSolicitud({ ...PROPUESTAS, commune: '' });
    const tipoInvalido = normalizeSolicitud({ ...PROPUESTAS, property_type: 'castillo' });

    expect(sinComuna.ok).toBe(false);
    expect(tipoInvalido.ok).toBe(false);
  });

  it('exige una dirección exacta, no una referencia vacía', () => {
    const sinDireccion = normalizeSolicitud({ ...PROPUESTAS, address: '' });
    const referenciaVaga = normalizeSolicitud({ ...PROPUESTAS, address: '  ' });
    const demasiadoCorta = normalizeSolicitud({ ...PROPUESTAS, address: 'Casa' });

    expect(sinDireccion.ok).toBe(false);
    expect(referenciaVaga.ok).toBe(false);
    expect(demasiadoCorta.ok).toBe(false);
    if (!sinDireccion.ok) expect(sinDireccion.error).toContain('dirección');
    if (!referenciaVaga.ok) expect(referenciaVaga.error).toContain('dirección');
    if (!demasiadoCorta.ok) expect(demasiadoCorta.error).toContain('calle');
  });

  it('acepta el precio como número, no solo como cadena del formulario', () => {
    const result = normalizeSolicitud({ ...PROPUESTAS, expected_price: 120_000_000 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.solicitud.payload.expected_price).toBe(120_000_000);
  });

  it('un precio negativo no se guarda como si fuera válido', () => {
    const result = normalizeSolicitud({ ...PROPUESTAS, expected_price: '-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('precio');
  });

  it('exige el precio esperado: ya no existe «a convenir»', () => {
    const vacio = normalizeSolicitud({ ...PROPUESTAS, expected_price: '' });
    const cero = normalizeSolicitud({ ...PROPUESTAS, expected_price: '0' });

    expect(vacio.ok).toBe(false);
    expect(cero.ok).toBe(false);
    if (!vacio.ok) expect(vacio.error).toContain('precio');
    if (!cero.ok) expect(cero.error).toContain('precio');
  });

  it('exige el ROL: no se puede enviar una solicitud de propuestas sin identificación', () => {
    const vacio = normalizeSolicitud({ ...PROPUESTAS, rol: '' });
    const espacios = normalizeSolicitud({ ...PROPUESTAS, rol: '  ' });

    expect(vacio.ok).toBe(false);
    expect(espacios.ok).toBe(false);
    if (!vacio.ok) expect(vacio.error).toContain('ROL');
    if (!espacios.ok) expect(espacios.error).toContain('ROL');
  });

  it('exige los detalles de la propiedad en una solicitud de propuestas', () => {
    const result = normalizeSolicitud({ ...PROPUESTAS, message: '' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('mensaje');
  });

  it('rechaza un ROL con forma inválida', () => {
    const result = normalizeSolicitud({ ...PROPUESTAS, rol: 'sin-rol' });

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

  it('acepta un agente sin empresa: no factura, emite boleta de honorarios', () => {
    const result = normalizeSolicitud(AGENTE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Sin razón social ni cargo que declarar: la empresa queda en null, no en ''.
    expect(result.solicitud).toMatchObject({
      kind: 'agente',
      company: null,
      payload: { rut: '12.345.678-5', role: null },
    });
  });

  it('un agente con nombre comercial lo guarda, pero no lo exige', () => {
    const conNombre = normalizeSolicitud({ ...AGENTE, company: 'Propiedades Sur' });
    const sinNombre = normalizeSolicitud({ ...AGENTE, company: '   ' });

    expect(conNombre.ok).toBe(true);
    expect(sinNombre.ok).toBe(true);
    if (conNombre.ok) expect(conNombre.solicitud.company).toBe('Propiedades Sur');
    if (sinNombre.ok) expect(sinNombre.solicitud.company).toBeNull();
  });

  it('un agente no necesita mensaje: una empresa tampoco, pero una solicitud de propuestas sí', () => {
    const agente = normalizeSolicitud({ ...AGENTE, message: '' });

    expect(agente.ok).toBe(true);
  });
});

describe('rowToSolicitud y detalles', () => {
  const row = {
    id: 's1',
    kind: 'propuestas',
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
    status: 'Recibida',
    created_at: '2026-10-20T12:00:00.000Z',
  };

  it('traduce la fila y arma el detalle de una solicitud de propuestas', () => {
    const solicitud = rowToSolicitud(row);

    expect(solicitud.status).toBe('Recibida');
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
        rut: '76.123.456-0',
        role: 'Gerente',
        coverage: 'regional',
        regions: ['Región Metropolitana de Santiago', 'Valparaíso'],
        website: 'https://losandes.cl',
      },
      status: 'Recibida',
      createdAt: '2026-10-20T12:00:00.000Z',
    };

    expect(solicitudDetails(solicitud)).toEqual([
      { label: 'Empresa', value: 'Inmobiliaria Los Andes' },
      { label: 'RUT', value: '76.123.456-0' },
      { label: 'Cargo', value: 'Gerente' },
      { label: 'Alcance', value: 'Regional' },
      { label: 'Regiones', value: 'Región Metropolitana de Santiago, Valparaíso' },
      { label: 'Sitio web', value: 'https://losandes.cl' },
    ]);
  });

  it('una solicitud anterior al alcance conserva su ubicación en el detalle', () => {
    const solicitud: Solicitud = {
      id: 's4',
      kind: 'corredora',
      name: 'Camila Rojas',
      email: 'camila@example.cl',
      phone: '+56 2 2345 6789',
      company: 'Corredora Antigua',
      message: null,
      payload: {
        rut: '76.123.456-0',
        role: null,
        region: 'Valparaíso',
        commune: 'Viña del Mar',
        website: null,
      },
      status: 'Recibida',
      createdAt: '2026-10-19T12:00:00.000Z',
    };

    expect(solicitudDetails(solicitud)).toEqual([
      { label: 'Empresa', value: 'Corredora Antigua' },
      { label: 'RUT', value: '76.123.456-0' },
      { label: 'Cargo', value: '—' },
      { label: 'Ubicación', value: 'Viña del Mar, Valparaíso' },
    ]);
  });

  it('el detalle de un agente no inventa empresa ni cargo', () => {
    const solicitud: Solicitud = {
      id: 's3',
      kind: 'agente',
      name: 'Diego Soto',
      email: 'diego@example.cl',
      phone: '+56 9 8765 4321',
      company: null,
      message: null,
      payload: {
        rut: '12.345.678-5',
        role: null,
        coverage: 'nacional',
        regions: [],
        website: null,
      },
      status: 'Recibida',
      createdAt: '2026-10-21T12:00:00.000Z',
    };

    expect(solicitudDetails(solicitud)).toEqual([
      { label: 'RUT', value: '12.345.678-5' },
      { label: 'Alcance', value: 'Nacional' },
    ]);
  });
});

describe('normalizeSolicitudPatch', () => {
  it('acepta un uuid y un estado del ciclo', () => {
    const uuid = '2c8f8e2a-1c7b-4f9d-9a1e-3b5c6d7e8f90';

    expect(normalizeSolicitudPatch({ id: uuid, status: 'En_Evaluacion' })).toEqual({
      ok: true,
      id: uuid,
      status: 'En_Evaluacion',
    });
  });

  it('acepta los ids de desarrollo sin Supabase', () => {
    expect(normalizeSolicitudPatch({ id: 'memoria-3', status: 'Aceptada' })).toMatchObject({
      ok: true,
      id: 'memoria-3',
    });
  });

  it('recorta el id antes de usarlo', () => {
    expect(normalizeSolicitudPatch({ id: '  s1  ', status: 'Pendiente_Informacion' })).toMatchObject({
      ok: true,
      id: 's1',
    });
  });

  it('rechaza un estado que no es del ciclo', () => {
    expect(normalizeSolicitudPatch({ id: 's1', status: 'pagada' })).toMatchObject({ ok: false });
    expect(normalizeSolicitudPatch({ id: 's1' })).toMatchObject({ ok: false });
  });

  it('rechaza un id vacío, demasiado largo o con caracteres raros', () => {
    expect(normalizeSolicitudPatch({ id: '', status: 'Aceptada' })).toMatchObject({ ok: false });
    expect(normalizeSolicitudPatch({ id: 'x'.repeat(121), status: 'Aceptada' })).toMatchObject({
      ok: false,
    });
    expect(normalizeSolicitudPatch({ id: "s1'; DROP TABLE", status: 'Aceptada' })).toMatchObject({
      ok: false,
    });
    expect(normalizeSolicitudPatch({ status: 'Aceptada' })).toMatchObject({ ok: false });
  });
});
