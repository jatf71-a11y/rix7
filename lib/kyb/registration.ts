/**
 * Puente entre el formulario de `/registro` y el alta evaluada.
 *
 * El registro de corredoras e inmobiliarias ya no es un lead: es el alta de una
 * empresa, así que va a `/api/kyb` y dispara el motor. Un **agente** no entra
 * acá: es una persona natural, sin razón social ni sitio que verificar, y su
 * registro sigue siendo un contacto para el equipo.
 *
 * El mapeo vive en un módulo puro para probarlo sin montar el formulario: es la
 * pieza donde un campo mal nombrado se traduce en una verificación que nunca
 * corre o en un dato operativo que se pierde en silencio.
 */

export type CompanyRegistrationKind = 'corredora' | 'inmobiliaria';

export interface CompanyRegistrationInput {
  company: string;
  rut: string;
  website: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  coverage: '' | 'nacional' | 'regional';
  regions: string[];
  message: string;
  consent: boolean;
}

export interface KybRegistrationPayload {
  legalName: string;
  rut: string;
  email: string;
  contactName: string;
  phone: string;
  consent: boolean;
  website?: string;
  coverage?: 'nacional' | 'regional';
  regions: string[];
  message?: string;
  registrationKind?: CompanyRegistrationKind;
  contactRole?: string;
}

/**
 * Solo las empresas pasan por el motor; un agente sigue siendo un contacto.
 *
 * Es un predicado de tipo para que el llamador pueda pasar `kind` a
 * `toKybPayload` sin una aserción: el compilador ya sabe que es una empresa
 * dentro de la rama.
 */
export function usesKybFlow(kind: string): kind is CompanyRegistrationKind {
  return kind === 'corredora' || kind === 'inmobiliaria';
}

export function toKybPayload(
  input: CompanyRegistrationInput,
  kind: CompanyRegistrationKind
): KybRegistrationPayload {
  const website = input.website.trim();
  const message = input.message.trim();
  const role = input.role.trim();

  return {
    legalName: input.company.trim(),
    rut: input.rut.trim(),
    email: input.email.trim(),
    contactName: input.name.trim(),
    phone: input.phone.trim(),
    consent: input.consent,
    registrationKind: kind,
    // Los opcionales se omiten cuando están vacíos: mandar `website: ''` haría
    // que el servidor lo rechace por no empezar con http.
    ...(website ? { website } : {}),
    ...(input.coverage ? { coverage: input.coverage } : {}),
    regions: input.coverage === 'regional' ? input.regions : [],
    ...(message ? { message } : {}),
    ...(role ? { contactRole: role } : {}),
  };
}
