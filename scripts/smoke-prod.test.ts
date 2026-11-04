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
  ALTA_STEP_LABELS,
  SIGNUP_STEP_LABELS,
  SMOKE_NAME,
  altaEmailFor,
  bridgeEmailFor,
  judgeAccessLink,
  judgeActivation,
  judgeOperando,
  judgePanelSession,
  judgePayment,
  judgeProposalAccepted,
  judgeProposalSent,
  runAltaCheck,
  smokeBillingPeriod,
  cleanupSignup,
  createSmokeStore,
  formatReport,
  judgeAdminPage,
  judgeBridgeAlta,
  judgeBridgeRegistro,
  judgeHome,
  judgeProtectedEndpoint,
  judgeRegistroGuard,
  judgeSignup,
  judgeSocioPanel,
  normalizeBaseUrl,
  persistenceHint,
  runBridgeCheck,
  runSmoke,
  rutCheckDigit,
  smokeRegistroPayload,
  smokeSignupPayload,
  smokeTestRut,
} from './smoke-prod.mjs';

const MARKER = 'Rix7 ';
const HOME_HTML = `<!doctype html><html><head><title>Rix7 | Propiedades</title></head><body>${MARKER.repeat(
  1200
)}</body></html>`;
const ADMIN_HTML = '<!doctype html><html><head><title>Panel | Rix7</title></head><body>Registros</body></html>';
const SOCIO_HTML =
  '<!doctype html><html><head><title>Panel profesional | Rix7</title></head><body>Panel profesional Mis publicaciones</body></html>';

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
  '/api/solicitudes POST': () =>
    jsonResponse(201, {
      success: true,
      id: 'sol-1',
      persisted: true,
      autopilot: { status: 'Aceptada', decision: 'Aceptada', questions: [] },
    }),
  ...overrides,
});

/** Un alta de prueba que quedó bien, tal como la lee el store. */
const SAVED_BRIDGE = {
  solicitud: { id: 'sol-1', status: 'Aceptada', payload: { kyb_application_id: 'alta-1' } },
  alta: { id: 'alta-1', status: 'Calificado', solicitud_origen: 'sol-1' },
};

/**
 * Store simulado del alta de visita: registra la búsqueda y el borrado.
 *
 * El argumento `found` permite reproducir el caso incómodo: la API dijo
 * «guardada» y en la base no hay nada (otro Supabase detrás del `--url`).
 */
function signupStore(
  found: { id: string } | null = { id: 'sign-1' },
  deleteResult: { ok: boolean; rows: number } = { ok: true, rows: 1 }
) {
  const calls = { find: [] as { email: string | null; since: number }[], remove: [] as string[] };

  return {
    calls,
    store: {
      findSignup: async ({ email, since }: { email: string | null; since: number }) => {
        calls.find.push({ email, since });
        return found;
      },
      deleteSignup: async (id: string) => {
        calls.remove.push(id);
        return deleteResult;
      },
    },
  };
}

/** Store simulado: registra lo que se lee y lo que se borra. */
function bridgeStore(saved: unknown = SAVED_BRIDGE, cleanupResult = { ok: true, altas: 1, solicitudes: 1 }) {
  const calls = { read: [] as string[], cleanup: [] as string[] };

  return {
    calls,
    store: {
      read: async (id: string) => {
        calls.read.push(id);
        return saved;
      },
      cleanup: async (id: string) => {
        calls.cleanup.push(id);
        return cleanupResult;
      },
    },
  };
}

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

