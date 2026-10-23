/**
 * Tests de la prueba de humo.
 *
 * Lo que hay que proteger es el **veredicto**: este script decide si un deploy
 * dejó las rutas vivas y si el alta se está guardando. Un falso «todo bien»
 * —el deploy roto más común: 200 con la pantalla de error, o un alta que se
 * acepta y no se guarda— es exactamente lo que no puede pasar.
 */
import { describe, expect, it } from 'vitest';

import {
  SMOKE_NAME,
  formatReport,
  judgeAdminPage,
  judgeHome,
  judgeProtectedEndpoint,
  judgeRegistroGuard,
  judgeSignup,
  judgeSocioPanel,
  normalizeBaseUrl,
  persistenceHint,
  runSmoke,
  smokeSignupPayload,
} from './smoke-prod.mjs';

const MARKER = 'Rix7 ';
const HOME_HTML = `<!doctype html><html><head><title>Rix7 | Propiedades</title></head><body>${MARKER.repeat(
  1200
)}</body></html>`;
const ADMIN_HTML = '<!doctype html><html><head><title>Panel | Rix7</title></head><body>Registros</body></html>';
const SOCIO_HTML =
  '<!doctype html><html><head><title>Panel de socios | Rix7</title></head><body>Panel de socios Mis publicaciones</body></html>';

const htmlResponse = (status: number, body: string) => new Response(body, { status });
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const HEALTH_OK = {
  status: 'ok',
  summary: 'Todo lo que el portal necesita está configurado.',
  missing: { broken: [], degraded: [], optional: [] },
};

