# Inventario de datos personales

Primer paso del cumplimiento de la **Ley 21.719** (nueva ley chilena de protección
de datos personales, con régimen sancionatorio). Este documento **no es asesoría
legal**: es el inventario técnico que un abogado necesita para decir qué falta, y
la lista de decisiones que el producto tiene que tomar.

Levantado contra el esquema real de producción (24 tablas en `public`, más
`auth.users`) el **2026-11-16**, vía OpenAPI de PostgREST.

## Cómo leerlo

- **Base de licitud**: por qué se puede tratar el dato. La ley exige una; en un
  portal inmobiliario casi todo cae en «ejecución de un contrato» o
  «consentimiento».
- **Retención**: cuánto tiempo se guarda. Sin plazo escrito, el dato se guarda
  para siempre, y eso es exactamente lo que la ley sanciona.
- **Borrado**: quién puede hacerlo hoy. Si la respuesta es «nadie», es una brecha.

## Inventario

| Tabla | Datos personales | Para qué | Base propuesta | Retención propuesta | Borrado hoy |
|---|---|---|---|---|---|
| `leads` | nombre, email, teléfono | que el socio contacte al interesado | ejecución del servicio (socio) | 24 meses desde el último contacto | ❌ no existe |
| `solicitudes` | nombre, email, teléfono | atender un registro de socio | consentimiento del formulario | 12 meses | ❌ no existe |
| `signups` | nombre, email, teléfono | alta de visita de prueba y su correo | consentimiento del formulario | 3 meses sin actividad | ❌ |
| `share_events` | nombre, email, teléfono del destinatario | atribuir un compartido | interés legítimo | 6 meses | ❌ |
| `kyb_applications` | razón social, RUT, email, nombre y teléfono de contacto, email corporativo | evaluar el alta de una empresa | ejecución de contrato | 24 meses desde el cierre | ❌ |
| `kyb_documents` | documentos societarios (PDF) | respaldar la evaluación | obligación contractual | 24 meses | ❌ |
| `partner_users` | email | dar acceso al panel | ejecución de contrato | mientras dure el vínculo + 6 meses | ✅ (borrar la cuenta) |
| `properties` | dirección, nombre/email/teléfono del agente | publicar y que contacten | interés legítimo del socio | mientras esté publicada + 6 meses | ⚠️ parcial |
| `admin_events` | email del actor y del afectado | auditoría de acciones del equipo | interés legítimo / seguridad | 24 meses | ⚠️ no se purga |
| `favorites`, `saved_searches` | `user_id` | funcionalidad de la cuenta | ejecución de contrato | mientras la cuenta viva | ✅ con la cuenta |
| `auth.users` (Supabase) | email, sesiones, IP de acceso | autenticación | ejecución de contrato | mientras la cuenta viva | ✅ (API de administración) |

## Brechas detectadas

1. **No hay consentimiento registrado.** Los formularios públicos no guardan
   cuándo ni con qué texto se aceptó, y alguno ni siquiera muestra una finalidad.
2. **No hay proceso de supresión.** Borrar a un titular exige tocar `leads`,
   `solicitudes`, `signups`, `share_events` y `auth.users` a mano, y nada lo
   verifica.
3. **No hay plazo de retención en ningún lado.** Ninguna tabla purga.
4. **No hay entrega de datos al titular** (derecho de acceso y portabilidad).
5. **Los logs de plataforma** (Vercel) guardan IPs por su cuenta, con su propia
   retención; hay que declararlo.

## Próximos pasos, en orden

1. **Consentimiento con registro**: texto de finalidad visible en cada formulario
   y columnas `consent_at` / `consent_text_version` en `solicitudes`, `signups`,
   `share_events` y `kyb_applications`.
2. **Solicitudes de titulares**: tabla `data_requests` (tipo, email, estado,
   fechas) y un procedimiento documentado con plazo de respuesta.
3. **Purga por retención**: job mensual (mismo patrón que `socioNudges`) que
   anonimice o borre según la tabla, con informe en `admin_events`.
4. **Página legal** `/legal/datos` con finalidades, plazos y cómo ejercer los
   derechos, enlazada desde el pie de todos los correos.
