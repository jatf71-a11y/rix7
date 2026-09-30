/**
 * Tests de la verificación de firma de webhooks de Sentry (1.4).
 *
 * Es el candado del receptor: si alguien lo afloja, cualquiera con la URL
 * puede fabricar "producción en llamas" a las 3 AM. Cubre el caso feliz
 * firmando exactamente como lo hace Sentry (HMAC-SHA256 sobre
 * `<timestamp>.<body>`, cabecera `t=…, v1=…`) y los cinco modos de rechazo.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { SENTRY_WEBHOOK_MAX_AGE_S, verifySentryWebhook } from './sentrySignature';

const SECRET = 'secreto-del-webhook-de-prueba';
const BODY = '{"action":"issue","data":{}}';

/** Firma igual que Sentry: HMAC-SHA256 sobre `<ts>.<body>`. */
function sign(timestamp: number, body: string, secret = SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp}, v1=${v1}`;
}

const NOW = 1_800_000_000; // segundos

describe('verifySentryWebhook', () => {
  it('acepta un webhook genuino y reciente', () => {
    const result = verifySentryWebhook({
      body: BODY,
      signatureHeader: sign(NOW, BODY),
      secret: SECRET,
      now: () => NOW * 1000,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rechaza sin secreto configurado (fail-closed)', () => {
    const result = verifySentryWebhook({
      body: BODY,
      signatureHeader: sign(NOW, BODY),
      secret: null,
      now: () => NOW * 1000,
    });
    expect(result).toEqual({ ok: false, reason: 'missing-secret' });
  });

  it('rechaza sin cabecera de firma', () => {
    const result = verifySentryWebhook({
      body: BODY,
      signatureHeader: null,
      secret: SECRET,
      now: () => NOW * 1000,
    });
    expect(result).toEqual({ ok: false, reason: 'missing-header' });
  });

  it('rechaza cabeceras malformadas (la vacía ya es missing-header)', () => {
    for (const header of ['t=abc', 'v1=deadbeef', 'algo suelto']) {
      const result = verifySentryWebhook({
        body: BODY,
        signatureHeader: header,
        secret: SECRET,
        now: () => NOW * 1000,
      });
      expect(result).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('rechaza webhooks más viejos que la ventana anti-replay', () => {
    const old = NOW - SENTRY_WEBHOOK_MAX_AGE_S - 1;
    const result = verifySentryWebhook({
      body: BODY,
      signatureHeader: sign(old, BODY),
      secret: SECRET,
      now: () => NOW * 1000,
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('acepta dentro de la ventana (borde inclusive)', () => {
    const edge = NOW - SENTRY_WEBHOOK_MAX_AGE_S;
    const result = verifySentryWebhook({
      body: BODY,
      signatureHeader: sign(edge, BODY),
      secret: SECRET,
      now: () => NOW * 1000,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rechaza firma inválida (secreto distinto o cuerpo alterado)', () => {
    const wrongSecret = verifySentryWebhook({
      body: BODY,
      signatureHeader: sign(NOW, BODY, 'otro-secreto'),
      secret: SECRET,
      now: () => NOW * 1000,
    });
    expect(wrongSecret).toEqual({ ok: false, reason: 'bad-signature' });

    const tampered = verifySentryWebhook({
      body: '{"action":"issue","data":{"injected":true}}',
      signatureHeader: sign(NOW, BODY),
      secret: SECRET,
      now: () => NOW * 1000,
    });
    expect(tampered).toEqual({ ok: false, reason: 'bad-signature' });
  });
});
