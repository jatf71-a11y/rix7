/**
 * Tests de las reglas de vinculación de cuentas a corredoras.
 *
 * Es el módulo que decide quién entra al panel de socios, así que lo que se
 * protege acá no es un formato: son las cuatro reglas que evitan que el alta
 * haga daño —no degradar a un admin, ser idempotente, devolver a Visita al
 * desvincular, y no publicar de una cuenta más datos de los necesarios— y el
 * emparejamiento por correo, que es lo único que permite volver a encontrar la
 * cuenta para desvincularla.
 */
import { describe, expect, it } from 'vitest';

import {
  describeLinkOutcome,
  findAccountByEmail,
  linkMetadata,
  normalizeEmail,
  pickSocioAccounts,
  unlinkMetadata,
} from './socioAccounts';

const socio = (overrides: Record<string, unknown> = {}) => ({
  id: 'u-1',
  email: 'Corredora@Ejemplo.CL',
  app_metadata: { role: 'member', partner_id: 'catedral' },
  ...overrides,
});

describe('normalizeEmail', () => {
  it('recorta y pasa a minúsculas', () => {
    expect(normalizeEmail('  Ana@Corredora.CL ')).toBe('ana@corredora.cl');
  });

  it('rechaza lo que no es un correo, en vez de devolver una cadena vacía', () => {
    for (const value of ['', '   ', 'ana', 'ana@', '@corredora.cl', 'ana@corredora', 42, null, undefined, {}]) {
      expect(normalizeEmail(value)).toBeNull();
    }
  });

  it('corta los correos absurdamente largos', () => {
    expect(normalizeEmail(`${'a'.repeat(200)}@x.cl`)).toBeNull();
  });
});

describe('pickSocioAccounts', () => {
  it('deja solo las cuentas con rol y resuelve el vínculo', () => {
    const accounts = pickSocioAccounts([
      socio(),
      { id: 'u-2', email: 'visita@ejemplo.cl', app_metadata: {} },
      { id: 'u-3', email: 'equipo@rix7.cl', app_metadata: { role: 'admin' } },
      { id: 'u-4', email: 'cliente@ejemplo.cl', app_metadata: { role: 'cliente', partner_id: 'otra' } },
    ]);

    expect(accounts).toEqual([
      { id: 'u-4', email: 'cliente@ejemplo.cl', role: 'member', partnerId: 'otra' },
      { id: 'u-1', email: 'corredora@ejemplo.cl', role: 'member', partnerId: 'catedral' },
      { id: 'u-3', email: 'equipo@rix7.cl', role: 'admin', partnerId: null },
    ]);
  });

  it('ordena por correo para que el listado sea estable', () => {
    const accounts = pickSocioAccounts([
      socio({ id: 'b', email: 'b@ejemplo.cl' }),
      socio({ id: 'a', email: 'a@ejemplo.cl' }),
    ]);
    expect(accounts.map((a) => a.email)).toEqual(['a@ejemplo.cl', 'b@ejemplo.cl']);
  });

  it('descarta entradas sin id, sin correo usable o sin forma', () => {
    expect(
      pickSocioAccounts([
        { email: 'sin-id@ejemplo.cl', app_metadata: { role: 'member' } },
        { id: 'sin-correo', app_metadata: { role: 'member' } },
        { id: 'correo-roto', email: 'roto', app_metadata: { role: 'member' } },
        'basura',
        null,
      ])
    ).toEqual([]);
  });

  it('con algo que no es una lista devuelve lista vacía, sin lanzar', () => {
    expect(pickSocioAccounts(null)).toEqual([]);
    expect(pickSocioAccounts({ users: [] })).toEqual([]);
  });

  it('no publica más que id, correo, rol y corredora', () => {
    const [account] = pickSocioAccounts([
      socio({
        user_metadata: { phone: '+56 9 1111 1111' },
        last_sign_in_at: '2026-01-01T00:00:00Z',
      }),
    ]);

    expect(Object.keys(account).sort()).toEqual(['email', 'id', 'partnerId', 'role']);
  });
});

