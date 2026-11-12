import { describe, expect, it } from 'vitest';

import { assessMfa } from './mfa';

const factor = { id: 'factor-1', status: 'verified', factor_type: 'totp' };

describe('assessMfa', () => {
  it('sin factores no pide segundo factor, aunque la sesión sea aal1', () => {
    const state = assessMfa([], { currentLevel: 'aal1', nextLevel: 'aal1' });

    expect(state.enrolled).toBe(false);
    expect(state.requiresChallenge).toBe(false);
    expect(state.factorId).toBeNull();
  });

  it('con factor verificado y sesión aal1 pide el código', () => {
    const state = assessMfa([factor], { currentLevel: 'aal1', nextLevel: 'aal2' });

    expect(state.enrolled).toBe(true);
    expect(state.requiresChallenge).toBe(true);
    expect(state.factorId).toBe('factor-1');
  });

  it('con la sesión ya en aal2 no vuelve a pedirlo', () => {
    const state = assessMfa([factor], { currentLevel: 'aal2', nextLevel: 'aal2' });

    expect(state.requiresChallenge).toBe(false);
  });

  it('ignora los factores sin verificar', () => {
    const state = assessMfa(
      [{ id: 'factor-2', status: 'unverified', factor_type: 'totp' }],
      { currentLevel: 'aal1', nextLevel: 'aal1' }
    );

    expect(state.enrolled).toBe(false);
    expect(state.requiresChallenge).toBe(false);
    expect(state.factorId).toBeNull();
  });

  it('sin datos de nivel de garantía no bloquea el panel', () => {
    const state = assessMfa([factor], null);

    expect(state.enrolled).toBe(true);
    expect(state.requiresChallenge).toBe(false);
  });
});
