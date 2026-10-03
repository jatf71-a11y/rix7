/**
 * Registros de visitas y las autorizaciones que dieron.
 *
 * La identidad que usan los formularios vive en el dispositivo (localStorage),
 * pero la **constancia de consentimiento** vive acá: si solo estuviera en el
 * navegador de la persona, Rix7 no tendría cómo probar quién autorizó qué ni
 * cuándo. Es un dato legal, no un dato de producto.
 *
 * Módulo puro y compartido, como `leads`: la misma forma corre en el endpoint que
 * escribe, en el panel que lee y en los tests. La tabla es **solo-anexa**, así
 * que «el estado vigente de una persona» es siempre su fila más nueva.
 */

import { CONSENT_VERSION, type ConsentState, type NormalizedSignup } from '@/lib/utils/consents';

/** Fila de `public.signups` tal como la devuelve Supabase. */
export interface SignupRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  consent_personal_data: boolean;
  consent_terms: boolean;
  consent_marketing: boolean;
  consent_third_party: boolean;
  consent_version: string;
  created_at: string;
}

/** Alta tal como la consume el panel: las columnas vuelven a ser un estado. */
export interface Signup {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Las cuatro autorizaciones, incluidas las que quedaron sin marcar. */
  consents: ConsentState;
  /** Qué versión de los textos aceptó. */
  consentVersion: string;
  createdAt: string;
}

export const SIGNUP_COLUMNS =
  'id, name, email, phone, consent_personal_data, consent_terms, consent_marketing, consent_third_party, consent_version, created_at';

/** Lo que se escribe en la tabla: los datos del alta más su versión de texto. */
export interface SignupInsert {
  name: string;
  email: string;
  phone: string;
  consent_personal_data: boolean;
  consent_terms: boolean;
  consent_marketing: boolean;
  consent_third_party: boolean;
  consent_version: string;
}

/**
 * Alta normalizada → fila de la tabla.
 *
 * La versión la pone **el servidor**, no el cliente: si viniera en el cuerpo de
 * la petición, cualquiera podría declarar haber aceptado una versión que nunca
 * vio. Se acepta el parámetro solo para poder probar el mapeo y para una futura
 * migración de textos.
 */
export function toSignupInsert(
  signup: NormalizedSignup,
  version: string = CONSENT_VERSION
): SignupInsert {
  return {
    name: signup.name,
    email: signup.email,
    phone: signup.phone,
    consent_personal_data: signup.consents.personal_data,
    consent_terms: signup.consents.terms,
    consent_marketing: signup.consents.marketing,
    consent_third_party: signup.consents.third_party,
    consent_version: version,
  };
}

/** Fila de la base → objeto del panel. */
export function rowToSignup(row: SignupRow): Signup {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    consents: {
      personal_data: row.consent_personal_data,
      terms: row.consent_terms,
      marketing: row.consent_marketing,
      third_party: row.consent_third_party,
    },
    consentVersion: row.consent_version,
    createdAt: row.created_at,
  };
}
