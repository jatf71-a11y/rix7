import { describe, expect, it } from 'vitest';

import { shareGateDecision } from './shareGate';

describe('shareGateDecision', () => {
  it('sin identidad pide registro en vez de ejecutar la acción', () => {
    expect(shareGateDecision({ registration: null, isChecking: false })).toBe('prompt');
  });

  it('con registro del dispositivo o sesión ejecuta la acción', () => {
    const registration = { name: 'Ana', email: 'ana@example.com', phone: '+56911111111' };
    expect(shareGateDecision({ registration, isChecking: false })).toBe('run');
  });

  it('mientras se verifica la identidad ignora el clic, sin acusar falta de registro', () => {
    // Un visitante registrado ve el botón antes de que el cliente lea su
    // identidad; mostrarle el aviso en ese instante sería un falso positivo.
    expect(shareGateDecision({ registration: null, isChecking: true })).toBe('ignore');
    expect(shareGateDecision({ registration: { email: 'a@b.cl' }, isChecking: true })).toBe(
      'ignore'
    );
  });
});