describe('runSmoke con --write: la fila de prueba no se queda', () => {
  const writeOptions = (store: unknown, fetchImpl: typeof fetch) => ({
    baseUrl: 'https://x.test',
    write: true,
    email: 'quien@correo.cl',
    store,
    fetchImpl,
    now: 1234,
    sleep: async () => {},
  });

  it('borra la fila que acaba de escribir y lo dice en el informe', async () => {
    const { fetchImpl } = server(happyRoutes());
    const fake = signupStore();

    const report = await runSmoke(writeOptions(fake.store, fetchImpl) as never);

    expect(report.ok).toBe(true);
    expect(report.persisted).toBe(true);

    const step = report.steps.find((item) => item.label === SIGNUP_STEP_LABELS.cleanup);
    expect(step?.level).toBe('ok');
    expect(step?.detail).toContain('sign-1');

    // Se busca por correo y desde el arranque de la corrida (con un margen para
    // el desfase de reloj): lo anterior es historial ajeno.
    expect(fake.calls.find).toHaveLength(1);
    expect(fake.calls.find[0].email).toBe('quien@correo.cl');
    expect(fake.calls.find[0].since).toBeLessThanOrEqual(1234);
    expect(fake.calls.find[0].since).toBeGreaterThan(1234 - 10 * 60 * 1000);
    // Y se borra por id, no por correo.
    expect(fake.calls.remove).toEqual(['sign-1']);
    expect(formatReport(report)).toContain('no acumula altas de smoke');
  });

  it('sin claves avisa que la fila queda, en vez de callarlo', async () => {
    const { fetchImpl } = server(happyRoutes());

    const report = await runSmoke(writeOptions(null, fetchImpl) as never);

    const step = report.steps.find((item) => item.label === SIGNUP_STEP_LABELS.cleanup);
    expect(step?.level).toBe('warn');
    expect(step?.detail).toContain('SUPABASE_SERVICE_ROLE_KEY');
    // No poder limpiar no convierte el deploy en rojo: la persistencia ya se juzgó.
    expect(report.ok).toBe(true);
    expect(report.persisted).toBe(true);
  });

  it('si la fila no aparece no la inventa: lo dice y no borra nada', async () => {
    const { fetchImpl } = server(happyRoutes());
    const fake = signupStore(null);

    const report = await runSmoke(writeOptions(fake.store, fetchImpl) as never);

    const step = report.steps.find((item) => item.label === SIGNUP_STEP_LABELS.cleanup);
    expect(step?.level).toBe('warn');
    expect(step?.detail).toContain('no hay nada que borrar');

    // Reintenta por el retraso de lectura de PostgREST, y no borra a ciegas.
    expect(fake.calls.find.length).toBe(3);
    expect(fake.calls.remove).toEqual([]);
    expect(report.persisted).toBe(true);
  });

  it('si el borrado no se lleva la fila, el smoke falla y deja el id', async () => {
    const { fetchImpl } = server(happyRoutes());
    const fake = signupStore({ id: 'sign-1' }, { ok: true, rows: 0 });

    const report = await runSmoke(writeOptions(fake.store, fetchImpl) as never);

    const step = report.steps.find((item) => item.label === SIGNUP_STEP_LABELS.cleanup);
    expect(step?.level).toBe('fail');
    expect(step?.detail).toContain('sign-1');
    expect(report.ok).toBe(false);
  });

  it('si el alta no quedó guardada no hay nada que limpiar', async () => {
    const { fetchImpl } = server(
      happyRoutes({
        '/api/registro POST': () =>
          jsonResponse(201, {
            success: true,
            email: { sent: false, skipped: true },
            stored: { saved: true, persistent: false },
          }),
      })
    );
    const fake = signupStore();

    const report = await runSmoke(writeOptions(fake.store, fetchImpl) as never);

    expect(report.steps.some((item) => item.label === SIGNUP_STEP_LABELS.cleanup)).toBe(false);
    expect(fake.calls.find).toEqual([]);
  });
});

