/**
 * Solicitudes del botón «Publicar».
 *
 * Cuatro caminos, una misma fila:
 *
 * - `propuestas`: un propietario sin corredora pide recibir propuestas de
 *   corredoras verificadas, que compiten por publicar su propiedad. La clave
 *   interna dice lo mismo que la pantalla («recibir propuestas») desde la
 *   migración `0021`, que renombró el antiguo `licitacion`.
 * - `corredora` / `inmobiliaria`: una empresa pide su registro.
 * - `agente`: un corredor que opera por cuenta propia, sin empresa. No se le
 *   pide razón social ni cargo porque no factura: emite boleta de honorarios
 *   con su RUT de persona natural.
 *
 * Lo común —contacto, consentimiento, estado— vive en columnas; lo propio de
 * cada camino vive en `payload`. Así los formularios de empresa pueden crecer
 * sin una migración por campo, que es justo lo que se está definiendo todavía.
 *
 * Este módulo es puro: lo usan el formulario, la API y el panel, y se prueba sin
 * Supabase ni React. La API vuelve a validar aunque el navegador ya lo haya
 * hecho; el cliente se puede saltar.
 */

import { CHILE_REGIONS } from '@/lib/data/chileLocations';
import { KYB_STATUSES, KYB_STATUS_LABELS, type KybStatus } from '@/lib/kyb/status';
import { isValidRol, ROL_MAX_LENGTH } from '@/lib/utils/rol';
import { normalizeRut } from '@/lib/utils/rut';

export type SolicitudKind = 'propuestas' | 'corredora' | 'inmobiliaria' | 'agente';

/**
 * Los cuatro caminos de «Publicar».
 *
 * Es la misma lista que acepta el CHECK de `solicitudes.kind` (migración
 * `0021`) y la política de INSERT, que la vuelve a validar en el servidor. Si
 * se agrega o renombra un camino hay que mover los tres lugares en la misma
 * migración —el CHECK, la política y esta lista— o la API aceptaría un `kind`
 * que la tabla rechaza.
 */
export const SOLICITUD_KINDS: readonly SolicitudKind[] = [
  'propuestas',
  'corredora',
  'inmobiliaria',
  'agente',
];

/**
 * Alcance geográfico del registro: en todo Chile o en regiones concretas.
 *
 * Reemplaza a la pareja región/comuna del registro de empresas y agentes. Lo
 * que el equipo necesita para asignar trabajo no es la comuna de una oficina,
 * sino dónde opera la corredora: si es nacional, o en qué regiones trabaja.
 */
export type SolicitudCoverage = 'nacional' | 'regional';

export const SOLICITUD_COVERAGES: readonly SolicitudCoverage[] = ['nacional', 'regional'];

export const SOLICITUD_COVERAGE_LABELS: Record<SolicitudCoverage, string> = {
  nacional: 'Nacional',
  regional: 'Regional',
};

/** Nombres válidos de región, los mismos del selector del formulario. */
const SOLICITUD_REGION_NAMES = new Set(CHILE_REGIONS.map((region) => region.name));

/**
 * El estado de una solicitud es el del alta de empresas.
 *
 * La bandeja de «Publicar» tenía su propio ciclo —`nueva`, `en_revision`,
 * `contactada`, `cerrada`— y el alta de empresas otro. Dos vocabularios para la
 * misma pregunta («¿en qué quedó esto?») obligaban a traducir de cabeza al
 * pasar de una pantalla a la otra, y a mantener dos listas de etiquetas. Ahora
 * se toma el del alta, que ya es la máquina de estados con transiciones
 * probadas: `lib/kyb/status.ts` es la única fuente y este módulo no la copia.
 *
 * No se importan las transiciones: la bandeja mueve el estado a mano y sin
 * reglas, como antes; el alta es la que las exige porque cada movimiento suyo
 * dispara correos y tokens.
 */
export type SolicitudStatus = KybStatus;

export const SOLICITUD_STATUSES: readonly SolicitudStatus[] = KYB_STATUSES;

/** Operación de la propiedad que se ofrece a las corredoras. */
export type SolicitudOperation = 'sale' | 'rent';

export const SOLICITUD_OPERATIONS: readonly SolicitudOperation[] = ['sale', 'rent'];

/**
 * Tipos de propiedad que acepta la solicitud de propietario. Es el mismo
 * vocabulario de las publicaciones (`PropertyType`), sin `all`: acá se describe
 * una propiedad real.
 */
export type SolicitudPropertyType =
  | 'apartment'
  | 'house'
  | 'office'
  | 'local'
  | 'land'
  | 'parcel'
  | 'warehouse'
  | 'parking';

