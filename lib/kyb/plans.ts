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
  /** Usuarios con acceso al panel que el plan trae de fábrica. */
  users: number;
  features: readonly string[];
}

/**
 * El catálogo **no** tiene precio.
 *
 * Lo que se cobra se define en **Planes** (`plan_settings`), por perfil de socio:
 * alta inicial, mensualidad y usuarios incluidos. Tener un precio también acá
 * era la forma de que la pantalla del alta y el panel del equipo mostraran
 * números distintos. El único lugar donde se fija un monto es la propuesta
 * comercial, que nace de esos precios y el candidato acepta.
 */

/**
 * **Ningún plan trae cupo de publicaciones.** Rix7 no cobra por publicación: se
 * cobra la mensualidad del plan y, aparte, el CCA sobre la cartera del socio
 * (`lib/kyb/cca.ts`, `docs/kyb-onboarding.md`). Poner un cupo acá era una
 * promesa que además el sistema no aplicaba —nada bloquea publicar de más— y
 * que en la propuesta comercial se leía como si se vendieran publicaciones.
 */
export const KYB_PLANS: readonly KybPlan[] = [
  {
    id: 'basico',
    name: 'Básico',
    users: 1,
    features: [
      'Publicaciones sin cupo: el CCA se factura sobre la cartera',
      'Ficha de empresa en el portal',
      'Un usuario con acceso al panel',
      'Contactos y visitas por publicación',
    ],
  },
  {
    id: 'profesional',
    name: 'Profesional',
    users: 5,
    features: [
      'Publicaciones sin cupo: el CCA se factura sobre la cartera',
      'Cinco usuarios con acceso al panel',
      'Feed XML para agregadores',
      'Estadísticas de compartidos y contactos',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    users: 20,
    features: [
      'Publicaciones sin cupo: el CCA se factura sobre la cartera',
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
