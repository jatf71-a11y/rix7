import { describe, it, expect } from 'vitest';

import { nextMonthStart } from './partnerAccount';

/**
 * El período que ve el socio es mensual: arranca el primer día del mes siguiente
 * al alta y no se prorratea. Lo único que se prueba acá es esa fecha; el resto de
 * la cuenta depende de la base.
 */
describe('nextMonthStart', () => {
  it('con fecha de alta, el período corre hasta el primer día del mes siguiente', () => {
    expect(nextMonthStart('2026-11-11T15:57:00.000Z')).toBe('2026-12-01T00:00:00.000Z');
    expect(nextMonthStart('2026-12-31T23:59:00.000Z')).toBe('2027-01-01T00:00:00.000Z');
  });

  it('sin fecha de alta usa hoy como referencia, para no mostrar «—»', () => {
    expect(nextMonthStart(null, new Date('2026-11-11T12:00:00.000Z'))).toBe(
      '2026-12-01T00:00:00.000Z'
    );
  });

  it('una fecha ilegible no inventa un período', () => {
    expect(nextMonthStart('no-es-fecha')).toBeNull();
  });
});
