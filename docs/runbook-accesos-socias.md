# 🔑 Runbook — devolver el acceso a socias y corredoras

El corte a la base nueva deja el portal **sin ninguna cuenta**. Este documento es el plan para
que cada socia y cada corredora vuelva a entrar **sin pedirle nada a nadie y sin restablecer
contraseñas de una en una**. Se apoya en un solo comando, `npm run accesos:socias`, que se
detiene en el primer problema y no le escribe a nadie hasta que las cuentas estén listas.

Estado (2026-10-14): **la herramienta está hecha y probada** —90 tests, `tsc`, `knip` y la
guardia de secretos en verde— y **falta la clave de servicio y la lista de personas** para las
socias cuyo correo no es el de contacto de su corredora. Ver §3.

---

## 1. Primero, lo que hay que entender: acá nadie tiene contraseña

El portal no usa contraseñas. Se entra de dos formas, las dos en
[`components/auth/AuthModal.tsx`](../components/auth/AuthModal.tsx):

1. **Google**, en un clic.
2. **Enlace de un solo uso** al correo (`signInWithOtp`).

Así que «recuperar el acceso» **no** es restablecer nada: es que cada persona pueda entrar con
la cuenta que ya tiene, y que al entrar vea **su** panel. Eso depende de dos datos que viven en
`app_metadata` —la parte del usuario que **solo escribe el servidor**—:

| Dato | Qué abre | Dónde se exige |
|---|---|---|
| `role = member` | el panel `/socio` | [`lib/utils/roles.ts`](../lib/utils/roles.ts) · `requireMember` |
| `partner_id = <corredora>` | **sus** publicaciones (RLS) | migración [`0014`](../supabase/migrations/0014_socio_publicaciones.sql) · `/socio`, `/api/partner/*` |

**El fallo que este plan evita** es este: si una socia entra *antes* de que su cuenta tenga esos
dos datos, Supabase le crea una cuenta nueva y vacía, ella queda como *Visita*, `/socio` le
responde «sin corredora vinculada» y hay que arreglarlo a mano desde `/admin/empresas`. Eso es
exactamente el «uno por uno». Por eso el orden es: **primero la cuenta con su rol y su
corredora, después el aviso**.

### Y por qué el correo no sale por Supabase

