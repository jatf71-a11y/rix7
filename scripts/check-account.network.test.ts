/**
 * Tests del camino de red de la sonda de titularidad, contra un servidor falso.
 *
 * Es la parte que en el mundo real habla con el Management API de Supabase, así
 * que se prueba de verdad: se levanta un servidor local que imita
 * `/v1/organizations`, `/v1/projects`, `/v1/organizations/{slug}/projects` y
 * `/v1/organizations/{slug}/members`, y se comprueba qué reporta la sonda en cada
 * caso. Sin esto, lo único probado sería el formato de los mensajes.
 *
 * Dos cosas que estos tests cuidan especialmente:
 *
 * - que el **token nunca** salga en el veredicto (el informe de esta sonda se pega
 *   en un issue del repositorio);
 * - que el camino del **token de alcance mínimo** funcione: el que solo puede leer
 *   los proyectos de su organización, que es el que conviene crear.
 *
 * Los tiempos límite son más holgados que los de por defecto: esto hace E/S real
 * —levantar el servidor y responder por HTTP— y con la máquina cargada el límite
 * corto falla sin que haya nada roto.
 */
import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyAccountOwnership } from './check-account.mjs';

/** El token de prueba: tiene que ser reconocible para poder buscarlo en el informe. */
const TOKEN = 'sbp_0123456789_token-de-prueba-que-no-debe-filtrarse';
const EXPECTED = 'jatf71@gmail.com';
const REF = 'vsqkjimpssdvlvdwrtnh';

interface FakeRoute {
  status?: number;
  body?: unknown;
}

const ORG_BODY = [{ id: 'org-1', slug: 'miorg', name: 'Mi Org' }];
const ORG_PROJECTS_BODY = [{ ref: REF, name: 'rix7-portal', region: 'sa-east-1' }];

let server: Server | null = null;

