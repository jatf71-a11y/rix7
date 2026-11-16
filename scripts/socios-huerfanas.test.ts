import { describe, expect, it } from 'vitest';

import { findOrphans, parseArgs, withoutPartner } from './socios-huerfanas.mjs';

describe('findOrphans', () => {
  const users = [
    { id: '1', email: 'ok@x.cl', app_metadata: { partner_id: 'catedral', role: 'member' } },
    { id: '2', email: 'huerfana@x.cl', app_metadata: { partner_id: 'prueba-borrada' } },
    { id: '3', email: 'portal@x.cl', app_metadata: { provider: 'email' } },
    { id: '4', email: 'admin@x.cl', app_metadata: { role: 'admin' } },
  ];

  it('solo devuelve las que apuntan a un socio que no existe', () => {
    expect(findOrphans(users, ['catedral'])).toEqual([
      { id: '2', email: 'huerfana@x.cl', partnerId: 'prueba-borrada' },
    ]);
  });

  it('una cuenta sin corredora no es una huérfana', () => {
    const result = findOrphans(users, ['catedral']);
    expect(result.map((row) => row.id)).toEqual(['2']);
    expect(result.some((row) => row.id === '3' || row.id === '4')).toBe(false);
  });

  it('sin ningún socio, todas las cuentas vinculadas quedan huérfanas', () => {
    expect(findOrphans(users, [])).toHaveLength(2);
  });

  it('acepta un Set y ordena por correo', () => {
    const result = findOrphans(
      [
        { id: 'b', email: 'z@x.cl', app_metadata: { partner_id: 'no-existe' } },
        { id: 'a', email: 'a@x.cl', app_metadata: { partner_id: 'no-existe' } },
      ],
      new Set(['catedral'])
    );
    expect(result.map((row) => row.email)).toEqual(['a@x.cl', 'z@x.cl']);
  });

  it('no rompe con metadata rara', () => {
    expect(
      findOrphans([{ id: '1', email: null, app_metadata: { partner_id: 42 } }], ['catedral'])
    ).toEqual([]);
  });
});

describe('withoutPartner', () => {
  it('quita el vínculo y conserva el resto', () => {
    expect(withoutPartner({ partner_id: 'catedral', role: 'member', provider: 'email' })).toEqual({
      role: 'member',
      provider: 'email',
    });
  });

  it('tolera una metadata vacía', () => {
    expect(withoutPartner(undefined)).toEqual({});
  });
});

describe('parseArgs', () => {
  it('por defecto solo informa', () => {
    expect(parseArgs([])).toEqual({ apply: false, help: false });
  });

  it('--aplicar escribe, en sus dos idiomas', () => {
    expect(parseArgs(['--aplicar']).apply).toBe(true);
    expect(parseArgs(['--apply']).apply).toBe(true);
  });

  it('una opción desconocida corta sin tocar nada', () => {
    expect(parseArgs(['--forzar']).error).toContain('--forzar');
  });
});
