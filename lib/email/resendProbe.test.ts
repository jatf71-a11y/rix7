/**
 * Tests de la sonda de Resend.
 *
 * Lo que importa: que una clave rechazada se distinga de una que no se pudo
 * comprobar (nunca al revés), y que la caché no repita la consulta ni deje dos
 * requests en vuelo preguntando a la vez.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RESEND_PROBE_TTL_MS,
  observeResendKey,
  resetResendProbeCache,
} from './resendProbe';

const KEY = 're_abcdefghijklmnopqrstuvwxyz';

const respond = (status: number, body = '') => async () => new Response(body, { status });
const asFetch = (impl: (...args: never[]) => Promise<Response>) => impl as unknown as typeof fetch;

describe('observeResendKey', () => {
  beforeEach(() => {
    resetResendProbeCache();
  });

  it('sin clave no consulta nada', async () => {
    const fetchImpl = vi.fn();

    expect(await observeResendKey({ key: null, fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('una clave revocada queda como rechazada, con lo que dijo Resend', async () => {
    const observation = await observeResendKey({
      key: KEY,
      fetchImpl: asFetch(respond(400, '{"message":"API key is invalid"}')),
    });

    expect(observation).toMatchObject({ state: 'invalid', status: 400 });
    expect(observation?.detail).toContain('API key is invalid');
  });

  it('un 200 significa que Resend la acepta', async () => {
    const observation = await observeResendKey({
      key: KEY,
      fetchImpl: asFetch(respond(200, '{"data":[]}')),
    });

    expect(observation).toMatchObject({ state: 'valid', status: 200, detail: null });
  });

  it('un 5xx no acusa a la clave', async () => {
    const observation = await observeResendKey({ key: KEY, fetchImpl: asFetch(respond(503)) });

    expect(observation).toMatchObject({ state: 'unverified', status: 503 });
  });

  it('un corte de red es «no se pudo comprobar», no una clave vencida', async () => {
    const failing = (async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;

    const observation = await observeResendKey({ key: KEY, fetchImpl: failing });

    expect(observation).toMatchObject({ state: 'unverified', status: null });
    expect(observation?.detail).toContain('fetch failed');
  });

  it('dentro del plazo la respuesta sale de la caché', async () => {
    const fetchImpl = vi.fn(respond(200));

    await observeResendKey({ key: KEY, fetchImpl: fetchImpl as unknown as typeof fetch, now: 1_000 });
    await observeResendKey({
      key: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: 1_000 + RESEND_PROBE_TTL_MS - 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('vencido el plazo vuelve a preguntar', async () => {
    const fetchImpl = vi.fn(respond(200));

    await observeResendKey({ key: KEY, fetchImpl: fetchImpl as unknown as typeof fetch, now: 1_000 });
    await observeResendKey({
      key: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: 1_000 + RESEND_PROBE_TTL_MS + 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('dos requests a la vez comparten una sola consulta', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return new Response('{"data":[]}', { status: 200 });
    });

    const first = observeResendKey({ key: KEY, fetchImpl: fetchImpl as unknown as typeof fetch });
    const second = observeResendKey({ key: KEY, fetchImpl: fetchImpl as unknown as typeof fetch });
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('otra clave no reusa la caché de la anterior', async () => {
    const fetchImpl = vi.fn(respond(200));

    await observeResendKey({ key: KEY, fetchImpl: fetchImpl as unknown as typeof fetch });
    await observeResendKey({ key: 're_otraclaveabcdefghijklmn', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