/** Servidor simulado: se le pide una respuesta por ruta y método. */
function server(routes: Record<string, () => Response>) {
  const calls: { url: string; method: string; body: unknown }[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const key = `${new URL(url).pathname} ${method}`;
    calls.push({
      url,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });

    const route = routes[key];
    if (!route) throw new Error(`ruta no simulada: ${key}`);
    return route();
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

const happyRoutes = (overrides: Record<string, () => Response> = {}) => ({
  '/ GET': () => htmlResponse(200, HOME_HTML),
  '/admin/registros GET': () => htmlResponse(200, ADMIN_HTML),
  '/socio GET': () => htmlResponse(200, SOCIO_HTML),
  '/api/partner/access GET': () => jsonResponse(401, { success: false, error: 'Inicia sesión para continuar.' }),
  '/api/admin/socios GET': () => jsonResponse(401, { success: false, error: 'Inicia sesión para continuar.' }),
  '/api/registro GET': () => jsonResponse(503, { success: false, error: 'Sin Supabase' }),
  '/api/health GET': () => jsonResponse(200, HEALTH_OK),
  '/api/registro POST': () =>
    jsonResponse(201, {
      success: true,
      email: { sent: false, skipped: true },
      stored: { saved: true, persistent: true },
    }),
  ...overrides,
});

describe('normalizeBaseUrl', () => {
  it('quita barras finales para no armar rutas con doble barra', () => {
    expect(normalizeBaseUrl('https://rix7.vercel.app/')).toBe('https://rix7.vercel.app');
    expect(normalizeBaseUrl('  http://localhost:3111///  ')).toBe('http://localhost:3111');
  });
});

describe('smokeSignupPayload', () => {
  it('firma la fila como prueba y no autoriza nada opcional', () => {
    const payload = smokeSignupPayload('alguien@ejemplo.cl');

    expect(payload.name).toBe(SMOKE_NAME);
    // Lo que no queremos es dejar autorizada publicidad o cesión a socios por
    // una prueba: van en false a propósito.
    expect(payload.consents).toEqual({
      personal_data: true,
      terms: true,
      marketing: false,
      third_party: false,
    });
    expect(payload.email).toBe('alguien@ejemplo.cl');
  });
});

describe('judgeHome', () => {
  it('acepta la portada de verdad', () => {
    expect(judgeHome(200, HOME_HTML).level).toBe('ok');
  });

  it('rechaza el caso silencioso: 200 con la pantalla de error adentro', () => {
    const verdict = judgeHome(200, `<html><title>Rix7</title><body>Application error: a server-side exception has occurred</body></html>`);

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('pantalla de error');
  });

  it('rechaza un 200 que no es la portada', () => {
    expect(judgeHome(200, '<html><body>hola</body></html>').level).toBe('fail');
  });

  it('rechaza un error del servidor', () => {
    expect(judgeHome(500, '').level).toBe('fail');
  });
});

describe('judgeAdminPage', () => {
  it('acepta la pantalla de registros', () => {
    expect(judgeAdminPage(200, ADMIN_HTML).level).toBe('ok');
  });

  it('dice que la ruta no está desplegada cuando da 404', () => {
    const verdict = judgeAdminPage(404, '<html>Not found</html>');

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('no está desplegada');
  });

  it('acepta una redirección: la página existe y el panel pide sesión', () => {
    expect(judgeAdminPage(307, '').level).toBe('ok');
  });

  it('rechaza un 200 que no es la pantalla de registros', () => {
    expect(judgeAdminPage(200, '<html><title>Rix7</title></html>').level).toBe('fail');
  });

  it('acepta la pantalla de acceso: sin sesión el panel no muestra la tabla', () => {
    const verdict = judgeAdminPage(
      200,
      '<!doctype html><html><head><title>Panel | Rix7</title></head><body><h1>Acceso al panel</h1></body></html>'
    );

    expect(verdict.level).toBe('ok');
    expect(verdict.detail).toContain('pide sesión');
  });

  it('acepta el HTML que sirve el servidor: la tarjeta va con ssr:false y solo llega el esqueleto', () => {
    // La forma real de la respuesta sin sesión (verificado contra rix7.cl): el
    // título del layout más el marcador de carga de `AdminAccess`, sin la tabla
    // ni la tarjeta, que se hidratan en el cliente.
    const verdict = judgeAdminPage(
      200,
      '<!doctype html><html><head><title>Panel | Rix7</title></head><body><p>Verificando el acceso…</p></body></html>'
    );

    expect(verdict.level).toBe('ok');
    expect(verdict.detail).toContain('pide sesión');
  });
});

describe('judgeRegistroGuard', () => {
  it('acepta que pida sesión (sin Supabase o sin sesión)', () => {
    expect(judgeRegistroGuard(503).level).toBe('ok');
    expect(judgeRegistroGuard(401).level).toBe('ok');
    expect(judgeRegistroGuard(403).level).toBe('ok');
  });

  it('falla si el listado de registros se ve sin sesión', () => {
    // Es el peor resultado posible de esta comprobación: datos personales fuera.
    const verdict = judgeRegistroGuard(200);

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('sin sesión');
  });

  it('falla si la ruta no está desplegada', () => {
    expect(judgeRegistroGuard(404).detail).toContain('no está desplegada');
  });
});

describe('judgeProtectedEndpoint', () => {
  it('acepta que la ruta pida sesión', () => {
    expect(judgeProtectedEndpoint(401).level).toBe('ok');
    expect(judgeProtectedEndpoint(403).level).toBe('ok');
    expect(judgeProtectedEndpoint(503).level).toBe('ok');
  });

  it('dice que la ruta no está desplegada cuando da 404', () => {
    // El caso real: la gestión de socios existía en el repo y no en producción.
    expect(judgeProtectedEndpoint(404).detail).toContain('no está desplegada');
  });

  it('falla si la respuesta se ve sin sesión, y nombra qué se filtró', () => {
    const verdict = judgeProtectedEndpoint(200, 'las cuentas de socios');

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('sin sesión');
    expect(verdict.detail).toContain('las cuentas de socios');
  });

  it('un código inesperado no se da por bueno', () => {
    expect(judgeProtectedEndpoint(500).level).toBe('fail');
  });
});

describe('judgeSocioPanel', () => {
  it('acepta el panel de socios', () => {
    expect(judgeSocioPanel(200, SOCIO_HTML).level).toBe('ok');
  });

  it('dice que la ruta no está desplegada cuando da 404', () => {
    expect(judgeSocioPanel(404, 'Not found').detail).toContain('no está desplegada');
  });

  it('rechaza el 200 con la pantalla de error adentro', () => {
    const verdict = judgeSocioPanel(200, '<html><body>Application error: a server-side exception</body></html>');

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('pantalla de error');
  });

  it('rechaza un 200 que no es el panel', () => {
    expect(judgeSocioPanel(200, '<html><title>Rix7</title></html>').level).toBe('fail');
  });

  it('una redirección cuenta como buena: la página existe y pide sesión', () => {
    expect(judgeSocioPanel(307, '').level).toBe('ok');
  });
});

describe('judgeSignup', () => {
  const ok = { success: true, stored: { saved: true, persistent: true } };

  it('acepta el alta que quedó guardada', () => {
    expect(judgeSignup(201, ok).level).toBe('ok');
  });

  it('falla si el alta se acepta pero no persiste', () => {
    const verdict = judgeSignup(201, { success: true, stored: { saved: true, persistent: false } });

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('NO se está guardando');
  });

  it('falla si no se guardó ni en memoria', () => {
    const verdict = judgeSignup(201, { success: true, stored: { saved: false, persistent: false } });

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('no se guardó');
  });

  it('avisa cuando el rate limit impide comprobarlo, sin darlo por fallo', () => {
    const verdict = judgeSignup(429, null);

    expect(verdict.level).toBe('warn');
    expect(verdict.detail).toContain('429');
  });

  it('falla si la propia alta de prueba fue rechazada', () => {
    const verdict = judgeSignup(400, { error: 'Falta autorizar: términos y condiciones.' });

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('Falta autorizar');
  });
});

describe('persistenceHint', () => {
  it('apunta al proyecto Supabase cuando falta', () => {
    const hint = persistenceHint({ missing: { broken: ['supabase'] } });

    expect(hint).toContain('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('si la base no es la de la cuenta dueña, lo dice con el corte como salida', () => {
    const hint = persistenceHint({ missing: { broken: ['supabase_owner'] } });

    expect(hint).toContain('cuenta dueña');
    expect(hint).toContain('corte:supabase');
  });

  it('si Supabase está configurado, sospecha de la migración', () => {
    // El otro motivo posible: la tabla no existe todavía en la base.
    const hint = persistenceHint({ missing: { broken: [], degraded: ['email'] } });

    expect(hint).toContain('db:status');
    expect(hint).toContain('0010');
  });
});

describe('runSmoke', () => {
  it('sin --write no escribe nada y lo dice', async () => {
    const { fetchImpl, calls } = server(happyRoutes());

    const report = await runSmoke({ baseUrl: 'https://x.test', fetchImpl });

    expect(report.ok).toBe(true);
    expect(report.persisted).toBeNull();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(formatReport(report)).toContain('no se verificó');
  });

  it('comprueba las rutas del panel de socios en la misma corrida', async () => {
    const { fetchImpl } = server(happyRoutes());

    const report = await runSmoke({ baseUrl: 'https://x.test', fetchImpl });
    const labels = report.steps.map((step) => step.label);

    expect(labels).toContain('GET /socio');
    expect(labels).toContain('GET /api/partner/access (sin sesión)');
    expect(labels).toContain('GET /api/admin/socios (sin sesión)');
    expect(report.ok).toBe(true);
  });

  it('detecta el deploy a medias: el panel de socios sin su API', async () => {
    // El incidente que estas comprobaciones existen para atrapar: la página
    // responde y la sección de gestión no llegó al despliegue.
    const { fetchImpl } = server(
      happyRoutes({ '/api/admin/socios GET': () => htmlResponse(404, 'Not found') })
    );

    const report = await runSmoke({ baseUrl: 'https://x.test', fetchImpl });

    expect(report.ok).toBe(false);
    expect(
      report.steps.find((step) => step.label === 'GET /api/admin/socios (sin sesión)')?.detail
    ).toContain('no está desplegada');
  });

  it('falla cuando una ruta de la tanda no está desplegada', async () => {
    const { fetchImpl } = server(
      happyRoutes({ '/admin/registros GET': () => htmlResponse(404, 'Not found') })
    );

    const report = await runSmoke({ baseUrl: 'https://x.test', fetchImpl });

    expect(report.ok).toBe(false);
    expect(report.steps.find((step) => step.label === 'GET /admin/registros')?.detail).toContain(
      'no está desplegada'
    );
  });

  it('con --write confirma que el alta persiste', async () => {
    const { fetchImpl, calls } = server(happyRoutes());

    const report = await runSmoke({
      baseUrl: 'https://x.test',
      write: true,
      email: 'quien@correo.cl',
      fetchImpl,
    });

    expect(report.persisted).toBe(true);
    expect(report.ok).toBe(true);
    const post = calls.find((call) => call.method === 'POST');
    expect((post?.body as { email: string }).email).toBe('quien@correo.cl');
    expect(formatReport(report)).toContain('quedó guardada');
  });

  it('con --write avisa si el guardado no persiste y explica por qué', async () => {
    const { fetchImpl } = server(
      happyRoutes({
        '/api/health GET': () =>
          jsonResponse(200, {
            status: 'broken',
            summary: '6 de 6 subsistemas sin configurar — críticos: supabase.',
            missing: { broken: ['supabase'], degraded: ['email'], optional: [] },
          }),
        '/api/registro POST': () =>
          jsonResponse(201, {
            success: true,
            email: { sent: false, skipped: true },
            stored: { saved: true, persistent: false },
          }),
      })
    );

    const report = await runSmoke({
      baseUrl: 'https://x.test',
      write: true,
      email: 'quien@correo.cl',
      fetchImpl,
    });

    expect(report.persisted).toBe(false);
    expect(report.ok).toBe(false);
    const text = formatReport(report);
    expect(text).toContain('NO persiste');
    expect(text).toContain('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('informa el correo en vez de fingir que salió', async () => {
    const { fetchImpl } = server(
      happyRoutes({
        '/api/registro POST': () =>
          jsonResponse(201, {
            success: true,
            email: { sent: true, skipped: false },
            stored: { saved: true, persistent: true },
          }),
      })
    );

    const report = await runSmoke({
      baseUrl: 'https://x.test',
      write: true,
      email: 'quien@correo.cl',
      fetchImpl,
    });

    const emailStep = report.steps.find((step) => step.label === 'Correo de bienvenida');
    expect(emailStep?.detail).toContain('quien@correo.cl');
    expect(emailStep?.level).toBe('warn');
  });

  it('con rate limit no da la persistencia por buena ni por mala', async () => {
    const { fetchImpl } = server(
      happyRoutes({ '/api/registro POST': () => jsonResponse(429, { error: 'Demasiadas solicitudes' }) })
    );

    const report = await runSmoke({
      baseUrl: 'https://x.test',
      write: true,
      email: 'quien@correo.cl',
      fetchImpl,
    });

    expect(report.persisted).toBeNull();
    expect(report.ok).toBe(true);
    expect(formatReport(report)).toContain('429');
  });

  it('si el despliegue no responde, lo dice en vez de morir', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const report = await runSmoke({ baseUrl: 'https://x.test', fetchImpl });

    expect(report.ok).toBe(false);
    expect(report.steps[0].detail).toContain('ECONNREFUSED');
  });

  it('acepta el 404 de /api/health: puede no estar en un despliegue viejo', async () => {
    const { fetchImpl } = server(
      happyRoutes({ '/api/health GET': () => htmlResponse(404, 'Not found') })
    );

    const report = await runSmoke({ baseUrl: 'https://x.test', fetchImpl });

    expect(report.ok).toBe(true);
    expect(report.steps.find((step) => step.label === 'GET /api/health')?.detail).toContain('404');
  });
});
