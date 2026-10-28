import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminAltaEmpresasPage from './page';

/**
 * Arranque de la sección, sin navegador.
 *
 * `useEffect` no corre en el render estático, así que se ve el estado inicial:
 * lo que importa acá es que la pantalla monte sin romperse, que tenga su
 * encabezado y que arranque en el pipeline con una columna por etapa. La lista,
 * los filtros y la ficha tienen sus propias pruebas.
 */

describe('sección de alta en el panel', () => {
  const html = renderToStaticMarkup(React.createElement(AdminAltaEmpresasPage));

  it('monta con su encabezado y el estado de carga', () => {
    expect(html).toContain('Alta de empresas');
    expect(html).toContain('Cargando altas');
  });

  it('deja cambiar entre pipeline y lista', () => {
    // La pantalla arranca en el pipeline y la lista queda a un clic; sin el
    // conmutador, los filtros por estado —que viven en la lista— quedarían
    // inalcanzables. Las columnas y sus conteos se arman con datos, que en el
    // render estático todavía están cargando.
    expect(html).toContain('aria-label="Cómo ver las altas"');
    expect(html).toContain('Pipeline');
    expect(html).toContain('Lista');
    expect(html).toContain('aria-pressed="true"');
  });

  it('dice qué se verifica, para que el panel no sea solo una tabla de estados', () => {
    expect(html).toContain('Verificación automática de RUT');
    expect(html).toContain('reputación');
  });
});
