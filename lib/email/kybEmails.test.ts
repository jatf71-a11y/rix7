import { describe, it, expect } from 'vitest';
import {
  buildKybAcceptedEmail,
  buildKybActivatedEmail,
  buildKybCaptacionEmail,
  buildKybPendingEmail,
  buildKybQualifiedEmail,
  buildKybReceivedEmail,
  kybAccessUrl,
} from './kybEmails';
import { DEFAULT_LEAD_BRACKETS } from '@/lib/kyb/planPricing';
import type { PlanOption } from '@/lib/kyb/proposal';

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

  it('el pedido de informe dice que tiene que ser de los últimos 30 días', () => {
    const email = buildKybPendingEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      questions: [{ id: 'debt_report', question: 'Adjunta tu informe de deudas' }],
      token,
      siteUrl,
    });

    expect(email.text).toContain('emitido dentro de los últimos 30 días');
    expect(email.html).toContain('emitido dentro de los');
    expect(email.html).toContain('30 días');
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

  it('el correo de aceptación muestra el plan y los montos de la propuesta', () => {
    const email = buildKybAcceptedEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      token,
      siteUrl,
      plan: {
        planId: 'profesional',
        planName: 'Profesional',
        altaClp: 49990,
        monthlyClp: 39990,
        usuariosIncluidos: 5,
        source: 'propuesta',
      },
    });

    expect(email.subject).toMatch(/aceptada/i);
    expect(email.text).toContain('Profesional');
    expect(email.text).toContain('39.990');
    expect(email.text).toContain('49.990');
    // Ya no se listan los tres planes del catálogo: el plan lo fijó la propuesta.
    expect(email.text).not.toContain('Premium');
    expect(email.html).toContain('Confirmar plan');
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

  it('el acuse dice que la solicitud ya está en evaluación y con qué datos', () => {
    const email = buildKybReceivedEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      siteUrl,
    });

    // Paso 1: fue recibida. Paso 2: se está evaluando.
    expect(email.text).toMatch(/Recibimos la solicitud/);
    expect(email.text).toMatch(/ya está en curso/);
    expect(email.text).toMatch(/datos que nos entregaste/);
    expect(email.text).toMatch(/conseguimos por nuestra cuenta/);
    expect(email.html).toContain('Con los datos que nos entregaste');
  });

  it('el correo de calificación lleva los tres planes y el enlace para elegir', () => {
    const plans: PlanOption[] = [
      {
        planId: 'basico',
        planName: 'Básico',
        altaClp: 19990,
        monthlyClp: 14990,
        usuariosIncluidos: 1,
        features: ['Ficha de empresa en el portal'],
        recommended: false,
      },
      {
        planId: 'profesional',
        planName: 'Profesional',
        altaClp: 49990,
        monthlyClp: 39990,
        usuariosIncluidos: 5,
        features: ['Cinco usuarios con acceso al panel'],
        recommended: true,
      },
      {
        planId: 'premium',
        planName: 'Premium',
        altaClp: 99990,
        monthlyClp: 99990,
        usuariosIncluidos: 20,
        features: ['Veinte usuarios con acceso al panel'],
        recommended: false,
      },
    ];

    const email = buildKybQualifiedEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      siteUrl,
      profileLabel: 'Corredora',
      plans,
      captacionMonthlyClp: 19990,
      planUrl: `${siteUrl}/empresas/plan?token=${token}`,
    });

    // Paso 4 (aceptada) y paso 5 (calificada, con los planes a la vista).
    expect(email.text).toMatch(/quedó aceptada y calificada/);
    expect(email.text).toContain('Perfil de socio: Corredora');
    expect(email.text).toContain('Plan Básico: $19.990 de alta y $14.990 al mes');
    expect(email.text).toContain('Plan Profesional: $49.990 de alta y $39.990 al mes');
    expect(email.text).toContain('Plan Premium: $99.990 de alta y $99.990 al mes');
    expect(email.text).toContain('5 usuarios');
    // Sin cupo de publicaciones: el CCA se factura sobre la cartera.
    expect(email.text).toContain('sin cupo');
    expect(email.text).not.toContain('publicaciones activas');
    // El enlace para elegir y la captación del perfil.
    expect(email.text).toMatch(/empresas\/plan\?token=/);
    expect(email.text).toContain('19.990');
    expect(email.html).toContain('Elegir mi plan');
    expect(email.html).toContain('sugerido para tu perfil');
    expect(email.html).toContain('Corredora');
  });

  it('el plan de captación se explica con sus tres componentes y sus tramos', () => {
    const email = buildKybCaptacionEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      siteUrl,
      profileLabel: 'Inmobiliaria',
      monthlyClp: 39990,
      ventas: DEFAULT_LEAD_BRACKETS.ventas,
      arriendos: DEFAULT_LEAD_BRACKETS.arriendos,
    });

    expect(email.text).toMatch(/Suscripción Captación Activa/);
    expect(email.text).toMatch(/leads de ventas/);
    expect(email.text).toMatch(/leads de arriendos/);
    expect(email.text).toContain('39.990');
    // Los tramos, con el último abierto.
    expect(email.text).toMatch(/UF 5\.000/);
    expect(email.text).toMatch(/Más de UF 40\.000/);
    expect(email.text).toMatch(/Más de \$1\.500\.000/);
    expect(email.html).toContain('Inmobiliaria');
  });

  it('el correo del alta confirma la captación y no habla del CCA', () => {
    const email = buildKybAcceptedEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      token,
      siteUrl,
      plan: {
        planId: 'profesional',
        planName: 'Profesional',
        altaClp: 49990,
        monthlyClp: 39990,
        usuariosIncluidos: 5,
        source: 'propuesta',
      },
      captacionMonthlyClp: 19990,
    });

    expect(email.text).toContain('Captación de leads: $19.990 al mes');
    expect(email.html).toContain('Captación de leads');
    // El CCA se determina después del alta, con la cartera del socio.
    expect(email.text).not.toMatch(/CCA/);
    expect(email.html).not.toMatch(/CCA/);
  });

  it('sin captación no aparece la línea del plan de captación', () => {
    const email = buildKybAcceptedEmail({
      legalName: 'Catedral Propiedades SpA',
      contactName: 'Ana Torres',
      token,
      siteUrl,
      plan: {
        planId: 'profesional',
        planName: 'Profesional',
        altaClp: 49990,
        monthlyClp: 39990,
        usuariosIncluidos: 5,
        source: 'propuesta',
      },
      captacionMonthlyClp: null,
    });

    expect(email.text).not.toContain('Captación de leads');
    expect(email.html).not.toContain('Captación de leads');
  });
});
