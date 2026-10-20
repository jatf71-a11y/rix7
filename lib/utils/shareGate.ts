/**
 * Qué hacer cuando una visita aprieta compartir o guardar en una ficha.
 *
 * Compartir por WhatsApp, copiar el enlace, la hoja nativa y guardar en
 * favoritos piden que el visitante esté registrado. La decisión vive acá —y no
 * dentro del componente— porque tiene un caso que se olvida fácil: mientras la
 * identidad todavía se está leyendo (`isChecking`, sesión + almacenamiento del
 * dispositivo) **no** se puede afirmar que no haya registro. Ahí no se ejecuta
 * la acción ni se acusa al visitante de no estar registrado: se ignora el clic.
 *
 * Las acciones se habilitan con el registro del dispositivo o con la sesión del
 * portal; ambas llegan ya resueltas como `registration`.
 *
 * @param registration Identidad reconocida, o `null` si el sitio no la tiene.
 * @param isChecking   `true` mientras se verifica la identidad en el cliente.
 * @returns `run` para ejecutar la acción, `prompt` para mostrar el aviso de
 *          registro, `ignore` para descartar el clic sin efectos.
 */
export type ShareGateDecision = 'run' | 'prompt' | 'ignore';

/** Acciones del portal que piden visitante registrado. */
export type GatedAction = 'whatsapp' | 'copy' | 'share' | 'save' | 'card';

/** Título del aviso para cada acción, según el botón que se apretó. */
export const REGISTRATION_GATE_TITLES: Record<GatedAction, string> = {
  whatsapp: 'Regístrate para compartir por WhatsApp',
  copy: 'Regístrate para copiar el enlace',
  share: 'Regístrate para compartir esta propiedad',
  save: 'Regístrate para guardar esta propiedad',
  card: 'Regístrate para descargar la tarjeta',
};

export function shareGateDecision({
  registration,
  isChecking,
}: {
  registration: unknown | null;
  isChecking: boolean;
}): ShareGateDecision {
  if (isChecking) return 'ignore';
  return registration ? 'run' : 'prompt';
}
