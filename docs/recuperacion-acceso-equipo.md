# Cómo se recupera el acceso del equipo

El panel `/admin` administra socios, planes, facturación y accesos. Tiene segundo
factor obligatorio desde el 2026-11-16, y un segundo factor sin salida es una
forma elegante de perder el panel: alcanza con cambiar de teléfono, o con que la
única persona con rol admin se vaya del equipo.

Este documento define **quién puede recuperar el acceso, cómo y qué queda
registrado**. Es la contraparte operativa del código: sin esto, el 2FA del equipo
es una promesa de bloqueo.

## Principio

Ninguna recuperación es silenciosa. Las tres vías dejan rastro en
`admin_events`, y las dos primeras avisan por correo a la cuenta afectada.

## Vía 1 — Código de recuperación (autoservicio)

Es la salida normal y la primera que hay que intentar.

1. La persona entra con su enlace de correo habitual. El panel le pide el código
   de la app; abajo hay un enlace: **«Perdí el teléfono: usar un código de
   recuperación»**.
2. Escribe uno de sus diez códigos (`XXXX-XXXX`). El servidor lo busca por hash,
   lo marca usado y **quita el factor TOTP** de su cuenta.
3. Al recargar, entra sin segundo factor, **activa uno nuevo** con el teléfono
   nuevo y **genera un lote de códigos nuevo** desde `/admin/cuenta`.

Qué queda registrado: fila en `admin_recovery_codes` con `used_at`, y evento
`admin_mfa.recovery_code` en `admin_events` con el correo y la cantidad de
factores quitados. El código no se puede reutilizar: el canje exige `used_at`
nulo, así que dos intentos simultáneos no ganan los dos.

**Dónde se guardan los códigos** (decisión del equipo, no del sistema):

- En un gestor de contraseñas compartido del equipo (una entrada por persona), o
  impresos en un sobre cerrado fuera de la oficina.
- **Nunca** en el repositorio, en un chat, en el correo de la propia cuenta ni en
  el mismo teléfono que genera los códigos: si se pierde el teléfono, se pierden
  los dos.
- Se regeneran cuando se usa uno, cuando alguien deja el equipo y cada 12 meses.

**Lo que esta vía no hace**: no devuelve el acceso a la cuenta de correo. Si la
persona perdió también el correo, hace falta la vía 3 (la cuenta de correo es la
identidad del sistema).

## Vía 2 — Reset por otro admin (acompañado)

Cuando la persona ya no tiene ninguno de sus códigos.

1. Otro admin, con su propia sesión **ya verificada** (con su código de app),
   entra a `/admin/cuenta` → «Resetear el segundo factor de otra cuenta».
2. Escribe el correo de la persona y confirma.
3. El servidor quita sus factores, escribe `team_mfa.reset` en `admin_events` y
   **le manda el correo de aviso** a la cuenta afectada.

Reglas:

- **No se puede resetear a sí mismo** por esta vía: un admin que se resetea a sí
  mismo convierte el segundo factor en opcional. Para la propia cuenta están los
  códigos.
- El aviso por correo es obligatorio, no cosmético: es la señal que tiene la
  persona de que alguien tocó su seguridad.
- Después del reset, la persona activa un 2FA nuevo y genera códigos nuevos: los
  anteriores quedan sin valor al regenerar el lote.

## Vía 3 — Último recurso: el panel de Supabase

Solo si no queda ningún admin operativo (por ejemplo, un equipo de una sola
persona que perdió teléfono y códigos a la vez). Es una operación **fuera de la
aplicación** y por eso la más delicada:

1. Quien tenga acceso al proyecto de Supabase (hoy: la cuenta dueña del proyecto,
   ver `docs/registro-cuentas-y-servicios.md`) entra al dashboard.
2. Authentication → Users → la cuenta afectada → quita los factores MFA.
3. **Se registra a mano** en la bitácora: una fila en `admin_events` con acción
   `team_mfa.manual` y el correo de quien lo hizo. Si no queda nadie que pueda
   escribirla, se anota en el registro del proyecto y se carga después.
4. La persona entra, activa 2FA y genera códigos nuevos.

Esta vía existe porque el sistema no puede ser más fuerte que su dueño, pero es
la única que no deja rastro automático: por eso se anota a mano y por eso no se
usa si existe cualquier otra salida.

## Checklist después de cualquier recuperación

- [ ] La persona volvió a activar el segundo factor con su teléfono.
- [ ] Generó un lote nuevo de códigos y lo guardó fuera del teléfono.
- [ ] En `/admin/correos` aparece el aviso enviado (o su motivo, si no salió).
- [ ] En `admin_events` está la acción correspondiente con el correo correcto.

## Si un código aparece usado y no fue la persona

Se trata como incidente de seguridad:

1. Reset inmediato del segundo factor de esa cuenta (vía 2, desde otra sesión
   admin) y regeneración del lote.
2. Revisar `admin_events` de las últimas 48 h buscando `admin_mfa.recovery_code`
   y `partner_mfa.reset`.
3. Revisar las sesiones activas de la cuenta en el dashboard de Supabase y cerrar
   las que no se reconozcan.
4. Cambiar la contraseña del correo asociado, que es la identidad del sistema.
