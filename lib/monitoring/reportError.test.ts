/**
 * @vitest-environment node
 *
 * Tests de `reportError`: la promesa es que el error **siempre**
 * quede en consola y que Sentry solo reciba eventos si está inicializado.
 * Activar el monitoreo no puede exigir cambiar código de nuevo.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  isInitialized: vi.fn(),
  captureException: vi.fn(),
}));

import { reportError } from './reportError';
import * as Sentry from '@sentry/nextjs';

const isInitializedMock = vi.mocked(Sentry.isInitialized);
const captureExceptionMock = vi.mocked(Sentry.captureException);

describe('reportError', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Estado por defecto: sin DSN. Se fija antes de la precarga para que el
    // warm-up no dispare captureException y ensucie al test que sigue.
    isInitializedMock.mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Precarga del módulo dinámico: reportError importa Sentry de forma
    // perezosa y en el runner frío del CI la resolución puede tardar más que
    // un tick. Al esperar el primer uso acá, ningún test compite contra el
    // import y ninguna promesa pendiente de un test anterior se cuela en el
    // siguiente (era el fallo intermitente del pipeline: el "boom" del primer
    // test llegaba a captureException durante el segundo).
    await reportError(new Error('warm-up'));
    consoleSpy.mockClear();
  });

  it('siempre registra en consola, haya o no Sentry', () => {
    reportError(new Error('boom'));

    expect(console.error).toHaveBeenCalledTimes(1);
    const firstArg = vi.mocked(console.error).mock.calls[0]?.[0];
    expect(String(firstArg)).toContain('[monitoring]');
  });

  it('envía a Sentry cuando el SDK está inicializado, con el contexto extra', async () => {
    isInitializedMock.mockReturnValue(true);
    const error = new Error('ficha caída');

    await reportError(error, { extra: { propertyId: 'scl-depto-marco-polo' } });

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      extra: { propertyId: 'scl-depto-marco-polo' },
    });
  });

  it('no envía nada a Sentry si el SDK quedó sin inicializar (sin DSN)', async () => {
    await reportError(new Error('sin dsn'));

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('acepta cualquier valor lanzado, no solo Error', async () => {
    await reportError('algo raro pasó', { extra: { where: 'pois' } });

    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
