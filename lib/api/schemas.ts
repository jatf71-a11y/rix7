/**
 * Esquemas Zod de las rutas `/api/*`.
 *
 * Antes de este módulo la validación de entrada vivía dispersa: ifs sueltos en
 * cada handler, `Number(...)` sin verificar `NaN`, y cuerpos que se leían con
 * `as` sin garantía de forma. Con Zod la **forma** de cada entrada queda
 * declarada en un solo lugar, los límites son explícitos (los mismos que las
 * columnas y políticas de Supabase toleran) y las respuestas de error llevan un
 * formato uniforme.
 *
 * Convención de la capa:
 *
 * - Zod valida la **forma y los límites** del dato que llega del navegador.
 *   La **semántica de dominio** sigue donde ya estaba (p. ej. `normalizeLead`
 *   para contactos, `normalizePropertyIds` para favoritos): esos módulos son
 *   puros, están testeados y comparten reglas con las políticas RLS.
 * - Los mensajes de error son los mismos que las rutas devolvían a mano, para
 *   no romper contratos con la UI ni con los tests.
 * - Se aceptan campos desconocidos (`.passthrough()` o simplemente no
 *   `strict()`): endurecer eso sin necesidad rompe clientes legítimos.
 *
 * Referencia de límites usados: `LEAD_LIMITS` (lib/data/leads),
 * `MAX_FAVORITES` (lib/data/favorites) y `MAX_ID_LENGTH` de cada store.
 */

import { z } from 'zod';

import { isValidRol, ROL_MAX_LENGTH } from '@/lib/utils/rol';
import { KYB_PLAN_IDS } from '@/lib/kyb/plans';

/** Longitud máxima aceptada para ids de propiedad/usuario-style legibles. */
const MAX_ID_LENGTH = 120;

/** Tope de favoritos por cuenta (igual criterio que `MAX_FAVORITES`). */
const MAX_FAVORITE_IDS = 200;

/**
 * Id legible del catálogo (`scl-depto-marco-polo`, `com-13-...`).
 * El alfabeto acotado evita guardar basura arbitraria en columnas de texto.
 */
const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(/^[A-Za-z0-9._-]+$/);

/** Número entero no negativo (contadores, límites de página). */
const nonNegativeInt = (max: number) => z.coerce.number().int().min(0).max(max);

/**
 * Coordenada decimal chilena tolerante: acota el rango global en vez del
 * bounding box nacional para no rechazar búsquedas de frontera legítimas.
 */
const coordinate = z.coerce.number().finite();

// ═══ /api/favorites ═══

/**
 * POST acepta `propertyId` (corazón de una ficha) o `propertyIds` (migración
 * desde localStorage). La pertenencia la impone el servidor con `userId` de
 * sesión: nada de lo que llegue en el cuerpo puede elegirla.
 *
 * Los **valores** de cada id los filtra después `normalizePropertyIds`: en una
 * importación los ids inválidos se descartan y siguen los buenos (contrato que
 * ya tenían los tests), así que acá solo se acota el tamaño del lote.
 */
export const favoritesPostSchema = z
  .object({
    propertyId: z.unknown().optional(),
    propertyIds: z.array(z.unknown()).max(MAX_FAVORITE_IDS).optional(),
  })
  .refine(
    (body) => body.propertyId !== undefined || (body.propertyIds?.length ?? 0) > 0,
    { message: 'Falta el id de la propiedad.' }
  );

export const favoritesDeleteSchema = z.object({
  propertyId: idSchema,
});

// ═══ /api/saved-searches ═══

/**
 * DELETE exige un id. La propiedad del recurso la resuelve el store con el
 * `userId` de sesión (RLS), así que aquí solo importa que el id tenga forma.
 */
export const savedSearchDeleteSchema = z.object({
  id: idSchema,
});

// ═══ /api/geocode ═══

/**
 * Autocompletado: cada tecla dispara una consulta, así que el límite de largo
 * existe para que nadie use el proxy hacia Nominatim como buscador general.
 *
 * Las consultas cortas **no** se rechazan: el contrato de la ruta es responder
 * 200 con lista vacía (el cliente dispara con 0 o 1 caracteres al montar), así
 * que acá solo se acota el techo y se recorta; el mínimo lo decide la ruta.
 */