/** Levanta el servidor falso con las rutas dadas y devuelve su URL y lo que recibió. */
async function startFakeApi(routes: Record<string, FakeRoute>): Promise<{
  baseUrl: string;
  seen: { path: string; authorization: string | undefined }[];
}> {
  const seen: { path: string; authorization: string | undefined }[] = [];

  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    seen.push({ path: pathname, authorization: req.headers.authorization });

    const route = routes[pathname];
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found' }));
      return;
    }

    res.writeHead(route.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(route.body ?? {}));
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server!.address();
  if (!address || typeof address === 'string') throw new Error('sin puerto');

  return { baseUrl: `http://127.0.0.1:${address.port}`, seen };
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe('verifyAccountOwnership', () => {
  it('el dueño de la organización es el esperado: verificado', async () => {
    const { baseUrl, seen } = await startFakeApi({
      '/v1/organizations': { body: ORG_BODY },
      '/v1/projects': { body: [{ id: REF, organization_id: 'org-1' }] },
      '/v1/organizations/miorg/members': {
        body: [{ user_id: 'u1', user_name: 'Javi', email: EXPECTED, role_name: 'Owner' }],
      },
    });

    const verdict = await verifyAccountOwnership({
      projectRef: REF,
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: baseUrl,
    });

    expect(verdict.state).toBe('verified');
    expect(verdict.ok).toBe(true);
    expect(verdict.organization?.slug).toBe('miorg');
    expect(verdict.ownerEmails).toEqual([EXPECTED]);
    // El token viaja como `Bearer`, que es lo documentado, y a ningún otro lado.
    expect(seen.every((call) => call.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('el token nunca sale en el veredicto', async () => {
    // El informe de esta sonda se pega en un issue: si el token entrara al
    // veredicto, quedaría publicado en el repositorio.
    const { baseUrl } = await startFakeApi({
      '/v1/organizations': { body: ORG_BODY },
      '/v1/projects': { body: [{ id: REF, organization_id: 'org-1' }] },
      '/v1/organizations/miorg/members': { status: 403, body: { message: 'insufficient privileges' } },
    });

    const verdict = await verifyAccountOwnership({
      projectRef: REF,
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: baseUrl,
    });

    const serialized = JSON.stringify(verdict);
    expect(serialized).not.toContain('sbp_');
    expect(serialized).not.toContain(TOKEN);
  });

  it('la organización es de otra cuenta: lo dice con nombre y correo', async () => {
    const { baseUrl } = await startFakeApi({
      '/v1/organizations': { body: ORG_BODY },
      '/v1/projects': { body: [{ id: REF, organization_id: 'org-1' }] },
      '/v1/organizations/miorg/members': {
        body: [
          { user_id: 'u1', email: 'otra@cuenta.cl', role_name: 'Owner' },
          { user_id: 'u2', email: 'dev@cuenta.cl', role_name: 'Developer' },
        ],
      },
    });

    const verdict = await verifyAccountOwnership({
      projectRef: REF,
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: baseUrl,
    });

    expect(verdict.state).toBe('mismatch');
    expect(verdict.reason).toContain('otra@cuenta.cl');
    expect(verdict.reason).toContain('Mi Org');
    expect(verdict.ownerEmails).toEqual(['otra@cuenta.cl']);
  });

  it('sin permiso para leer los miembros no se aprueba nada', async () => {
    const { baseUrl } = await startFakeApi({
      '/v1/organizations': { body: ORG_BODY },
      '/v1/projects': { body: [{ id: REF, organization_id: 'org-1' }] },
      '/v1/organizations/miorg/members': { status: 403, body: { message: 'insufficient privileges' } },
    });

    const verdict = await verifyAccountOwnership({
      projectRef: REF,
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: baseUrl,
    });

    expect(verdict.state).toBe('unconfirmed');
    expect(verdict.reason).toContain('Organization Members → Read');
    // Se supo de qué organización es: eso sí se informa.
    expect(verdict.organization?.slug).toBe('miorg');
  });

  it('el token de alcance mínimo sirve: recorre los proyectos de cada organización', async () => {
    // Es el caso del token que conviene crear: sin «Projects (account-wide)», con
    // «Organization Projects → Read».
    const { baseUrl, seen } = await startFakeApi({
      '/v1/organizations': { body: ORG_BODY },
      '/v1/projects': { status: 403, body: { message: 'insufficient privileges' } },
      '/v1/organizations/miorg/projects': { body: ORG_PROJECTS_BODY },
      '/v1/organizations/miorg/members': { body: [{ email: EXPECTED, role_name: 'Owner' }] },
    });

    const verdict = await verifyAccountOwnership({
      projectRef: REF,
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: baseUrl,
    });

    expect(verdict.state).toBe('verified');
    expect(seen.map((call) => call.path)).toContain('/v1/organizations/miorg/projects');
  });

  it('si el proyecto no aparece en ninguna organización, no se sabe de quién es', async () => {
    const { baseUrl } = await startFakeApi({
      '/v1/organizations': { body: ORG_BODY },
      '/v1/projects': { body: [{ id: 'otro-proyecto', organization_id: 'org-1' }] },
      '/v1/organizations/miorg/projects': { body: ORG_PROJECTS_BODY },
    });

    const verdict = await verifyAccountOwnership({
      projectRef: 'no-existe-ref',
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: baseUrl,
    });

    expect(verdict.state).toBe('unconfirmed');
    expect(verdict.reason).toContain('no-existe-ref');
    expect(verdict.reason).toContain('no aparece');
  });

  it('frena antes de acercarse al límite de tasa, y lo dice', async () => {
    // Tres organizaciones y un techo de una: se recorre la primera y se informa,
    // en vez de barrer la cuenta entera cada 6 horas.
    const { baseUrl, seen } = await startFakeApi({
      '/v1/organizations': {
        body: [
          { id: 'org-1', slug: 'una', name: 'Una' },
          { id: 'org-2', slug: 'dos', name: 'Dos' },
          { id: 'org-3', slug: 'tres', name: 'Tres' },
        ],
      },
      '/v1/projects': { body: [] },
      '/v1/organizations/dos/projects': { body: ORG_PROJECTS_BODY },
      '/v1/organizations/dos/members': { body: [{ email: EXPECTED, role_name: 'Owner' }] },
    });

    const verdict = await verifyAccountOwnership({
      projectRef: REF,
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: baseUrl,
      maxOrganizations: 1,
    });

    expect(verdict.state).toBe('unconfirmed');
    expect(verdict.notes.join(' ')).toContain('techo de 1');
    expect(seen).toHaveLength(3);
  });

  it('que la API no tenga permiso para listar organizaciones es «no se pudo», no «otra cuenta»', async () => {
    const { baseUrl } = await startFakeApi({
      '/v1/organizations': { status: 401, body: { message: 'Unauthorized' } },
    });

    const verdict = await verifyAccountOwnership({
      projectRef: REF,
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: baseUrl,
    });

    expect(verdict.state).toBe('unconfirmed');
    expect(verdict.reason).toContain('revocado');
  });

  it('el límite de tasa de la API se informa como tal', async () => {
    const { baseUrl } = await startFakeApi({
      '/v1/organizations': { status: 429, body: { message: 'rate limited' } },
    });

    const verdict = await verifyAccountOwnership({
      projectRef: REF,
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: baseUrl,
    });

    expect(verdict.state).toBe('unconfirmed');
    expect(verdict.reason).toContain('límite de tasa');
  });

  it('sin respuesta de la API no lanza: informa', async () => {
    // Un puerto cerrado es lo más parecido a «no hay red» que se puede probar.
    const verdict = await verifyAccountOwnership({
      projectRef: REF,
      expectedOwnerEmail: EXPECTED,
      token: TOKEN,
      apiBase: 'http://127.0.0.1:1',
    });

    expect(verdict.state).toBe('unconfirmed');
    expect(verdict.reason).toContain('No se pudieron listar las organizaciones');
  });
});