export const SOLICITUD_PROPERTY_TYPES: readonly SolicitudPropertyType[] = [
  'apartment',
  'house',
  'office',
  'local',
  'land',
  'parcel',
  'warehouse',
  'parking',
];

export const SOLICITUD_PROPERTY_TYPE_LABELS: Record<SolicitudPropertyType, string> = {
  apartment: 'Departamento',
  house: 'Casa',
  office: 'Oficina',
  local: 'Local comercial',
  land: 'Terreno',
  parcel: 'Parcela',
  warehouse: 'Bodega',
  parking: 'Estacionamiento',
};

export const SOLICITUD_KIND_LABELS: Record<SolicitudKind, string> = {
  propuestas: 'Propietario busca propuestas',
  corredora: 'Registro de corredora',
  inmobiliaria: 'Registro de inmobiliaria',
  agente: 'Agente independiente',
};

export const SOLICITUD_STATUS_LABELS: Record<SolicitudStatus, string> = KYB_STATUS_LABELS;

/** Campos que llegan del navegador. Todos son `unknown` hasta validarlos. */
export interface SolicitudInput {
  kind?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  company?: unknown;
  message?: unknown;
  consent?: unknown;
  // Propietario que busca propuestas
  operation?: unknown;
  property_type?: unknown;
  region?: unknown;
  commune?: unknown;
  expected_price?: unknown;
  address?: unknown;
  /** ROL de propiedad (SII): identifica el inmueble de la solicitud. */
  rol?: unknown;
  // Registro de empresa o agente
  rut?: unknown;
  role?: unknown;
  website?: unknown;
  /** `nacional` o `regional`; obligatorio en corredora, inmobiliaria y agente. */
  coverage?: unknown;
  /** Nombres de región cuando el alcance es regional. */
  regions?: unknown;
}

/** Valores JSON-safe que se guardan en `payload`. */
export type SolicitudPayload = Record<string, string | number | string[] | null>;

export interface NormalizedSolicitud {
  kind: SolicitudKind;
  name: string;
  email: string;
  phone: string;
  company: string | null;
  message: string | null;
  payload: SolicitudPayload;
  consent: true;
}

export interface SolicitudRow {
  id: string;
  kind: string;
  name: string;
  email: string;
  phone: string;
  company: string | null;
  message: string | null;
  payload: unknown;
  consent: boolean;
  status: string;
  created_at: string;
}

export interface Solicitud {
  id: string;
  kind: SolicitudKind;
  name: string;
  email: string;
  phone: string;
  company: string | null;
  message: string | null;
  payload: SolicitudPayload;
  status: SolicitudStatus;
  createdAt: string;
}

export const SOLICITUD_COLUMNS =
  'id, kind, name, email, phone, company, message, payload, consent, status, created_at';

export const SOLICITUD_LIMITS = {
  name: 120,
  email: 200,
  phone: 40,
  company: 160,
  message: 1200,
  region: 80,
  commune: 80,
  address: 300,
  rol: ROL_MAX_LENGTH,
  website: 300,
  rut: 20,
  role: 80,
} as const;

export type SolicitudValidation =
  | { ok: true; solicitud: NormalizedSolicitud }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ¿Es uno de los cuatro caminos de «Publicar»? */
export function isSolicitudKind(value: unknown): value is SolicitudKind {
  return typeof value === 'string' && (SOLICITUD_KINDS as readonly string[]).includes(value);
}

/** ¿Es uno de los cuatro estados del ciclo de revisión? */
export function isSolicitudStatus(value: unknown): value is SolicitudStatus {
  return typeof value === 'string' && (SOLICITUD_STATUSES as readonly string[]).includes(value);
}

/** ¿Es un alcance geográfico válido? */
export function isSolicitudCoverage(value: unknown): value is SolicitudCoverage {
  return typeof value === 'string' && (SOLICITUD_COVERAGES as readonly string[]).includes(value);
}

/**
 * Tope de longitud del id de una solicitud.
 *
 * En producción es un uuid (36 caracteres); en desarrollo sin Supabase los ids
 * son `memoria-1`, `memoria-2`… El alfabeto es el mismo de los ids del catálogo,
 * así que un valor raro no llega a la consulta.
 */
export const SOLICITUD_ID_MAX_LENGTH = 120;

const SOLICITUD_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Valida el cambio de estado que manda el panel.
 *
 * Es la puerta de la API, no del formulario: el estado solo puede ser uno de
 * los cuatro del `CHECK` de la tabla y el id solo puede tener forma de id. Un
 * estado inventado se rechaza acá en vez de llegar a Postgres y volver como
 * error de constraint sin explicación.
 */