export const geocodeQuerySchema = z.object({
  q: z.string().trim().max(120).default(''),
});

// ═══ /api/pois ═══

/**
 * Proxy a Overpass: los radios válidos y el límite global de coordenadas
 * evitan consultas absurdas antes de gastar presupuesto de failover.
 */
export const poisQuerySchema = z.object({
  lat: coordinate.refine((v) => Math.abs(v) <= 90, 'Coordenadas inválidas'),
  lng: coordinate.refine((v) => Math.abs(v) <= 180, 'Coordenadas inválidas'),
});

// ═══ /api/properties ═══

/**
 * operation: `all` o el `status` de la propiedad (`for_sale` / `for_rent`).
 * La UI envía `sale`/`rent` desde la navbar (_links `/?operation=sale`), así que
 * se mapean aquí y no en cada cliente.
 */
const OPERATION_STATUS = ['for_sale', 'for_rent', 'sale', 'rent'] as const;

export const OPERATION_ALIASES: Record<string, string> = {
  sale: 'for_sale',
  rent: 'for_rent',
};

/**
 * Filtros del catálogo. Los contadores del buscador dependen de que `all` siga
 * siendo un valor válido para operación y tipo.
 */
export const propertiesQuerySchema = z.object({
  operation: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v === undefined || v === '' ? 'all' : v))
    .refine((v) => v === 'all' || (OPERATION_STATUS as readonly string[]).includes(v), {
      message: 'Operación inválida.',
    }),
  propertyType: z.string().trim().max(40).default('all'),
  search: z.string().trim().max(120).default(''),
  region: z.string().trim().max(80).default(''),
  commune: z.string().trim().max(80).default(''),
  minPrice: nonNegativeInt(1_000_000_000).optional(),
  maxPrice: nonNegativeInt(1_000_000_000).optional(),
  minBedrooms: nonNegativeInt(20).optional(),
  minBathrooms: nonNegativeInt(20).optional(),
  minPrivates: nonNegativeInt(99).optional(),
  newPropertyType: z.enum(['proyectos', 'entrega_inmediata']).optional(),
  partnerId: idSchema.optional(),
  page: nonNegativeInt(10_000).catch(1).default(1),
  limit: nonNegativeInt(2000).catch(50).default(50),
});

// ═══ /api/properties/[id] ═══

/** Parámetro de ruta del detalle de propiedad. */
export const propertyIdParamsSchema = z.object({
  id: idSchema,
});

// ═══ /api/properties/[id]/view ═══

/**
 * Ping de visita de una ficha. `counted` distingue «esta sesión todavía no la
 * contaba» (true, por defecto) de «solo quiero refrescar el número» (false):
 * recargar no debe inflar el contador, pero sí conviene ver el total al día.
 * El id de la propiedad viene en la ruta, no en el cuerpo.
 */
export const propertyViewSchema = z.object({
  counted: z.boolean().optional().default(true),
});

// ═══ /api/share/view ═══

/**
 * Aviso de apertura de enlace compartido. No guarda nada del visitante: solo
 * qué propiedad se abrió y a qué corredora atribuirle la apertura.
 *
 * `partnerId` llega sin validación de forma a propósito: si viene vacío o
 * absurdo, `resolvePartnerId` cae al catálogo y la apertura queda atribuida al
 * respaldo mejor que rechazada — el aviso es fire-and-forget.
 */
export const shareViewSchema = z.object({
  propertyId: idSchema,
  partnerId: z.unknown().optional(),
});

// ═══ /api/share/event ═══

/**
 * Un compartido con identidad. La **forma** se valida acá (objeto con campos
 * conocidos); la **semántica** —largos, correo, canal y origen permitidos— la
 * aplica `normalizeShareEvent`, que comparte límites con la política RLS de
 * `public.share_events` y tiene suite propia.
 */
export const shareEventPostSchema = z
  .object({
    property_id: z.unknown().optional(),
    partner_id: z.unknown().optional(),
    channel: z.unknown().optional(),
    source: z.unknown().optional(),
    name: z.unknown().optional(),
    email: z.unknown().optional(),
    phone: z.unknown().optional(),
    share_url: z.unknown().optional(),
  })
  .passthrough();

