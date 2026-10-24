/**
 * Alta del panel para una empresa aceptada.
 *
 * Para que `/socio` abra hacen falta dos cosas: una ficha en `partners` y una
 * cuenta con `app_metadata.role = member` y `partner_id` apuntando a esa ficha.
 * Esto crea —o reutiliza— la ficha y deja la cuenta lista:
 *
 * - Si la persona ya tiene cuenta con ese correo, se le escribe el rol y el
 *   vínculo (sin degradar a un admin, ver `linkMetadata`).
 * - Si no la tiene, se crea confirmada y se genera un enlace mágico de un solo
 *   uso para que entre sin contraseña, que es como entra todo el portal.
 *
 * Necesita la clave de servicio (`SUPABASE_SERVICE_ROLE_KEY`): `app_metadata`
 * solo lo escribe el servidor y la tabla `partners` solo deja escribir a un
 * admin. Sin esa clave no se puede habilitar el panel y se dice, en vez de
 * devolver un «listo» falso.
 */

import { linkMetadata } from '@/lib/data/socioAccounts';
import { isServiceRoleConfigured } from '@/lib/supabase/admin';
import { slugify } from '@/lib/utils/text';
import type { KybApplication } from './types';

export interface ProvisionResult {
  ok: boolean;
  partnerId?: string;
  /** Cómo quedó la cuenta: existente vinculada, creada ahora o sin tocar. */
  account?: 'linked' | 'created' | 'none';
  /** Enlace mágico de un solo uso, si se pudo generar. */
  magicLink?: string;
  error?: string;
}

/** Id de la ficha: el slug de la razón social, acotado y sin colisiones obvias. */
export function partnerIdFor(application: Pick<KybApplication, 'legalName' | 'rut'>): string {
  const base = slugify(application.legalName) || 'empresa';
  const trimmed = base.slice(0, 60).replace(/-+$/, '');
  // El RUT desambigua dos empresas con el mismo nombre comercial.
  const suffix = application.rut.replace(/\D/g, '').slice(-4);
  return `${trimmed}-${suffix}`;
}

async function findUserByEmail(
  admin: Awaited<ReturnType<typeof serviceAdmin>>,
  email: string
): Promise<{ id: string; app_metadata?: unknown } | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const match = users.find(
      (user) => (user.email ?? '').toLowerCase() === email.toLowerCase()
    );
    if (match) return { id: match.id, app_metadata: match.app_metadata };
    if (users.length < 1000) return null;
  }
  return null;
}

async function serviceAdmin() {
  const { createServiceRoleClient } = await import('@/lib/supabase/admin');
  return createServiceRoleClient();
}

export async function provisionCompanyPanel(
  application: KybApplication
): Promise<ProvisionResult> {
  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      error:
        'Falta SUPABASE_SERVICE_ROLE_KEY: no se puede crear la ficha ni vincular la cuenta del panel.',
    };
  }

  const partnerId = partnerIdFor(application);

  try {
    const admin = await serviceAdmin();

    // 1. Ficha de empresa. `kind` queda sin clasificar a propósito: el alta KYB
    //    no decide si es corredora, inmobiliaria o agente; eso lo clasifica el
    //    equipo desde /admin/empresas sin inventarle una categoría.
    const { error: partnerError } = await admin.from('partners').upsert(
      {
        id: partnerId,
        slug: partnerId,
        name: application.legalName,
        logo: '',
        description: `Empresa verificada en el alta automática de Rix7 (${new Date().toISOString().slice(0, 10)}).`,
        website: application.website,
        color: '#3B82F6',
        contact_phone: application.phone,
        contact_whatsapp: '',
        contact_email: application.email,
      },
      { onConflict: 'id', ignoreDuplicates: false }
    );

    if (partnerError) {
      return { ok: false, partnerId, error: `No se pudo crear la ficha: ${partnerError.message}` };
    }

    // 2. Cuenta: vincular la existente o crearla confirmada.
    const existing = await findUserByEmail(admin, application.email);
    let account: ProvisionResult['account'] = 'none';
    let magicLink: string | undefined;

    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        app_metadata: linkMetadata(existing.app_metadata, partnerId),
      });
      if (error) {
        return { ok: false, partnerId, error: `No se pudo vincular la cuenta: ${error.message}` };
      }
      account = 'linked';
    } else {
      const { error } = await admin.auth.admin.createUser({
        email: application.email,
        email_confirm: true,
        app_metadata: linkMetadata(undefined, partnerId),
      });
      if (error) {
        return { ok: false, partnerId, error: `No se pudo crear la cuenta: ${error.message}` };
      }
      account = 'created';
    }

    // 3. Enlace de un solo uso para entrar sin contraseña. Si falla, la cuenta
    //    ya existe y el correo trae el enlace al panel: el alta no se cae por
    //    esto.
    try {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: application.email,
      });
      if (!error) magicLink = data?.properties?.action_link;
    } catch {
      // Best-effort: el panel sigue siendo alcanzable con el correo.
    }

    return { ok: true, partnerId, account, magicLink };
  } catch (error) {
    return {
      ok: false,
      partnerId,
      error: error instanceof Error ? error.message : 'Error inesperado al habilitar el panel.',
    };
  }
}