export function normalizeSolicitudPatch(input: {
  id?: unknown;
  status?: unknown;
}): { ok: true; id: string; status: SolicitudStatus } | { ok: false; error: string } {
  const id = text(input.id);
  if (!id) return { ok: false, error: 'Falta la solicitud que se quiere actualizar.' };
  if (id.length > SOLICITUD_ID_MAX_LENGTH || !SOLICITUD_ID_PATTERN.test(id)) {
    return { ok: false, error: 'La solicitud indicada no es válida.' };
  }

  if (!isSolicitudStatus(input.status)) {
    return { ok: false, error: 'El estado indicado no es válido.' };
  }

  return { ok: true, id, status: input.status };
}

/** Texto recortado; cualquier cosa que no sea string queda vacía. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Texto opcional: vacío o demasiado largo se rechaza con un mensaje concreto. */
function optionalText(
  value: unknown,
  limit: number,
  label: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  const valueText = text(value);
  if (!valueText) return { ok: true, value: null };
  if (valueText.length > limit) return { ok: false, error: `${label} es demasiado largo.` };
  return { ok: true, value: valueText };
}

function requiredText(
  value: unknown,
  limit: number,
  label: string,
  min = 1
): { ok: true; value: string } | { ok: false; error: string } {
  const valueText = text(value);
  if (valueText.length < min) return { ok: false, error: `${label} es obligatorio.` };
  if (valueText.length > limit) return { ok: false, error: `${label} es demasiado largo.` };
  return { ok: true, value: valueText };
}

/**
 * Valida y normaliza una solicitud.
 *
 * El `kind` decide qué campos son obligatorios: una solicitud de propietario
 * sin comuna no sirve para asignar corredoras, y una empresa sin nombre no se
 * puede verificar.
 * Los campos opcionales vacíos se guardan como `null`, no como `''`, para que el
 * panel distinga «no lo dejó» de «lo dejó en blanco».
 */
