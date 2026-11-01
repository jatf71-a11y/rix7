/**
 * Tests de `cobranzaStore` — el cierre del circuito que une el pago con el alta
 * y con la vidriera pública.
 *
 * La regla que este archivo vigila es la que se rompió en producción: al
 * registrar un pago que deja al socio sin períodos vencidos, la morosidad se
 * levanta **sola**. La condición comparaba el estado calculado —que mientras la
 * marca está puesta siempre es «moroso»— contra «no ser moroso», así que el
 * levantamiento nunca ocurría y el socio quedaba bloqueado hasta que alguien lo
 * destrabara a mano.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const isServiceRoleConfigured = vi.fn(() => true);
const createServiceRoleClient = vi.fn();
const listApplications = vi.fn();
const updateApplication = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  isServiceRoleConfigured: () => isServiceRoleConfigured(),
  createServiceRoleClient: () => createServiceRoleClient(),
}));

vi.mock('@/lib/kyb/store', () => ({
  listApplications: (...args: unknown[]) => listApplications(...args),
  updateApplication: (...args: unknown[]) => updateApplication(...args),
}));

import { registrarPago, setMorosidad } from './cobranzaStore';
import type { BillingPeriod } from './cobranza';

interface FakeRow {
  partner_id: string;
  period: string;
  amount_clp: number;
  due_date: string;
  paid_at: string | null;
  note: string | null;
}

/**
 * Cliente falso thenable: registra la cadena y devuelve las filas de cobranza que
 * el test dejó. El `upsert` del pago se refleja en esas filas, para que la
 * situación posterior —la que decide si se levanta la morosidad— se calcule
 * sobre lo que quedó guardado y no sobre lo que el panel creía.
 */
function fakeClient(rows: FakeRow[], moroso = true) {
  const calls: string[] = [];
  const state = rows.map((row) => ({ ...row }));

  function builder(table: string) {
    const api: Record<string, unknown> = {};
    let pendingUpdate: Record<string, unknown> | null = null;

    const finish = () =>
      table === 'partners' && pendingUpdate
        ? { data: null, error: null }
        : { data: state, error: null };

    for (const name of ['select', 'eq', 'limit', 'order']) {
      api[name] = vi.fn((...args: unknown[]) => {
        calls.push(`${table}.${name}:${JSON.stringify(args)}`);
        return api;
      });
    }

    api.update = vi.fn((values: Record<string, unknown>) => {
      calls.push(`${table}.update:${JSON.stringify(values)}`);
      pendingUpdate = values;
      return api;
    });

    api.upsert = vi.fn((values: FakeRow, options: { onConflict?: string }) => {
      calls.push(`${table}.upsert:${JSON.stringify({ values, onConflict: options?.onConflict })}`);
      const index = state.findIndex(
        (row) => row.partner_id === values.partner_id && row.period === values.period
      );
      if (index >= 0) state[index] = { ...state[index], ...values };
      else state.push({ ...values });
      return Promise.resolve({ data: null, error: null });
    });

    api.maybeSingle = vi.fn(() => {
      // `partners` es la única tabla con `maybeSingle` en este flujo: la marca.
      return Promise.resolve({ data: { moroso }, error: null });
    });

    api.then = (resolve: (value: unknown) => unknown) => resolve(finish());
    return api;
  }

  return {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      return builder(table);
    },
  };
}

/** Una fila pagada del período en curso, la situación de partida del test. */
function paidThisMonth(partnerId: string): FakeRow {
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    partner_id: partnerId,
    period,
    amount_clp: 39990,
    due_date: `${period}-10`,
    paid_at: now.toISOString(),
    note: null,
  };
}

const PARTNER = 'socio-prueba';

beforeEach(() => {
  isServiceRoleConfigured.mockReturnValue(true);
  listApplications.mockResolvedValue({ ok: true, data: { applications: [] } });
  updateApplication.mockResolvedValue({ ok: true });
});

