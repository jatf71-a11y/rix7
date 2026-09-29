/**
 * Contenido legal del portal (hallazgo #6 de la fase 2).
 *
 * Los textos viven en datos, no en el markup: así las páginas legales son
 * renderizadoras tontas, el contenido se puede testear de forma automática
 * (que no haya promesas vacías ni lazos con cláusulas de servicio) y revisar
 * una actualización es leer un solo archivo.
 *
 * **Aviso**: son textos redactados para el contexto de Rix7 (portal de
 * avisos clasificados inmobiliarios, Chile). No reemplazan la revisión de un
 * abogado; antes de operar con datos personales reales hay que validarlos
 * contra la Ley 19.628 y, si se acreditan corredoras, ante la DMA.
 */

import type { ReactNode } from 'react';

export interface LegalSection {
  /** Título de la sección (va dentro de un `h2`). */
  title: string;
  /** Párrafos y listas en orden; nunca vacío. */
  body: ReactNode[];
}

export interface LegalDocument {
  /** Slug y prefijo del título, p. ej. "Términos de Servicio". */
  title: string;
  /** Resumen para la metadata de la página. */
  description: string;
  /** Cuándo entró a vigencia esta versión del documento. */
  effectiveDate: string; // ISO yyyy-mm-dd
  /** Intro antes de la primera sección. */
  intro: ReactNode[];
  sections: LegalSection[];
}

/** Contacto canónico de privacidad, citado en más de un documento. */
export const PRIVACY_CONTACT = 'privacidad@rix7.cl';

const CONTACTO_EMAIL: ReactNode = (
  <a href={`mailto:${PRIVACY_CONTACT}`} className="text-blue-600 hover:text-blue-700 underline underline-offset-2">
    {PRIVACY_CONTACT}
  </a>
);

/* ------------------------------------------------------------------ */
/* Términos de Servicio                                                */
/* ------------------------------------------------------------------ */