// ═══ /api/leads ═══

/**
 * La **forma** del contacto se valida acá (objeto con los campos esperados);
 * la **semántica** (largos por campo, formato de email, canal permitido) la
 * aplica `normalizeLead`, que comparte límites con la política RLS de la tabla
 * `public.leads` y tiene suite propia. Duplicar eso acá sería mantener dos
 * fuentes de verdad para la misma regla.
 */
export const leadsPostSchema = z
  .object({
    property_id: z.unknown().optional(),
    partner_id: z.unknown().optional(),
    name: z.unknown().optional(),
    email: z.unknown().optional(),
    phone: z.unknown().optional(),
    channel: z.unknown().optional(),
    message: z.unknown().optional(),
  })
  .passthrough();

// ═══ /api/solicitudes ═══

/**
 * Solicitud del botón «Publicar» (propietario que busca propuestas o registro
 * de corredora/inmobiliaria).
 *
 * Acá se valida solo la **forma** —objeto con los campos que el formulario
 * puede mandar—; la semántica (qué exige cada camino, largos, correo, precio,
 * consentimiento) la aplica `normalizeSolicitud`, que comparte reglas con la
 * política RLS y tiene suite propia.
 */
export const solicitudPostSchema = z
  .object({
    kind: z.unknown().optional(),
    name: z.unknown().optional(),
    email: z.unknown().optional(),
    phone: z.unknown().optional(),
    company: z.unknown().optional(),
    message: z.unknown().optional(),
    consent: z.unknown().optional(),
    operation: z.unknown().optional(),
    property_type: z.unknown().optional(),
    region: z.unknown().optional(),
    commune: z.unknown().optional(),
    expected_price: z.unknown().optional(),
    address: z.unknown().optional(),
    rol: z.unknown().optional(),
    rut: z.unknown().optional(),
    role: z.unknown().optional(),
    website: z.unknown().optional(),
    coverage: z.unknown().optional(),
    regions: z.unknown().optional(),
  })
  .passthrough();

/**
 * Cambio de estado de una solicitud desde el panel (PATCH).
 *
 * Igual que el alta: acá solo la **forma**, y `normalizeSolicitudPatch` decide
 * si el id tiene forma de id y el estado es uno de los cuatro del ciclo.
 */
export const solicitudPatchSchema = z
  .object({
    id: z.unknown().optional(),
    status: z.unknown().optional(),
  })
  .passthrough();

// ═══ /api/contribuciones ═══

/**
 * Consulta de contribuciones al SII desde el panel (`?rol=&comuna=&region=`).
 *
 * Acá solo se valida la forma; el ROL se parte y se contrasta con el catálogo
 * de comunas del SII en `lookupContribucionesSII`. `region` es el nombre de la
 * ficha (`state`) y sirve para desambiguar comunas homónimas.
 */
export const contribucionesQuerySchema = z.object({
  rol: z.string({ required_error: 'Falta el ROL.' }).trim().min(4).max(ROL_MAX_LENGTH),
  comuna: z.string({ required_error: 'Falta la comuna.' }).trim().min(2).max(80),
  region: z.string().trim().max(120).optional(),
});

// ═══ /api/rol ═══

/**
 * Búsqueda del ROL por dirección en el SII (`?direccion=&comuna=`).
 *
 * `direccion` es el texto libre de la ficha y la unidad (depto, oficina) viaja
 * ahí mismo; `parseAddress` la separa en calle, número y detalle. La comuna es
 * obligatoria porque el SII indexa las direcciones por comuna.
 */
export const rolQuerySchema = z.object({
  direccion: z.string({ required_error: 'Falta la dirección.' }).trim().min(3).max(300),
  comuna: z.string({ required_error: 'Falta la comuna.' }).trim().min(2).max(80),
});

// ═══ /api/registro ═══

/**
 * Registro de una visita (nombre, correo, teléfono) con sus autorizaciones.
 *
 * Igual que en los contactos, acá se valida la **forma** —objeto con los campos
 * esperados— y `normalizeSignup` aplica la semántica: largos, formato de correo
 * y las autorizaciones obligatorias. Las casillas viajan anidadas en `consents`,
 * pero se aceptan también en la raíz para no romper un cliente antiguo.
 */
