import { describe, expect, it } from 'vitest';

import {
  buildSolicitudAcceptedEmail,
  buildSolicitudEvaluatingEmail,
  buildSolicitudPendingEmail,
  buildSolicitudReceivedEmail,
  buildSolicitudRejectedEmail,
} from './solicitudApplicantEmail';

/**
 * Los correos del solicitante son lo único que la persona ve del proceso
 * automático, así que acá se revisa lo que lee: el asunto y el membrete.
 *
 * El membrete decía «Registro de socios» y sobrevivía al renombre del sitio, con
 * lo cual el mismo trámite se llamaba distinto según se mirara la web o la
 * bandeja de entrada. Lo que se fija es el nombre nuevo, no la frase exacta.
 */
const SITE = 'https://rix7.cl';

const emails = () => [
  buildSolicitudReceivedEmail({
    name: 'María Soto',
    offerLabel: 'tu registro de Corredora',
    siteUrl: SITE,
  }),
  buildSolicitudEvaluatingEmail({
    name: 'María Soto',
    offerLabel: 'tu registro de Corredora',
    siteUrl: SITE,
  }),
  buildSolicitudPendingEmail({
    name: 'María Soto',
    offerLabel: 'tu registro de Corredora',
    questions: [{ id: 'email', question: '¿Cuál es el correo corporativo de la empresa?' }],
    link: 'https://rix7.cl/socios/responder/token-abc',
    siteUrl: SITE,
  }),
  buildSolicitudAcceptedEmail({
    name: 'María Soto',
    offerLabel: 'tu registro de Corredora',
    siteUrl: SITE,
  }),
  buildSolicitudRejectedEmail({
    name: 'María Soto',
    offerLabel: 'tu registro de Corredora',
    reason: 'El RUT no coincide con el nombre de la empresa.',
    siteUrl: SITE,
  }),
];

describe('correos del registro profesional', () => {
  it('membrete y firma dicen «Registro profesional»', () => {
    for (const email of emails()) {
      expect(email.html).toContain('Registro profesional');
      expect(email.text).toContain('Rix7 — Registro profesional');
    }
  });

  it('no queda ninguna mención a «socio» en asunto, texto ni HTML', () => {
    // Las URLs quedan fuera: `/socios/responder/...` es la ruta publicada y
    // cambiarla rompería los enlaces ya enviados. Lo que se revisa es lo que se
    // lee, no por dónde pasa.
    const visible = (value: string) => value.replace(/https?:\/\/\S+/g, ' ');
    for (const email of emails()) {
      expect(visible(`${email.subject}\n${email.text}\n${email.html}`)).not.toMatch(/soci[oa]s?\b/i);
    }
  });

  it('el pie explica por qué se recibe con el nombre nuevo', () => {
    for (const email of emails()) {
      expect(email.html).toContain('dejaste tus datos en el registro profesional de Rix7');
    }
  });

  it('el acuse informa solo la recepción, sin adelantar la evaluación', () => {
    const received = buildSolicitudReceivedEmail({
      name: 'María Soto',
      offerLabel: 'tu registro de Corredora',
      siteUrl: SITE,
    });

    expect(received.subject).toBe('Recibimos tu registro en Rix7');
    expect(received.text).toMatch(/etapa «Recibida»/);
    // El detalle de lo que se mira es del paso siguiente, no de este.
    expect(received.text).not.toMatch(/datos que nos entregaste/);
    expect(received.text).not.toMatch(/conseguimos por nuestra cuenta/);
    // Saluda por el nombre y no menciona «socio».
    expect(received.text).toContain('Hola María,');
    expect(`${received.subject}\n${received.text}`).not.toMatch(/soci[oa]s?\b/i);
  });

  it('la evaluación tiene su propio correo, con el detalle de lo que se mira', () => {
    const evaluating = buildSolicitudEvaluatingEmail({
      name: 'María Soto',
      offerLabel: 'tu registro de Corredora',
      siteUrl: SITE,
    });

    expect(evaluating.subject).toBe('Estamos evaluando tu registro en Rix7');
    expect(evaluating.text).toMatch(/etapa «En evaluación»/);
    expect(evaluating.text).toMatch(/datos que nos entregaste/);
    expect(evaluating.text).toMatch(/conseguimos por nuestra cuenta/);
    expect(evaluating.text).toContain('Hola María,');
    expect(`${evaluating.subject}\n${evaluating.text}`).not.toMatch(/soci[oa]s?\b/i);
  });

  it('el pedido de información sigue llevando sus preguntas y su enlace', () => {
    const pending = buildSolicitudPendingEmail({
      name: 'María Soto',
      offerLabel: 'tu registro de Corredora',
      questions: [{ id: 'email', question: '¿Cuál es el correo corporativo de la empresa?' }],
      link: 'https://rix7.cl/socios/responder/token-abc',
      siteUrl: SITE,
    });
    expect(pending.subject).toBe('Falta un dato para tu registro en Rix7');
    expect(pending.text).toContain('¿Cuál es el correo corporativo de la empresa?');
    expect(pending.html).toContain('https://rix7.cl/socios/responder/token-abc');
    expect(pending.subject).toMatch(/Falta un dato/);
  });

  it('el pedido de informe dice que tiene que ser de los últimos 30 días', () => {
    const pending = buildSolicitudPendingEmail({
      name: 'María Soto',
      offerLabel: 'tu registro de Corredora',
      questions: [{ id: 'debt_report', question: 'Adjunta tu informe de deudas' }],
      link: 'https://rix7.cl/socios/responder/token-abc',
      siteUrl: SITE,
    });
    expect(pending.text).toContain('emitido dentro de los últimos 30 días');
    expect(pending.html).toContain('30 días');
  });
});
