/**
 * Tests del texto de un fallo de lectura.
 *
 * Lo que hay que proteger es que un panel **nunca** diga «no hay datos» cuando en
 * realidad no pudo leerlos: fue el defecto que este módulo viene a arreglar (un
 * 401 se veía como «Todavía no hay contactos», y con él se habrían dado por
 * perdidos los contactos del proyecto viejo antes del corte).
 */
import { describe, expect, it } from 'vitest';

import { describeReadFailure } from './readFailure';

describe('describeReadFailure', () => {
  it('sin sesión de administración: es un permiso, no una lista vacía', () => {
    const failure = describeReadFailure(401, 'los contactos');

    expect(failure.kind).toBe('denied');
    expect(failure.detail).toContain('401');
    expect(failure.detail).toContain('administración');
  });

  it('403 se cuenta igual que 401: es la misma puerta', () => {
    expect(describeReadFailure(403, 'los registros').kind).toBe('denied');
  });

  it('sin respuesta: no hubo red, no es «no hay datos»', () => {
    const failure = describeReadFailure(null, 'los contactos', 'fetch failed');

    expect(failure.kind).toBe('unavailable');
    expect(failure.detail).toContain('fetch failed');
    expect(failure.detail).toContain('no es «no hay datos»');
  });

  it('un error del servidor se informa con su código', () => {
    const failure = describeReadFailure(500, 'los contactos');

    expect(failure.kind).toBe('unavailable');
    expect(failure.detail).toContain('500');
    expect(failure.detail).toContain('Actualizar');
  });

  it('un 2xx sin la lista se cuenta como falta de datos, no como caída', () => {
    const failure = describeReadFailure(200, 'los contactos', 'Sin proyecto configurado');

    expect(failure.kind).toBe('unavailable');
    expect(failure.title).toContain('sin los datos');
    expect(failure.detail).toContain('Sin proyecto configurado');
  });

  it('lo que dijo el cuerpo se conserva, para no obligar a abrir el log', () => {
    const failure = describeReadFailure(500, 'los contactos', 'No se pudo registrar el contacto');

    expect(failure.detail).toContain('No se pudo registrar el contacto');
  });

  it('ningún final afirma que no hay datos', () => {
    const casos = [
      describeReadFailure(401, 'los contactos'),
      describeReadFailure(500, 'los contactos'),
      describeReadFailure(null, 'los contactos', 'timeout'),
    ];

    for (const failure of casos) {
      expect(failure.detail.toLowerCase()).not.toContain('no hay contactos');
      expect(failure.detail.length).toBeGreaterThan(30);
      expect(failure.title.length).toBeGreaterThan(5);
    }
  });

  it('el texto empieza con mayúscula aunque lo que se lea venga en minúscula', () => {
    expect(describeReadFailure(401, 'los registros').detail.startsWith('Los registros')).toBe(true);
  });
});
