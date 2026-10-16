/**
 * Tests de `propertyRows` — el cruce entre la tabla y el catálogo del sitemap.
 *
 * Lo que no puede volver a pasar: que la misma ficha se publique dos veces, una
 * con el uuid de la tabla y otra con el id legible del catálogo. Fue el efecto de
 * cargar el catálogo en la base: 35 pares de URLs con el mismo contenido.
 */
import { describe, it, expect } from 'vitest';

import { mergePropertyRows } from './propertyRows';

describe('mergePropertyRows', () => {
  it('deja pasar las fichas del catálogo de una corredora que no está en la tabla', () => {
    const catalog = [
      { id: 'scl-casa-la-reina', partner_id: 'catedral', created_at: '2026-09-01T10:00:00Z' },
    ];

    const merged = mergePropertyRows([], catalog);

    expect(merged.map((row) => row.id)).toEqual(['scl-casa-la-reina']);
  });

  it('omite las fichas del catálogo cuya corredora ya tiene filas en la tabla', () => {
    // La base guarda el uuid; el catálogo, el id legible. La misma ficha en las
    // dos fuentes: una sola URL.
    const hot = [
      {
        id: 'b633effd-231f-567e-a9e9-935f93b49e8b',
        partner_id: 'catedral',
        created_at: '2026-09-01T10:00:00Z',
      },
    ];
    const catalog = [
      { id: 'scl-casa-la-reina', partner_id: 'catedral' },
      { id: 'inm-depto-concepcion', partner_id: 'savills' },
    ];

    const merged = mergePropertyRows(hot, catalog);

    expect(merged.map((row) => row.id)).toEqual([
      'b633effd-231f-567e-a9e9-935f93b49e8b',
      'inm-depto-concepcion',
    ]);
  });

  it('no repite por id ni toca las fichas sin corredora', () => {
    const hot = [
      { id: 'uuid-1', partner_id: null },
      { id: 'compartida', partner_id: 'cbre' },
    ];
    const catalog = [
      { id: 'compartida', partner_id: null },
      { id: 'suelta', partner_id: null },
    ];

    const merged = mergePropertyRows(hot, catalog);

    // `compartida` está en las dos: entra una vez, la de la tabla.
    expect(merged.map((row) => row.id)).toEqual(['uuid-1', 'compartida', 'suelta']);
  });

  it('una tabla vacía devuelve el catálogo completo', () => {
    const catalog = [
      { id: 'a', partner_id: 'catedral' },
      { id: 'b', partner_id: 'cbre' },
    ];

    expect(mergePropertyRows([], catalog)).toEqual(catalog);
  });
});
