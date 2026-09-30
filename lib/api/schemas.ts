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