describe('createSmokeStore', () => {
  it('busca por correo, nombre y hora, y borra solo por id', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if ((init?.method ?? 'GET') === 'DELETE') return jsonResponse(200, [{ id: 'sign-9' }]);
      return jsonResponse(200, [{ id: 'sign-9', email: 'quien@correo.cl' }]);
    }) as unknown as typeof fetch;

    const store = createSmokeStore({ url: 'https://db.test', key: 'clave', fetchImpl });
    const since = Date.UTC(2026, 10, 3, 17, 0, 0);

    const row = await store.findSignup({ email: 'quien@correo.cl', since });
    expect(row).toEqual({ id: 'sign-9', email: 'quien@correo.cl' });

    const query = decodeURIComponent(calls[0].url);
    expect(query).toContain('email=eq.quien@correo.cl');
    expect(query).toContain(`name=eq.${SMOKE_NAME}`);
    expect(query).toContain('created_at=gte.2026-11-03T17:00:00.000Z');

    const removed = await store.deleteSignup('sign-9');
    expect(removed).toEqual({ ok: true, status: 200, rows: 1 });
    expect(calls[1].method).toBe('DELETE');
    expect(calls[1].url).toContain('signups?id=eq.sign-9');
  });
});

describe('cleanupSignup', () => {
  it('un error al buscar no se disfraza de «no había nada»', async () => {
    const step = await cleanupSignup({
      store: {
        findSignup: async () => {
          throw new Error('HTTP 401');
        },
        deleteSignup: async () => ({ ok: true, rows: 1 }),
      },
      email: 'quien@correo.cl',
      since: 1,
      sleep: async () => {},
    });

    expect(step.level).toBe('fail');
    expect(step.detail).toContain('HTTP 401');
  });
});

describe('rutCheckDigit / smokeTestRut', () => {
  it('calcula el dígito verificador módulo 11', () => {
    // Los dos primeros son RUT que el motor ya aceptó en producción.
    expect(rutCheckDigit('21734380')).toBe('1');
    expect(rutCheckDigit('26500111')).toBe('4');
  });

  it('el RUT de prueba es válido y distinto en cada corrida', () => {
    const first = smokeTestRut(() => 0);
    const second = smokeTestRut(() => 0.999_999);

    expect(first).not.toBe(second);
    for (const rut of [first, second]) {
      const [body, dv] = rut.split('-');
      expect(rutCheckDigit(body)).toBe(dv);
      expect(Number(body)).toBeGreaterThanOrEqual(20_000_000);
    }
  });
});

describe('bridgeEmailFor', () => {
  it('agrega el alias después del `+` para que cada corrida sea única', () => {
    expect(bridgeEmailFor('alguien@gmail.com', 1234)).toBe('alguien+puente1234@gmail.com');
  });

  it('un correo sin forma de correo se manda tal cual', () => {
    expect(bridgeEmailFor('sin-arroba', 1234)).toBe('sin-arroba');
  });
});

describe('smokeRegistroPayload', () => {
  it('es un profesional independiente que se aprueba solo', () => {
    const payload = smokeRegistroPayload({
      email: 'alguien+puente1@gmail.com',
      rut: '21734380-1',
      now: Date.UTC(2026, 10, 2),
    });

    expect(payload.kind).toBe('agente');
    expect(payload.coverage).toBe('nacional');
    expect(payload.consent).toBe(true);
    expect(payload.name).toContain('Prueba de humo');
    expect(payload.message).toContain('lo borra al terminar');
  });
});

describe('judgeBridgeRegistro', () => {
  it('acepta el registro aprobado por el autómata en la misma petición', () => {
    const verdict = judgeBridgeRegistro(201, {
      success: true,
      id: 'sol-1',
      autopilot: { status: 'Aceptada', questions: [] },
    });

    expect(verdict.level).toBe('ok');
  });

  it('si el autómata pide información, dice qué preguntó', () => {
    const verdict = judgeBridgeRegistro(201, {
      success: true,
      id: 'sol-1',
      autopilot: {
        status: 'Pendiente_Informacion',
        questions: [{ id: 'rut', question: '¿Nos confirmas el RUT correcto?' }],
      },
    });

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('Pendiente_Informacion');
    expect(verdict.detail).toContain('RUT correcto');
  });

  it('un 400 es rojo con el motivo del servidor', () => {
    const verdict = judgeBridgeRegistro(400, { success: false, error: 'El RUT no es válido.' });

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('El RUT no es válido.');
  });

  it('el rate limit no es un fallo del puente: es no haberlo podido probar', () => {
    expect(judgeBridgeRegistro(429, {}).level).toBe('warn');
  });
});

