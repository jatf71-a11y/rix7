import { describe, expect, it } from 'vitest';

import { ERROR_LIMIT, emailLogRow, emailStatus } from './emailLog';

const INPUT = { to: 'socio@corredora.cl', subject: 'Tu panel en Rix7', html: '<p>x</p>', text: 'x' };

describe('emailStatus', () => {
  it('un envío aceptado es sent', () => {
    expect(emailStatus({ sent: true, skipped: false })).toBe('sent');
  });

  it('sin configuración es skipped, nunca sent', () => {
    expect(emailStatus({ sent: false, skipped: true, error: 'Falta RESEND_API_KEY' })).toBe(
      'skipped'
    );
  });

  it('un rechazo es failed', () => {
    expect(emailStatus({ sent: false, skipped: false, error: 'Resend respondió 422' })).toBe(
      'failed'
    );
  });
});

describe('emailLogRow', () => {
  it('guarda destinatario, asunto y plantilla', () => {
    const row = emailLogRow({ ...INPUT, template: 'panel_link' }, { sent: true, skipped: false });
    expect(row).toEqual({
      to_email: 'socio@corredora.cl',
      subject: 'Tu panel en Rix7',
      template: 'panel_link',
      status: 'sent',
      error: null,
      outbox_id: null,
    });
  });

  it('sin plantilla queda nula, no vacía', () => {
    expect(emailLogRow(INPUT, { sent: true, skipped: false }).template).toBeNull();
  });

  it('conserva el motivo cuando no salió', () => {
    const row = emailLogRow(INPUT, {
      sent: false,
      skipped: false,
      error: 'Resend respondió 422: dominio no verificado',
    });
    expect(row.status).toBe('failed');
    expect(row.error).toContain('dominio no verificado');
  });

  it('recorta un error enorme: es diagnóstico, no volcado', () => {
    const row = emailLogRow(INPUT, { sent: false, skipped: false, error: 'x'.repeat(5000) });
    expect(row.error).toHaveLength(ERROR_LIMIT);
  });

  it('un envío exitoso no arrastra error aunque venga', () => {
    expect(
      emailLogRow(INPUT, { sent: true, skipped: false, error: 'resto de un reintento' }).error
    ).toBeNull();
  });

  it('no guarda el cuerpo del correo', () => {
    const row = emailLogRow({ ...INPUT, html: '<a href="secreto">x</a>' }, { sent: true, skipped: false });
    expect(JSON.stringify(row)).not.toContain('secreto');
  });
});