describe('registrar un pago', () => {
  it('levanta la morosidad cuando el pago deja al socio sin períodos vencidos', async () => {
    const rows = [paidThisMonth(PARTNER)];
    const client = fakeClient(rows, true);
    createServiceRoleClient.mockReturnValue(client);

    const result = await registrarPago({
      partnerId: PARTNER,
      period: paidThisMonth(PARTNER).period,
      amountClp: 39990,
    });

    expect(result.ok).toBe(true);
    const lifted = client.calls.some(
      (call) => call.startsWith('partners.update') && call.includes('"moroso":false')
    );
    expect(lifted).toBe(true);
  });

  it('no la levanta si queda un período viejo sin pagar', async () => {
    const overdue: BillingPeriod = {
      partnerId: PARTNER,
      period: '2026-01',
      amountClp: 39990,
      dueDate: '2026-01-10',
      paidAt: null,
      note: null,
    };
    const client = fakeClient(
      [
        {
          partner_id: PARTNER,
          period: overdue.period,
          amount_clp: overdue.amountClp,
          due_date: overdue.dueDate,
          paid_at: null,
          note: null,
        },
      ],
      true
    );
    createServiceRoleClient.mockReturnValue(client);

    const result = await registrarPago({
      partnerId: PARTNER,
      period: paidThisMonth(PARTNER).period,
      amountClp: 39990,
    });

    expect(result.ok).toBe(true);
    const lifted = client.calls.some((call) => call.includes('"moroso":false'));
    expect(lifted).toBe(false);
    // El panel ve la situación recalculada: sigue moroso y con la deuda vieja.
    expect(result.situacion?.estado).toBe('moroso');
    expect(result.situacion?.periodosVencidos).toEqual(['2026-01']);
  });

  it('registra el pago del período como upsert, no como fila nueva', async () => {
    const client = fakeClient([paidThisMonth(PARTNER)], false);
    createServiceRoleClient.mockReturnValue(client);

    await registrarPago({ partnerId: PARTNER, period: '2026-11', amountClp: 39990 });

    const upsert = client.calls.find((call) => call.startsWith('partner_billing.upsert'));
    expect(upsert).toContain('"onConflict":"partner_id,period"');
  });

  it('cierra el alta del socio que acaba de pagar', async () => {
    createServiceRoleClient.mockReturnValue(fakeClient([], false));
    listApplications.mockResolvedValue({
      ok: true,
      data: { applications: [{ id: 'alta-1', partnerId: PARTNER, status: 'Alta' }] },
    });

    await registrarPago({ partnerId: PARTNER, period: '2026-11', amountClp: 39990 });

    expect(updateApplication).toHaveBeenCalledWith('alta-1', { status: 'Operando' });
  });

  it('rechaza un pago sin monto o con período inválido antes de tocar la base', async () => {
    const client = fakeClient([], false);
    createServiceRoleClient.mockReturnValue(client);

    const sinMonto = await registrarPago({ partnerId: PARTNER, period: '2026-11' });
    const sinPeriodo = await registrarPago({ partnerId: PARTNER, amountClp: 39990 });

    expect(sinMonto.ok).toBe(false);
    expect(sinPeriodo.ok).toBe(false);
    expect(client.calls).toHaveLength(0);
  });
});

describe('cambiar la morosidad a mano', () => {
  it('la confirma con nota y devuelve la situación del socio', async () => {
    const client = fakeClient([paidThisMonth(PARTNER)], true);
    createServiceRoleClient.mockReturnValue(client);

    const result = await setMorosidad({
      partnerId: PARTNER,
      moroso: true,
      nota: 'Tres períodos sin pagar.',
    });

    expect(result.ok).toBe(true);
    const update = client.calls.find((call) => call.startsWith('partners.update'));
    expect(update).toContain('"moroso":true');
    expect(update).toContain('Tres períodos sin pagar.');
    expect(result.situacion?.estado).toBe('moroso');
  });

  it('exige decir si queda moroso o al día', async () => {
    createServiceRoleClient.mockReturnValue(fakeClient([], false));

    const result = await setMorosidad({ partnerId: PARTNER, moroso: 'sí' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/moroso o al día/);
  });
});