describe('judgeBridgeAlta', () => {
  it('acepta el alta en Calificado vinculada por los dos lados', () => {
    expect(judgeBridgeAlta(SAVED_BRIDGE, 'sol-1').level).toBe('ok');
  });

  it('rechaza el registro que no quedó guardado', () => {
    const verdict = judgeBridgeAlta({ solicitud: null, alta: null }, 'sol-1');

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('no quedó guardada');
  });

  it('rechaza la aprobación sin alta: es el puente que falta', () => {
    const verdict = judgeBridgeAlta(
      { solicitud: SAVED_BRIDGE.solicitud, alta: null },
      'sol-1'
    );

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('no nació su alta');
  });

  it('rechaza el alta que no quedó en Calificado', () => {
    const verdict = judgeBridgeAlta(
      { ...SAVED_BRIDGE, alta: { ...SAVED_BRIDGE.alta, status: 'Aceptada' } },
      'sol-1'
    );

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('«Aceptada»');
  });

  it('rechaza el alta suelta: sin solicitud_origen el panel ve dos filas', () => {
    const verdict = judgeBridgeAlta(
      { ...SAVED_BRIDGE, alta: { ...SAVED_BRIDGE.alta, solicitud_origen: null } },
      'sol-1'
    );

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('solicitud_origen');
  });

  it('rechaza el registro que no guardó el vínculo al alta', () => {
    const verdict = judgeBridgeAlta(
      { ...SAVED_BRIDGE, solicitud: { ...SAVED_BRIDGE.solicitud, payload: {} } },
      'sol-1'
    );

    expect(verdict.level).toBe('fail');
    expect(verdict.detail).toContain('kyb_application_id');
  });
});

describe('runBridgeCheck', () => {
  it('recorre registro → alta y borra lo que escribió', async () => {
    const { fetchImpl, calls } = server(happyRoutes());
    const fake = bridgeStore();

    const steps = await runBridgeCheck({
      baseUrl: 'https://x.test',
      email: 'alguien@gmail.com',
      store: fake.store,
      fetchImpl,
      now: 1234,
    });

    expect(steps.every((step) => step.level !== 'fail')).toBe(true);
    expect(steps.map((step) => step.label)).toEqual([
      'POST /api/solicitudes (registro de prueba)',
      'Alta del registro en Calificado',
      'Limpieza del registro de prueba',
    ]);

    // El correo de la prueba es un alias del mismo buzón, único por corrida.
    const post = calls.find((call) => call.method === 'POST');
    expect((post?.body as { email: string }).email).toBe('alguien+puente1234@gmail.com');

    expect(fake.calls.read).toEqual(['sol-1']);
    expect(fake.calls.cleanup).toEqual(['sol-1']);
    expect(formatReport({ baseUrl: 'https://x.test', ok: true, steps, persisted: null, bridge: true })).toContain(
      'no queda nada en el pipeline'
    );
  });

  it('sin la clave de servicio no dice «todo bien»: falla y avisa qué quedó', async () => {
    const { fetchImpl } = server(happyRoutes());

    const steps = await runBridgeCheck({
      baseUrl: 'https://x.test',
      email: 'alguien@gmail.com',
      store: null,
      fetchImpl,
      now: 1234,
    });

    expect(steps.some((step) => step.level === 'fail')).toBe(true);
    expect(steps.find((step) => step.label === 'Limpieza del registro de prueba')?.detail).toContain(
      'sol-1'
    );
  });

  it('si la limpieza deja algo, el smoke falla en vez de acumular basura', async () => {
    const { fetchImpl } = server(happyRoutes());
    const fake = bridgeStore(SAVED_BRIDGE, { ok: true, altas: 0, solicitudes: 0 });

    const steps = await runBridgeCheck({
      baseUrl: 'https://x.test',
      email: 'alguien@gmail.com',
      store: fake.store,
      fetchImpl,
      now: 1234,
    });

    expect(steps.find((step) => step.label === 'Limpieza del registro de prueba')?.level).toBe('fail');
  });

  it('sin --email no manda nada: no hay a quién', async () => {
    const { fetchImpl, calls } = server(happyRoutes());

    const steps = await runBridgeCheck({ baseUrl: 'https://x.test', store: bridgeStore().store, fetchImpl });

    expect(steps[0].level).toBe('fail');
    expect(calls).toEqual([]);
  });
});

