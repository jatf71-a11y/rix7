/**
 * @vitest-environment node
 *
 * Tests de la consulta de contribuciones al SII.
 *
 * No salen a internet: el `fetch` se reemplaza por uno falso que responde como
 * el servicio real. El fixture imita la respuesta de `buscarPropiedades`
 * (cuotas por año) con un nombre de propietario inventado, para comprobar que
 * ese dato —y la dirección— **no** salen de este módulo.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  annualFromCuotas,
  lookupContribucionesSII,
  resetSiiCatalogCache,
  siiKey,
  splitRol,
  type FetchLike,
} from './siiContribuciones';

const COMUNAS = [
  { codigo: 6109, region: 6, descripcion: 'LAS CABRAS' },
  { codigo: 13101, region: 13, descripcion: 'SANTIAGO' },
  { codigo: 5101, region: 5, descripcion: 'SANTIAGO' },
];

const REGIONES = [
  { codigo: 6, descripcion: "REGION DEL LIBERTADOR BERNARDO O'HIGGINS" },
  { codigo: 13, descripcion: 'REGION METROPOLITANA DE SANTIAGO' },
  { codigo: 5, descripcion: 'REGION DE VALPARAISO' },
];

/**
 * Respuesta real de un ROL de Las Cabras, recortada: dos cuotas del año viejo y
 * las cuatro del vigente. `valor` es la cuota trimestral completa (contribución
 * neta + sobretasas + aseo).
 */
const ITEM = {
  rol: '3-60',
  comuna: 6109,
  descripcionComuna: 'LAS CABRAS',
  // Datos personales que el módulo debe descartar.
  nombrePropietario: 'PROPIETARIO DE PRUEBA',
  direccion: 'CALLE DE PRUEBA 123',
  tieneCuotas: 6,
  cuotas: {
    '1': { agno: 2025, cuota: 3, valor: 194712, condicion: 'VENCIDA' },
    '2': { agno: 2025, cuota: 4, valor: 194712, condicion: 'VENCIDA' },
    '3': { agno: 2026, cuota: 1, valor: 198503, condicion: 'VENCIDA' },
    '4': { agno: 2026, cuota: 2, valor: 198503, condicion: 'VENCIDA' },
    '5': { agno: 2026, cuota: 3, valor: 203731, condicion: 'VENCIDA' },
    '6': { agno: 2026, cuota: 4, valor: 203731, condicion: 'VIGENTE' },
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FakeOptions {
  comunas?: unknown;
  regiones?: unknown;
  buscar?: (data: { codigoComuna: string; manzana: string; predio: string }) => {
    status?: number;
    body: unknown;
  };
  /** Simula que el SII no responde (DNS, timeout, HTML en vez de JSON). */
  fail?: boolean;
}

function fakeSii(options: FakeOptions = {}) {
  const calls: string[] = [];
  const bodies: Array<{ data?: Record<string, string> }> = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    bodies.push(init?.body ? JSON.parse(String(init.body)) : {});

    if (options.fail) throw new Error('sin red');

    if (url.includes('getComunas')) return json({ data: options.comunas ?? COMUNAS });
    if (url.includes('getRegiones')) return json({ data: options.regiones ?? REGIONES });
    if (url.includes('buscarPropiedades')) {
      const result = options.buscar
        ? options.buscar(
            (bodies[bodies.length - 1].data ?? {}) as {
              codigoComuna: string;
              manzana: string;
              predio: string;
            }
          )
        : { body: { data: [ITEM] } };
      return json(result.body, result.status ?? 200);
    }
    return json({}, 404);
  }) as unknown as FetchLike;

  return { fetchImpl, calls, bodies };
}

beforeEach(() => {
  resetSiiCatalogCache();
});

describe('siiKey', () => {
  it('ignora tildes, mayúsculas y separadores', () => {
    expect(siiKey('Región del Biobío')).toBe('REGIONDELBIOBIO');
    expect(siiKey('REGION DEL BIO BIO')).toBe('REGIONDELBIOBIO');
    expect(siiKey('Ñuñoa')).toBe('NUNOA');
  });
});

describe('splitRol', () => {
  it('separa manzana y predio y quita ceros a la izquierda', () => {
    expect(splitRol('3-060')).toEqual({ manzana: '3', predio: '60' });
    expect(splitRol(' 15234 - 67 ')).toEqual({ manzana: '15234', predio: '67' });
  });

  it('rechaza lo que no tiene forma de ROL', () => {
    expect(splitRol('sin-rol')).toBeNull();
    expect(splitRol('1234')).toBeNull();
    expect(splitRol('000-000')).toBeNull();
  });
});

describe('annualFromCuotas', () => {
  it('prefiere el año más reciente con las cuatro cuotas', () => {
    const cuotas = Object.values(ITEM.cuotas);
    expect(annualFromCuotas(cuotas)).toEqual({ annual: 804468, year: 2026 });
  });

  it('si ningún año tiene cuatro, usa el más reciente con lo que haya', () => {
    expect(annualFromCuotas([{ agno: 2025, valor: 100000 }, { agno: 2026, valor: 120000 }])).toEqual({
      annual: 120000,
      year: 2026,
    });
  });

  it('sin valores positivos no inventa un monto', () => {
    expect(annualFromCuotas([])).toEqual({ annual: null, year: null });
    expect(annualFromCuotas([{ agno: 2026, valor: 0 }])).toEqual({ annual: null, year: null });
  });
});

