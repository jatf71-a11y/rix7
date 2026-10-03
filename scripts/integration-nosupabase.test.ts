/**
 * Tests del núcleo de `integration-nosupabase.mjs`.
 *
 * El script corre contra la app real, pero su **criterio** —qué se espera de
 * cada camino sin Supabase— es puro y se prueba sin red ni servidor inyectando
 * un `fetch` falso. Es lo que hace que un cambio de contrato (por ejemplo, que
 * `GET /api/favorites` deje de ser 401) rompa acá antes de correr la suite de
 * verdad, y sobre todo cubre el caso que no se puede cubrir contra la app
 * sana: que un `200` con datos **haga fallar** la comprobación.
 */
import { describe, it, expect } from 'vitest';
import {
  DEV_COUNT_LABEL,
  SAMPLE_PROPERTY,
  formatReport,
  normalizeBaseUrl,
  request,
  runIntegration,
  validLeadPayload,
  validSavedSearchPayload,
} from './integration-nosupabase.mjs';

/** Lo que devuelve un `fetch` falso: el código y el cuerpo, nada más. */
type FakeResponse = { status: number; body: unknown };

/** Una ruta falsa: recibe la URL y el `init` y decide la respuesta. */
type FakeRoute = (url: string, init: { method?: string; body?: string }) => FakeResponse;

