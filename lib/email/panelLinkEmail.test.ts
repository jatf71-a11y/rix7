import { describe, expect, it } from 'vitest';

import { buildPanelLinkEmail } from './panelLinkEmail';

const PANEL = 'https://rix7.cl/socio/catedral';

describe('buildPanelLinkEmail', () => {
  const email = buildPanelLinkEmail({
    companyName: 'Catedral Propiedades',
    panelUrl: PANEL,
    siteUrl: 'https://rix7.cl',
  });

  it('nombra la corredora en el asunto y lleva el enlace propio', () => {
    expect(email.subject).toBe('Tu panel de Catedral Propiedades en Rix7');
    expect(email.text).toContain(PANEL);
    expect(email.html).toContain(`href="${PANEL}"`);
  });

  it('explica con qué cuenta se entra, sin pedir nada urgente', () => {
    expect(email.text).toContain('la cuenta que vinculamos a tu corredora');
    expect(email.html).not.toMatch(/urgente|vence|expira/i);
  });

  it('sale con la plantilla del portal', () => {
    expect(email.html).toContain('Rix7');
    expect(email.html).toContain('Abrir mi panel');
    // La dirección repetida en texto sirve cuando el cliente no abre el botón.
    expect(email.html.match(/socio\/catedral/g)?.length).toBeGreaterThan(1);
  });

  it('escapa el nombre de la corredora', () => {
    const risky = buildPanelLinkEmail({
      companyName: '<b>Corredora</b> & Cía',
      panelUrl: PANEL,
      siteUrl: 'https://rix7.cl',
    });
    expect(risky.html).toContain('&lt;b&gt;');
    expect(risky.html).not.toContain('<b>Corredora</b>');
  });
});
