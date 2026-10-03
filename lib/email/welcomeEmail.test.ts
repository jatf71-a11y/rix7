import { describe, expect, it } from 'vitest';
import { buildWelcomeEmail } from './welcomeEmail';

const siteUrl = 'https://rix7.cl';

describe('buildWelcomeEmail', () => {
  it('saluda por el primer nombre', () => {
    const email = buildWelcomeEmail({ name: 'María José Rojas', siteUrl });
    expect(email.subject).toContain('María');
    expect(email.html).toContain('¡Bienvenido, María!');
    expect(email.text.startsWith('¡Bienvenido, María!')).toBe(true);
  });

  it('mantiene un saludo neutro cuando no hay nombre utilizable', () => {
    const email = buildWelcomeEmail({ name: '   ', siteUrl });
    expect(email.subject).toBe('¡Bienvenido a Rix7! Tu cuenta está lista');
    expect(email.html).toContain('¡Bienvenido a Rix7!');
  });

  it('lleva la identidad del portal: marca, azul y rasgos propios', () => {
    const email = buildWelcomeEmail({ name: 'Javier', siteUrl });
    expect(email.html).toContain('Rix<span style="color:#3b82f6">7</span>');
    expect(email.html).toContain('#2563eb');
    expect(email.text).toContain('Portal inmobiliario inteligente de Chile');
    expect(email.html).toContain('Mapa inteligente de todo Chile');
    expect(email.html).toContain('Búsquedas guardadas con alertas');
    expect(email.html).toContain('Calculadora de dividendo y monedas');
  });

  it('promete lo que el registro cumple: no volver a escribir los datos', () => {
    const email = buildWelcomeEmail({ name: 'Javier', siteUrl });
    expect(email.text).toContain('no tendrás que volver a escribir tus datos');
    expect(email.html).toContain('Ya no tendrás que repetir tus datos');
  });

  it('arma enlaces absolutos con la url del sitio', () => {
    const email = buildWelcomeEmail({ name: 'Javier', siteUrl });
    expect(email.html).toContain(`href="${siteUrl}/"`);
    expect(email.html).toContain(`href="${siteUrl}/favoritos"`);
    expect(email.html).toContain(`href="${siteUrl}/legal/privacidad"`);
  });

  it('escapa el nombre antes de meterlo en el HTML', () => {
    const email = buildWelcomeEmail({ name: '<script>alert(1)</script>', siteUrl });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('solo menciona la publicidad si la persona la aceptó', () => {
    const conMarketing = buildWelcomeEmail({ name: 'Javier', siteUrl, marketing: true });
    const sinMarketing = buildWelcomeEmail({ name: 'Javier', siteUrl });
    expect(conMarketing.html).toContain('aceptaste nuestras novedades');
    expect(sinMarketing.html).toContain('No lo usamos para publicidad');
  });

  it('incluye una versión de texto plano completa, sin HTML', () => {
    const email = buildWelcomeEmail({ name: 'Javier', siteUrl });
    expect(email.text).not.toContain('<');
    expect(email.text).toContain('Rix7 — Portal inmobiliario inteligente de Chile');
  });
});
