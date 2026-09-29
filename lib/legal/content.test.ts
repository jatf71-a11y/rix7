/**
 * Tests del contenido legal (hallazgo #6). El contenido vive en `lib/legal`,
 * así que los tests verifican el *dato* y no el markup: que los documentos
 * existan, sean sustanciosos, que los contactos y enlaces prometidos estén
 * presentes, y que páginas y footer los conecten de verdad (nada de páginas
 * legales inalcanzables, la forma exacta en que este hallazgo se manifestaba).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { PRIVACY_CONTACT, privacidad, terminos } from './content';
import { LegalPage } from '@/components/legal/LegalPage';

/** HTML plano de un documento legal renderizado, para aserciones de contenido. */
function renderLegal(doc: typeof terminos) {
  const other =
    doc === terminos
      ? { href: '/legal/privacidad', title: privacidad.title }
      : { href: '/legal/terminos', title: terminos.title };
  return renderToStaticMarkup(createElement(LegalPage, { doc, other }));
}

/** Cumple el contrato estructural mínimo de un documento legal. */
function expectCompleteDoc(doc: typeof terminos) {
  expect(doc.title.length).toBeGreaterThan(3);
  expect(doc.description.length).toBeGreaterThan(30);
  expect(doc.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(doc.intro.length).toBeGreaterThan(0);
  expect(doc.sections.length).toBeGreaterThanOrEqual(5);
  for (const section of doc.sections) {
    expect(section.title.length).toBeGreaterThan(3);
    expect(section.body.length).toBeGreaterThan(0);
  }
}

describe('Documentos legales', () => {
  it('términos y privacidad existen y están completos', () => {
    expectCompleteDoc(terminos);
    expectCompleteDoc(privacidad);
  });

  it('cada documento menciona el contacto de privacidad real', () => {
    // El correo no puede quedar como placeholder tipo "contacto@ejemplo.cl".
    for (const doc of [terminos, privacidad]) {
      const html = renderLegal(doc);
      expect(html).toContain(PRIVACY_CONTACT);
      expect(html).not.toMatch(/@(ejemplo|example|correo|tuemail)/i);
    }
  });

  it('la política declara la base legal chilena (Ley 19.628)', () => {
    const html = renderLegal(privacidad);
    expect(html).toContain('Ley 19.628');
  });

  it('los términos no prometen comisiones ni intermediación propia', () => {
    const html = renderLegal(terminos);
    expect(html).toContain('intermediario técnico');
  });

  it('no quedan rastreadores prometidos por error: sin "cookies publicitarias" afirmadas', () => {
    const html = renderLegal(privacidad);
    expect(html).toContain('no usa cookies de rastreo');
  });

  it('el pie de LegalPage enlaza al documento hermano y al portal', () => {
    const html = renderLegal(terminos);
    expect(html).toContain('href="/legal/privacidad"');
    expect(html).toContain('href="/"');
  });

  it('cada ítem del cuerpo se renderiza en su propio párrafo (no corrido)', () => {
    const html = renderLegal(privacidad);
    // Regresión: sin el <p> envolvente, los fragments del body pegaban los
    // párrafos corridos en el HTML servido («…rix7.cl.La identificación…»). El
    // número de <p> debe superar al de secciones porque cada ítem es uno.
    const parrafos = (html.match(/<p[ >]/g) || []).length;
    const itemsDeCuerpo = privacidad.sections.reduce((n, s) => n + s.body.length, 0);
    expect(parrafos).toBeGreaterThanOrEqual(itemsDeCuerpo);
    expect(html).not.toContain('.La identificación');
    expect(html).not.toContain('partes.La información');
  });

  it('los títulos de sección generan ids válidos para aria-labelledby', () => {
    const html = renderLegal(terminos);
    // Cada aria-labelledby debe apuntar a un id real con forma de slug
    // (un id con espacios o tildes rompe la referencia).
    const refs = Array.from(html.matchAll(/aria-labelledby="(h-[^"]+)"/g), (m) => m[1]);
    expect(refs.length).toBe(terminos.sections.length);
    for (const id of refs) {
      expect(id).toMatch(/^h-[a-z0-9-]+$/);
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe('Rutas legales', () => {
  const appDir = join(process.cwd(), 'app', 'legal');

  it('existen las páginas /legal/terminos y /legal/privacidad', () => {
    for (const page of ['terminos/page.tsx', 'privacidad/page.tsx']) {
      const src = readFileSync(join(appDir, page), 'utf-8');
      expect(src).toContain('LegalPage');
      expect(src).toContain('metadata');
    }
  });

  it('las páginas usan canonical propio', () => {
    const terminosSrc = readFileSync(join(appDir, 'terminos/page.tsx'), 'utf-8');
    const privacidadSrc = readFileSync(join(appDir, 'privacidad/page.tsx'), 'utf-8');
    expect(terminosSrc).toContain("canonical: '/legal/terminos'");
    expect(privacidadSrc).toContain("canonical: '/legal/privacidad'");
  });
});

describe('Footer con enlaces legales', () => {
  const footerPath = join(process.cwd(), 'components', 'layout', 'Footer.tsx');

  it('el footer existe y enlaza ambas páginas legales', () => {
    const src = readFileSync(footerPath, 'utf-8');
    expect(src).toContain('/legal/terminos');
    expect(src).toContain('/legal/privacidad');
  });

  it('el layout raíz monta el footer (si no, los enlaces no aparecen en ninguna página)', () => {
    const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf-8');
    expect(layout).toContain('<Footer />');
  });
});

describe('Sitemap incluye las páginas legales', () => {
  it('el generador las lista', () => {
    const src = readFileSync(join(process.cwd(), 'app', 'sitemap.ts'), 'utf-8');
    expect(src).toContain("'/legal/terminos'");
    expect(src).toContain("'/legal/privacidad'");
  });
});
