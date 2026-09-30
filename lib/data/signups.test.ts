import { describe, it, expect } from 'vitest';
import { CONSENT_VERSION, normalizeSignup, type NormalizedSignup } from '@/lib/utils/consents';
import { SIGNUP_COLUMNS, rowToSignup, toSignupInsert, type SignupRow } from './signups';

const alta: NormalizedSignup = {
  name: 'Javier Torres',
  email: 'javier@example.cl',
  phone: '+56 9 1234 5678',
  consents: {
    personal_data: true,
    terms: true,
    marketing: false,
    third_party: true,
  },
};

const fila: SignupRow = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Javier Torres',
  email: 'javier@example.cl',
  phone: '+56 9 1234 5678',
  consent_personal_data: true,
  consent_terms: true,
  consent_marketing: false,
  consent_third_party: true,
  consent_version: '2026-09-30',
  created_at: '2026-09-30T14:00:00Z',
};

describe('toSignupInsert', () => {
  it('lleva los datos y las cuatro autorizaciones a columnas, incluidas las no marcadas', () => {
    expect(toSignupInsert(alta)).toEqual({
      name: 'Javier Torres',
      email: 'javier@example.cl',
      phone: '+56 9 1234 5678',
      consent_personal_data: true,
      consent_terms: true,
      consent_marketing: false,
      consent_third_party: true,
      consent_version: CONSENT_VERSION,
    });
  });

  it('estampa la versión del servidor, no una que venga del cliente', () => {
    expect(toSignupInsert(alta).consent_version).toBe(CONSENT_VERSION);
    // El parámetro existe para probar el mapeo y para una futura migración de textos.
    expect(toSignupInsert(alta, '2027-01-01').consent_version).toBe('2027-01-01');
  });

  it('todo alta que la API acepta cumple el mínimo legal de la política RLS', () => {
    // Si esto falla, la base rechazaría un alta que la API dio por buena: la
    // política exige base de licitud y términos aceptados.
    const result = normalizeSignup({
      name: 'Javier Torres',
      email: 'javier@example.cl',
      phone: '+56 9 1234 5678',
      consents: { personal_data: true, terms: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const insert = toSignupInsert(result.signup);
    expect(insert.consent_personal_data).toBe(true);
    expect(insert.consent_terms).toBe(true);
    expect(insert.consent_version.length).toBeGreaterThan(0);
  });

  it('un alta sin las obligatorias ni siquiera llega a construirse', () => {
    expect(normalizeSignup({ ...alta, consents: { ...alta.consents, personal_data: false } }).ok).toBe(
      false
    );
  });
});

describe('rowToSignup', () => {
  it('vuelve a armar el estado de autorizaciones del panel', () => {
    expect(rowToSignup(fila)).toEqual({
      id: fila.id,
      name: 'Javier Torres',
      email: 'javier@example.cl',
      phone: '+56 9 1234 5678',
      consents: {
        personal_data: true,
        terms: true,
        marketing: false,
        third_party: true,
      },
      consentVersion: '2026-09-30',
      createdAt: '2026-09-30T14:00:00Z',
    });
  });

  it('conserva el «no autorizó»: false es un dato, no un hueco', () => {
    expect(rowToSignup(fila).consents.marketing).toBe(false);
  });
});

describe('SIGNUP_COLUMNS', () => {
  it('pide todas las columnas del mapeo (una omisión silenciosa se leería como false)', () => {
    for (const column of Object.keys(fila)) {
      expect(SIGNUP_COLUMNS).toContain(column);
    }
  });
});