describe('runSmoke con el puente', () => {
  it('con --bridge comprueba el puente aunque no dé de alta la visita', async () => {
    const { fetchImpl, calls } = server(happyRoutes());
    const fake = bridgeStore();

    const report = await runSmoke({
      baseUrl: 'https://x.test',
      bridge: true,
      store: fake.store,
      email: 'alguien@gmail.com',
      fetchImpl,
    });

    expect(report.ok).toBe(true);
    expect(report.bridge).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/api/solicitudes'))).toBe(true);
    // La visita de prueba no se dio de alta: el puente es la única escritura.
    expect(calls.some((call) => call.url.endsWith('/api/registro') && call.method === 'POST')).toBe(false);
    expect(fake.calls.cleanup).toEqual(['sol-1']);
  });

  it('sin pedir el puente no lo toca', async () => {
    const { fetchImpl, calls } = server(happyRoutes());

    const report = await runSmoke({ baseUrl: 'https://x.test', fetchImpl });

    expect(report.bridge).toBe(false);
    expect(calls.some((call) => call.url.endsWith('/api/solicitudes'))).toBe(false);
  });
});

/** Store del alta completa: todo lo que el recorrido necesita, simulado. */
function altaStore(overrides: Record<string, unknown> = {}) {
  const calls = {
    read: [] as string[],
    readAlta: [] as string[],
    setToken: [] as { id: string; purpose: string }[],
    magic: [] as string[],
    cleanup: [] as unknown[],
    deleteAccount: [] as string[],
  };

  const store = {
    read: async (id: string) => {
      calls.read.push(id);
      return {
        solicitud: { id, status: 'Aceptada', payload: { kyb_application_id: 'alta-1' } },
        alta: { id: 'alta-1', status: 'Calificado', solicitud_origen: id },
      };
    },
    readAlta: async (id: string) => {
      calls.readAlta.push(id);
      return {
        id,
        status: 'Operando',
        panel_enabled: true,
        partner_id: 'ficha-1',
        proposal: [{ monthlyClp: 14_990 }],
      };
    },
    setToken: async (id: string, purpose: string) => {
      calls.setToken.push({ id, purpose });
      return { ok: true, token: 'x'.repeat(43) };
    },
    adminSession: async () => ({ ok: true, cookie: 'sb-x-auth-token=abc', email: 'equipo@rix7.cl' }),
    mintMagicLink: async (email: string) => {
      calls.magic.push(email);
      return { ok: true, tokenHash: 'hash-1' };
    },
    cleanupAlta: async (ids: unknown) => {
      calls.cleanup.push(ids);
      return { ok: true, alta: 1, solicitud: 1, partner: 1, billing: 1, errors: [] };
    },
    deleteAccount: async (email: string) => {
      calls.deleteAccount.push(email);
      return { ok: true, deleted: 1, found: true };
    },
    ...overrides,
  };

  return { calls, store };
}

