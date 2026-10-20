import { describe, expect, it } from 'vitest';

import { parseStoredRegistration } from '../lib/utils/registration';
import {
  CARD_GATE_TITLE,
  FICHA_GATES,
  FICHA_PATH,
  REGISTRATION_KEY,
  REGISTRATION_SEED,
  allPassed,
  makeCheck,
  parseArgs,
  registrationJson,
} from './gate-e2e.mjs';

describe('gate-e2e · argumentos', () => {
  it('por defecto no fija base ni puerto y respeta CHROME_PATH', () => {
    const previo = process.env.CHROME_PATH;
    process.env.CHROME_PATH = '/ruta/chrome';
    try {
      const args = parseArgs([]);
      expect(args.base).toBeNull();
      expect(args.port).toBeNull();
      expect(args.json).toBe(false);
      expect(args.chrome).toBe('/ruta/chrome');
    } finally {
      if (previo === undefined) delete process.env.CHROME_PATH;
      else process.env.CHROME_PATH = previo;
    }
  });

  it('acepta --base con y sin «=» y quita la barra final', () => {
    expect(parseArgs(['--base', 'http://localhost:3123/']).base).toBe('http://localhost:3123');
    expect(parseArgs(['--base=http://localhost:4000']).base).toBe('http://localhost:4000');
  });

  it('leer --json y --port', () => {
    const args = parseArgs(['--json', '--port', '4123']);
    expect(args.json).toBe(true);
    expect(args.port).toBe(4123);
    expect(parseArgs(['--port=5000']).port).toBe(5000);
  });
});

describe('gate-e2e · fixtures', () => {
  it('el registro sembrado es uno que el portal reconoce', () => {
    // Si el fixture deja de cumplir las reglas de `parseStoredRegistration`, el
    // escenario «con registro» pasaría a probar el camino anónimo sin avisar.
    const parsed = parseStoredRegistration(registrationJson());
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe(REGISTRATION_SEED.name);
    expect(parsed?.email).toBe(REGISTRATION_SEED.email);
    expect(parsed?.phone).toBe(REGISTRATION_SEED.phone);
  });

  it('la clave de localStorage es la que usa el provider', () => {
    expect(REGISTRATION_KEY).toBe('rix7_contact_registration');
  });

  it('la ficha de prueba es una ruta de propiedad', () => {
    expect(FICHA_PATH).toMatch(/^\/properties\/[a-z0-9-]+$/);
  });

  it('cubre los cuatro botones de la ficha, cada uno con su aviso', () => {
    expect(FICHA_GATES).toHaveLength(4);
    const titulos = FICHA_GATES.map(([, , titulo]) => titulo);
    expect(new Set(titulos).size).toBe(4);
    expect(titulos.every((t) => t.startsWith('Regístrate para'))).toBe(true);
    expect(titulos).toContain(CARD_GATE_TITLE);
  });
});

describe('gate-e2e · resumen', () => {
  it('un check fallido hace fallar la corrida', () => {
    expect(allPassed([makeCheck('a', true, 'ok')])).toBe(true);
    expect(allPassed([makeCheck('a', true, 'ok'), makeCheck('b', false, 'falló')])).toBe(false);
  });

  it('una lista vacía no se considera una prueba pasada', () => {
    // Un runner que no ejecutó nada no puede salir verde.
    expect(allPassed([])).toBe(false);
  });
});
