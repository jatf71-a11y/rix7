/**
 * Tests del correo de alerta de Sentry (1.4).
 *
 * El correo viaja por un proveedor externo y llega a una bandeja humana: acá
 * se fija lo que ese correo debe decir y —más importante— lo que **no** debe
 * decir: los títulos de issues provienen de mensajes de error que a veces
 * contienen HTML de la propia app que falló, y entra al correo sin escapar.
 */
import { describe, it, expect } from 'vitest';
import { ALERT_WORTHY_LEVELS, buildSentryAlertEmail, isAlertWorthy, type SentryAlertPayload } from './sentryAlertEmail';

const BASE: SentryAlertPayload = {
  action: 'issue',
  project: 'rix7',
  environment: 'production',
  level: 'error',
  title: 'TypeError: Cannot read properties of undefined',
  culprit: 'app/api/leads/route.ts in POST',
  eventId: 'abcdefgh12345678',
  issueUrl: 'https://sentry.io/organizations/ejemplo/issues/123/',
};

describe('isAlertWorthy', () => {
  it('solo error y fatal despiertan a alguien', () => {
    expect(isAlertWorthy({ level: 'error' })).toBe(true);
    expect(isAlertWorthy({ level: 'fatal' })).toBe(true);
    expect(isAlertWorthy({ level: 'warning' })).toBe(false);
    expect(isAlertWorthy({ level: 'info' })).toBe(false);
    // Default defensivo: nivel vacío se trata como error (mejor avisar de más).
    expect(isAlertWorthy({ level: '' })).toBe(true);
  });

  it('la lista de severidades no incluye niveles silenciosos', () => {
    expect(ALERT_WORTHY_LEVELS.has('debug')).toBe(false);
  });
});

describe('buildSentryAlertEmail', () => {
  it('arma asunto con severidad, entorno y evento acortado', () => {
    const email = buildSentryAlertEmail(BASE);
    expect(email.subject).toBe(
      '[Sentry:ERROR] production · TypeError: Cannot read properties of undefined (abcdefgh)'
    );
    expect(email.text).toContain('Detalle y triage: https://sentry.io/organizations/ejemplo/issues/123/');
    expect(email.html).toContain('Abrir en Sentry');
  });

  it('escapa el HTML que venga dentro del título del issue', () => {
    const email = buildSentryAlertEmail({
      ...BASE,
      title: 'Error en <script>alert("x")</script>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('escapa también culprit, stack y la URL del enlace', () => {
    const email = buildSentryAlertEmail({
      ...BASE,
      culprit: 'route in <b>POST</b>',
      firstStackFrame: 'app/x.ts:1 "> injected',
      issueUrl: 'https://sentry.io/?a=1&b=<script>',
    });
    expect(email.html).not.toContain('<b>POST</b>');
    expect(email.html).toContain('route in &lt;b&gt;POST&lt;/b&gt;');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('funciona con el mínimo de datos (sin culprit, stack ni evento)', () => {
    const email = buildSentryAlertEmail({
      action: 'error',
      project: 'rix7',
      environment: 'production',
      level: 'fatal',
      title: 'Fallo total',
    });
    expect(email.subject).toBe('[Sentry:FATAL] production · Fallo total');
    expect(email.text).not.toContain('Módulo:');
    expect(email.text).not.toContain('Origen:');
    expect(email.html).not.toContain('undefined');
  });
});