/** Las rutas del alta completa, con el servidor ya respondiendo el camino bueno. */
const altaRoutes = (overrides: Record<string, () => Response> = {}) => {
  const proposal = { planId: 'profesional', altaClp: 19_990, monthlyClp: 14_990, note: null };

  return happyRoutes({
    '/api/kyb/alta-1/proposal POST': () =>
      jsonResponse(200, {
        success: true,
        data: { status: 'Propuesta_Comercial', proposal },
        email: { sent: true, skipped: false },
      }),
    '/api/kyb/proposal POST': () =>
      jsonResponse(200, {
        success: true,
        data: { status: 'Alta', decision: 'aceptada', already: false },
        email: { sent: true, skipped: false },
      }),
    '/api/kyb/activate POST': () =>
      jsonResponse(200, {
        success: true,
        data: {
          status: 'Alta',
          plan: 'profesional',
          already: false,
          panel: { enabled: true, partnerId: 'ficha-1', account: 'created' },
        },
        email: { sent: true, skipped: false },
      }),
    '/api/admin/cobranza POST': () =>
      jsonResponse(200, { success: true, data: { situacion: { estado: 'al_dia' } } }),
    '/auth/confirm GET': () =>
      new Response(null, {
        status: 307,
        headers: {
          location: 'https://x.test/socio',
          'set-cookie': 'sb-x-auth-token=abc; Path=/; HttpOnly; SameSite=Lax',
        },
      }),
    '/api/partner/access GET': () =>
      jsonResponse(200, { success: true, data: { role: 'member', partnerId: 'ficha-1' } }),
    ...overrides,
  });
};

