import { describe, expect, it } from 'vitest';

import { buildMfaResetEmail } from './mfaResetEmail';

describe('buildMfaResetEmail', () => {
  const built = buildMfaResetEmail({
    companyName: 'Corredora & Cía',
    panelUrl: 'https://rix7.cl/socio/cuenta',
    siteUrl: 'https://rix7.cl',
  });

  it('dice en el asunto qué se desactivó', () => {
    expect(built.subject).toBe('Desactivamos la verificación en dos pasos de tu cuenta de Rix7');
  });

  it('cuenta qué cambió, qué no, y cómo volver a activarla', () => {
    expect(built.text).toContain('Corredora & Cía');
    expect(built.text).toContain('ya no te va a pedir el código');
    expect(built.text).toContain('Tu cuenta sigue igual');
    expect(built.text).toContain('https://rix7.cl/socio/cuenta');
  });

  it('deja una salida por si el reset no era para esa persona', () => {
    expect(built.text).toContain('Si no pediste esto, responde este correo');
    expect(built.html).toContain('revisamos el acceso a tu cuenta');
  });

  it('escapa el nombre de la empresa en el HTML', () => {
    expect(built.html).toContain('Corredora &amp; Cía');
    expect(built.html).not.toContain('Corredora & Cía');
  });

  it('enlaza al panel del socio en el HTML', () => {
    expect(built.html).toContain('href="https://rix7.cl/socio/cuenta"');
  });
});