export const terminos: LegalDocument = {
  title: 'Términos de Servicio',
  description:
    'Condiciones de uso de Rix7: quién es responsable de cada aviso, qué puede publicarse, cómo se tratan las reservas del portal y qué ley rige el servicio.',
  effectiveDate: '2026-09-28',
  intro: [
    <>
      Estos términos regulan el uso de <strong>Rix7</strong> (en adelante, «el
      portal»), una plataforma digital que publica avisos clasificados
      inmobiliarios en Chile y herramientas asociadas de búsqueda y contacto.
      Al usar el portal aceptas estos términos; si publicas un aviso o te
      identificas en él, también las reglas específicas que se mencionan más
      abajo.
    </>,
  ],
  sections: [
    {
      title: '1. Naturaleza del servicio',
      body: [
        <>
          Rix7 es un <strong>intermediario técnico de avisos</strong>: muestra
          la información que cada publicante (dueño directo o corredora
          autorizada) carga al sistema y le permite recibir consultas. No es
          parte de las operaciones que se cierren a partir de un aviso: no
          arrienda, no vende, no cobra comisiones ni interviene en los pagos
          entre las partes.
        </>,
        <>
          La información de cada propiedad —precio, superficie, disponibilidad,
          datos de contacto— es declarada por su publicante. Rix7 no la verifica
          caso a caso y no garantiza su exactitud, actualidad ni completitud.
        </>,
      ],
    },
    {
      title: '2. Cuenta de usuario',
      body: [
        <>
          Para guardar favoritos, guardar búsquedas o publicar se pide una
          identificación mínima (nombre y correo, verificados con un enlace
          mágico). Eres responsable de mantener tu acceso al correo asociado y
          de no compartirlo. Puedes pedir la eliminación de tu cuenta y sus
          datos escribiendo a {CONTACTO_EMAIL}.
        </>,
        <>
          La identificación «en este dispositivo» es una comodidad local para
          recordar tu nombre entre visitas: no es una cuenta, no viaja al
          servidor y puedes borrarla cuando quieras desde el propio portal.
        </>,
      ],
    },
    {
      title: '3. Publicación de avisos',
      body: [
        <>
          Quien publica un aviso declara y responde por que: (a) es el dueño
          del inmueble o tiene mandato expreso para publicarlo; (b) los datos,
          fotografías y videos son veraces y de su propiedad o tiene derecho a
          usarlos; (c) el precio y la moneda indicados son los reales.
        </>,
        <>
          Está prohibido publicar: propiedades sin mandato, contenido que
          discrimine, avisos repetidos o que no correspondan a inmuebles,
          datos de contacto de terceros sin autorización, y cualquier uso que
          vulnere la ley chilena. Rix7 puede retirar un aviso que infrinja
          estas reglas y suspender a un publicante reincidente, avisándole al
          correo registrado.
        </>,
      ],
    },
    {
      title: '4. Herramientas de cálculo',
      body: [
        <>
          La calculadora de dividendo, el selector de monedas y cualquier
          estimador son <strong>referenciales</strong>. Los valores de UF y dólar
          provienen de fuentes públicas y pueden llegar desfasados; las
          condiciones reales de un crédito las fija cada institución
          financiera. Ninguna cifra del portal constituye una oferta de
          crédito ni asesoría financiera.
        </>,
      ],
    },
    {
      title: '5. Datos de mapas y servicios de terceros',
      body: [
        <>
          Los mapas usan cartografía de OpenStreetMap y sus contribuidores, y
          los datos de puntos de interés provienen de la API pública Overpass,
          con caché propia para no sobrecargar el servicio. Esas fuentes tienen
          sus propios términos; Rix7 no controla su disponibilidad.
        </>,
      ],
    },
    {
      title: '6. Enlaces de compartir',
      body: [
        <>
          Al compartir una ficha se genera una landing pública con datos
          acotados de la propiedad (sin contacto directo del agente y con
          ubicación aproximada). El enlace es personal de quien lo genera:
          puede caducar si el aviso se retira.
        </>,
      ],
    },
    {
      title: '7. Limitación de responsabilidad',
      body: [
        <>
          En la máxima medida que permita la ley, Rix7 no responde por daños
          derivados de: la veracidad de los avisos, decisiones tomadas a partir
          de las herramientas de cálculo, interrupciones del servicio, ni
          acuerdos fallidos entre usuario y publicante. El portal se ofrece
          «tal cual», en desarrollo continuo.
        </>,
      ],
    },
    {
      title: '8. Cambios y ley aplicable',
      body: [
        <>
          Estos términos pueden actualizarse; la fecha de vigencia al final de
          esta página indica la versión aplicable y los cambios relevantes se
          anuncian en el portal. Todo lo no tratado acá se rige por la
          legislación de la República de Chile, y cualquier controversia se
          somete a los tribunales de Santiago.
        </>,
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Política de privacidad                                              */
/* ------------------------------------------------------------------ */

export const privacidad: LegalDocument = {
  title: 'Política de Privacidad',
  description:
    'Qué datos recoge Rix7, para qué, cuánto tiempo los guarda, cómo se eliminan y qué pasa con las cookies y servicios de terceros. Ley 19.628.',
  effectiveDate: '2026-09-28',
  intro: [
    <>
      Esta política explica qué datos personales trata <strong>Rix7</strong>,
      con qué fin y bajo qué base. El principio que guía el portal:{' '}
      <strong>recoger lo mínimo</strong> — no hay rastreadores publicitarios ni
      perfiles comerciales—, y darte control directo sobre lo que se guarda.
      El tratamiento se rige por la <em>Ley 19.628 sobre protección de la vida
      privada</em> de Chile.
    </>,
  ],
  sections: [
    {
      title: '1. Responsable del tratamiento',
      body: [
        <>
          Rix7 (portal inmobiliario) es responsable de los datos que se recogen
          en este sitio. Para cualquier consulta sobre privacidad —acceso,
          rectificación, eliminación o portabilidad— escribe a{' '}
          {CONTACTO_EMAIL} y responderemos dentro de un plazo razonable.
        </>,
      ],
    },
    {
      title: '2. Datos que recogemos y para qué',
      body: [
        <>
          <strong>Cuenta:</strong> nombre, correo y la verificación del correo
          mediante enlace mágico. Sirve para reconocerte entre visitas, guardar
          tus favoritos y búsquedas, y autorizar publicaciones. Sin esto el
          portal funciona igual, solo sin lista de favoritos persistente.
        </>,
        <>
          <strong>Consultas a publicantes:</strong> si envías un contacto desde
          una ficha, tu nombre, correo, teléfono (opcional) y mensaje se pasan
          a la corredora o dueño del aviso para que te responda. Ese uso está
          fuera del portal y regido por su propia relación contigo.
        </>,
        <>
          <strong>Registro local del dispositivo:</strong> tu nombre e email
          pueden guardarse solo en tu navegador para saludarte de nuevo; nunca
          viaja al servidor y se borra desde el menú («Olvidar este
          dispositivo»).
        </>,
        <>
          <strong>Registros técnicos:</strong> la plataforma de hosting
          (Vercel) registra peticiones con fines de seguridad y operación, según
          <a
            href="https://vercel.com/legal/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-700 underline underline-offset-2"
          >
            {' '}
            su propia política
          </a>
          . Rix7 no añade analítica de terceros con cookies.
        </>,
      ],
    },
    {
      title: '3. Cookies y almacenamiento local',
      body: [
        <>
          Rix7 <strong>no usa cookies de rastreo ni publicitarias</strong>. El
          navegador guarda solo lo funcional: tu sesión, tu identidad local, la
          moneda elegida y la caché de mapas. La Web Analytics de Vercel —si el
          operador la activa— está configurada sin cookies y sin almacenar
          datos personales identificables.
        </>,
        <>
          Como no hay cookies de terceros ni avisos dirigidos, el portal no
          muestra un banner de cookies; si esto cambia, esta política se
          actualizará antes de activar nada.
        </>,
      ],
    },
    {
      title: '4. Con quién se comparten',
      body: [
        <>
          Solo con: (a) el publicante del aviso, cuando tú le envías una
          consulta; (b) proveedores de infraestructura que procesan datos por
          encargo (hosting Vercel, base de datos Supabase, correos
          transaccionales), cada uno bajo su acuerdo de tratamiento; (c)
          autoridades, si la ley lo exige. Nunca se venden ni ceden datos a
          terceros con fines comerciales.
        </>,
      ],
    },
    {
      title: '5. Cuánto tiempo se guardan',
      body: [
        <>
          Los datos de cuenta viven mientras tengas la cuenta activa; los
          registros de hosting los retiene el proveedor por sus plazos de
          seguridad (habitualmente días o semanas). Las consultas enviadas a
          un publicante se conservan en el buzón de destino, fuera del control
          del portal.
        </>,
      ],
    },
    {
      title: '6. Tus derechos y cómo ejercerlos',
      body: [
        <>
          Puedes pedir acceso, rectificación o eliminación de tus datos
          escribiendo a {CONTACTO_EMAIL}. La eliminación de la cuenta borra tu
          perfil, favoritos y búsquedas guardadas. También puedes borrar la
          identidad local desde el propio portal sin pasar por nosotros.
        </>,
      ],
    },
    {
      title: '7. Menores de edad',
      body: [
        <>
          El portal está dirigido a personas mayores de 18 años. No se recogen
          datos de menores de forma deliberada; si detectamos una cuenta de un
          menor, se eliminará.
        </>,
      ],
    },
    {
      title: '8. Cambios en esta política',
      body: [
        <>
          Cualquier cambio relevante se anunciará en el portal y actualizará la
          fecha de vigencia al final de esta página. Los cambios no reducen
          derechos ya ganados sobre datos recogidos con la versión anterior.
        </>,
      ],
    },
  ],
};
