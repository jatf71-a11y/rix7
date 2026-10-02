/**
 * Tests del buzón de salida local.
 *
 * Lo que hay que garantizar no es que «guarde»: es que **nada se guarda si
 * nadie lo encendió**, que el resultado real del envío viaja junto al mensaje
 * y que `sendEmail` devuelve el id solo cuando el buzón está activo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureOutbox, clearOutbox, getOutbox, isOutboxEnabled, listOutbox } from './outbox';
import { sendEmail, type EmailInput } from './sendEmail';

const mensaje: EmailInput = {
  to: 'maria@example.cl',
  subject: '¡Bienvenido, María!',
  html: '<p>Hola María</p>',
  text: 'Hola María',
};

beforeEach(() => {
  clearOutbox();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearOutbox();
});

describe('isOutboxEnabled', () => {
  it('está apagado por defecto', () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', undefined);
    expect(isOutboxEnabled()).toBe(false);
  });

  it('se enciende con DEV_EMAIL_OUTBOX=1', () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);
    expect(isOutboxEnabled()).toBe(true);
  });

  it('nunca se enciende en Vercel, aunque la variable suba por error', () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', '1');
    expect(isOutboxEnabled()).toBe(false);
  });
});

describe('captureOutbox', () => {
  it('apagado, no guarda nada y devuelve null', () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', undefined);

    const id = captureOutbox(mensaje, { sent: false, skipped: true, error: 'Falta RESEND_API_KEY' });

    expect(id).toBeNull();
    expect(listOutbox()).toHaveLength(0);
  });

  it('encendido, guarda el mensaje con el resultado real del envío', () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);

    const id = captureOutbox(mensaje, { sent: false, skipped: true, error: 'Falta RESEND_API_KEY' });

    expect(id).toMatch(/^correo-\d+$/);
    const entry = getOutbox(id!);
    expect(entry).toMatchObject({
      id,
      to: 'maria@example.cl',
      subject: '¡Bienvenido, María!',
      html: '<p>Hola María</p>',
      text: 'Hola María',
      sent: false,
      skipped: true,
      error: 'Falta RESEND_API_KEY',
    });
    expect(entry?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('los ids no se repiten y lo más reciente va primero', () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);

    const primero = captureOutbox(mensaje, { sent: true, skipped: false });
    const segundo = captureOutbox(mensaje, { sent: true, skipped: false });

    expect(primero).not.toBe(segundo);
    const ids = listOutbox().map((e) => e.id);
    expect(ids[0]).toBe(segundo);
    expect(ids[1]).toBe(primero);
  });

  it('acota el buzón: no crece sin límite', () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);

    for (let i = 0; i < 60; i++) {
      captureOutbox(mensaje, { sent: true, skipped: false });
    }

    expect(listOutbox().length).toBeLessThanOrEqual(50);
  });

  it('clearOutbox vacía y reporta cuántos sacó', () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);
    captureOutbox(mensaje, { sent: true, skipped: false });
    captureOutbox(mensaje, { sent: true, skipped: false });

    expect(clearOutbox()).toBe(2);
    expect(listOutbox()).toHaveLength(0);
    expect(clearOutbox()).toBe(0);
  });
});

describe('sendEmail con buzón', () => {
  it('sin clave ni buzón: skipped y sin outboxId', async () => {
    vi.stubEnv('RESEND_API_KEY', undefined);
    vi.stubEnv('DEV_EMAIL_OUTBOX', undefined);

    const result = await sendEmail(mensaje);

    expect(result).toEqual({
      sent: false,
      skipped: true,
      error: 'Falta RESEND_API_KEY',
    });
    expect(listOutbox()).toHaveLength(0);
  });

  it('sin clave pero con buzón: skipped igual (no se finge el envío) y devuelve el id', async () => {
    vi.stubEnv('RESEND_API_KEY', undefined);
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);

    const result = await sendEmail(mensaje);

    expect(result.skipped).toBe(true);
    expect(result.sent).toBe(false);
    expect(result.outboxId).toMatch(/^correo-\d+$/);
    expect(getOutbox(result.outboxId!)).toMatchObject({ sent: false, skipped: true });
  });

  it('con clave, el envío real se guarda igual en el buzón', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_prueba');
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail(mensaje);

    expect(result).toMatchObject({ sent: true, skipped: false });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getOutbox(result.outboxId!)).toMatchObject({ sent: true, skipped: false });
  });

  it('un fallo de Resend queda registrado con su error en el buzón', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_prueba');
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') }));

    const result = await sendEmail(mensaje);

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toContain('500');
    expect(getOutbox(result.outboxId!)).toMatchObject({ sent: false, skipped: false });
  });
});
