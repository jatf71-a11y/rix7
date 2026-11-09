/**
 * «¿Este solicitante ya está en los registros?»
 *
 * Un mismo RUT puede llegar dos veces por caminos distintos: el formulario de
 * empresas crea un alta (`kyb_applications`) y el de corredora, inmobiliaria o
 * agente crea una solicitud (`solicitudes`). Sin comparar las dos fuentes, una
 * empresa que se registra de nuevo nace con una segunda ficha y nadie se entera
 * hasta que dos personas del equipo la trabajan en paralelo.
 *
 * El RUT se compara **canónico**: uno puede estar guardado con puntos y el otro
 * sin ellos y es la misma empresa. El correo se compara en minúsculas por la
 * misma razón.
 *
 * Es un módulo puro —sin red ni base— porque la regla es una sola y la usan el
 * alta de empresas y el registro de socios; duplicarla es cómo una de las dos
 * capas empieza a decir «ya existe» donde la otra no.
 */

import { normalizeRut } from '@/lib/utils/rut';

export type DuplicateField = 'rut' | 'email';

export interface ApplicantDuplicate {
  /** Qué dato coincidió: el RUT o el correo. */
  field: DuplicateField;
  /** De dónde salió el registro previo. */
  source: 'solicitud' | 'alta';
  /** Id del registro previo, para que el panel lo pueda abrir. */
  id: string;
}

/** Solicitud de socio: el RUT vive dentro de `payload`. */
interface SolicitudLike {
  id: string;
  email: string;
  payload: { rut?: unknown };
}

/** Alta de empresa: el RUT es una columna. */
interface ApplicationLike {
  id: string;
  rut: string;
  email: string;
}

/**
 * Primer registro que coincide con este RUT o correo, o `null`.
 *
 * `ignoreIds` deja fuera la fila recién creada: al comprobar después de
 * guardar, el propio registro aparecería como duplicado de sí mismo.
 */
export function findApplicantDuplicate(input: {
  rut: string;
  email: string;
  solicitudes?: readonly SolicitudLike[];
  applications?: readonly ApplicationLike[];
  ignoreIds?: readonly string[];
}): ApplicantDuplicate | null {
  const rut = normalizeRut(input.rut);
  const email = input.email.trim().toLowerCase();
  if (!rut && !email) return null;

  const ignored = new Set(input.ignoreIds ?? []);

  const sameRut = (other: unknown): boolean =>
    !!rut && typeof other === 'string' && normalizeRut(other) === rut;
  const sameEmail = (other: string): boolean => !!email && other.trim().toLowerCase() === email;

  for (const solicitud of input.solicitudes ?? []) {
    if (ignored.has(solicitud.id)) continue;
    if (sameRut(solicitud.payload.rut)) {
      return { field: 'rut', source: 'solicitud', id: solicitud.id };
    }
    if (sameEmail(solicitud.email)) {
      return { field: 'email', source: 'solicitud', id: solicitud.id };
    }
  }

  for (const application of input.applications ?? []) {
    if (ignored.has(application.id)) continue;
    if (sameRut(application.rut)) {
      return { field: 'rut', source: 'alta', id: application.id };
    }
    if (sameEmail(application.email)) {
      return { field: 'email', source: 'alta', id: application.id };
    }
  }

  return null;
}
