import { describe, it, expect } from 'vitest';

import { buildPartnerInviteEmail } from './partnerInviteEmail';

const siteUrl = 'https://rix7.cl';
const magicLink = 'https://rix7.cl/auth/confirm?token_hash=abc&type=magiclink';

describe('correo de invitación a la cuenta', () => {
  it('dice quién invita, a qué empresa entra y con qué rol', () => {
    const email = buildPartnerInviteEmail({
      companyName: 'Catedral Propiedades SpA',
      roleLabel: 'Publica propiedades',
      usersIncluded: 5,
      panelUrl: `${siteUrl}/socio/cuenta`,
      magicLink,
      siteUrl,
    });

    expect(email.subject).toContain('Catedral Propiedades SpA');
    expect(email.text).toContain('Catedral Propiedades SpA');
    expect(email.text).toContain('Publica propiedades');
    expect(email.text).toContain('5 usuarios');
    // El enlace de un solo uso es el botón, no el panel genérico.
    expect(email.text).toContain(magicLink);
    expect(email.html).toContain(magicLink.replace(/&/g, '&amp;'));
  });

  it('sin enlace mágico manda al panel, y escapa el nombre de la empresa', () => {
    const email = buildPartnerInviteEmail({
      companyName: '<script>alert(1)</script>',
      roleLabel: 'Administra la cuenta',
      usersIncluded: 1,
      panelUrl: `${siteUrl}/socio/cuenta`,
      siteUrl,
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.text).toContain(`${siteUrl}/socio/cuenta`);
    expect(email.text).toContain('1 usuario');
  });
});