describe('lookupContribucionesSII', () => {
  it('consulta el ROL en la comuna y devuelve el monto anual del SII', async () => {
    const { fetchImpl } = fakeSii();

    const result = await lookupContribucionesSII(
      { rol: '3-060', comuna: 'Las Cabras', region: "Región del Libertador Bernardo O'Higgins" },
      fetchImpl
    );

    expect(result).toMatchObject({ ok: true, annual: 804468, year: 2026, source: 'sii' });
    if (result.ok) expect(new Date(result.checkedAt).getTime()).not.toBeNaN();
  });

  it('manda manzana y predio sin ceros a la izquierda y el código SII de la comuna', async () => {
    const { fetchImpl, bodies } = fakeSii();

    await lookupContribucionesSII({ rol: '3-060', comuna: 'Las Cabras' }, fetchImpl);

    const buscar = bodies.find((body) => {
      const meta = (body as { metaData?: { namespace?: string } }).metaData;
      return meta?.namespace?.endsWith('buscarPropiedades');
    }) as { data?: Record<string, string> } | undefined;

    expect(buscar?.data).toEqual({ codigoComuna: '6109', manzana: '3', predio: '60' });
  });

  it('no devuelve el nombre del propietario ni la dirección que trae el SII', async () => {
    const { fetchImpl } = fakeSii();

    const result = await lookupContribucionesSII(
      { rol: '3-60', comuna: 'Las Cabras' },
      fetchImpl
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('PROPIETARIO');
    expect(serialized).not.toContain('CALLE DE PRUEBA');
    expect(serialized).not.toContain('direccion');
  });

  it('dice not_found cuando el SII no lista el ROL', async () => {
    const { fetchImpl } = fakeSii({ buscar: () => ({ body: { data: [] } }) });

    const result = await lookupContribucionesSII(
      { rol: '999-9', comuna: 'Las Cabras' },
      fetchImpl
    );

    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
    if (!result.ok) expect(result.error).toContain('no encontró');
  });

  it('dice not_found cuando el ROL está exento y no tiene cuotas', async () => {
    const { fetchImpl } = fakeSii({
      buscar: () => ({ body: { data: [{ rol: '5-16', cuotas: {} }] } }),
    });

    const result = await lookupContribucionesSII(
      { rol: '5-16', comuna: 'Las Cabras' },
      fetchImpl
    );

    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
    if (!result.ok) expect(result.error).toContain('exento');
  });

  it('una comuna que el SII no conoce es un dato inválido, no un fallo del SII', async () => {
    const { fetchImpl } = fakeSii();

    const result = await lookupContribucionesSII(
      { rol: '3-60', comuna: 'Comuna Inventada' },
      fetchImpl
    );

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('desambigua comunas homónimas con la región', async () => {
    const { fetchImpl } = fakeSii();

    const sinRegion = await lookupContribucionesSII({ rol: '3-60', comuna: 'Santiago' }, fetchImpl);
    expect(sinRegion).toMatchObject({ ok: false, reason: 'invalid' });
    if (!sinRegion.ok) expect(sinRegion.error).toContain('más de una comuna');

    const { fetchImpl: again } = fakeSii();
    const conRegion = await lookupContribucionesSII(
      { rol: '3-60', comuna: 'Santiago', region: 'Región Metropolitana de Santiago' },
      again
    );
    expect(conRegion.ok).toBe(true);
  });

  it('un ROL mal formado o sin comuna no llega a consultar', async () => {
    const { fetchImpl, calls } = fakeSii();

    const rol = await lookupContribucionesSII({ rol: '1234', comuna: 'Las Cabras' }, fetchImpl);
    const comuna = await lookupContribucionesSII({ rol: '3-60', comuna: '' }, fetchImpl);

    expect(rol).toMatchObject({ ok: false, reason: 'invalid' });
    expect(comuna).toMatchObject({ ok: false, reason: 'invalid' });
    expect(calls).toHaveLength(0);
  });

  it('si el SII no responde, es upstream y no un «no existe»', async () => {
    const { fetchImpl } = fakeSii({ fail: true });

    const result = await lookupContribucionesSII(
      { rol: '3-60', comuna: 'Las Cabras' },
      fetchImpl
    );

    expect(result).toMatchObject({ ok: false, reason: 'upstream' });
  });

  it('reutiliza el catálogo de comunas entre consultas', async () => {
    const { fetchImpl, calls } = fakeSii();

    await lookupContribucionesSII({ rol: '3-60', comuna: 'Las Cabras' }, fetchImpl);
    await lookupContribucionesSII({ rol: '3-60', comuna: 'Las Cabras' }, fetchImpl);

    const catalogCalls = calls.filter((url) => url.includes('getComunas'));
    expect(catalogCalls).toHaveLength(1);
  });
});