export function normalizeSolicitud(input: SolicitudInput): SolicitudValidation {
  if (!isSolicitudKind(input.kind)) {
    return { ok: false, error: 'Tipo de solicitud inválido.' };
  }
  const kind = input.kind;

  const name = requiredText(input.name, SOLICITUD_LIMITS.name, 'El nombre', 2);
  if (!name.ok) return name;

  const email = requiredText(input.email, SOLICITUD_LIMITS.email, 'El correo', 5);
  if (!email.ok) return email;
  if (!EMAIL_RE.test(email.value)) {
    return { ok: false, error: 'El correo no tiene un formato válido.' };
  }

  const phone = requiredText(input.phone, SOLICITUD_LIMITS.phone, 'El teléfono', 6);
  if (!phone.ok) return phone;
  // Un teléfono con seis letras no es un teléfono: se exigen dígitos y se
  // admiten los separadores habituales (+56 9 1234 5678).
  const digits = phone.value.replace(/\D/g, '');
  if (digits.length < 6 || !/^[+()\d\s.-]+$/.test(phone.value)) {
    return { ok: false, error: 'El teléfono no tiene un formato válido.' };
  }

  // En una solicitud de propietario el detalle también es obligatorio: el equipo necesita
  // saber el estado y la urgencia para preparar la invitación a corredoras.
  // En un registro de empresa sigue siendo un comentario libre.
  const message =
    kind === 'propuestas'
      ? requiredText(input.message, SOLICITUD_LIMITS.message, 'El mensaje', 10)
      : optionalText(input.message, SOLICITUD_LIMITS.message, 'El mensaje');
  if (!message.ok) return message;

  if (input.consent !== true) {
    return { ok: false, error: 'Debes aceptar la política de privacidad.' };
  }

  if (kind === 'propuestas') {
    const operation = text(input.operation);
    if (!(SOLICITUD_OPERATIONS as readonly string[]).includes(operation)) {
      return { ok: false, error: 'Indica si la propiedad es para venta o arriendo.' };
    }

    const propertyType = text(input.property_type);
    if (!(SOLICITUD_PROPERTY_TYPES as readonly string[]).includes(propertyType)) {
      return { ok: false, error: 'Selecciona el tipo de propiedad.' };
    }

    const region = requiredText(input.region, SOLICITUD_LIMITS.region, 'La región', 2);
    if (!region.ok) return region;

    const commune = requiredText(input.commune, SOLICITUD_LIMITS.commune, 'La comuna', 2);
    if (!commune.ok) return commune;

    // La dirección es obligatoria y exacta: es lo que permite ubicar el
    // inmueble y asignarle una zona, y sin ella la solicitud no se puede
    // preparar. Ya no se acepta «sector» o una referencia vaga.
    const address = requiredText(input.address, SOLICITUD_LIMITS.address, 'La dirección', 1);
    if (!address.ok) return address;
    if (address.value.length < 5) {
      return { ok: false, error: 'La dirección debe incluir calle y número.' };
    }

    // El ROL es obligatorio: identifica el inmueble sin depender de la
    // dirección y es lo que permite preparar la solicitud.
    const rol = requiredText(input.rol, SOLICITUD_LIMITS.rol, 'El ROL', 1);
    if (!rol.ok) return rol;
    if (!isValidRol(rol.value)) {
      return { ok: false, error: 'ROL inválido (ej: 15234-67).' };
    }

    let expectedPrice: number | null = null;
    // El formulario puede mandar la cadena del input o un número ya convertido;
    // aceptar las dos evita que un precio válido se guarde como «a convenir».
    if (
      input.expected_price !== undefined &&
      input.expected_price !== null &&
      typeof input.expected_price !== 'string' &&
      typeof input.expected_price !== 'number'
    ) {
      return { ok: false, error: 'El precio esperado no es válido.' };
    }
    const rawPrice =
      typeof input.expected_price === 'number'
        ? String(input.expected_price)
        : text(input.expected_price);
    if (!rawPrice) {
      return { ok: false, error: 'El precio esperado es obligatorio.' };
    }
    const parsed = Number(rawPrice);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000_000_000) {
      return { ok: false, error: 'El precio esperado no es válido.' };
    }
    expectedPrice = Math.round(parsed);

    return {
      ok: true,
      solicitud: {
        kind,
        name: name.value,
        email: email.value,
        phone: phone.value,
        company: null,
        message: message.value,
        payload: {
          operation,
          property_type: propertyType,
          region: region.value,
          commune: commune.value,
          expected_price: expectedPrice,
          address: address.value,
          rol: rol.value,
        },
        consent: true,
      },
    };
  }

  // El agente no tiene empresa que declarar: `company` es opcional y casi
  // siempre termina en `null`. No se le pide razón social ni boleta de
  // actividad porque no factura — emite boleta de honorarios con su RUT de
  // persona natural—; si igual deja un nombre comercial, se guarda tal cual.
  const company =
    kind === 'agente'
      ? optionalText(input.company, SOLICITUD_LIMITS.company, 'El nombre de la empresa')
      : requiredText(input.company, SOLICITUD_LIMITS.company, 'El nombre de la empresa', 2);
  if (!company.ok) return company;

  // El RUT dejó de ser opcional: identifica a la empresa —o a la persona, en
  // el caso del agente— y es lo que permite acreditar el registro. Se valida
  // con módulo 11 y se guarda en forma canónica, no como lo escribió cada uno.
  const rut = requiredText(input.rut, SOLICITUD_LIMITS.rut, 'El RUT', 8);
  if (!rut.ok) return rut;

  const normalizedRut = normalizeRut(rut.value);
  if (!normalizedRut) {
    return {
      ok: false,
      error: 'RUT inválido: revisa el dígito verificador (ej: 76.123.456-0).',
    };
  }

  const role = optionalText(input.role, SOLICITUD_LIMITS.role, 'El cargo');
  if (!role.ok) return role;

  // Alcance en vez de una comuna: lo que importa para asignar solicitudes es
  // si trabaja en todo Chile o solo en algunas regiones.
  if (!isSolicitudCoverage(input.coverage)) {
    return { ok: false, error: 'Indica si tu alcance es nacional o regional.' };
  }
  const coverage = input.coverage;

  let regions: string[] = [];
  if (coverage === 'regional') {
    if (!Array.isArray(input.regions)) {
      return { ok: false, error: 'Selecciona al menos una región donde trabajas.' };
    }

    const selected = new Set<string>();
    for (const value of input.regions) {
      const name = text(value);
      if (!SOLICITUD_REGION_NAMES.has(name)) {
        return { ok: false, error: 'Una de las regiones seleccionadas no es válida.' };
      }
      selected.add(name);
    }

    if (selected.size === 0) {
      return { ok: false, error: 'Selecciona al menos una región donde trabajas.' };
    }

    // Orden alfabético y sin repetidos: el panel y el correo muestran siempre
    // la misma lista, sin importar el orden en que se marcaron las casillas.
    regions = Array.from(selected).sort((a, b) => a.localeCompare(b, 'es-CL'));
  }

  const website = optionalText(input.website, SOLICITUD_LIMITS.website, 'El sitio web');
  if (!website.ok) return website;
  if (website.value && !/^https?:\/\/\S+$/i.test(website.value)) {
    return { ok: false, error: 'El sitio web debe empezar con http:// o https://.' };
  }

  return {
    ok: true,
    solicitud: {
      kind,
      name: name.value,
      email: email.value,
      phone: phone.value,
      company: company.value,
      message: message.value,
      payload: {
        rut: normalizedRut,
        role: role.value,
        coverage,
        regions,
        website: website.value,
      },
      consent: true,
    },
  };
}