/** Respuesta de un `fetch` falso a partir de `{ status, body }`. */
function respond(fetchImpl: FakeRoute) {
  return async (url: string, init: { method?: string; body?: string } = {}) => {
    // `await` a propósito: si el falso lanza (servidor caído), la promesa se
    // rechaza y `request` la atrapa; sin await quedaría como rechazo sin manejar.
    const result = await fetchImpl(String(url), init);
    const status = result?.status ?? 200;
    const body = result?.body ?? {};
    return {
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
}

/** El servidor «sano»: cada ruta responde lo que debe sin Supabase. */
const healthyRoutes: FakeRoute = (url, init = {}) => {
  const path = new URL(url).pathname;
  const method = (init.method ?? 'GET').toUpperCase();

  if (path === '/api/health') {
    return { status: 503, body: { status: 'broken', missing: { broken: ['supabase'] } } };
  }
  if (path.startsWith('/api/favorites') || path.startsWith('/api/saved-searches')) {
    return { status: 401, body: { success: false, error: 'Inicia sesión.' } };
  }
  if (path === '/api/leads') {
    if (method !== 'POST') {
      return { status: 200, body: { success: true, data: [], source: 'memory', persistent: false } };
    }
    // La validación de dominio no depende de la base: sin correo, 400.
    const payload = JSON.parse(init.body ?? '{}');
    return payload.email
      ? { status: 201, body: { success: true, persisted: false } }
      : { status: 400, body: { success: false, error: 'Falta el correo.' } };
  }
  if (path.endsWith('/view')) {
    const counted = JSON.parse(init.body ?? '{}').counted !== false;
    return counted
      ? { status: 202, body: { success: true, views: 1, counted: true, persisted: false } }
      : { status: 200, body: { success: true, views: 1, counted: false, persisted: false } };
  }
  if (path.startsWith('/properties/')) {
    return { status: 200, body: `<html><span>${DEV_COUNT_LABEL} · se pierde al reiniciar</span></html>` };
  }
  return { status: 404, body: { error: 'no encontrado' } };
};

const run = (routes: FakeRoute) =>
  runIntegration({
    baseUrl: 'http://localhost:9999',
    // El doble devuelve solo `{ status, text }`: no hace falta un `Response`
    // completo para lo que el núcleo lee.
    fetchImpl: respond(routes) as unknown as typeof fetch,
  });

describe('normalizeBaseUrl', () => {
  it('quita la barra final', () => {
    expect(normalizeBaseUrl('http://x:1/')).toBe('http://x:1');
    expect(normalizeBaseUrl('http://x:1///')).toBe('http://x:1');
  });

  it('tolera vacío', () => {
    expect(normalizeBaseUrl(undefined)).toBe('');
  });
});

describe('payloads de la suite', () => {
  it('el contacto cumple las reglas de normalizeLead', () => {
    const lead = validLeadPayload();
    expect(lead.property_id).toBe(SAMPLE_PROPERTY);
    expect(lead.email).toMatch(/@/);
    expect(lead.phone.replace(/\D/g, '').length).toBeGreaterThanOrEqual(9);
    expect(['form', 'call', 'whatsapp', 'mail']).toContain(lead.channel);
  });

  it('la búsqueda guardada trae al menos un filtro (si no, la ruta la rechaza)', () => {
    const filters = validSavedSearchPayload();
    expect(filters.operation).not.toBe('all');
  });
});

describe('request', () => {
  it('parsea JSON y conserva el código', async () => {
    const fetchImpl = async () => ({ status: 201, text: async () => '{"a":1}' });
    expect(await request(fetchImpl, 'http://x')).toEqual({ ok: true, status: 201, body: { a: 1 } });
  });

  it('un cuerpo no-JSON se conserva como texto (para poder buscarlo)', async () => {
    const fetchImpl = async () => ({ status: 200, text: async () => '<html>hola</html>' });
    expect((await request(fetchImpl, 'http://x')).body).toBe('<html>hola</html>');
  });

  it('un fallo de red no lanza', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = await request(fetchImpl, 'http://x');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});

describe('runIntegration · app sin Supabase sana', () => {
  it('todas las comprobaciones pasan', async () => {
    const report = await run(healthyRoutes);
    const failed = report.checks.filter((c) => c.status === 'fail');
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('cubre los cuatro flujos y la ficha', async () => {
    const { checks } = await run(healthyRoutes);
    const names = checks.map((c) => c.name).join('\n');
    for (const expected of [
      '/api/health',
      '/api/favorites',
      '/api/saved-searches',
      '/api/leads',
      '.../view',
      '/properties/[id]',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('comprueba los tres métodos de favoritos y búsquedas', async () => {
    const { checks } = await run(healthyRoutes);
    const names = checks.map((c) => c.name);
    expect(names).toContain('GET /api/favorites → 401');
    expect(names).toContain('POST /api/favorites → 401');
    expect(names).toContain('DELETE /api/favorites → 401');
    expect(names).toContain('GET /api/saved-searches → 401');
    expect(names).toContain('POST /api/saved-searches → 401');
    expect(names).toContain('DELETE /api/saved-searches → 401');
  });

  it('acepta GET /api/leads en modo producción (503 fail-closed)', async () => {
    const report = await run((url: string, init) => {
      if (new URL(url).pathname === '/api/leads' && (init.method ?? 'GET') === 'GET') {
        return { status: 503, body: { success: false, error: 'Supabase no está configurado.' } };
      }
      return healthyRoutes(url, init);
    });
    expect(report.ok).toBe(true);
  });

  it('falla si GET /api/leads devuelve algo que no es ni memory ni fail-closed', async () => {
    const report = await run((url: string, init) => {
      if (new URL(url).pathname === '/api/leads' && (init.method ?? 'GET') === 'GET') {
        return { status: 500, body: { success: false } };
      }
      return healthyRoutes(url, init);
    });
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.name === 'GET /api/leads → no filtra contactos' && c.status === 'fail')).toBe(
      true
    );
  });
});

describe('runIntegration · el contrato se rompe', () => {
  it('falla si /api/health deja de marcar el crítico', async () => {
    const report = await run((url: string, init) => {
      if (new URL(url).pathname === '/api/health') {
        return { status: 200, body: { status: 'ok', missing: { broken: [] } } };
      }
      return healthyRoutes(url, init);
    });
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.name.includes('503 por crítico') && c.status === 'fail')).toBe(true);
  });

  it('falla si favoritos responde 200 sin sesión (fuga de datos)', async () => {
    const report = await run((url: string, init) => {
      const path = new URL(url).pathname;
      if (path === '/api/favorites' && (init.method ?? 'GET') === 'GET') {
        return { status: 200, body: { success: true, data: ['scl-depto-marco-polo'] } };
      }
      return healthyRoutes(url, init);
    });
    expect(report.ok).toBe(false);
    expect(
      report.checks.some((c) => c.name === 'GET /api/favorites no devuelve datos sin sesión' && c.status === 'fail')
    ).toBe(true);
  });

  it('falla si /api/leads lista contactos sin sesión de admin', async () => {
    const report = await run((url: string, init) => {
      const path = new URL(url).pathname;
      if (path === '/api/leads' && (init.method ?? 'GET') === 'GET') {
        return { status: 200, body: { success: true, data: [{ id: '1' }], source: 'memory', persistent: false } };
      }
      return healthyRoutes(url, init);
    });
    expect(report.ok).toBe(false);
    expect(
      report.checks.some((c) => c.name === 'GET /api/leads no filtra contactos sin sesión' && c.status === 'fail')
    ).toBe(true);
  });

  it('falla si las vistas dejan de declarar persisted:false', async () => {
    const report = await run((url: string, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/view')) {
        return { status: 202, body: { success: true, views: 1, counted: true, persisted: true } };
      }
      return healthyRoutes(url, init);
    });
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.name.includes('persisted:false') && c.status === 'fail')).toBe(true);
  });

  it('falla si la ficha deja de rotular el conteo de prueba', async () => {
    const report = await run((url: string, init) => {
      const path = new URL(url).pathname;
      if (path.startsWith('/properties/')) {
        return { status: 200, body: '<html><span>Visitas a esta ficha</span></html>' };
      }
      return healthyRoutes(url, init);
    });
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.name.includes('rotula el conteo de prueba') && c.status === 'fail')).toBe(true);
  });

  it('un servidor caído no lanza: marca todas las comprobaciones en rojo', async () => {
    const report = await run(() => {
      throw new Error('ECONNREFUSED');
    });
    expect(report.ok).toBe(false);
    expect(report.checks.every((c) => c.status === 'fail')).toBe(true);
  });
});

describe('formatReport', () => {
  it('resume cuántas pasaron', async () => {
    const report = await run(healthyRoutes);
    expect(formatReport(report)).toContain(`Las ${report.checks.length} comprobaciones pasaron`);
  });

  it('cuenta los fallos y avisa del modo --base', async () => {
    const report = await run(() => {
      throw new Error('sin servidor');
    });
    const text = formatReport(report, { warned: true });
    expect(text).toContain('fallaron');
    expect(text).toContain('no lo controla este');
  });
});
