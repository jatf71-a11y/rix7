/**
 * Tests del camino de red de `check:auth`, contra un servidor falso.
 *
 * Es la parte que en el mundo real habla con Supabase, así que se prueba de
 * verdad: se levanta un servidor local que imita `/auth/v1/settings` y
 * `/auth/v1/otp`, y se comprueba qué reporta el script en cada caso. Sin esto,
 * lo único probado sería el formato de los mensajes.
 *
 * Los tres bloques llevan un tiempo límite más holgado que el de por defecto:
 * hacen E/S real (levantar el servidor y responder por HTTP), y con la máquina
 * cargada —por ejemplo con un build de Next en paralelo— el límite de 5 s se
 * pasa y el test falla sin que haya nada roto. Un test intermitente es peor que
 * no tenerlo.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { runAuthCheck, formatReport } from './check-auth-config.mjs';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.clave.de-prueba';

interface FakeOptions {
  /** Respuesta de `/auth/v1/settings`. */
  settings?: { status?: number; body?: unknown };
  /** Respuesta de `/auth/v1/otp`. */
  otp?: { status?: number; body?: unknown };
}

let server: Server | null = null;

/** Levanta el servidor falso y devuelve su URL base. */
async function startFakeServer(options: FakeOptions = {}): Promise<string> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/auth/v1/settings') {
      const { status = 200, body = { external: { email: true, google: false } } } =
        options.settings ?? {};
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    if (url.pathname === '/auth/v1/otp') {
      const { status = 200, body = {} } = options.otp ?? {};
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server!.address();
  if (!address || typeof address === 'string') throw new Error('sin puerto');

  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

const TEST_TIMEOUT_MS = 20000;

describe('runAuthCheck con un proyecto alcanzable', { timeout: TEST_TIMEOUT_MS }, () => {
  it('reporta el correo habilitado y avisa que Google no lo está', async () => {
    const url = await startFakeServer();

    const report = await runAuthCheck({ supabaseUrl: url, anonKey: ANON_KEY });

    expect(report.configured).toBe(true);
    expect(report.ok).toBe(true);
    const correo = report.steps.find((s) => s.label.includes('enlace mágico'))!;
    expect(correo.level).toBe('ok');
    const google = report.steps.find((s) => s.label.includes('Google'))!;
    // Es un aviso, no un error: sin Google el enlace mágico sigue funcionando.
    expect(google.level).toBe('warn');
  });

  it('marca como error el correo deshabilitado: sin eso no hay acceso', async () => {
    const url = await startFakeServer({
      settings: { body: { external: { email: false } } },
    });

    const report = await runAuthCheck({ supabaseUrl: url, anonKey: ANON_KEY });

    expect(report.ok).toBe(false);
    const correo = report.steps.find((s) => s.label.includes('enlace mágico'))!;
    expect(correo.level).toBe('error');
    expect(correo.detail).toMatch(/DESHABILITADO/);
  });

  it('propaga los avisos de altas cerradas y confirmación automática', async () => {
    const url = await startFakeServer({
      settings: {
        body: { external: { email: true, google: true }, disable_signup: true, mailer_autoconfirm: true },
      },
    });

    const report = await runAuthCheck({ supabaseUrl: url, anonKey: ANON_KEY });
    const avisos = report.steps.filter((s) => s.label === 'aviso');

    expect(avisos).toHaveLength(2);
  });

  it('dice qué revisar sin mandar nada cuando no se pidió correo', async () => {
    const url = await startFakeServer();

    const report = await runAuthCheck({ supabaseUrl: url, anonKey: ANON_KEY });
    const texto = formatReport(report);

    expect(report.needsEmail).toBe(true);
    expect(texto).toMatch(/--email/);
    expect(texto).toMatch(/no se pueden leer por API/);
  });

  it('con un 401 explica que la URL o la clave no son del proyecto', async () => {
    const url = await startFakeServer({ settings: { status: 401, body: { msg: 'invalid api key' } } });

    const report = await runAuthCheck({ supabaseUrl: url, anonKey: ANON_KEY });

    expect(report.ok).toBe(false);
    const paso = report.steps.find((s) => s.label === 'GET /auth/v1/settings')!;
    expect(paso.level).toBe('error');
    expect(paso.detail).toMatch(/HTTP 401/);
  });
});

describe('envío real del enlace', { timeout: TEST_TIMEOUT_MS }, () => {
  it('cuando el envío sale bien, devuelve la lista de qué mirar', async () => {
    const url = await startFakeServer();

    const report = await runAuthCheck({
      supabaseUrl: url,
      anonKey: ANON_KEY,
      email: 'visita@example.cl',
      redirectTo: 'https://rix7.cl/properties/ficha',
    });

    expect(report.ok).toBe(true);
    expect(report.sentTo).toBe('visita@example.cl');

    const texto = report.checklist.join('\n');
    expect(texto).toContain('visita@example.cl');
    expect(texto).toContain('https://rix7.cl/properties/ficha');
    expect(texto).toMatch(/ESPAÑOL/);
  });

  it('si el proveedor rechaza el envío, lo dice y no promete nada', async () => {
    const url = await startFakeServer({
      otp: { status: 422, body: { msg: 'Email rate limit exceeded' } },
    });

    const report = await runAuthCheck({
      supabaseUrl: url,
      anonKey: ANON_KEY,
      email: 'visita@example.cl',
      redirectTo: 'https://rix7.cl/',
    });

    expect(report.ok).toBe(false);
    expect(report.sentTo).toBeNull();
    expect(report.checklist).toEqual([]);

    const paso = report.steps.find((s) => s.label.includes('/auth/v1/otp'))!;
    expect(paso.level).toBe('error');
    // El texto del proveedor se conserva: "rate limit" es la pista del límite
    // de 2 correos por hora del integrado.
    expect(paso.detail).toMatch(/rate limit/);
  });

  it('incluye el destino del clic en la lista de verificación', async () => {
    const url = await startFakeServer();

    const report = await runAuthCheck({
      supabaseUrl: url,
      anonKey: ANON_KEY,
      email: 'a@b.cl',
      redirectTo: 'http://localhost:3000/favoritos',
    });

    expect(report.checklist.join(' ')).toContain('http://localhost:3000/favoritos');
  });
});

describe('sin proyecto alcanzable', { timeout: TEST_TIMEOUT_MS }, () => {
  it('no se cae cuando el proyecto no existe', async () => {
    const report = await runAuthCheck({
      // Puerto que nadie escucha: simula una URL mal copiada.
      supabaseUrl: 'http://127.0.0.1:9',
      anonKey: ANON_KEY,
    });

    expect(report.ok).toBe(false);
    const paso = report.steps.find((s) => s.label === 'GET /auth/v1/settings')!;
    expect(paso.level).toBe('error');
    expect(paso.detail).toMatch(/no se pudo conectar/);
  });

  it('con el placeholder no intenta ninguna llamada', async () => {
    const report = await runAuthCheck({
      supabaseUrl: 'https://placeholder-project.supabase.co',
      anonKey: 'placeholder-anon-key',
    });

    expect(report.configured).toBe(false);
    expect(report.steps).toHaveLength(2);
    expect(formatReport(report)).toMatch(/Qué hacer/);
  });
});
