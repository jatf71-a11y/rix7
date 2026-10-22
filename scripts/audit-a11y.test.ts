/**
 * Tests del arranque de Chrome de la auditoría de accesibilidad.
 *
 * El 2026-10-22 el job de a11y se puso rojo sin un solo hallazgo: Chrome no
 * expuso el puerto de depuración a tiempo. Lo que se agregó —más margen,
 * reintentos con puerto y perfil nuevos, y el stderr del navegador en el
 * mensaje— es justo lo que estos tests fijan: que un arranque lento no se lea
 * como un fallo de accesibilidad, y que la comprobación de axe no se haya
 * relajado por el camino (el sandbox de Chrome sigue activo, `--fail-on-serious`
 * sigue decidiendo el exit code en `main`).
 *
 * No se lanza un navegador de verdad: la lógica de reintentos se prueba con un
 * `launch` falso, que es la parte que puede romperse en silencio.
 */
import { describe, expect, it, vi } from 'vitest';

import { chromeArgs, withChromeRetries } from './audit-a11y.mjs';

const noWait = () => Promise.resolve();

describe('withChromeRetries', () => {
  it('si el primer arranque funciona, no reintenta', async () => {
    const launch = vi.fn().mockResolvedValue({ port: 1234 });
    const onRetry = vi.fn();

    const session = await withChromeRetries({ launch, onRetry, wait: noWait });

    expect(session).toEqual({ port: 1234 });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('reintenta tras un arranque fallido y devuelve el que funcionó', async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Chrome no expuso el endpoint de depuración en 60 s'))
      .mockResolvedValueOnce({ port: 5678 });
    const onRetry = vi.fn();

    const session = await withChromeRetries({ launch, onRetry, wait: noWait });

    expect(session).toEqual({ port: 5678 });
    expect(launch).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // El aviso lleva el error real: es lo que explica el fallo en el log del CI.
    expect(onRetry.mock.calls[0][0].message).toContain('endpoint de depuración');
    expect(onRetry.mock.calls[0].slice(1)).toEqual([1, 3]);
  });

  it('se rinde al agotar los intentos y conserva el motivo de cada uno', async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error('falló 1'))
      .mockRejectedValueOnce(new Error('falló 2'))
      .mockRejectedValueOnce(new Error('falló 3'));
    const onRetry = vi.fn();
    const wait = vi.fn(noWait);

    const error = await withChromeRetries({ launch, onRetry, wait }).catch((e) => e);

    expect(launch).toHaveBeenCalledTimes(3);
    // Sin espera después del último intento: no hay nada más que esperar.
    expect(wait).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(error.message).toContain('es el navegador, no una regla de axe');
    expect(error.message).toContain('falló 3');
    expect(error.failures.map((e: Error) => e.message)).toEqual(['falló 1', 'falló 2', 'falló 3']);
  });

  it('un número de intentos inválido vuelve al valor por defecto en vez de no intentar nada', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('no arranca'));

    await withChromeRetries({ launch, attempts: 0, wait: noWait }).catch(() => {});

    expect(launch).toHaveBeenCalledTimes(3);
  });
});

describe('chromeArgs', () => {
  const args = chromeArgs({ port: 9333, profileDir: '/tmp/rix7-a11y-x/profile' });

  it('abre el puerto de depuración y usa un perfil propio', () => {
    expect(args).toContain('--remote-debugging-port=9333');
    expect(args).toContain('--user-data-dir=/tmp/rix7-a11y-x/profile');
    expect(args).toContain('--headless=new');
  });

  it('no desactiva el sandbox del navegador', () => {
    // Desactivarlo «arreglaría» un fallo de arranque escondiendo un problema
    // real del runner: si hiciera falta, se documenta, no se mete en silencio.
    expect(args).not.toContain('--no-sandbox');
  });
});
