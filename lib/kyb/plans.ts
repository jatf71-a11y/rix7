/**
 * Planes de suscripción que la empresa elige al usar su token de alta.
 *
 * Viven en código y no en una tabla: son tres filas que cambian con una decisión
 * de producto, no con la operación diaria, y el flujo las necesita para validar
 * lo que llega del formulario. Si algún día se editan desde el panel, una tabla
 * reemplaza este arreglo sin cambiar la forma del dato.
 */

export const KYB_PLAN_IDS = ['basico', 'profesional', 'premium'] as const;

export type KybPlanId = (typeof KYB_PLAN_IDS)[number];

export interface KybPlan {
  id: KybPlanId;
  name: string;
  /** Precio mensual en pesos, sin IVA. */
  priceClp: number;
  /** Publicaciones activas incluidas. */
  listings: number;
  /** Usuarios con acceso al panel. */
  users: number;
  features: readonly string[];
}

export const KYB_PLANS: readonly KybPlan[] = [
  {
    id: 'basico',
    name: 'Básico',
    priceClp: 29990,
    listings: 10,
    users: 1,
    features: [
      '10 publicaciones activas',
      'Ficha de empresa en el portal',
      'Un usuario con acceso al panel',
      'Contactos y visitas por publicación',
    ],
  },
  {
    id: 'profesional',
    name: 'Profesional',
    priceClp: 59990,
    listings: 50,
    users: 5,
    features: [
      '50 publicaciones activas',
      'Cinco usuarios con acceso al panel',
      'Feed XML para agregadores',
      'Estadísticas de compartidos y contactos',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    priceClp: 99990,
    listings: 1000,
    users: 20,
    features: [
      'Publicaciones sin tope práctico (1.000)',
      'Veinte usuarios con acceso al panel',
      'Feed XML y landings compartibles',
      'Acompañamiento del equipo de Rix7',
    ],
  },
];

export function isKybPlanId(value: unknown): value is KybPlanId {
  return typeof value === 'string' && (KYB_PLAN_IDS as readonly string[]).includes(value);
}

export function getKybPlan(id: KybPlanId): KybPlan {
  const plan = KYB_PLANS.find((candidate) => candidate.id === id);
  if (!plan) throw new Error(`Plan desconocido: ${id}`);
  return plan;
}

/** Precio en formato chileno, para el correo y la API. */
export function formatPlanPrice(priceClp: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(priceClp);
}
