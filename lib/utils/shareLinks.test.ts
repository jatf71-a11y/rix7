import { describe, expect, it } from 'vitest';
import { buildShareLinks, shareText } from './shareLinks';

const INPUT = {
  url: 'https://rix7.cl/compartir/scl-depto-marco-polo?utm=á',
  text: 'Departamento con vista · $ 85.000.000 — Rix7',
};

describe('buildShareLinks', () => {
  const links = buildShareLinks(INPUT);
  const byId = Object.fromEntries(links.map((l) => [l.id, l]));

  it('cubre las siete redes, con Instagram marcada como copiar-y-abrir', () => {
    expect(links.map((l) => l.id)).toEqual([
      'whatsapp',
      'facebook',
      'x',
      'instagram',
      'telegram',
      'linkedin',
      'email',
    ]);
    // Instagram no tiene endpoint web de compartir: href null es la señal.
    expect(byId.instagram.href).toBeNull();
    expect(byId.instagram.note).toMatch(/pegues/);
  });

  it('los destinos web son https y llevan la URL codificada', () => {
    for (const link of links) {
      if (!link.href) continue;
      expect(link.href, link.id).toMatch(/^(https:|mailto:)/);
      expect(link.href).toContain(encodeURIComponent(INPUT.url));
    }
  });

  it('el texto viaja codificado (un & sin codificar partiría el mensaje)', () => {
    expect(byId.whatsapp.href).toContain(encodeURIComponent(INPUT.text));
    expect(byId.x.href).toContain(`text=${encodeURIComponent(INPUT.text)}`);
    expect(byId.telegram.href).toContain(`text=${encodeURIComponent(INPUT.text)}`);
    expect(byId.email.href).toContain(`subject=${encodeURIComponent(INPUT.text)}`);
    // Ningún href contiene el texto crudo con caracteres de query.
    expect(byId.whatsapp.href).not.toContain('85.000.000 —');
  });

  it('WhatsApp mete enlace DENTRO del texto (su formato es un solo parámetro)', () => {
    expect(byId.whatsapp.href).toBe(
      `https://wa.me/?text=${encodeURIComponent(`${INPUT.text} ${INPUT.url}`)}`
    );
  });

  it('el correo lleva texto y landing en el cuerpo, no una URL pelada', () => {
    const href = byId.email.href;
    expect(href).toBeTruthy();
    const body = new URLSearchParams(href!.split('?')[1]).get('body');

    expect(body).toContain(INPUT.url);
    expect(body).toContain(INPUT.text);
  });

  it('Facebook y LinkedIn comparten solo la URL (título lo toma la tarjeta OG)', () => {
    expect(byId.facebook.href).toBe(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(INPUT.url)}`
    );
    expect(byId.linkedin.href).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(INPUT.url)}`
    );
  });
});

describe('shareText', () => {
  it('arma título · precio en CLP — Rix7, con /mes para arriendos', () => {
    expect(shareText({ title: 'Casa en La Reina', price: 139_000_000 })).toBe(
      'Casa en La Reina · $ 139.000.000 — Rix7'
    );
    expect(shareText({ title: 'Depto en arriendo', price: 650_000, isRent: true })).toBe(
      'Depto en arriendo · $ 650.000 /mes — Rix7'
    );
  });
});