El correo integrado de Supabase está limitado a **2 correos por hora** por proyecto: un aviso a
once corredoras tardaría medio día. Pero **generar** el enlace no manda ningún correo
(`POST /auth/v1/admin/generate_link`, según la [referencia de la API de Auth](https://github.com/supabase/auth#endpoints)),
así que los enlaces se generan con la clave de servicio y los manda **Resend** —el mismo
`RESEND_API_KEY` de los avisos— en lotes de hasta 100. Eso es lo que hace posible avisar a todas
sin depender de nadie. Ver [`docs/runbook-resend.md`](runbook-resend.md).

---

## 2. El plan, en fases

```
A. Antes del corte          armar la lista (§3)
B. Después del corte        npm run accesos:socias                       → plan, no escribe
C. Preparar las cuentas     npm run accesos:socias -- --aplicar          → rol + corredora
D. Probar con uno mismo     npm run accesos:socias -- --aplicar --enviar --solo <tu correo>
E. Avisar a todas           npm run accesos:socias -- --aplicar --enviar
F. Cerrar                   las que no entraron (rebote, spam) → --reenviar --solo
```

### Fase A · Antes del corte: la lista de personas

Es la única parte que **no** se puede automatizar, porque el proyecto no conoce las direcciones
de las personas: solo conoce el **correo de contacto de cada corredora**
(`partners.contact_email`, el que ya se publica en el portal).

1. Mirar qué corredoras **no** tienen correo de contacto: el propio comando lo dice en su primer
   paso (`N corredora(s) sin correo de contacto (…)`). Se completan en `/admin/empresas`.
2. Para las personas cuyo correo **no** es el de contacto de su corredora —cuentas personales,
   equipos de dos o tres—, armar un archivo `docs/cuentas.csv` (o `.accesos/cuentas.csv`, que no
   se versiona) y pasarlo con `--cuentas`:

   ```csv
   correo,nombre,rol,corredora
   ana.perez@gmail.com,Ana Pérez,member,catedral
   jtorres@catedralpropiedades.com,Javier Torres,member,catedral
   equipo@rix7.cl,Equipo Rix7,admin,catedral
   ```

   También acepta **JSON** (`[{"correo": …, "corredora": …}]`), que es el formato en el que
   llegaría una exportación del proyecto viejo. `corredora` es el `id` de `partners`
   (por ejemplo `catedral`, `savills`, `cbre`), no el nombre.
3. Si en algún momento el soporte devuelve el acceso al proyecto viejo, la lista sale de ahí
   (ver §7, «camino sin avisarle a nadie»).

### Fases B a E · El comando

```bash
npm run accesos:socias                                            # B · plan (solo lectura)
npm run accesos:socias -- --aplicar                               # C · crea y vincula
npm run accesos:socias -- --aplicar --enviar --solo tu@correo.cl  # D · probar con uno mismo
npm run accesos:socias -- --aplicar --enviar                      # E · el resto, en lotes de 100
```

| Fase | Qué hace | Qué NO hace |
|---|---|---|
| B | Lee el catálogo y las cuentas, y muestra el plan persona por persona | no escribe ni manda nada |
| C | Crea la cuenta que falta (`email_confirm: true` + `app_metadata`) o completa la que existe, y **relee para verificar** | no manda correo |
| D y E | Genera un enlace por persona y los manda con Resend; anota a quién ya le escribió | no vuelve a escribirle a quien ya tiene envío anotado |

**La fase D no es un adorno**: es la única forma de comprobar de punta a punta que el enlace
llega, entra y abre el panel, antes de escribirle a once personas. `--solo` recorta todo el
comando a una dirección.

### Fase F · Cerrar el día

- Las que no entraron (correo en spam, dirección vieja, se equivocaron de botón):
  `npm run accesos:socias -- --aplicar --enviar --reenviar --solo <correo>`. `--reenviar` es lo
  único que repite un envío ya anotado, y es explícito.
- Las que ya entraron pero no ven sus publicaciones: casi siempre es que su cuenta quedó con
  otra corredora. Se corrige vinculándola de nuevo en `/admin/empresas` (o en la lista, con la
  corredora correcta, y volviendo a correr `--aplicar`).

---

## 3. Lo que hay que tener antes de la fase B

| Dependencia | Dónde | Sin eso |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` del proyecto nuevo | `npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY` | el comando **se frena en el paso 3** y no escribe nada: sin esa clave no se puede leer ni escribir el rol de una cuenta |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` (ya están) | no se puede leer el catálogo de corredoras |
| El **corte** hecho | [`corte:supabase`](recuperacion-base-2026-10-14.md) | las cuentas se crearían en la base nueva mientras el sitio sigue apuntando a la vieja |
| `RESEND_API_KEY` + remitente verificado | Vercel / `.env.local` | **no se envía ninguno** y el informe lo dice: los enlaces igual se generan (y con `--enlaces` quedan en un archivo para repartirlos a mano) |

---

## 4. Los casos que aparecen en una base recreada

| Caso | Qué hace el comando |
|---|---|
| La cuenta no existe | la **crea** confirmada, con su rol y su corredora ya escritos |
| Ya existe porque la persona entró con Google antes del aviso | la **vincula** (le escribe rol y corredora) y le manda el enlace |
| Ya existe y está perfecta | **no la toca** (`listo`) |
| Es una cuenta del equipo (`role = admin`) | **conserva el rol**: solo se le agrega el vínculo. Vincular nunca degrada a un admin |
| La misma persona aparece dos veces en la lista | queda **una** cuenta, con el vínculo más completo, y el plan lo avisa |
| La lista trae una corredora que no existe | queda **fuera del plan**: crear esa cuenta la dejaría sin panel |
| Una corredora no tiene correo de contacto | se reporta en el paso 1 y **no** se le inventa una dirección |
| Un correo inválido en la lista | se descarta con su número de línea, y el plan lo dice |

---

## 5. Verificación

**Lo que el comando afirma por su cuenta** (lo hace en la fase C, antes de mandar nada):

| Control | Qué comprueba |
|---|---|
| Paso 3 · claves | que la clave de servicio sea del proyecto de la URL y del rol `service_role` — la pública en su lugar daría 403 *después* de haber avisado |
| Paso 4 · cuentas | que el listado esté completo (si se trunca, se frena: con la mitad haría crear cuentas que ya existen) |
| Paso 7 · verificar | **relee la base** y comprueba persona por persona que su cuenta tiene rol y corredora |
| Registro | anota a quién se le escribió, así que reanudar no duplica correos |

**Lo que queda con ojos humanos** (el comando lo imprime al terminar):

- [ ] Abrir uno de los correos y entrar desde ahí: el enlace deja la sesión abierta en `/socio`.
- [ ] Entrar con **Google** usando el mismo correo y comprobar que cae en la misma cuenta.
- [ ] Confirmar que en `/socio` se ven las publicaciones de su corredora.

Y los controles de siempre del corte, que no cambian con esto:
`npm run check:schema` · `/api/health` con `service_role` en verde · `npm run smoke:prod`.

---

## 6. Estado, enlaces y deshacer

| Cosa | Dónde | Nota |
|---|---|---|
| Registro de la corrida | `.accesos/estado.json` | a quién se le escribió y en qué estado quedó cada cuenta. **No se versiona** y no guarda credenciales |
| Enlaces generados (`--enlaces <archivo>`) | donde se pida | son **secretos de un uso** y vencen en una hora; no se imprimen por pantalla |
| Deshacer el vínculo de una cuenta | `/admin/empresas` (desvincular) | la devuelve a Visita sin tocar el resto de su metadata |
| Deshacer un correo | no se puede | por eso la fase D existe: primero tu propio correo, después los demás |

---

## 7. El camino sin avisarle a nadie (si el soporte devuelve el proyecto viejo)

La guía oficial de Supabase permite migrar **todo el esquema `auth`**, hashes de contraseña
incluidos, para que nadie tenga que restablecer nada
([*Migrating Auth Users Between Supabase Projects*](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)).
Si el acceso al proyecto viejo se recupera —el ticket está en
[`ticket-supabase-recuperacion.md`](ticket-supabase-recuperacion.md)— se puede copiar
`auth.users` **y** `auth.identities` (la copia va con la clave de servicio del viejo, que hoy solo
vive dentro de Vercel) y las cuentas reaparecen con su rol y su corredora, con el mismo `id` que
tenían.

Dos cosas que igual habría que revisar en ese camino:

1. **Las identidades OAuth**: copiar la fila no configura el proveedor. Google tiene que estar
   habilitado en el proyecto nuevo con las mismas URLs de redirección (runbook-resend §8.4,
   paso 5) y hay que probar un ingreso real.
2. **La `app_metadata`**: viaja en el `auth.users.raw_app_meta_data`, así que el rol y la
   corredora llegan con la copia. Conviene comprobarlo con `GET /auth/v1/admin/users` y con
   `/socio` abierto, que es lo que ya hace la fase C de este runbook.

Mientras eso no exista, este comando es el camino: **el proyecto viejo no se toca** (solo se
leyó su catálogo, que es público por diseño).

---

## 8. Si algo falla

| Síntoma | Causa | Arreglo |
|---|---|---|
| «falta SUPABASE_SERVICE_ROLE_KEY» en el paso 3 | la clave no está guardada | `npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY` (`corte:supabase` la usa y la comprueba) |
| El paso 4 se frena con «hay más de 4000 cuentas» | el listado no cabe en el tope de páginas | no debería pasar en este portal; si pasa, el listado hay que resolverlo desde la API con `page` manual |
| El paso 7 dice que una cuenta sigue sin rol | la metadata no se guardó | se corrige y se vuelve a correr `--aplicar`; el correo **no** salió para esa persona |
| «no salió ningún correo: falta RESEND_API_KEY» | no está la clave del correo | ponerla (runbook-resend §5) y volver a correr `--enviar`: los enlaces se regeneran |
| Resend rechaza el lote (403, 422) | remitente sin verificar o dirección inválida | runbook-resend §4 · §10; los envíos ya aceptados quedaron anotados y no se repiten |
| Llegó el correo pero el enlace dice «vencido» | pasó más de una hora | pedir otro desde `/socio`: la persona no necesita ayuda para eso |

---

## 9. Lo que este comando no hace (a propósito)

- **No manda correos de Supabase.** No depende del límite de 2 por hora, pero tampoco lo usa
  como plan B: si falta la clave de Resend, dice que no salió nada.
- **No inventa direcciones.** Las que no tiene, las reporta.
- **No toca el proyecto viejo.** De él solo lee el catálogo público.
- **No crea publicaciones ni rehace `properties.user_id`.** El vínculo que importa es
  `partner_id` (migración 0014), y las publicaciones ya quedaron atribuidas a su corredora en la
  copia (`db:copy` omite `user_id` y la política de socio funciona por `partner_id`).
- **No es un alta de usuarios.** Quien entra solo con Google y nunca estuvo en la lista queda
  como Visita, y se vincula desde `/admin/empresas` como siempre.

---

**Archivos:** [`scripts/accesos-socias.mjs`](../scripts/accesos-socias.mjs) (el comando) ·
[`scripts/accesos-socias.test.ts`](../scripts/accesos-socias.test.ts) (90 tests) ·
[`lib/data/socioAccounts.ts`](../lib/data/socioAccounts.ts) (las reglas de rol y vínculo, compartidas) ·
[`docs/recuperacion-base-2026-10-14.md`](recuperacion-base-2026-10-14.md) (el corte) ·
[`docs/runbook-resend.md`](runbook-resend.md) (el correo)
