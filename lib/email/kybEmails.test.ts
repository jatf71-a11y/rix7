import { describe, it, expect } from 'vitest';
import {
  buildKybAcceptedEmail,
  buildKybActivatedEmail,
  buildKybPendingEmail,
  buildKybReceivedEmail,
  kybAccessUrl,
} from './kybEmails';

const token = 'a'.repeat(43);
const siteUrl = 'https://rix7.cl';

describe('correos KYB', () => {
  it('el acuse nombra la empresa y explica la evaluación', () => {
    const email = buildKybReceivedEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      siteUrl,
    });

    expect(email.subject).toContain('Catedral Propiedades SpA');
    expect(email.text).toContain('Hola Ana');
    expect(email.text).toMatch(/evaluación es automática/);
    expect(email.html).toContain('Catedral Propiedades SpA');
  });

  it('el correo de información lleva las preguntas y el enlace con token', () => {
    const email = buildKybPendingEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      questions: [
        { id: 'domain_web', question: '¿Cuál es el dominio oficial?' },
        { id: 'email_domain_match', question: '¿Por qué el correo es de otro dominio?' },
      ],
      token,
      siteUrl,
    });

    expect(email.text).toContain('1. ¿Cuál es el dominio oficial?');
    expect(email.text).toContain('2. ¿Por qué el correo es de otro dominio?');
    expect(email.text).toContain(`${siteUrl}/empresas/onboarding?token=${token}`);
    expect(email.html).toContain('¿Cuál es el dominio oficial?');
  });

  it('escapa el HTML que viene de la empresa', () => {
    const email = buildKybPendingEmail({
      legalName: 'Empresa <script>alert(1)</script>',
      contactName: 'Ana',
      questions: [{ id: 'x', question: '<b>¿Dominio?</b>' }],
      token,
      siteUrl,
    });

    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).not.toContain('<b>¿Dominio?</b>');
    expect(email.html).toContain('&lt;b&gt;');
  });

  it('el correo de aceptación lista los planes con precio', () => {
    const email = buildKybAcceptedEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      token,
      siteUrl,
    });

    expect(email.subject).toMatch(/aceptada/i);
    expect(email.text).toContain('Básico');
    expect(email.text).toContain('Profesional');
    expect(email.text).toContain('Premium');
    expect(email.html).toContain('Elegir plan');
  });

  it('el correo de panel habilitado usa el enlace mágico cuando existe', () => {
    const withLink = buildKybActivatedEmail({
      legalName: 'Catedral Propiedades SpA',
      planName: 'Profesional',
      panelUrl: `${siteUrl}/socio`,
      magicLink: 'https://auth.example.com/verify?token=abc',
      siteUrl,
    });
    expect(withLink.text).toContain('https://auth.example.com/verify?token=abc');
    expect(withLink.html).toContain('https://auth.example.com/verify?token=abc');

    const withoutLink = buildKybActivatedEmail({
      legalName: 'Catedral Propiedades SpA',
      planName: 'Básico',
      panelUrl: `${siteUrl}/socio`,
      siteUrl,
    });
    expect(withoutLink.text).toContain(`${siteUrl}/socio`);
  });

  it('el enlace de acceso codifica el token', () => {
    expect(kybAccessUrl(siteUrl, token)).toBe(`${siteUrl}/empresas/onboarding?token=${token}`);
  });
});