export const signupPostSchema = z
  .object({
    name: z.unknown().optional(),
    email: z.unknown().optional(),
    phone: z.unknown().optional(),
    consents: z.unknown().optional(),
    personal_data: z.unknown().optional(),
    terms: z.unknown().optional(),
    marketing: z.unknown().optional(),
    third_party: z.unknown().optional(),
  })
  .passthrough();

// ═══ /api/admin/partners ═══

/**
 * Contacto público de la corredora (botones Llamar / WhatsApp / Mail).
 * Los campos faltantes se completan con cadena vacía: es la misma forma que
 * espera `Partner` y la que la ruta escribía a mano antes de Zod.
 */
const partnerContactSchema = z
  .object({
    phone: z.string().max(40).default(''),
    whatsapp: z.string().max(40).default(''),
    email: z.string().max(200).default(''),
  })
  .optional();

/**
 * Alta de corredora: lo que exige la ficha pública es nombre y slug.
 * `required_error` conserva el mensaje exacto que la ruta devolvía a mano
 * cuando faltaba un campo (el panel ya lo muestra).
 */
export const partnerPostSchema = z.object({
  name: z
    .string({ required_error: 'name and slug are required' })
    .trim()
    .min(1, 'name and slug are required')
    .max(120),
  slug: z
    .string({ required_error: 'name and slug are required' })
    .trim()
    .min(1, 'name and slug are required')
    .max(120)
    .regex(/^[A-Za-z0-9._-]+$/, 'slug inválido'),
  logo: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  website: z.string().max(500).optional(),
  color: z
    .string()
    .max(20)
    .refine((v) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v), 'color inválido')
    .optional(),
  contact: partnerContactSchema,
});

/**
 * Edición de corredora: la identidad viaja en el cuerpo (`id`) y el resto son
 * campos opcionales; el store decide cuáles aplicar.
 */
export const partnerPutSchema = z
  .object({
    id: z.string({ required_error: 'id is required' }).trim().min(1).max(120),
    name: z.string().trim().min(1).max(120).optional(),
    slug: z
      .string()
      .trim()
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/, 'slug inválido')
      .optional(),
    logo: z.string().max(500).optional(),
    description: z.string().max(2000).optional(),
    website: z.string().max(500).optional(),
    color: z
      .string()
      .max(20)
      .refine((v) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v), 'color inválido')
      .optional(),
    contact: partnerContactSchema,
  })
  .passthrough();

export const partnerDeleteSchema = z.object({
  id: z.string({ required_error: 'id is required' }).trim().min(1).max(120),
});

// ═══ /api/admin/socios (cuentas vinculadas a corredoras) ═══

/**
 * Correo de una cuenta del portal.
 *
 * Es la **clave de búsqueda** con la que el panel encuentra la cuenta que hay
 * que vincular: la API de administración de Supabase no busca por correo, así
 * que se lista y se empareja (ver `findAccountByEmail`). Se normaliza a
 * minúsculas porque los correos no distinguen mayúsculas.
 */
const accountEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(200)
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: 'Correo inválido.',
  });

/** Alta o movimiento de un vínculo: qué cuenta y con qué corredora. */
export const socioLinkSchema = z.object({
  email: accountEmailSchema,
  partner_id: idSchema,
});

export const socioUnlinkSchema = z.object({
  email: accountEmailSchema,
});

// ═══ /api/partner/properties (panel del socio) ═══

/**
 * Vocabulario de publicación: el mismo que la migración 0013 deja documentado
 * en la columna `property_type`. `all` no está porque es valor del filtro del
 * buscador, no de una fila.
 */
const PUBLICATION_TYPES = [
  'apartment',
  'house',
  'premium',
  'parcel',
  'office',
  'land',
  'parking',
  'local',
  'warehouse',
] as const;

const PUBLICATION_STATUS = ['for_sale', 'for_rent', 'sold', 'rented'] as const;

