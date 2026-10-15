# Registro de cuentas, servicios y credenciales

**Regla de este documento: nunca escribe valores.** Solo registra *qué* credencial existe,
*dónde* vive, *quién* puede emitir una nueva y *cómo se recupera* si se pierde. Un archivo
así no sirve para filtrar secretos; sirve para no quedar sin puerta de entrada, que es
exactamente lo que pasó el 2026-10-13 con el proyecto en vivo.

Última revisión: **2026-10-15** (se comprobó, contra la API y contra producción, qué quedó
del lado de la cuenta A y qué sigue del lado de la cuenta B: el corte de Vercel **todavía no
está hecho**). Base de la revisión anterior: **2026-10-14**, después del corte a la base propia
(ver [recuperacion-base-2026-10-14.md](recuperacion-base-2026-10-14.md)).

---

## 1. Las identidades (quién es quién)

| Identidad | Tipo | Dónde manda | Estado |
|---|---|---|---|
| `jatf71@gmail.com` | Google (personal) | Cuenta Supabase **A**, y es el correo de contacto del proyecto | ✅ accesible |
| `jatf71-a11y` | GitHub | Dueña de Vercel, firma de los commits, `gh` autenticado en esta máquina | ✅ accesible |
| `jatf71-4430` | Usuario Vercel | El mismo equipo de Vercel visto desde la CLI | ✅ accesible |
| `jtorres@catedralpropiedades.com` | Google Workspace del dominio (MX `smtp.google.com`) | Cuenta Supabase **B**: la **dueña del proyecto en vivo** | ⚠️ sin puerta de entrada |
| `jtorres-ops` | GitHub (histórico, autor de 84 commits) | Era el método de ingreso de la cuenta Supabase **B** | ❌ **eliminada** (la API de GitHub responde 404) |

**Consecuencia (el incidente del 2026-10-13):** la cuenta Supabase **B** es *solo-GitHub*,
su única identidad de GitHub fue eliminada y no tiene contraseña, así que hoy no se puede
entrar. El aviso de restablecimiento lo dice con todas las letras: *«Su cuenta está vinculada
a GitHub, por lo que solo puede iniciar sesión con la opción de GitHub»*.

## 2. Servicios y qué rol cumple cada uno

| Servicio | Cuenta | Para qué | Credencial que usa el proyecto |
|---|---|---|---|
| **Supabase** | A (`jatf71@gmail.com`) | Cuenta accesible. Su proyecto `rix7-portal` (`vsqkjimpssdvlvdwrtnh`) **es la base nueva**: esquema al día y catálogo copiado el 2026-10-14 | URL y clave pública en `.env.local`; falta guardar la **clave de servicio** nueva y cortar Vercel |
| **Supabase** | B (`jtorres@catedralpropiedades.com`) | Proyecto `wcxpkfmevrbjrjlbayba`: **origen de la copia** (sigue sirviendo a producción hasta el corte). Conserva `leads`, `signups` y los usuarios de Auth, que no se pudieron leer | URL y clave pública (en `.env.local.pre-migracion-2026-10-14`); la service role key sigue **solo** en Vercel |
| **Vercel** | `jatf71-4430` (GitHub `jatf71-a11y`) | Hosting de `rix7.cl`, DNS del dominio y variables de entorno | `vercel` CLI, `VERCEL_OIDC_TOKEN` |
| **GitHub** | `jatf71-a11y` | Repositorio, Actions (CI, avisos, health-check) y secrets del repo | `gh` CLI, `GITHUB_TOKEN` de Actions |
| **Resend** | cuenta del equipo | Correo de bienvenida y avisos de búsquedas | `RESEND_API_KEY`, `ALERTS_FROM_EMAIL` |
| **Sentry** | organización del equipo | Monitoreo de errores (opcional: sin DSN es no-op) | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` |
| **Google Workspace** | `catedralpropiedades.com` | Buzón del dominio; recibe los correos transaccionales y de recuperación | — |

### Identificadores concretos (no secretos)

| Cosa | Valor |
|---|---|
| Ref del **origen** (cuenta B) | `wcxpkfmevrbjrjlbayba` (URL de API: `https://wcxpkfmevrbjrjlbayba.supabase.co`) |
| Ref de la **base nueva** (cuenta A) | `vsqkjimpssdvlvdwrtnh` (nombre `rix7-portal`, org `rziojndhrppqwbfmayln`) |
| Proyecto de **producción** hoy | Todavía el de la cuenta B (`wcxpkfmevrbjrjlbayba`): comprobado el 2026-10-15, `GET https://rix7.cl/api/health` responde **503** con `supabase_owner` en rojo. El corte de Vercel es el paso que falta |
| Org de Vercel | `team_ZqliMBcJmzlw3EHnMBCRGbHi` (proyecto `prj_38HRJ2h2Q8lxjsXu4pRU6MkRpMD4`, nombre `rix7`) |
| DNS del dominio | `ns1.vercel-dns.com`, `ns2.vercel-dns.com` (la zona vive en Vercel) |
| Dominio productivo | `https://rix7.cl` (con `www`), previews en `*.vercel.app` |

