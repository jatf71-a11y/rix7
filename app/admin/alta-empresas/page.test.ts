import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminAltaEmpresasPage from './page';
import { KYB_STATUSES, KYB_STATUS_LABELS } from '@/lib/kyb/status';

/**
 * Arranque de la sección, sin navegador.
 *
 * `useEffect` no corre en el render estático, así que se ve el estado inicial:
 * lo que importa acá es que la pantalla monte sin romperse, que tenga su
 * encabezado y que ofrezca todos los filtros. La lista y la ficha tienen sus
 * propias pruebas.
 */

describe('sección de alta en el panel', () => {
  const html = renderToStaticMarkup(React.createElement(AdminAltaEmpresasPage));

  it('monta con su encabezado y el estado de carga', () => {
    expect(html).toContain('Alta de empresas');
    expect(html).toContain('Cargando altas');
  });

  it('ofrece un filtro por cada estado del flujo, más «Todas»', () => {
    expect(html).toContain('Todas');
    for (const status of KYB_STATUSES) {
      expect(html, status).toContain(KYB_STATUS_LABELS[status]);
    }
  });

  it('dice qué se verifica, para que el panel no sea solo una tabla de estados', () => {
    expect(html).toContain('Verificación automática de RUT');
    expect(html).toContain('reputación');
  });
});