/**
 * Imagen: URL absoluta o ruta local que empieza con `/`.
 * Sin este filtro cualquier cadena pegable terminaría como `src` de la ficha
 * pública (y con `javascript:` sería además un vector de XSS en el navegador).
 */
const publicationImageSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/'), {
    message: 'La imagen debe ser una URL (http/https) o una ruta que empiece con "/".',
  });

/**
 * ROL de propiedad (SII): la forma se define una sola vez en
 * `lib/utils/rol.ts`, que también usan el formulario del panel y la
 * solicitud de propuestas.
 */
const rolSchema = z
  .string()
  .trim()
  .min(4, 'ROL demasiado corto.')
  .max(ROL_MAX_LENGTH)
  .refine(isValidRol, {
    message: 'ROL inválido (ej: 15234-67).',
  });

/**
 * URL de media: http(s) o ruta local. Se acepta la cadena vacía como
 * «sin video»: la edición la manda para poder **quitar** el video, y el
 * store la convierte en NULL (sin eso, un campo opcional no se podría
 * borrar desde el formulario).
 */
const mediaUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/'), {
    message: 'La URL debe ser http/https o una ruta que empiece con "/".',
  });

/**
 * Campos de una publicación.
 *
 * Los límites reflejan las columnas (`price NUMERIC(14,2)`, `bedrooms
 * INTEGER`, textos acotados) y el número viaja con `coerce` porque llega desde
 * un formulario HTML: los inputs dan cadena, no número.
 */
const publicationFields = {
  title: z
    .string({ required_error: 'El título es obligatorio.' })
    .trim()
    .min(3, 'El título es demasiado corto.')
    .max(140),
  description: z.string().trim().max(4000).default(''),
  price: z.coerce.number().finite().min(0).max(1_000_000_000, 'Precio fuera de rango.'),
  property_type: z.enum(PUBLICATION_TYPES),
  status: z.enum(PUBLICATION_STATUS),
  bedrooms: z.coerce.number().int().min(0).max(50),
  bathrooms: z.coerce.number().min(0).max(50),
  area_sqm: z.coerce.number().min(1).max(1_000_000),
  parking_spots: z.coerce.number().int().min(0).max(50),
  year_built: z.coerce.number().int().min(1800).max(2100).optional(),
  address: z.string().trim().min(3, 'La dirección es obligatoria.').max(300),
  city: z.string().trim().min(1, 'La comuna es obligatoria.').max(120),
  state: z.string().trim().max(120).optional(),
  zip_code: z.string().trim().max(20).optional(),
  // Identificación interna (SII): solo el panel la lee/establece; los RPC
  // públicos no la seleccionan, así que jamás llega a la ficha.
  rol: rolSchema.or(z.literal('')).optional(),
  // Video de la ficha: URL o archivo subido a Storage. Vacío = sin video.
  video_url: mediaUrlSchema.optional(),
  // Costos de la ficha (migración 0022), en CLP y opcionales: sin valor no
  // viajan y la columna queda NULL, que la ficha lee como «no informado».
  common_expenses: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
  property_taxes: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
  deposit: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
  // Procedencia del monto de contribuciones (0023): la pone la consulta al SII
  // desde el panel, nunca un cliente anónimo. Cadena vacía = borrar la marca.
  property_taxes_source: z.string().trim().max(20).optional(),
  property_taxes_checked_at: z.string().trim().max(40).optional(),
  images: z.array(publicationImageSchema).max(30).default([]),
  features: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  // `location` es NOT NULL en la base: sin par no hay fila posible.
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
  agent_name: z.string().trim().max(120).optional(),
  agent_email: z.string().trim().max(200).optional(),
  agent_phone: z.string().trim().max(40).optional(),
};

/** Alta de publicación desde `/socio/publicar`. */
export const publicationPostSchema = z.object(publicationFields);

/**
 * Edición desde `/socio/publicaciones/[id]`: mismos campos, todos opcionales
 * (el store solo escribe los que lleguen) e `id` obligatorio en la raíz.
 *
 * Latitud y longitud viajan juntas: `inputToRow` solo recalcula `location`
 * cuando llegan las dos, así que una sola a medias se descartaría en silencio
 * y el formulario mostraría unas coordenadas que la ficha no tiene.
 */
