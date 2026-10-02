/**
 * @vitest-environment node
 *
 * Tests de `/api/dev/outbox`: la ruta que deja abrir el correo capturado en
 * local. Lo importante es el apagado —fuera de `DEV_EMAIL_OUTBOX=1` no debe
 * existir— y que el HTML se sirve tal cual, sin reescribirse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NextRequest } from 'next/server';

import { captureOutbox, clearOutbox } from '@/lib/email/outbox';
import { DELETE, GET } from './route';

const mensaje = {
  to: 'maria@example.cl',
  subject: '¡Bienvenido, María!',
  html: '<p>Hola María</p>',
  text: 'Hola María',
};

const get = (url = 'http://localhost/api/dev/outbox') => GET(new NextRequest(url));
const getById = (id: string, format?: string) =>
  GET(
    new NextRequest(
      `http://localhost/api/dev/outbox?id=${encodeURIComponent(id)}${format ? `&format=${format}` : ''}`
    )
  );

beforeEach(() => {
  clearOutbox();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearOutbox();
});

describe('/api/dev/outbox', () => {
  it('sin DEV_EMAIL_OUTBOX=1 la ruta no existe (404)', async () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', undefined);

    expect((await get()).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
  });

  it('en Vercel responde 404 aunque la variable esté puesta', async () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', '1');

    expect((await get()).status).toBe(404);
  });

  it('lista los mensajes sin el HTML completo', async () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);
    captureOutbox(mensaje, { sent: false, skipped: true, error: 'Falta RESEND_API_KEY' });

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.data[0]).toMatchObject({
      to: 'maria@example.cl',
      subject: '¡Bienvenido, María!',
      skipped: true,
    });
    expect(body.data[0].html).toBeUndefined();
  });

  it('un id desconocido responde 404', async () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);

    expect((await getById('correo-999')).status).toBe(404);
  });

  it('format=html sirve el correo tal cual, como lo vería la bandeja', async () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);
    const id = captureOutbox(mensaje, { sent: false, skipped: true, error: 'Falta RESEND_API_KEY' })!;

    const res = await getById(id, 'html');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toBe('<p>Hola María</p>');
  });

  it('sin id devuelve el mensaje entero en JSON', async () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);
    const id = captureOutbox(mensaje, { sent: true, skipped: false })!;

    const body = await (await getById(id)).json();

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id, html: '<p>Hola María</p>', sent: true });
  });

  it('DELETE vacía el buzón', async () => {
    vi.stubEnv('DEV_EMAIL_OUTBOX', '1');
    vi.stubEnv('VERCEL', undefined);
    captureOutbox(mensaje, { sent: true, skipped: false });
    captureOutbox(mensaje, { sent: true, skipped: false });

    const body = await (await DELETE()).json();

    expect(body).toEqual({ success: true, removed: 2 });
    expect((await (await get()).json()).count).toBe(0);
  });
});