describe('runAltaCheck', () => {
  it('recorre el alta completa y borra todo lo que creó', async () => {
    const { fetchImpl, calls } = server(altaRoutes());
    const fake = altaStore();

    const steps = await runAltaCheck({
      baseUrl: 'https://x.test',
      email: 'quien@correo.cl',
      store: fake.store,
      fetchImpl,
      now: 1234,
      sleep: async () => {},
    });

    expect(steps.map((step) => step.label)).toEqual(Object.values(ALTA_STEP_LABELS));
    expect(steps.filter((step) => step.level === 'fail')).toEqual([]);

    // El registro va al alias del alta, no al buzón a secas.
    const registro = calls.find((call) => call.url.endsWith('/api/solicitudes'));
    expect((registro?.body as { email: string }).email).toBe('quien+alta1234@correo.cl');

    // Los dos tokens que se piden son los del trámite, en orden.
    expect(fake.calls.setToken.map((call) => call.purpose)).toEqual(['proposal', 'activation']);

    // El pago usa el monto de la propuesta aceptada, no un número inventado.
    const pago = calls.find((call) => call.url.endsWith('/api/admin/cobranza'));
    expect((pago?.body as { amountClp: number }).amountClp).toBe(14_990);
    expect((pago?.body as { partnerId: string }).partnerId).toBe('ficha-1');

    // Y la limpieza se lleva la cuenta porque la creó esta corrida.
    expect(fake.calls.deleteAccount).toEqual(['quien+alta1234@correo.cl']);
    expect(fake.calls.cleanup[0]).toMatchObject({ altaId: 'alta-1', partnerId: 'ficha-1' });
  });

  it('no se lleva la cuenta si el correo ya tenía una', async () => {
    const { fetchImpl } = server(
      altaRoutes({
        '/api/kyb/activate POST': () =>
          jsonResponse(200, {
            success: true,
            data: {
              status: 'Alta',
              plan: 'profesional',
              panel: { enabled: true, partnerId: 'ficha-1', account: 'linked' },
            },
            email: { sent: true, skipped: false },
          }),
      })
    );
    const fake = altaStore();

    const steps = await runAltaCheck({
      baseUrl: 'https://x.test',
      email: 'quien@correo.cl',
      store: fake.store,
      fetchImpl,
      now: 1234,
      sleep: async () => {},
    });

    expect(steps.every((step) => step.level !== 'fail')).toBe(true);
    expect(fake.calls.deleteAccount).toEqual([]);
  });

  it('si la propuesta no se puede enviar, lo dice y limpia igual', async () => {
    const { fetchImpl } = server(
      altaRoutes({
        '/api/kyb/alta-1/proposal POST': () =>
          jsonResponse(409, {
            success: false,
            error: 'Solo se envía una propuesta a una solicitud calificada.',
          }),
      })
    );
    const fake = altaStore();

    const steps = await runAltaCheck({
      baseUrl: 'https://x.test',
      email: 'quien@correo.cl',
      store: fake.store,
      fetchImpl,
      now: 1234,
      sleep: async () => {},
    });

    expect(steps.find((step) => step.label === ALTA_STEP_LABELS.propuesta)?.level).toBe('fail');
    expect(steps.find((step) => step.label === ALTA_STEP_LABELS.plan)?.detail).toBe('no se intentó');
    // Un paso rojo no puede dejar basura: la limpieza corrió igual.
    expect(fake.calls.cleanup).toHaveLength(1);
    expect(steps.find((step) => step.label === ALTA_STEP_LABELS.cleanup)?.level).toBe('ok');
  });

  it('si el pago no deja el alta en Operando, el paso falla', async () => {
    const { fetchImpl } = server(altaRoutes());
    const fake = altaStore({
      readAlta: async () => ({
        id: 'alta-1',
        status: 'Alta',
        panel_enabled: true,
        partner_id: 'ficha-1',
        proposal: [{ monthlyClp: 14_990 }],
      }),
    });

    const steps = await runAltaCheck({
      baseUrl: 'https://x.test',
      email: 'quien@correo.cl',
      store: fake.store,
      fetchImpl,
      now: 1234,
      sleep: async () => {},
    });

    const pago = steps.find((step) => step.label === ALTA_STEP_LABELS.pago);
    expect(pago?.level).toBe('fail');
    expect(pago?.detail).toContain('Operando');
    expect(steps.find((step) => step.label === ALTA_STEP_LABELS.acceso)?.detail).toBe('no se intentó');
  });

  it('si el enlace no deja sesión, no se da el acceso por bueno', async () => {
    const { fetchImpl } = server(
      altaRoutes({
        '/api/partner/access GET': () =>
          jsonResponse(401, { success: false, error: 'Inicia sesión para continuar.' }),
      })
    );
    const fake = altaStore();

    const steps = await runAltaCheck({
      baseUrl: 'https://x.test',
      email: 'quien@correo.cl',
      store: fake.store,
      fetchImpl,
      now: 1234,
      sleep: async () => {},
    });

    const acceso = steps.find((step) => step.label === ALTA_STEP_LABELS.acceso);
    expect(acceso?.level).toBe('fail');
    expect(acceso?.detail).toContain('401');
  });

  it('si la limpieza deja algo, lo dice con el nombre para encontrarlo', async () => {
    const { fetchImpl } = server(altaRoutes());
    const fake = altaStore({
      cleanupAlta: async () => ({ ok: true, alta: 0, solicitud: 1, partner: 1, errors: [] }),
    });

    const steps = await runAltaCheck({
      baseUrl: 'https://x.test',
      email: 'quien@correo.cl',
      store: fake.store,
      fetchImpl,
      now: 1234,
      sleep: async () => {},
    });

    const cleanup = steps.find((step) => step.label === ALTA_STEP_LABELS.cleanup);
    expect(cleanup?.level).toBe('fail');
    expect(cleanup?.detail).toContain('alta sin borrar');
    expect(cleanup?.detail).toContain('Prueba de humo');
  });

  it('sin --email o sin base no escribe nada', async () => {
    const { fetchImpl, calls } = server(altaRoutes());

    const sinEmail = await runAltaCheck({
      baseUrl: 'https://x.test',
      store: altaStore().store,
      fetchImpl,
    });
    expect(sinEmail[0].level).toBe('fail');
    expect(calls).toEqual([]);

    const sinBase = await runAltaCheck({
      baseUrl: 'https://x.test',
      email: 'quien@correo.cl',
      fetchImpl,
    });
    expect(sinBase[0].detail).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(calls).toEqual([]);
  });
});

