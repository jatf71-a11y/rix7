/**
 * Correo de bienvenida de Rix7.
 *
 * Se construye acá, en un módulo puro, porque es lo único que la persona ve de
 * este envío: conviene poder revisarlo en un test en vez de descubrirlo en la
 * bandeja de entrada.
 *
 * La identidad del portal está puesta en el correo y no en un texto genérico:
 * azul de marca (#2563eb), el nombre partido en «Rix» + «7» como en el Navbar, y
 * los tres rasgos que distinguen a Rix7 del resto de los portales —el mapa GIS,
 * las búsquedas guardadas con alertas y la calculadora de dividendo en UF—. Un
 * correo de bienvenida que podría ser de cualquier sitio no le sirve a nadie.
 *
 * Todo lo que viene del usuario (su nombre) se escapa antes de entrar al HTML.
 */

import { escapeHtml } from './alertEmail';

export interface WelcomeEmailInput {
  /** Nombre que dejó al registrarse. */
  name: string;
  /** Base para armar los enlaces absolutos. */
  siteUrl: string;
  /** Si aceptó recibir publicidad, se lo recordamos con la salida a mano. */
  marketing?: boolean;
}

export interface BuiltWelcomeEmail {
  subject: string;
  text: string;
  html: string;
}

/** Primer nombre, para saludar como se saluda de verdad. */
function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || '';
}

/** Los tres rasgos que el correo destaca. El orden es el del portal. */
const HIGHLIGHTS: readonly { title: string; body: string; href: string }[] = [
  {
    title: 'Mapa inteligente de todo Chile',
    body: 'Explora por comuna, dibuja una búsqueda alrededor de un punto de interés y mira cada propiedad sobre el mapa. Con sectores, avenidas y precios de referencia.',
    href: '/?operation=sale',
  },
  {
    title: 'Búsquedas guardadas con alertas',
    body: 'Guarda lo que buscas una vez y te avisamos por correo cuando aparezca algo que encaje. Sin entrar a revisar todos los días.',
    href: '/favoritos',
  },
  {
    title: 'Calculadora de dividendo y monedas',
    body: 'Pasa los precios entre pesos, UF y dólares, y estima tu dividendo con la tasa y el pie que elijas antes de contactar a la corredora.',
    href: '/?operation=sale',
  },
];

export function buildWelcomeEmail({
  name,
  siteUrl,
  marketing = false,
}: WelcomeEmailInput): BuiltWelcomeEmail {
  const first = firstNameOf(name);
  const greeting = first ? `¡Bienvenido, ${first}!` : '¡Bienvenido a Rix7!';

  const subject = first
    ? `${greeting} Tu cuenta en Rix7 está lista`
    : '¡Bienvenido a Rix7! Tu cuenta está lista';

  const text = [
    greeting,
    '',
    'Tu cuenta en Rix7 ya está activa. Esto es lo que puedes hacer desde hoy:',
    '',
    ...HIGHLIGHTS.map((h) => `• ${h.title}\n  ${h.body}\n  ${siteUrl}${h.href}`),
    '',
    'Lo mejor: no tendrás que volver a escribir tus datos.',
    'Cuando te interese una propiedad, la corredora recibirá tu nombre, tu correo y tu',
    'teléfono directamente, sin formularios que repetir.',
    '',
    `Empezar a buscar: ${siteUrl}`,
    '',
    'Cualquier duda, respóndenos este correo: lo lee una persona.',
    '',
    'Rix7 — Portal inmobiliario inteligente de Chile',
    siteUrl,
  ].join('\n');

  const itemsHtml = HIGHLIGHTS.map(
    (h) => `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #e2e8f0">
            <div style="color:#0f172a;font-size:15px;font-weight:700">${escapeHtml(h.title)}</div>
            <div style="color:#475569;font-size:13px;line-height:1.6;margin-top:4px">${escapeHtml(h.body)}</div>
            <div style="margin-top:8px">
              <a href="${siteUrl}${h.href}"
                 style="color:#2563eb;font-size:12px;font-weight:700;text-decoration:none">
                Verlo en Rix7 →
              </a>
            </div>
          </td>
        </tr>`
  ).join('');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0">

      <!-- Cabecera de marca -->
      <div style="background:#0f172a;padding:28px 24px">
        <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-.02em">
          Rix<span style="color:#3b82f6">7</span>
        </div>
        <div style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-top:6px">
          Portal inmobiliario inteligente · Chile
        </div>
      </div>

      <!-- Bienvenida -->
      <div style="padding:26px 24px 6px">
        <h1 style="margin:0 0 6px;font-size:22px;color:#0f172a">${escapeHtml(greeting)}</h1>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6">
          Tu cuenta en Rix7 ya está activa. Desde ahora te reconocemos en el portal:
          guarda tus búsquedas, marca favoritos y contacta a las corredoras sin volver a
          escribir tus datos.
        </p>
      </div>

      <!-- Datos que ya no hay que repetir -->
      <div style="padding:18px 24px 0">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px">
          <div style="color:#1d4ed8;font-size:13px;font-weight:800">
            Ya no tendrás que repetir tus datos
          </div>
          <div style="color:#334155;font-size:13px;line-height:1.6;margin-top:4px">
            Cada vez que contactes a una corredora desde una ficha, recibirá tu nombre,
            tu correo y tu teléfono al instante. Tú solo eliges si prefieres llamar,
            escribir por WhatsApp o enviar un correo.
          </div>
        </div>
      </div>

      <!-- Qué puedes hacer -->
      <div style="padding:22px 24px 0">
        <div style="color:#0f172a;font-size:15px;font-weight:800">Lo que puedes hacer hoy</div>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:0 24px">
        ${itemsHtml}
      </table>

      <!-- Llamado a la acción -->
      <div style="padding:22px 24px 26px">
        <a href="${siteUrl}/"
           style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">
          Empezar a buscar
        </a>
        <p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:1.6">
          ¿Tienes una duda? Responde este correo y te contesta una persona del equipo.
        </p>
      </div>

      <!-- Pie -->
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 24px">
        <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.7">
          ${
            marketing
              ? 'Recibes este correo porque creaste tu cuenta en Rix7 y aceptaste nuestras novedades. Puedes darte de baja desde cualquier correo que te enviemos.'
              : 'Recibes este correo porque creaste tu cuenta en Rix7. No lo usamos para publicidad: solo para lo que tiene que ver con tu cuenta.'
          }
          <br />
          <a href="${siteUrl}/legal/privacidad" style="color:#64748b;text-decoration:underline">Privacidad</a>
          ·
          <a href="${siteUrl}/legal/terminos" style="color:#64748b;text-decoration:underline">Términos</a>
          ·
          <a href="${siteUrl}/" style="color:#64748b;text-decoration:underline">rix7.cl</a>
        </p>
      </div>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}
