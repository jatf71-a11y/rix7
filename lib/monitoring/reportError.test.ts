/**
 * @vitest-environment node
 *
 * Tests de `reportError`: la promesa del módulo es que el error **siempre**
 * quede en consola y que Sentry solo reciba eventos si está inicializado.
 * Activar el monitoreo no puede exigir cambiar código de nuevo.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const isInitialized = vi.fn();
const captureException = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  isInitialized: () => isInitialized(),
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { reportError } from './reportError';

describe('reportError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('siempre registra en consola, haya o no Sentry', () => {
    reportError(new Error('boom'));

    expect(console.error).toHaveBeenCalledTimes(1);
    const firstArg = vi.mocked(console.error).mock.calls[0]?.[0];
    expect(String(firstArg)).toContain('[monitoring]');
  });

  it('envía a Sentry cuando el SDK está inicializado, con el contexto extra', async () => {
    isInitialized.mockReturnValue(true);
    const error = new Error('ficha caída');

    // El retorno es la promesa del envío: esperarla es determinista, sin
    // sondeos con timeout que en el runner frío del CI podían expirar antes
    // de que el import dinámico resolviera.
    await reportError(error, { extra: { propertyId: 'scl-depto-marco-polo' } });

    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { propertyId: 'scl-depto-marco-polo' },
    });
  });

  it('no envía nada a Sentry si el SDK quedó sin inicializar (sin DSN)', async () => {
    isInitialized.mockReturnValue(false);

    // Esperar la promesa devuelta: así no queda ningún callback pendiente
    // que pueda derramarse al siguiente test.
    await reportError(new Error('sin dsn'));

    expect(captureException).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('acepta cualquier valor lanzado, no solo Error', () => {
    reportError('algo raro pasó', { extra: { where: 'pois' } });

    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