export const publicationPutSchema = z
  .object(publicationFields)
  .partial()
  .extend({ id: idSchema })
  .refine((body) => (body.lat === undefined) === (body.lng === undefined), {
    message: 'Latitud y longitud viajan juntas.',
    path: ['lat'],
  });

// ═══ /api/admin/share-report ═══

/** Ventana del informe, en días. */
export const shareReportQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).catch(30).default(30),
});

// ═══ /api/alerts/run ═══

/**
 * Modo de prueba del job de alertas: informa sin enviar ni tocar fechas.
 * El contrato histórico es `1/true/yes`; cualquier otro valor es falso.
 */
export const alertsRunQuerySchema = z.object({
  dry: z
    .string()
    .optional()
    .transform((v) => ['1', 'true', 'yes'].includes((v ?? '').toLowerCase())),
});

// ═══ /api/admin/partners/feed (hallazgo #14: feed XML por corredora) ═══

/** Cuerpo para habilitar/deshabilitar/regenerar el feed de una corredora. */
export const partnerFeedPostSchema = z.object({
  id: z.string({ required_error: 'id is required' }).trim().min(1).max(120),
  enabled: z.boolean(),
  /** true = token nuevo aunque ya exista (rota el anterior). */
  rotate: z.boolean().optional(),
});

/** Consulta de estado del feed de una corredora. */
export const partnerFeedQuerySchema = z.object({
  id: z.string({ required_error: 'id is required' }).trim().min(1).max(120),
});

/** Archivo del feed público: `<slug>.xml`, solo minúsculas, dígitos y guiones. */
export const feedFileSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+\.xml$/, 'archivo de feed inválido');

/** Token del feed en la query: hex de 32. */
export const feedTokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{32}$/, 'token de feed inválido');

// ═══ /api/kyb (alta de empresas) ═══

/**
 * Alta pública de una empresa. La forma es la mínima para poder verificar; el
 * dominio y la coherencia del correo los deriva `normalizeKybApplication`, que
 * corre después y es la validación de verdad.
 */
export const kybApplicationPostSchema = z.object({
  legalName: z.string({ required_error: 'La razón social es obligatoria.' }).trim().min(2).max(160),
  rut: z.string({ required_error: 'El RUT es obligatorio.' }).trim().min(8).max(20),
  website: z.string().trim().max(300).optional(),
  email: z
    .string({ required_error: 'El correo es obligatorio.' })
    .trim()
    .min(5)
    .max(200)
    .email('El correo no tiene un formato válido.'),
  contactName: z.string({ required_error: 'El nombre del contacto es obligatorio.' }).trim().min(2).max(120),
  phone: z.string({ required_error: 'El teléfono es obligatorio.' }).trim().min(6).max(40),
  // Datos del registro de empresas: opcionales porque el alta directa no los pide.
  coverage: z.enum(['nacional', 'regional']).optional(),
  regions: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
  message: z.string().trim().max(1200).optional(),
  registrationKind: z.enum(['corredora', 'inmobiliaria']).optional(),
  contactRole: z.string().trim().max(80).optional(),
  consent: z
    .boolean({ required_error: 'Debes aceptar la verificación de datos.' })
    .refine((value) => value === true, 'Debes aceptar la verificación de datos.'),
});

/** Token del correo KYB: 32 bytes en base64url (43 caracteres). */
export const kybTokenSchema = z
  .string({ required_error: 'Falta el token del enlace.' })
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'El enlace no es válido.');

/** Respuestas a la ronda de preguntas. */
export const kybAnswersPostSchema = z.object({
  token: kybTokenSchema,
  answers: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        answer: z.string().trim().min(2, 'Cada respuesta necesita contenido.').max(2000),
      })
    )
    .min(1)
    .max(10),
});

/** Consulta del estado con el token del correo. */
export const kybAccessPostSchema = z.object({ token: kybTokenSchema });

/** Elección de plan y habilitación del panel. */
export const kybActivatePostSchema = z.object({
  token: kybTokenSchema,
  plan: z.enum(KYB_PLAN_IDS, {
    required_error: 'Elige un plan.',
    invalid_type_error: 'El plan indicado no existe.',
  }),
});
