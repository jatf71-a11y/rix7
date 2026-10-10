import { describe, it, expect } from 'vitest';
import {
  decideAdminAccess,
  decideMemberAccess,
  resolvePartnerId,
  resolveRole,
  type RoleUserLike,
} from './roles';

describe('resolveRole', () => {
  it('trata a un usuario sin sesión como visita', () => {
    expect(resolveRole(null)).toBe('visitor');
    expect(resolveRole(undefined)).toBe('visitor');
  });

  it('trata a un usuario autenticado sin rol como visita', () => {
    // Visita no es "anónimo": alguien con cuenta sin rol sigue siendo visita.
    expect(resolveRole({})).toBe('visitor');
    expect(resolveRole({ app_metadata: {} })).toBe('visitor');
    expect(resolveRole({ app_metadata: { role: null } })).toBe('visitor');
  });

  it('reconoce el rol admin', () => {
    expect(resolveRole({ app_metadata: { role: 'admin' } })).toBe('admin');
  });

  it('reconoce el rol member (Cliente) y sus alias del negocio', () => {
    expect(resolveRole({ app_metadata: { role: 'member' } })).toBe('member');
    expect(resolveRole({ app_metadata: { role: 'client' } })).toBe('member');
    expect(resolveRole({ app_metadata: { role: 'cliente' } })).toBe('member');
    expect(resolveRole({ app_metadata: { role: 'miembro' } })).toBe('member');
  });

  it('tolera mayúsculas y espacios', () => {
    expect(resolveRole({ app_metadata: { role: '  MEMBER ' } })).toBe('member');
    expect(resolveRole({ app_metadata: { role: 'Admin' } })).toBe('admin');
  });

  it('no asciende por accidente con un rol desconocido', () => {
    expect(resolveRole({ app_metadata: { role: 'superuser' } })).toBe('visitor');
    expect(resolveRole({ app_metadata: { role: 'corredora' } })).toBe('visitor');
    expect(resolveRole({ app_metadata: { role: 42 } })).toBe('visitor');
    expect(resolveRole({ app_metadata: { role: { nested: 'admin' } } })).toBe('visitor');
  });

  it('ignora un rol que venga en user_metadata (editable por el usuario)', () => {
    // Solo app_metadata es de confianza; user_metadata la escribe el propio
    // usuario desde el cliente, así que no debe conceder nada.
    const user = { user_metadata: { role: 'admin' } } as RoleUserLike;
    expect(resolveRole(user)).toBe('visitor');
  });
});

describe('decideAdminAccess', () => {
  const base = { configured: true, authenticated: true, role: 'admin' as const, devBypass: false };

  it('permite al admin con sesión y proyecto configurado', () => {
    expect(decideAdminAccess(base)).toEqual({ allow: true, status: null, error: null });
  });

  it('rechaza con 401 cuando no hay sesión', () => {
    const decision = decideAdminAccess({ ...base, authenticated: false, role: 'visitor' });
    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
  });

  it('rechaza con 403 a una visita o a un Cliente autenticado', () => {
    expect(decideAdminAccess({ ...base, role: 'visitor' }).status).toBe(403);
    expect(decideAdminAccess({ ...base, role: 'member' }).status).toBe(403);
  });


  it('sin proyecto configurado permite en desarrollo y falla cerrado en producción', () => {
    const sinSupabase = { ...base, configured: false, authenticated: false, role: 'visitor' as const };
    expect(decideAdminAccess({ ...sinSupabase, devBypass: true }).allow).toBe(true);

    const denial = decideAdminAccess({ ...sinSupabase, devBypass: false });
    expect(denial.allow).toBe(false);
    expect(denial.status).toBe(503);
  });

  it('el bypass de desarrollo nunca salta una sesión real existente sin rol', () => {
    // Con Supabase configurado, el bypass no aplica: manda el rol.
    const decision = decideAdminAccess({ ...base, role: 'member', devBypass: true });
    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(403);
  });
});

describe('resolvePartnerId', () => {
  it('lee la corredora de app_metadata', () => {
    expect(resolvePartnerId({ app_metadata: { partner_id: 'catedral' } })).toBe('catedral');
    expect(resolvePartnerId({ app_metadata: { partner_id: '  .portal-inmobiliario ' } })).toBe(
      '.portal-inmobiliario'
    );
  });

  it('devuelve null sin sesión o sin el claim', () => {
    expect(resolvePartnerId(null)).toBeNull();
    expect(resolvePartnerId({})).toBeNull();
    expect(resolvePartnerId({ app_metadata: {} })).toBeNull();
    expect(resolvePartnerId({ app_metadata: { role: 'member' } })).toBeNull();
  });

  it('no acepta basura con forma de cadena', () => {
    // Un id inventado no existe en partners: usarlo en una política RLS
    // solo podría buscar de más, nunca de menos — pero la forma se valida
    // igual que idSchema para no propagar valores arbitrarios.
    expect(resolvePartnerId({ app_metadata: { partner_id: '' } })).toBeNull();
    expect(resolvePartnerId({ app_metadata: { partner_id: '   ' } })).toBeNull();
    expect(resolvePartnerId({ app_metadata: { partner_id: 'id con espacios' } })).toBeNull();
    expect(resolvePartnerId({ app_metadata: { partner_id: 'sql; DROP TABLE x' } })).toBeNull();
    expect(resolvePartnerId({ app_metadata: { partner_id: 'a'.repeat(121) } })).toBeNull();
  });

  it('ignora valores que no son cadena', () => {
    expect(resolvePartnerId({ app_metadata: { partner_id: 42 } })).toBeNull();
    expect(resolvePartnerId({ app_metadata: { partner_id: { id: 'x' } } })).toBeNull();
    // Igual que con el rol: user_metadata lo escribe el usuario, no vale.
    const spoofed = { user_metadata: { partner_id: 'catedral' } } as RoleUserLike;
    expect(resolvePartnerId(spoofed)).toBeNull();
  });
});

describe('decideMemberAccess', () => {
  const base = { configured: true, authenticated: true, role: 'member' as const, devBypass: false };
  it('permite al socio con sesión', () => {
    expect(decideMemberAccess(base)).toEqual({ allow: true, status: null, error: null });
  });

  it('permite también al admin', () => {
    // El equipo de Rix7 administra las mismas publicaciones: no necesita
    // una corredora vinculada para poder entrar al panel.
    expect(decideMemberAccess({ ...base, role: 'admin' }).allow).toBe(true);
  });

  it('rechaza con 401 cuando no hay sesión', () => {
    const decision = decideMemberAccess({ ...base, authenticated: false, role: 'visitor' });
    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
  });

  it('rechaza con 403 a una visita autenticada sin rol', () => {
    expect(decideMemberAccess({ ...base, role: 'visitor' }).status).toBe(403);
  });

  it('sin proyecto configurado permite en desarrollo y falla cerrado en producción', () => {
    const sinSupabase = { ...base, configured: false, authenticated: false, role: 'visitor' as const };
    expect(decideMemberAccess({ ...sinSupabase, devBypass: true }).allow).toBe(true);

    const denial = decideMemberAccess({ ...sinSupabase, devBypass: false });
    expect(denial.allow).toBe(false);
    expect(denial.status).toBe(503);
  });

  it('el bypass de desarrollo no salta una sesión real existente sin rol', () => {
    const decision = decideMemberAccess({ ...base, role: 'visitor', devBypass: true });
    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(403);
  });
});