describe('findAccountByEmail', () => {
  it('empareja sin distinguir mayúsculas ni espacios', () => {
    expect(findAccountByEmail([socio()], ' CORREDORA@ejemplo.cl ')?.id).toBe('u-1');
  });

  it('no inventa una cuenta cuando no está o el correo no sirve', () => {
    expect(findAccountByEmail([socio()], 'otra@ejemplo.cl')).toBeNull();
    expect(findAccountByEmail([socio()], 'roto')).toBeNull();
    expect(findAccountByEmail(null, 'corredora@ejemplo.cl')).toBeNull();
  });
});

describe('linkMetadata', () => {
  it('agrega rol member y el vínculo, conservando el resto de la metadata', () => {
    expect(linkMetadata({ plan: 'pro' }, 'catedral')).toEqual({
      plan: 'pro',
      role: 'member',
      partner_id: 'catedral',
    });
  });

  it('NO degrada a un admin: conserva su rol y solo gana el vínculo', () => {
    expect(linkMetadata({ role: 'admin' }, 'catedral')).toEqual({
      role: 'admin',
      partner_id: 'catedral',
    });
  });

  it('mueve el vínculo si la cuenta ya era socia de otra corredora', () => {
    expect(linkMetadata({ role: 'member', partner_id: 'vieja' }, 'nueva')).toEqual({
      role: 'member',
      partner_id: 'nueva',
    });
  });

  it('con metadata ausente o con forma inesperada parte de un objeto vacío', () => {
    expect(linkMetadata(undefined, 'catedral')).toEqual({ role: 'member', partner_id: 'catedral' });
    expect(linkMetadata('basura', 'catedral')).toEqual({ role: 'member', partner_id: 'catedral' });
    expect(linkMetadata(['x'], 'catedral')).toEqual({ role: 'member', partner_id: 'catedral' });
  });
});

describe('unlinkMetadata', () => {
  it('devuelve la cuenta a Visita y borra el vínculo', () => {
    expect(unlinkMetadata({ role: 'member', partner_id: 'catedral', plan: 'pro' })).toEqual({
      role: 'visitor',
      partner_id: null,
      plan: 'pro',
    });
  });

  it('un admin desvinculado sigue siendo admin', () => {
    expect(unlinkMetadata({ role: 'admin', partner_id: 'catedral' })).toEqual({
      role: 'admin',
      partner_id: null,
    });
  });
});

describe('describeLinkOutcome', () => {
  it('explica qué hacer cuando la cuenta no existe', () => {
    const outcome = describeLinkOutcome('nadie@ejemplo.cl', 'catedral', null);
    expect(outcome).toMatchObject({ status: 404 });
    expect('error' in outcome && outcome.error).toContain('nadie@ejemplo.cl');
    expect('error' in outcome && outcome.error).toContain('crear su cuenta');
  });

  it('reconoce el caso «ya estaba vinculada a esa misma corredora»', () => {
    const account = { id: 'u-1', email: 'a@b.cl', role: 'member' as const, partnerId: 'catedral' };
    expect(describeLinkOutcome('a@b.cl', 'catedral', account)).toEqual({ ok: true, already: true });
  });

  it('vincular a otra corredora no es «ya estaba»', () => {
    const account = { id: 'u-1', email: 'a@b.cl', role: 'member' as const, partnerId: 'vieja' };
    expect(describeLinkOutcome('a@b.cl', 'nueva', account)).toEqual({ ok: true, already: false });
  });

  it('una cuenta sin rol que se vincula tampoco es «ya estaba»', () => {
    const account = { id: 'u-1', email: 'a@b.cl', role: 'visitor' as const, partnerId: null };
    expect(describeLinkOutcome('a@b.cl', 'catedral', account)).toEqual({ ok: true, already: false });
  });
});