/** Fila de Supabase → objeto del panel. */
export function rowToSolicitud(row: SolicitudRow): Solicitud {
  const payload =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as SolicitudPayload)
      : {};

  return {
    id: row.id,
    kind: isSolicitudKind(row.kind) ? row.kind : 'propuestas',
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    message: row.message,
    payload,
    // Una fila con un estado que no está en la lista —de antes de la migración
    // `0028`, que tradujo los viejos— cae en el primero del alta, no en un
    // valor inventado.
    status: (SOLICITUD_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as SolicitudStatus)
      : 'Recibida',
    createdAt: row.created_at,
  };
}

export function solicitudPropertyTypeLabel(value: unknown): string {
  const key = typeof value === 'string' ? value : '';
  return (SOLICITUD_PROPERTY_TYPE_LABELS as Record<string, string>)[key] ?? 'Propiedad';
}

export function solicitudOperationLabel(value: unknown): string {
  if (value === 'sale') return 'Venta';
  if (value === 'rent') return 'Arriendo';
  return '—';
}

/** Precio esperado en CLP, o `null` si no lo informó. */
export function solicitudPriceLabel(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}

export interface SolicitudDetail {
  label: string;
  value: string;
}

/**
 * Detalle legible para el panel.
 *
 * Se arma desde `payload` y no desde columnas porque cada camino guarda cosas
 * distintas; así un campo nuevo aparece acá con un cambio pequeño y sin tocar
 * la tabla.
 */
export function solicitudDetails(solicitud: Solicitud): SolicitudDetail[] {
  const payload = solicitud.payload;

  if (solicitud.kind === 'propuestas') {
    const price = solicitudPriceLabel(payload.expected_price);
    return [
      { label: 'Operación', value: solicitudOperationLabel(payload.operation) },
      { label: 'Tipo', value: solicitudPropertyTypeLabel(payload.property_type) },
      { label: 'ROL', value: payload.rol ? String(payload.rol) : '—' },
      {
        label: 'Ubicación',
        value: [payload.commune, payload.region].filter(Boolean).join(', ') || '—',
      },
      ...(payload.address ? [{ label: 'Dirección', value: String(payload.address) }] : []),
      { label: 'Precio esperado', value: price ?? 'A convenir' },
    ];
  }

  // Los registros anteriores al alcance geográfico guardaron región y comuna;
  // se siguen mostrando para que una solicitud vieja no aparezca sin ubicación.
  const legacyLocation = [payload.commune, payload.region].filter(Boolean).join(', ');
  const coverageDetails: SolicitudDetail[] = isSolicitudCoverage(payload.coverage)
    ? [{ label: 'Alcance', value: SOLICITUD_COVERAGE_LABELS[payload.coverage] }]
    : legacyLocation
      ? [{ label: 'Ubicación', value: legacyLocation }]
      : [{ label: 'Alcance', value: '—' }];

  if (payload.coverage === 'regional' && Array.isArray(payload.regions)) {
    const regions = payload.regions.filter(
      (region): region is string => typeof region === 'string'
    );
    if (regions.length > 0) coverageDetails.push({ label: 'Regiones', value: regions.join(', ') });
  }

  // Un agente es una persona, no una empresa: sin «Empresa» ni «Cargo», que en
  // su caso serían campos vacíos permanentes. El RUT es lo que lo identifica y
  // con lo que emite la boleta de honorarios.
  if (solicitud.kind === 'agente') {
    return [
      { label: 'RUT', value: payload.rut ? String(payload.rut) : '—' },
      ...coverageDetails,
      ...(payload.website ? [{ label: 'Sitio web', value: String(payload.website) }] : []),
    ];
  }

  return [
    { label: 'Empresa', value: solicitud.company ?? '—' },
    { label: 'RUT', value: payload.rut ? String(payload.rut) : '—' },
    { label: 'Cargo', value: payload.role ? String(payload.role) : '—' },
    ...coverageDetails,
    ...(payload.website ? [{ label: 'Sitio web', value: String(payload.website) }] : []),
  ];
}
