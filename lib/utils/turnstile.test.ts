import { describe, expect, it, vi } from 'vitest';
import { TURNSTILE_FAILED_MESSAGE, verifyTurnstile } from './turnstile';

function fetchReturning(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

describe('verifyTurnstile', () => {
  it('omite la verificación sin secreto y lo deja explícito', async () => {
    const fetchImpl = fetchReturning({ success: true });
    const result = await verifyTurnstile({ token: 'x', secret: '', fetchImpl });
    expect(result).toEqual({ ok: true, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rechaza un token ausente o vacío sin llamar a Cloudflare', async () => {
    const fetchImpl = fetchReturning({ success: true });
    for (const token of [undefined, null, '', '   ', 42]) {
      const result = await verifyTurnstile({ token, secret: 'secret', fetchImpl });
      expect(result).toEqual({ ok: false, error: TURNSTILE_FAILED_MESSAGE });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('acepta cuando Cloudflare responde success y envía secreto, token e IP', async () => {
    const fetchImpl = fetchReturning({ success: true });
    const result = await verifyTurnstile({
      token: ' tok ',
      ip: '1.2.3.4',
      secret: 'secret',
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, skipped: false });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const sent = init.body as URLSearchParams;
    expect(sent.get('secret')).toBe('secret');
    expect(sent.get('response')).toBe('tok');
    expect(sent.get('remoteip')).toBe('1.2.3.4');
  });

  it('rechaza cuando Cloudflare responde success false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await verifyTurnstile({
      token: 'tok',
      secret: 'secret',
      fetchImpl: fetchReturning({ success: false, 'error-codes': ['invalid-input-response'] }),
    });
    expect(result).toEqual({ ok: false, error: TURNSTILE_FAILED_MESSAGE });
    warn.mockRestore();
  });

  it('no acepta a ciegas si la API de Cloudflare falla', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await verifyTurnstile({ token: 'tok', secret: 'secret', fetchImpl });
    expect(result).toEqual({ ok: false, error: TURNSTILE_FAILED_MESSAGE });
    error.mockRestore();
  });
});
