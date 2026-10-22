/**
 * @vitest-environment node
 *
 * Tests de la búsqueda de ROL por dirección en el SII.
 *
 * No salen a internet: el `fetch` se reemplaza por uno falso que responde como
 * el servicio de Mapas. El fixture imita la respuesta real, que trae el nombre
 * y el RUT del propietario: el módulo debe descartarlos y devolver solo el ROL
 * con la dirección, porque el panel no necesita nada más.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addressScore,
  lookupRolSII,
  parseAddress,
  resetSiiRolCache,
  streetTokens,
  type FetchLike,
} from './siiRol';

const COMUNAS = [
  { codigo: '15103', nombre: 'PROVIDENCIA' },
  { codigo: '15108', nombre: 'LAS CONDES' },
  { codigo: '15105', nombre: 'ÑUÑOA' },
  { codigo: '4106', nombre: 'PAIHUANO' },
];

/** Fila real de `getPrediosDireccion`, con lo que el módulo debe ignorar. */
const ITEM = {
  rol: '14-345',
  comuna: 15103,
  manzana: 14,
  predio: 345,
  direccion: 'PROVIDENCIA 1234 LC 1 ',
  nombreComuna: 'PROVIDENCIA',
  destinoDescripcion: 'COMERCIO',
  // Datos personales que no deben salir de este módulo.
  nombreProp: 'PROPIETARIO DE PRUEBA',
  rut: '11111111',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FakeOptions {
  comunas?: unknown;
  /** Filas, o una función de la petición para simular respuestas distintas. */
  predios?: unknown[] | ((data: { rolDireccion?: Record<string, unknown> }) => unknown[]);
  fail?: boolean;
  status?: number;
}

function fakeSii(options: FakeOptions = {}) {
  const calls: string[] = [];
  const bodies: Array<{ metaData?: { namespace?: string }; data?: unknown }> = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    bodies.push(init?.body ? JSON.parse(String(init.body)) : {});

    if (options.fail) throw new Error('sin red');
    if (options.status && options.status !== 200) return json({}, options.status);

    if (url.includes('listComunas')) return json({ data: options.comunas ?? COMUNAS });
    if (url.includes('getPrediosDireccion')) {
      const data = (bodies[bodies.length - 1].data ?? {}) as {
        rolDireccion?: Record<string, unknown>;
      };
      const rows =
        typeof options.predios === 'function'
          ? options.predios(data)
          : options.predios ?? [ITEM];
      return json({ data: rows });
    }
    return json({}, 404);
  }) as unknown as FetchLike;

  const lastBodyOf = (operation: string) =>
    bodies.filter((body) => body.metaData?.namespace?.endsWith(operation)).pop();

  return { fetchImpl, calls, bodies, lastBodyOf };
}

beforeEach(() => {
  resetSiiRolCache();
});

describe('parseAddress', () => {
  it('separa calle, número y departamento', () => {
    expect(parseAddress('Av. Providencia 1234, depto 901')).toEqual({
      street: 'Av. Providencia',
      number: '1234',
      unit: { code: 2, number: '901' },
    });
  });

  it('toma el último número: «11 de Septiembre 2231» tiene la altura al final', () => {
    expect(parseAddress('11 de Septiembre 2231')).toEqual({
      street: '11 de Septiembre',
      number: '2231',
      unit: null,
    });
  });

  it('reconoce las abreviaturas del SII para la unidad', () => {
    expect(parseAddress('Apoquindo 4501 BX 567')?.unit).toEqual({ code: 4, number: '567' });
    expect(parseAddress('Los Leones 100 oficina 5')?.number).toBe('100');
    // «piso» no es un detalle del predio: solo se descarta del texto.
    expect(parseAddress('Los Leones 100 piso 5')).toEqual({
      street: 'Los Leones',
      number: '100',
      unit: null,
    });
  });

  it('sin número no hay búsqueda posible', () => {
    expect(parseAddress('Av. Providencia')).toBeNull();
    expect(parseAddress('')).toBeNull();
    expect(parseAddress('0')).toBeNull();
    expect(parseAddress('  ')).toBeNull();
  });
});

