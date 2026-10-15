/**
 * Qué decir cuando un panel **no pudo leer** sus datos.
 *
 * Existe por un defecto concreto: `/admin/leads` y `/admin/registros` solo
 * miraban `result.success`, así que un `401` —la respuesta normal de una sesión
 * sin rol de administración— los dejaba con la lista vacía y en pantalla se leía
 * **«Todavía no hay contactos»**. O sea: «no se pudo» y «no hay» se veían igual,
 * que es exactamente la clase de mentira que este proyecto evita en todo lo
 * demás (un «no sé» pintado de verde, un alta «guardada» que se pierde al
 * reiniciar). El problema no era el 401 —que es correcto— sino contarlo mal.
 *
 * El texto se decide acá, en un módulo puro y probado, y no en cada página: son
 * dos paneles con el mismo caso y una sola forma de contarlo. Los dos estados
 * son distintos y llevan a arreglos distintos:
 *
 * - **`denied`** — hay respuesta y dice que no: falta sesión o rol. El arreglo es
 *   entrar con una cuenta de administración.
 * - **`unavailable`** — no hubo respuesta, o respondió pero sin los datos. El
 *   arreglo es mirar el servidor y volver a intentar.
 */
export type ReadFailureKind = 'denied' | 'unavailable';

export interface ReadFailure {
  kind: ReadFailureKind;
  /** Una línea, para el título del aviso. */
  title: string;
  /** Qué pasó y qué hacer. Nunca dice que no hay datos. */
  detail: string;
}

/**
 * El fallo de una lectura, en texto.
 *
 * @param status el código HTTP, o `null` cuando no hubo respuesta (red, timeout, DNS)
 * @param what qué se estaba leyendo, en plural y con artículo: «los contactos»
 * @param reason lo que dijo el cuerpo o la excepción, si dijo algo
 */
export function describeReadFailure(
  status: number | null,
  what: string,
  reason: string | null = null
): ReadFailure {
  const extra = reason && reason.trim() ? ` ${reason.trim()}` : '';

  if (status === 401 || status === 403) {
    return {
      kind: 'denied',
      title: 'Tu sesión no puede leer esto',
      detail: `${what[0].toUpperCase()}${what.slice(1)} solo los ve una cuenta de administración (HTTP ${status}).${extra} Entrá con una cuenta de administración y volvé a intentar.`,
    };
  }

  if (status === null) {
    return {
      kind: 'unavailable',
      title: 'No hubo respuesta del servidor',
      detail: `No se pudo leer ${what}: ${reason?.trim() || 'no hubo respuesta'}. Lo que se ve más abajo no es «no hay datos».`,
    };
  }

  if (status >= 200 && status < 300) {
    // Un 2xx que igual no trajo los datos: no es una caída del servidor, y decirlo
    // como «respondió 200» no le sirve a nadie. El cuerpo ya explicó por qué.
    return {
      kind: 'unavailable',
      title: 'El servidor respondió sin los datos',
      detail: `La consulta de ${what} no devolvió la lista (HTTP ${status}).${extra} Volvé a intentar con «Actualizar».`,
    };
  }

  return {
    kind: 'unavailable',
    title: 'No se pudieron leer los datos',
    detail: `La consulta de ${what} respondió HTTP ${status}.${extra} Volvé a intentar con «Actualizar».`,
  };
}