describe('veredictos del alta', () => {
  it('la propuesta solo vale con el estado guardado', () => {
    const ok = judgeProposalSent(200, {
      success: true,
      data: {
        status: 'Propuesta_Comercial',
        proposal: { planId: 'profesional', altaClp: 1, monthlyClp: 2 },
      },
    });
    expect(ok.level).toBe('ok');

    const sinEstado = judgeProposalSent(200, {
      success: true,
      data: {
        status: 'Calificado',
        proposal: { planId: 'profesional', altaClp: 1, monthlyClp: 2 },
      },
    });
    expect(sinEstado.level).toBe('fail');
  });

  it('aceptar tiene que dejar la solicitud en Alta', () => {
    expect(judgeProposalAccepted(200, { success: true, data: { status: 'Alta' } }).level).toBe('ok');
    expect(
      judgeProposalAccepted(200, { success: true, data: { status: 'Propuesta_Comercial' } }).level
    ).toBe('fail');
  });

  it('el plan no vale si el panel no quedó habilitado', () => {
    expect(
      judgeActivation(200, {
        success: true,
        data: { status: 'Alta', plan: 'profesional', panel: { enabled: false } },
      }).level
    ).toBe('fail');
    expect(
      judgeActivation(200, {
        success: true,
        data: { status: 'Alta', plan: 'profesional', panel: { enabled: true, partnerId: 'f' } },
      }).level
    ).toBe('ok');
  });

  it('Operando exige panel y ficha, no solo el estado', () => {
    expect(
      judgeOperando({ status: 'Operando', panel_enabled: true, partner_id: 'ficha-1' }).level
    ).toBe('ok');
    expect(
      judgeOperando({ status: 'Operando', panel_enabled: false, partner_id: 'ficha-1' }).level
    ).toBe('fail');
    expect(judgeOperando({ status: 'Operando', panel_enabled: true }).level).toBe('fail');
    expect(judgeOperando({ status: 'Alta', panel_enabled: true, partner_id: 'f' }).level).toBe('fail');
  });

  it('el enlace del acceso no puede volver con error ni con tokens en el fragmento', () => {
    expect(judgeAccessLink(307, 'https://rix7.cl/socio').level).toBe('ok');
    expect(
      judgeAccessLink(
        307,
        'https://rix7.cl/socio?error=access_denied&error_description=Email+link+is+invalid'
      ).level
    ).toBe('fail');
    expect(judgeAccessLink(307, 'https://rix7.cl/socio#access_token=abc').level).toBe('fail');
    expect(judgeAccessLink(200, 'https://rix7.cl/socio').level).toBe('fail');
    expect(judgeAccessLink(307, 'https://rix7.cl/empresas').level).toBe('fail');
  });

  it('la sesión tiene que quedar vinculada a la ficha del alta', () => {
    const body = { success: true, data: { role: 'member', partnerId: 'ficha-1' } };
    expect(judgePanelSession(200, body, 'ficha-1').level).toBe('ok');
    expect(judgePanelSession(200, { ...body, data: { partnerId: 'otra' } }, 'ficha-1').level).toBe(
      'fail'
    );
    expect(judgePanelSession(401, null).level).toBe('fail');
  });

  it('el pago exige un 200 con la operación hecha', () => {
    expect(judgePayment(200, { success: true }).level).toBe('ok');
    expect(
      judgePayment(400, { error: 'El monto tiene que ser un entero en pesos.' }).level
    ).toBe('fail');
  });

  it('el período de pago es el mes en curso en UTC', () => {
    expect(smokeBillingPeriod(Date.UTC(2026, 10, 4, 17, 0, 0))).toBe('2026-11');
    expect(smokeBillingPeriod(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe('2026-01');
  });

  it('el correo del alta es un alias distinto del puente', () => {
    expect(altaEmailFor('quien@correo.cl', 7)).toBe('quien+alta7@correo.cl');
    expect(bridgeEmailFor('quien@correo.cl', 7)).toBe('quien+puente7@correo.cl');
  });
});