describe('streetTokens', () => {
  it('descarta las palabras que no distinguen una calle', () => {
    expect(streetTokens('Av. Providencia')).toEqual(['PROVIDENCIA']);
    expect(streetTokens('Avenida Pedro de Valdivia')).toEqual(['PEDRO', 'VALDIVIA']);
  });

  it('quita tildes y no repite', () => {
    expect(streetTokens('Ñuñoa Ñuñoa')).toEqual(['NUNOA']);
  });
});

describe('addressScore', () => {
  it('exige que el número sea un token propio', () => {
    // «12345» no es la altura 1234, y «OF 100» sí es la unidad 100.
    expect(addressScore('ALAMEDA 12345', ['ALAMEDA'], '1234')).toBe(0);
    expect(addressScore('ALAMEDA 1234 OF 100', ['ALAMEDA'], '100')).toBe(1);
  });

  it('cuenta cuántas palabras de la calle aparecen', () => {
    expect(addressScore('AV.PEDRO DE VALDIVIA 1090', ['PEDRO', 'VALDIVIA'], '1090')).toBe(2);
    expect(addressScore('AV EL BOSQUE 1090', ['PEDRO', 'VALDIVIA'], '1090')).toBe(0);
  });
});

describe('lookupRolSII', () => {
  it('busca por comuna, calle y número, y devuelve el ROL con su dirección', async () => {
    const { fetchImpl, lastBodyOf } = fakeSii();

    const result = await lookupRolSII(
      { address: 'Av. Providencia 1234', comuna: 'Providencia' },
      fetchImpl
    );

    expect(result).toEqual({
      ok: true,
      total: 1,
      candidates: [
        {
          rol: '14-345',
          address: 'PROVIDENCIA 1234 LC 1',
          comuna: 'PROVIDENCIA',
          destino: 'COMERCIO',
        },
      ],
    });

    expect(lastBodyOf('getPrediosDireccion')?.data).toMatchObject({
      rolDireccion: {
        comuna: '15103',
        calle: 'Av. Providencia',
        numeroCalleStr: '1234',
        detalle: 0,
        numeroDetalleStr: null,
      },
    });
  });

  it('manda el detalle de la unidad y, si el SII no la tiene, reintenta sin ella', async () => {
    // El SII anota la unidad con su propia notación: un «901» escrito a mano
    // puede no existir y no por eso la dirección deja de ser válida.
    const { fetchImpl, bodies } = fakeSii({
      predios: (data) => (data.rolDireccion?.detalle === 2 ? [] : [ITEM]),
    });

    const result = await lookupRolSII(
      { address: 'Av. Providencia 1234, depto 901', comuna: 'Providencia' },
      fetchImpl
    );

    const requests = bodies
      .filter((body) => body.metaData?.namespace?.endsWith('getPrediosDireccion'))
      .map((body) => (body.data as { rolDireccion?: Record<string, unknown> }).rolDireccion);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ detalle: 2, numeroDetalleStr: '901' });
    expect(requests[1]).toMatchObject({ detalle: 0, numeroDetalleStr: null });
    expect(result.ok).toBe(true);
  });

  it('sin unidad no repite la consulta', async () => {
    const { fetchImpl, bodies } = fakeSii();

    await lookupRolSII({ address: 'Providencia 1234', comuna: 'Providencia' }, fetchImpl);

    const requests = bodies.filter((body) =>
      body.metaData?.namespace?.endsWith('getPrediosDireccion')
    );
    expect(requests).toHaveLength(1);
  });

  it('descarta los predios de otras calles que el SII arrastra por el número', async () => {
    const { fetchImpl } = fakeSii({
      predios: [
        ITEM,
        // Así responde el SII a una calle inventada: solo comparte el número.
        {
          rol: '2345-167',
          direccion: 'AV EL BOSQUE 1234 BOX 22 ',
          nombreComuna: 'PROVIDENCIA',
          destinoDescripcion: 'ESTACIONAMIENTO',
        },
      ],
    });

    const result = await lookupRolSII(
      { address: 'Providencia 1234', comuna: 'Providencia' },
      fetchImpl
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.total).toBe(1);
      expect(result.candidates.map((candidate) => candidate.rol)).toEqual(['14-345']);
    }
  });

  it('recorta la lista pero informa el total de predios de la dirección', async () => {
    const predios = Array.from({ length: 20 }, (_, index) => ({
      rol: `14-${900 + index}`,
      direccion: `PROVIDENCIA 1234 BX ${100 + index}`,
      nombreComuna: 'PROVIDENCIA',
      destinoDescripcion: 'ESTACIONAMIENTO',
    }));
    const { fetchImpl } = fakeSii({ predios });

    const result = await lookupRolSII(
      { address: 'Providencia 1234', comuna: 'Providencia' },
      fetchImpl
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.total).toBe(20);
      expect(result.candidates).toHaveLength(12);
    }
  });

  it('no devuelve nombre del propietario ni RUT', async () => {
    const { fetchImpl } = fakeSii();

    const result = await lookupRolSII(
      { address: 'Providencia 1234', comuna: 'Providencia' },
      fetchImpl
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('PROPIETARIO');
    expect(serialized).not.toContain('11111111');
    expect(serialized).not.toContain('nombreProp');
  });

  it('dice not_found cuando la dirección no tiene predios', async () => {
    const { fetchImpl } = fakeSii({ predios: [] });

    const result = await lookupRolSII(
      { address: 'Providencia 99999', comuna: 'Providencia' },
      fetchImpl
    );

    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
    if (!result.ok) expect(result.error).toContain('no encontró predios');
  });

  it('una dirección sin número o una comuna desconocida no llegan al SII', async () => {
    const { fetchImpl, calls } = fakeSii();

    const sinNumero = await lookupRolSII({ address: 'Av. Providencia', comuna: 'Providencia' }, fetchImpl);
    expect(sinNumero).toMatchObject({ ok: false, reason: 'invalid' });
    const sinComuna = await lookupRolSII({ address: 'Providencia 1234', comuna: '' }, fetchImpl);
    expect(sinComuna).toMatchObject({ ok: false, reason: 'invalid' });
    expect(calls).toHaveLength(0);
  });

  it('una comuna que el SII no conoce es un dato inválido, no un fallo del SII', async () => {
    const { fetchImpl } = fakeSii();

    const result = await lookupRolSII(
      { address: 'Providencia 1234', comuna: 'Comuna Inventada' },
      fetchImpl
    );

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    if (!result.ok) expect(result.error).toContain('no reconoce la comuna');
  });

  it('resuelve las comunas que la app escribe distinto que el SII', async () => {
    const { fetchImpl, calls } = fakeSii({ predios: [] });

    await lookupRolSII({ address: 'Los Aromos 12', comuna: 'Paiguano' }, fetchImpl);

    expect(calls.some((url) => url.includes('getPrediosDireccion'))).toBe(true);
  });

  it('si el SII no responde, es upstream y no un «no existe»', async () => {
    const { fetchImpl } = fakeSii({ fail: true });

    const result = await lookupRolSII(
      { address: 'Providencia 1234', comuna: 'Providencia' },
      fetchImpl
    );

    expect(result).toMatchObject({ ok: false, reason: 'upstream' });
  });

  it('un error HTTP del SII también es upstream', async () => {
    const { fetchImpl } = fakeSii({ status: 503 });

    const result = await lookupRolSII(
      { address: 'Providencia 1234', comuna: 'Providencia' },
      fetchImpl
    );

    expect(result).toMatchObject({ ok: false, reason: 'upstream' });
  });

  it('reutiliza el catálogo de comunas entre búsquedas', async () => {
    const { fetchImpl, calls } = fakeSii();

    await lookupRolSII({ address: 'Providencia 1234', comuna: 'Providencia' }, fetchImpl);
    await lookupRolSII({ address: 'Providencia 1234', comuna: 'Providencia' }, fetchImpl);

    expect(calls.filter((url) => url.includes('listComunas'))).toHaveLength(1);
  });
});
