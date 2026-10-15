# Ticket a Supabase — recuperar acceso a la cuenta dueña del proyecto en vivo

## Desenlace (2026-10-14): **ya no bloquea**

Mientras el ticket seguía en la cola se ejecutó la alternativa que no depende de nadie: la base
se levantó de nuevo bajo la cuenta accesible (`vsqkjimpssdvlvdwrtnh`), con las 15 migraciones
aplicadas y el catálogo copiado del proyecto en vivo. El sitio puede mudarse a esa base en
cuanto esté guardada la clave de servicio nueva. Procedimiento, evidencia y lo que queda:
[recuperacion-base-2026-10-14.md](recuperacion-base-2026-10-14.md).

**Qué sigue valiendo del ticket** (por eso no se cierra): lo que la copia no puede traer vive
solo en el proyecto de la cuenta B —los **usuarios de Auth**, las **consultas** (`leads`) y las
**altas** (`signups`)—. Si el soporte devuelve el acceso, esas tres cosas se exportan en un
rato; si no, se rehacen: cada persona con cuenta restablece su contraseña y las consultas
históricas quedan archivadas en el proyecto viejo (que sigue en pie, solo sin administración).

## Estado original: **enviado el 2026-10-14**

Se envió por el **formulario del dashboard** (`/dashboard/support/new`), que es el canal
preferido, desde la sesión de `jatf71@gmail.com` (GitHub `jatf71-a11y`). La confirmación del
sitio fue *«Support request sent — We'll reach out at jatf71@gmail.com»*.

Cómo se completó, para poder repetirlo o citarlo:

| Campo | Valor |
|---|---|
| Organización | `jatf71-a11y's Org` (la única visible desde esa sesión) |
| Proyecto | **No specific project** — el proyecto en vivo no aparece desde esta cuenta, así que se dejó vacío **a propósito** y el ref va en el mensaje |
| Tipo | Issues with logging in |
| Severidad | Normal (System impaired) |
| Asunto | *No puedo iniciar sesión: la cuenta dueña del proyecto `wcxpkfmevrbjrjlbayba` es solo-GitHub y su único GitHub fue eliminado* |
| Mensaje | 2.259 caracteres: situación, los dos pedidos en orden, cómo acreditar titularidad y los datos del proyecto |
| Respuesta va a | `jatf71@gmail.com` |

Cosas para tener presentes:

- El ticket sale **desde la cuenta A**, que no es miembro del proyecto. La política pide que el
  pedido venga de un correo registrado en la cuenta y con acceso Developer o superior al proyecto.
  El mensaje lo anticipa y ofrece verificación por el buzón del dominio; si la respuesta es «escriba
  desde la cuenta dueña», queda el camino del correo de abajo.
- El formulario ofrece *«Allow support access to your project»*: al no haber proyecto seleccionado,
  no se otorgó acceso a ninguno.
- Al elegir el tipo *Issues with logging in*, el propio dashboard sugirió el artículo «GitHub Account
  was deleted - Lost Supabase account access»: es un caso que ellos ya tienen catalogado, así que el
  pedido cae en una categoría conocida y no hay que explicar la mecánica desde cero.

**A dónde va** (queda como alternativa, y como canal si el ticket se cierra sin respuesta)

| Canal | Dirección | Cuándo |
|---|---|---|
| Formulario del dashboard | `https://supabase.com/dashboard/support/new` | **Ya usado el 2026-10-14**, ver arriba |
| Correo | `support@supabase.com` | Si el ticket se cierra sin respuesta, o se prefiere el canal que la política pide de verdad: tiene que salir **desde `jtorres@catedralpropiedades.com`**, que es un correo registrado en la cuenta afectada. Desde otra casilla no lo procesan |

Reglas del canal (https://supabase.com/support-policy): el pedido debe salir por un canal oficial,
desde un **correo registrado** en la cuenta, y el solicitante debe tener acceso **Developer o
superior** en el proyecto. El soporte de facturación y gestión de cuenta está disponible para
**todos** los clientes; el técnico limitado es solo para proyectos pagos.

**Asunto**

    No puedo iniciar sesión: la cuenta dueña del proyecto wcxpkfmevrbjrjlbayba es solo-GitHub y su único GitHub fue eliminado

**Cuerpo (copiar tal cual)**

```
Hola:

Soy la persona titular de la cuenta registrada en Supabase con el correo
jtorres@catedralpropiedades.com, dueña del proyecto wcxpkfmevrbjrjlbayba
("rix7-portal", en producción).

No puedo iniciar sesión. Esa cuenta se creó usando GitHub como único método de
ingreso, y esa cuenta de GitHub (jtorres-ops) fue eliminada. La API pública de
GitHub responde 404 para ese usuario, así que el botón "Continue with GitHub"
ya no puede autenticarme. La cuenta nunca tuvo contraseña ni otro método de
ingreso, por lo que el restablecimiento tampoco sirve: el aviso del propio
formulario dice "Su cuenta está vinculada a GitHub, por lo que solo puede
iniciar sesión con la opción de GitHub".

Puedo acreditar titularidad desde el buzón jtorres@catedralpropiedades.com
—el mismo correo de la cuenta y el que recibe sus avisos de restablecimiento—,
y desde ese correo estoy escribiendo. Puedo responder cualquier pregunta de
verificación o enviar capturas que pidan.

Lo que necesito, en orden de preferencia:

1. Agregar un método de ingreso adicional a esa cuenta (correo + contraseña), o
   bien vincular una cuenta de GitHub nueva que yo indique. Es lo mínimo y
   conserva datos, usuarios de Auth y archivos.
2. Si (1) no es viable: transferir la organización con el proyecto
   wcxpkfmevrbjrjlbayba a otra cuenta mía, jatf71@gmail.com.

Es un proyecto en producción (https://rix7.cl), así que agradezco que me digan
si hace falta algún dato más para avanzar.

Datos del proyecto:
- Ref del proyecto: wcxpkfmevrbjrjlbayba
- URL de API: https://wcxpkfmevrbjrjlbayba.supabase.co
- Correo de la cuenta dueña: jtorres@catedralpropiedades.com
- Cuenta de GitHub vinculada (eliminada): jtorres-ops
- Cuenta de destino, si se opta por transferir: jatf71@gmail.com

Gracias.
```

**Adjuntos útiles si los piden**

- Captura del aviso «Su cuenta está vinculada a GitHub…» en la pantalla de ingreso.
- Captura de `https://api.github.com/users/jtorres-ops` devolviendo `404`.
- Cualquier correo de Supabase recibido en ese buzón (comprobante de titularidad).

**Qué NO escribir**: la `service_role_key`, la anon key ni ningún token. No hacen falta para
acreditar titularidad y no deben circular por correo.
