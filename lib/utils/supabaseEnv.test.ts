import { describe, it, expect } from 'vitest';
import {
  describeAnonKeyProblem,
  describeSupabaseUrlProblem,
  isSupabaseConfigured,
} from './supabaseEnv';

/**
 * Estos tests existen por un fallo real: con el placeholder puesto, el botón de
 * Google navegaba a un dominio inexistente y el usuario terminaba en la página
 * de error del navegador, sin explicación y sin forma de volver.
 */

describe('describeSupabaseUrlProblem', () => {
  it('acepta una URL real de proyecto', () => {
    expect(describeSupabaseUrlProblem('https://abcdefghijklm.supabase.co')).toBeNull();
  });

  it('acepta un dominio propio con https', () => {
    expect(describeSupabaseUrlProblem('https://api.rix7.cl')).toBeNull();
  });

  it('acepta Supabase local por http', () => {
    expect(describeSupabaseUrlProblem('http://localhost:54321')).toBeNull();
    expect(describeSupabaseUrlProblem('http://127.0.0.1:54321')).toBeNull();
  });

  it('rechaza el placeholder de desarrollo', () => {
    const problem = describeSupabaseUrlProblem('https://placeholder-project.supabase.co');
    expect(problem).toContain('valor de ejemplo');
  });

  it('rechaza las plantillas del .env.example', () => {
    expect(describeSupabaseUrlProblem('https://tu-proyecto-id.supabase.co')).not.toBeNull();
  });

  it('rechaza vacío, nulo y no definido', () => {
    expect(describeSupabaseUrlProblem('')).toContain('Falta');
    expect(describeSupabaseUrlProblem('   ')).toContain('Falta');
    expect(describeSupabaseUrlProblem(null)).toContain('Falta');
    expect(describeSupabaseUrlProblem(undefined)).toContain('Falta');
  });

  it('rechaza algo que no es una URL', () => {
    expect(describeSupabaseUrlProblem('no-soy-una-url')).toContain('No es una URL válida');
  });

  it('rechaza http en un dominio público', () => {
    expect(describeSupabaseUrlProblem('http://abcdefghijklm.supabase.co')).toContain('https');
  });
});

describe('describeAnonKeyProblem', () => {
  const realKey = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${'a'.repeat(40)}`;

  it('acepta una clave anon realista', () => {
    expect(describeAnonKeyProblem(realKey)).toBeNull();
  });

  it('rechaza el placeholder', () => {
    expect(describeAnonKeyProblem('placeholder-anon-key')).toContain('ejemplo');
  });

  it('rechaza la plantilla del example', () => {
    expect(describeAnonKeyProblem('tu-clave-anon-publica-aqui')).toContain('ejemplo');
  });

  it('rechaza vacío', () => {
    expect(describeAnonKeyProblem('')).toContain('Falta');
    expect(describeAnonKeyProblem(undefined)).toContain('Falta');
  });

  it('rechaza una clave demasiado corta', () => {
    expect(describeAnonKeyProblem('abc123')).toContain('demasiado corta');
  });
});

describe('isSupabaseConfigured', () => {
  const realKey = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${'a'.repeat(40)}`;

  it('es verdadero solo con las dos cosas reales', () => {
    expect(isSupabaseConfigured('https://abcdefghijklm.supabase.co', realKey)).toBe(true);
  });

  it('es falso con el placeholder puesto (el caso que rompía el botón de Google)', () => {
    expect(
      isSupabaseConfigured('https://placeholder-project.supabase.co', 'placeholder-anon-key')
    ).toBe(false);
  });

  it('es falso si solo falta la clave', () => {
    expect(isSupabaseConfigured('https://abcdefghijklm.supabase.co', '')).toBe(false);
  });
});