**Cómo distinguir los dos proyectos Supabase sin depender del nombre** (los dos se llaman
`rix7-portal`): cada anon key responde solo en su proyecto (`GET <ref>.supabase.co/rest/v1/properties?limit=1").
Comprobado el 2026-10-15, con la clave que hoy está en `.env.local` (la de la cuenta A):
`vsqkjimpssdvlvdwrtnh` → **200**, `wcxpkfmevrbjrjlbayba` → **401 Invalid API key**; con la de
`.env.local.pre-migracion-2026-10-14` (cuenta B) es al revés. Ojo: cuál de los dos sirve
**producción** no se adivina por la clave, se lee —`GET https://rix7.cl/api/health`, subsistema
`supabase_owner`, que nombra la ref en uso— y hoy sigue siendo la de la cuenta B.

## 3. Dónde vive cada credencial

| Credencial | Vive en | Emitida por | Se recupera con |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` + Vercel (los 3 entornos) | **Cuenta A** (`jatf71@gmail.com`) → Project Settings → API del proyecto `vsqkjimpssdvlvdwrtnh` | Acceso a la cuenta A (no es secreta: también viaja al navegador) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, solo servidor (**nunca** al navegador) | **Cuenta A** → API (falta guardarla: es el corte). En Vercel todavía está la de la cuenta B, que sirve **solo** para el proyecto viejo | Acceso a la cuenta A (`npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY`) |
| `SUPABASE_ACCESS_TOKEN` | `.env.local` (ignorado por git), con `npm run db:token`; **y los secretos de GitHub**, para la sonda de titularidad (`npm run check:cuenta`, cada 6 h) | **Cuenta A** → Account → Tokens | Acceso a la cuenta A: es la única que ve el proyecto `vsqkjimpssdvlvdwrtnh` (el de la cuenta B quedó **revocado el 2026-10-06**). Para el CI conviene uno **de solo lectura con alcance** («Organization Projects → Read» y «Organization Members → Read»): alcanza para comprobar de quién es la base y no puede cambiar nada |
| `RESEND_API_KEY`, `ALERTS_FROM_EMAIL` | Vercel (Secret/Config) | Resend → API Keys | Acceso a la cuenta de Resend |
| `ALERTS_CRON_SECRET` | Vercel + secrets de GitHub | Se genera | Volver a generarlo y actualizarlo en los dos lados |
| `SENTRY_*` | Vercel (opcional) | Sentry → Auth Tokens | Acceso a la organización de Sentry |
| `VERCEL_OIDC_TOKEN` | `.env.local` | Vercel CLI | `npx vercel env pull` o `vercel link` |
| Login de Vercel y GitHub | Gestor de contraseñas / llave del sistema | — | Restablecer en cada servicio (ambos tienen correo de recuperación propio) |

**Lo que el repo y esta máquina NO guardan:** la contraseña de ninguna cuenta, la clave de base
de datos de PostgreSQL y ningún archivo de credenciales. Verificado: no hay `~/.pgpass`, no hay
`~/.supabase`, y el respaldo `.git.backup-*` no contiene ningún `.env`.

## 4. Secrets y variables por plataforma

| Plataforma | Nombres configurados hoy |
|---|---|
| Vercel (Production/Preview/Development) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ALERTS_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `ALERTS_CRON_SECRET`, `NEXT_PUBLIC_DEFAULT_MAP_LAT/LNG/ZOOM` |
| GitHub → Secrets | `ALERTS_CRON_SECRET`; ⚠️ **falta `SUPABASE_ACCESS_TOKEN`** — sin él la sonda saltea la comprobación de titularidad (no se pone roja: lo dice con un aviso) |
| GitHub → Variables | `SITE_URL` (= `https://rix7.cl`) |
| `.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_DEFAULT_MAP_LAT/LNG/ZOOM`, `VERCEL_OIDC_TOKEN` (+ `SUPABASE_ACCESS_TOKEN` cuando hay uno vigente, + `SUPABASE_SERVICE_ROLE_KEY` cuando se guarda con `npm run env:secret`) |
| `.env.local.pre-migracion-2026-10-14` | Las credenciales del proyecto de la cuenta B: la única copia local del origen de la copia. No se versiona ni se borra |

## 5. Puntos únicos de falla

1. **El proyecto en vivo dependía de una sola cuenta personal** (B, cuenta de Catedral) cuyo
   ingreso era un único GitHub, hoy eliminado. Es el fallo que ya ocurrió. Mitigado: la base
   nueva vive en la cuenta A.
2. **La operación ya no depende de la cuenta B.** Las credenciales de la base nueva se emiten
   desde la cuenta A (tabla §3), y con ellas se administran las migraciones, el catálogo, el
   panel y los avisos. De la cuenta B queda una sola cosa alcanzable: la `service_role_key` de
   su proyecto, **solo** dentro de Vercel (marcada como sensible, así que `vercel env pull` la
   devuelve como `[SENSITIVE]`), que además **no sirve para DDL** porque PostgREST no ejecuta
   DDL — el motivo por el que la base nueva se levantó con el SQL Editor y `npm run db:apply-sql`,
   sin ninguna clave del proyecto viejo. Completado el corte de Vercel (pendiente, §6 camino 2)
   ni siquiera esa sigue haciendo falta.
3. **El CI no puede migrar**: no existe el secreto `SUPABASE_ACCESS_TOKEN` en el repo, y
   ningún workflow corre `db:push`. Es el mismo secreto que necesita la comprobación de
   titularidad de la sonda de salud (`npm run check:cuenta`): sin él, cada 6 horas se
   comprueba que la base sea *la referencia esperada*, pero no que esa referencia siga
   siendo de la cuenta A. La sonda lo dice al saltearlo, en vez de dar por bueno lo que no
   comprobó.
4. **Una sola persona con las llaves**: Vercel, GitHub, Supabase, Resend y el buzón del
   dominio dependen de la misma persona. Sin una segunda persona capaz de reemitir, cualquier
   ausencia bloquea el despliegue.

## 6. Plan para que todo dependa solo de `jatf71@gmail.com`

Objetivo: que el proyecto en vivo y sus credenciales queden bajo las cuentas que ya se usan
(`jatf71@gmail.com` / GitHub `jatf71-a11y`), y que la cuenta B deje de ser imprescindible.
Dos caminos, de mejor a peor. El correo listo para enviar está en
[`docs/ticket-supabase-recuperacion.md`](ticket-supabase-recuperacion.md); el camino 2 se apoya en
`DEPLOY.md` (§3 y §6: cómo aplicar migraciones y desplegar).

1. **Soporte de Supabase (conserva todo).** Pedir que, probando titularidad con el buzón de la
   cuenta (`jtorres@catedralpropiedades.com`, que se controla: ahí llega el correo de
   restablecimiento), hagan una de dos cosas: **agregar otro método de ingreso** a la cuenta B
   (email+contraseña, o vincular un GitHub nuevo) o **transferir la organización con el proyecto
   `wcxpkfmevrbjrjlbayba`** a la cuenta `jatf71@gmail.com`. Conserva datos, usuarios de Auth y
   archivos.
   **A dónde exactamente** (canales oficiales, según https://supabase.com/support-policy):
   - **Formulario** (preferido, requiere dashboard): `https://supabase.com/dashboard/support/new`
   - **Correo** (es el camino cuando *no* se puede entrar al dashboard, que es este caso):
     `support@supabase.com`, **enviado desde un correo registrado en la cuenta** →
     `jtorres@catedralpropiedades.com`. Otras casillas: `legal@`, `privacy@`, `abuse@`,
     `security@` (no aplican; un ticket técnico/de cuenta va a `support@`).
   El soporte de **facturación y gestión de cuenta está disponible para todos los clientes**
   (no hace falta plan pago); el soporte técnico limitado sí es solo para proyectos pagos.
2. **Proyecto propio bajo `jatf71@gmail.com` (sin depender de nadie).** **Ejecutado el
   2026-10-14**: las 15 migraciones y el catálogo ya están en `vsqkjimpssdvlvdwrtnh`, verificado
   con `check:schema` y con el portal corriendo contra esa base. Falta el corte de Vercel (una
   clave: `npm run env:secret` → `npm run corte:supabase`, que la comprueba contra la base antes de
   aplicarla y despliega) y la recreación
   de las cuentas de Auth. **Costo aceptado:** los usuarios de Auth no se pueden exportar, así
   que las cuentas se recrean con `npm run accesos:socias`: escribe el rol y la corredora de cada
   una y manda su enlace de acceso por lotes. Nadie restablece contraseñas (el portal no usa:
   se entra con Google o con un enlace al correo); el plan está en
   [runbook-accesos-socias.md](runbook-accesos-socias.md). Detalle y evidencia en
   [recuperacion-base-2026-10-14.md](recuperacion-base-2026-10-14.md).

⚠️ **Restaurar la identidad de GitHub NO es una opción.** La documentación oficial lo dice sin
matices: *«Once your personal account has been deleted, GitHub cannot restore your content»*.
Los 90 días que se citan en foros aplican al **nombre de usuario** y a los **repositorios**
eliminados, no a la cuenta. Y aunque el usuario se pudiera volver a crear con el mismo nombre, no
sirve: Supabase vincula por **identificador** de GitHub, no por nombre ni correo.

## 7. Reglas para no repetir esto

- Toda credencial de producción debe poder **reemitirse desde al menos dos caminos o dos
  personas**. Si solo hay uno, se anota acá como punto único de falla.
- **Nunca** una cuenta de proyecto con un único método de ingreso externo (GitHub/SSO) sin
  email+contraseña alternativo.
- Al crear cualquier cuenta de servicio, se anota en este registro *en el momento*.
- Cada credencial de la tabla §3 se revisa una vez por trimestre: ¿sigue viva?, ¿sigue en su
  lugar?, ¿alguien más puede reemitirla?
- **La pertenencia no se recuerda: se comprueba**, y en dos capas que no son la misma:
  - **En cada respuesta del portal**: el subsistema `supabase_owner` de `GET /api/health` coteja
    —con la URL y con el `ref` que llevan las claves, sin red y sin credenciales— que la base sea
    la del proyecto de la cuenta dueña. Si no lo es, responde `503`, pone en rojo la sonda que
    corre cada 6 horas (`.github/workflows/health-check.yml`) y hace fallar la verificación del
    release. Un despliegue que use otro proyecto a propósito lo declara con
    `SUPABASE_OWNER_PROJECT_REF` y el informe lo anota.
  - **Contra Supabase mismo**: la referencia esperada está escrita en el código, así que por sí
    sola no puede notar que la base **cambie de dueño**. Eso lo pregunta
    `npm run check:cuenta` (`scripts/check-account.mjs`) a la **API de administración** —el único
    camino documentado para saber a qué organización pertenece un proyecto—, y lo dice con
    nombre y correo: qué organización es la dueña y quién figura como dueño de esa organización.
    La sonda de salud lo corre en cada pasada cuando existe el secreto, y lo saltea diciéndolo
    cuando no.
