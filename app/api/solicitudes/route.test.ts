/**
 * @vitest-environment node
 *
 * Tests de `/api/solicitudes`: el alta es pública y está limitada; el listado
 * es solo para el equipo y acepta el filtro de las pestañas.
 *
 * El store y el guard se mockean para ejercitar los caminos sin Supabase real;
 * la validación que se prueba es la de verdad (`normalizeSolicitud`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { createSolicitud, listSolicitudes, updateSolicitudStatus, requireAdmin, sendEmail } =
  vi.hoisted(() => ({
    createSolicitud: vi.fn(),
    listSolicitudes: vi.fn(),
    updateSolicitudStatus: vi.fn(),
    requireAdmin: vi.fn(),
    sendEmail: vi.fn(),
  }));

vi.mock('@/lib/data/solicitudesStore', () => ({
  createSolicitud,
  listSolicitudes,
  updateSolicitudStatus,
}));
vi.mock('@/lib/supabase/auth-guard', () => ({ requireAdmin }));
vi.mock('@/lib/email/sendEmail', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  isEmailConfigured: () => true,
}));

// El rate limit vive en estado de módulo: cada test arranca con el contador en
// cero (`vi.resetModules()` + import dinámico).
let route: typeof import('./route');

const registro = {
  kind: 'corredora',
  name: 'Camila Rojas',
  email: 'camila@example.cl',
  phone: '+56 2 2345 6789',
  consent: true,
  company: 'Catedral Propiedades',
  rut: '76.123.456-0',
  role: 'Gerente comercial',
  coverage: 'regional',
  regions: ['Valparaíso', 'Región Metropolitana de Santiago'],
};

const valida = {
  kind: 'propuestas',
  name: 'Ana Pérez',
  email: 'ana@example.cl',
  phone: '+56 9 1234 5678',
  consent: true,
  operation: 'sale',
  property_type: 'apartment',
  region: 'Región Metropolitana de Santiago',
  commune: 'Providencia',
  address: 'Av. Providencia 1234',
  expected_price: '120000000',
  rol: '15234-67',
  message: 'Departamento arrendado hasta marzo.',
};

const post = (body: unknown, ip = '1.2.3.4') =>
  new NextRequest('http://localhost/api/solicitudes', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });

const get = (query = '') => new NextRequest(`http://localhost/api/solicitudes${query}`);

const patch = (body: unknown) =>
  new NextRequest('http://localhost/api/solicitudes', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeEach(async () => {
  vi.resetModules();
  route = await import('./route');
  createSolicitud.mockReset();
  listSolicitudes.mockReset();
  updateSolicitudStatus.mockReset();
  requireAdmin.mockReset();
  createSolicitud.mockResolvedValue({ ok: true, id: 's1', persisted: true });
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ sent: true, skipped: false });
  vi.stubEnv('SOLICITUDES_EMAIL_TO', 'equipo@example.cl');
  listSolicitudes.mockResolvedValue({ solicitudes: [], source: 'supabase', persistent: true });
  updateSolicitudStatus.mockResolvedValue({
    ok: true,
    found: true,
    persisted: true,
    solicitud: { id: 's1', status: 'Pendiente_Informacion' },
  });
  requireAdmin.mockResolvedValue({ ok: true, role: 'admin', devBypass: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/solicitudes', () => {
  it('registra una solicitud de propuestas válida y devuelve el folio', async () => {
    const response = await route.POST(post(valida));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      id: 's1',
      persisted: true,
    });

    expect(createSolicitud).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'propuestas',
        name: 'Ana Pérez',
        payload: expect.objectContaining({
          commune: 'Providencia',
          expected_price: 120_000_000,
          rol: '15234-67',
        }),
      })
    );
  });

  it('no requiere sesión: quien publica todavía no tiene cuenta', async () => {
    await route.POST(post(valida));
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('avisa por correo al equipo cuando entra un registro de empresa', async () => {
    const response = await route.POST(post(registro));

    expect(response.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const [mail] = sendEmail.mock.calls[0];
    expect(mail.to).toBe('equipo@example.cl');
    expect(mail.subject).toContain('Corredora');
    expect(mail.text).toContain('RUT: 76.123.456-0');
    expect(mail.text).toContain('Valparaíso');
  });

  it('una solicitud de propietario no manda aviso al equipo', async () => {
    await route.POST(post(valida));

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sin destinatario configurado guarda igual y no inventa el envío', async () => {
    vi.stubEnv('SOLICITUDES_EMAIL_TO', '');

    const response = await route.POST(post(registro));

    expect(response.status).toBe(201);
    expect(createSolicitud).toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('si el aviso falla, la solicitud igual queda guardada', async () => {
    sendEmail.mockRejectedValue(new Error('Resend caído'));

    const response = await route.POST(post(registro));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ success: true, id: 's1' });
    expect(createSolicitud).toHaveBeenCalledTimes(1);
  });

  it('rechaza un tipo desconocido sin llegar al store', async () => {
    const response = await route.POST(post({ ...valida, kind: 'vendedor' }));

    expect(response.status).toBe(400);
    expect(createSolicitud).not.toHaveBeenCalled();
  });

  it('rechaza un ROL inválido sin llegar al store', async () => {
    const response = await route.POST(post({ ...valida, rol: 'sin-rol' }));

    expect(response.status).toBe(400);
    expect(createSolicitud).not.toHaveBeenCalled();
  });

  it('rechaza una solicitud de propuestas sin precio o sin ROL', async () => {
    const sinPrecio = await route.POST(post({ ...valida, expected_price: '' }));
    const sinRol = await route.POST(post({ ...valida, rol: '' }));

    expect(sinPrecio.status).toBe(400);
    expect(sinRol.status).toBe(400);
    expect(createSolicitud).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    const response = await route.POST(post('{roto'));

    expect(response.status).toBe(400);
    expect(createSolicitud).not.toHaveBeenCalled();
  });

  it('avisa cuando la solicitud no se pudo guardar', async () => {
    createSolicitud.mockResolvedValue({ ok: false, persisted: true, error: 'boom' });

    const response = await route.POST(post(valida));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it('informa cuando se guardó sin persistir (desarrollo sin Supabase)', async () => {
    createSolicitud.mockResolvedValue({ ok: true, id: 'memoria-1', persisted: false });

    const response = await route.POST(post(valida));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ persisted: false });
  });

  it('corta la ráfaga de una misma IP con 429', async () => {
    let limitado = 0;
    for (let i = 0; i < 30; i += 1) {
      const response = await route.POST(post(valida, '9.9.9.9'));
      if (response.status === 429) limitado += 1;
    }

    expect(limitado).toBeGreaterThan(0);
    expect(createSolicitud.mock.calls.length).toBeLessThan(30);
  });
});

describe('GET /api/solicitudes', () => {
  it('responde 403 cuando el guard rechaza', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ success: false }, { status: 403 }),
    });

    const response = await route.GET(get());

    expect(response.status).toBe(403);
    expect(listSolicitudes).not.toHaveBeenCalled();
  });

  it('devuelve el listado con su origen y si persiste', async () => {
    listSolicitudes.mockResolvedValue({
      solicitudes: [{ id: 's1', kind: 'propuestas' }],
      source: 'supabase',
      persistent: true,
    });

    const response = await route.GET(get());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.source).toBe('supabase');
    expect(body.persistent).toBe(true);
  });

  it('pasa el filtro de tipo al store', async () => {
    await route.GET(get('?kind=corredora'));

    expect(listSolicitudes).toHaveBeenCalledWith('corredora');
  });

  it('rechaza un filtro desconocido en vez de devolver todo', async () => {
    const response = await route.GET(get('?kind=otra'));

    expect(response.status).toBe(400);
    expect(listSolicitudes).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/solicitudes', () => {
  it('responde 403 cuando el guard rechaza y no toca la solicitud', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ success: false }, { status: 403 }),
    });

    const response = await route.PATCH(patch({ id: 's1', status: 'Pendiente_Informacion' }));

    expect(response.status).toBe(403);
    expect(updateSolicitudStatus).not.toHaveBeenCalled();
  });

  it('cambia el estado y devuelve la fila actualizada', async () => {
    const response = await route.PATCH(patch({ id: 's1', status: 'Pendiente_Informacion' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSolicitudStatus).toHaveBeenCalledWith('s1', 'Pendiente_Informacion');
    expect(body).toMatchObject({ success: true, solicitud: { id: 's1', status: 'Pendiente_Informacion' } });
  });

  it('rechaza un estado que no es del ciclo sin llegar al store', async () => {
    const response = await route.PATCH(patch({ id: 's1', status: 'pagada' }));

    expect(response.status).toBe(400);
    expect(updateSolicitudStatus).not.toHaveBeenCalled();
  });

  it('rechaza un id con forma inválida sin llegar al store', async () => {
    const response = await route.PATCH(patch({ id: 'x'.repeat(200), status: 'Aceptada' }));

    expect(response.status).toBe(400);
    expect(updateSolicitudStatus).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    const response = await route.PATCH(patch('{roto'));

    expect(response.status).toBe(400);
    expect(updateSolicitudStatus).not.toHaveBeenCalled();
  });

  it('devuelve 404 cuando la solicitud ya no existe', async () => {
    updateSolicitudStatus.mockResolvedValue({
      ok: false,
      found: false,
      persisted: true,
      error: 'No encontramos esa solicitud.',
    });

    const response = await route.PATCH(patch({ id: 's9', status: 'Aceptada' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it('distingue un fallo de la base (500) de una fila inexistente (404)', async () => {
    updateSolicitudStatus.mockResolvedValue({
      ok: false,
      found: true,
      persisted: true,
      error: 'deadlock detected',
    });

    const response = await route.PATCH(patch({ id: 's1', status: 'Aceptada' }));

    expect(response.status).toBe(500);
  });
});
