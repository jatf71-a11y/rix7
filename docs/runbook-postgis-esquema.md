# 🧭 Runbook — PostGIS fuera de `public` (aviso crítico del Security Advisor)

**Aviso recibido:** 2026-10-17 · *«Table publicly accessible — `rls_disabled_in_public`»*
**Proyecto:** `rix7-portal` (`vsqkjimpssdvlvdwrtnh`, producción desde el 2026-10-15).

## Estado (2026-10-21): ticket enviado

Enviado por el formulario del dashboard desde la cuenta `jatf71@gmail.com`
(nombre visible `jatf71-a11y`), con proyecto `rix7-portal`. Confirmación del
sitio: *«Support request sent — Your ticket has been logged for rix7-portal.
We'll reach out at jatf71@gmail.com»*. Quedó con tipo **Other**, severidad
**Normal** y la casilla **«Allow support access to your project»** activada (la
necesitan para ejecutar SQL como `supabase_admin`). La respuesta llega a
`jatf71@gmail.com`; cuando actúen, se verifica con la sección de abajo.

Comprobado justo después de enviarlo: PostGIS sigue en `public` (3.3.7),
`spatial_ref_sys` sigue con RLS deshabilitado y `anon` la lee con `200`. Es
decir, **la alerta sigue abierta** hasta que Support ejecute el traslado.

### Respuesta automática de Support (2026-10-21)

Llegó el acuse automático: confirma el diagnóstico (PostGIS en `public`,
dueño `supabase_admin`, sólo el dueño puede habilitar RLS o revocar) y propone
**bajar y volver a crear** la extensión en `extensions`, con copia previa. No
oferta el traslado asistido que pedimos.

### Ticket SU-518175 (2026-10-21)

Al responder el hilo llegó un segundo acuse genérico con el número de ticket
**SU-518175**. No es una respuesta: no trae diagnóstico ni compromiso de plazo.
Avisa que el proyecto está en **Free**, que ese plan no tiene respuesta
garantizada y que los correos directos se tratan como tickets de Free; para
priorizar por plan hay que usar el formulario del dashboard o `supabase.help`
(el pedido original ya salió por el formulario, así que está bien encauzado).

Conclusión práctica: **no conviene esperar a Support para decidir**. El riesgo
sigue siendo de integridad (escritura abierta sobre `spatial_ref_sys`), no de
fuga de datos del portal, y los dos exports previos ya están hechos. Si al
**viernes 23 de octubre** no hay una respuesta humana que acepte la Vía A o A2,
ejecutar la **Vía B** en una ventana sin escrituras, con esos exports como
respaldo. Si Support contesta después, el traslado ya no hace falta: la
extensión estará en `extensions` y el aviso habrá desaparecido.

Dato que cambia la balanza: el proyecto está en **Free y no tiene backups**
(Database → Backups: «Free Plan does not include project backups»). Un
`DROP EXTENSION ... CASCADE` sin copia del lado de Supabase no es aceptable.

Antes de cualquier cambio se hizo un **export lógico** (ignorado por git):

- `.deploy-tmp/backup-pre-postgis-2026-10-21.json` — las 11 tablas
  (`properties` 49, `partners` 11, `share_views` 2, `property_views` 3,
  `rix7_migrations` 18; el resto vacías).
- `.deploy-tmp/coords-postgis-2026-10-21.json` — `id`, `lat`, `lng` de las 49
  propiedades, para restaurar `location` sin depender del EWKB.

Requisitos del lado de la app, ya verificados: los dos RPC espaciales
(`get_properties_filtered`, `get_property_by_id`) usan
`search_path = public, extensions`; la única columna `geography` es
`properties.location`; no hay triggers. Un traslado no requiere cambios de
código.

**Respondido el 2026-10-21**: se contestó el mismo hilo desde
`jatf71@gmail.com` pidiendo el traslado asistido (Vía A), aclarando que no hay
backups y que los RPC ya usan `search_path = public, extensions`. Ese envío
generó el ticket **SU-518175**. Queda pendiente la respuesta de una persona;
por el plan Free no hay plazo garantizado, así que la fecha límite es la de
arriba (viernes 23 de octubre) y después va la Vía B con los dos exports.

### Aviso automático del plazo (2026-10-21)

La espera no depende de que alguien se acuerde: `scripts/check-postgis.mjs`
consulta cada 6 horas, desde el workflow **Salud de producción**, si
`public.spatial_ref_sys` sigue expuesta. Esa consulta es de solo lectura (la
clave pública que ya viaja en el bundle) y tiene tres veredictos:

| Estado | Qué hace |
|---|---|
| `404` / `PGRST205` | `✓` el aviso está cerrado. Si había un issue abierto, se cierra solo. |
| `200` y **antes** del plazo | `·` en espera. **Verde a propósito**: la tabla expuesta es el estado esperado mientras se espera a Support. |
| `200` y **pasado** el plazo | `✗` dispara el rojo, el issue y el correo: hay que ejecutar la Vía B. |

El plazo es **viernes 2026-10-23, 18:00 en Chile** (`2026-10-23T21:00:00Z`).
Con el cron de las 00/06/12/18 UTC, el primer aviso cae el sábado 24 a las
00:00 UTC. Si Support da otra fecha, se mueve **sin tocar código** definiendo la
variable de repositorio `POSTGIS_DEADLINE` (Settings → Secrets and variables →
Actions → Variables); vacía o ausente, vale la fecha de arriba.

Desde la terminal:

```bash
npm run check:postgis                                    # contra la base real
npm run check:postgis -- --now 2026-10-24T00:00:00Z      # simular que el plazo venció
npm run check:postgis -- --deadline 2026-10-30T21:00:00Z # mover el disparador
npm run check:postgis -- --json
```

Salida: `0` cerrado o en plazo · `1` plazo vencido y sigue en `public` · `2` no se
pudo sondear (sin URL, sin clave o respuesta inentendible), que **no** es un
«está bien».

Lo que la sonda **no** distingue: si Support aplica la **Vía A2** (RLS y
escrituras revocadas), la tabla sigue siendo legible por `anon`, así que la
sonda la ve expuesta y, pasado el plazo, avisa igual. Es deliberado —A2 cierra
la alerta crítica pero no es el arreglo, y el traslado sigue pendiente— y el
informe del issue lo dice con esas palabras para que el rojo no se lea como
«Support no hizo nada».

## Qué pasa

PostGIS se instaló en el esquema **`public`** (`CREATE EXTENSION postgis;` sin
`WITH SCHEMA`, en `0001_extension_postgis.sql`). PostGIS crea su tabla de
sistemas de referencia, `public.spatial_ref_sys`, en el esquema donde se
instala, y `public` es el esquema que la Data API expone:

- `anon` y `authenticated` tienen **SELECT, INSERT, UPDATE y DELETE** sobre
  `spatial_ref_sys` (PostGIS se los concede a `PUBLIC`).
- La tabla **no tiene RLS**, así que el Security Advisor la marca como crítica
  en cada revisión.

Comprobado contra la base real (solo lectura salvo el `PATCH`/`DELETE` con
filtro que no matchea ninguna fila):

| Prueba (clave pública) | Resultado |
|---|---|
| `GET /rest/v1/spatial_ref_sys?select=srid&limit=2` | `200` con filas |
| `PATCH /rest/v1/spatial_ref_sys?srid=eq.-999999` (`{}`) | `200` — la escritura está permitida |
| `DELETE /rest/v1/spatial_ref_sys?srid=eq.-999999` | `200` — el borrado está permitido |

Las tablas del portal **no** están afectadas: `leads`, `saved_searches`,
`signups`, `rix7_migrations` responden `[]` a `anon`, y `properties` /`partners`
solo lo público. El aviso es por la tabla de PostGIS, no por datos del negocio.

## Qué riesgo tiene (y qué no)

- **No hay exposición de datos del portal.** `spatial_ref_sys` guarda las
  definiciones de los SRID (EPSG), no filas de propiedades ni contactos.
- **Sí hay riesgo de integridad.** Con escritura abierta se pueden corromper o
  borrar definiciones de proyecciones; `ST_Transform` y cualquier cálculo que
  dependa de un SRID pueden empezar a fallar. Es una denegación de servicio
  sobre las consultas espaciales, no una fuga.

## Por qué no se arregla con RLS

`ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY` **no es la
salida**: la tabla pertenece a la extensión y el rol `postgres` del proyecto no
es su dueño, así que no puede habilitarlo ni revocar los `GRANT` que PostGIS
hizo a `PUBLIC`.

Verificado el 2026-10-21 contra la base real: la tabla y la extensión
(`PostGIS 3.3.7`, en `public`) tienen dueño **`supabase_admin`**; `postgres` no
es miembro de ese rol y `SET ROLE supabase_admin` responde `42501 permission
denied`. Es decir, ni RLS ni `REVOKE` se pueden ejecutar con las credenciales
del proyecto: hace falta que lo haga Support (superusuario) o el procedimiento
oficial.

Tampoco sirve `ALTER EXTENSION postgis SET SCHEMA extensions`: desde PostGIS
2.3 la extensión **no es relocalizable**. Lo documenta Supabase en
[PostGIS → Troubleshooting](https://supabase.com/docs/guides/database/extensions/postgis#security-advisor-flags-publicspatial_ref_sys)
junto con las dos vías de abajo.

## Vía A — Supabase Support (recomendada, sin downtime)

Es la única que mueve la extensión sin tocar los datos. **Ya enviada el
2026-10-21** (ver Estado arriba), desde
**Dashboard → Support → New request** (o `support@supabase.com` desde el correo
de la cuenta dueña), con el proyecto `vsqkjimpssdvlvdwrtnh`.

**Asunto**

    Mover la extensión PostGIS de public a extensions (Security Advisor: spatial_ref_sys)

**Mensaje**

```
Hola:

El Security Advisor de mi proyecto en producción marca como crítica la tabla
public.spatial_ref_sys («Table publicly accessible», rls_disabled_in_public).
PostGIS quedó instalada en el esquema public y esa tabla no se puede proteger
con RLS porque pertenece a la extensión, no al rol postgres.

Les pido que ejecuten el procedimiento documentado para mover PostGIS al
esquema extensions sin recrear la extensión:

BEGIN;
UPDATE pg_extension SET extrelocatable = true WHERE extname = 'postgis';
ALTER EXTENSION postgis SET SCHEMA extensions;
ALTER EXTENSION postgis UPDATE TO "<POSTGIS_VERSION>next";
ALTER EXTENSION postgis UPDATE;
UPDATE pg_extension SET extrelocatable = false WHERE extname = 'postgis';
COMMIT;

El proyecto es rix7-portal (ref vsqkjimpssdvlvdwrtnh, región sa-east-1). La
tabla public.properties tiene una columna geography que depende de la
extensión, así que por favor confirmen antes de ejecutar si hace falta ventana
de mantenimiento; puedo coordinarla.

Gracias.
```

Pedir que confirmen la versión exacta de PostGIS (`<POSTGIS_VERSION>`) y que
avisen al terminar. No hace falta pegar claves ni tokens: el pedido va desde una
cuenta con acceso al proyecto.

## Vía A2 — mitigar sin mover la extensión (también vía Support)

Si Support prefiere no tocar la extensión, la alternativa es que ellos
(superusuario) habiliten RLS en `public.spatial_ref_sys`, revoquen
`INSERT/UPDATE/DELETE` a `anon` y `authenticated`, y dejen una política de
`SELECT` (PostGIS la lee en `ST_Transform`). Cierra la alerta **crítica** sin
mover nada y es reversible, pero deja la tabla expuesta para lectura y suele
aparecer el aviso menor de «política siempre verdadera». Es un parche, no el
arreglo: el traslado a `extensions` sigue siendo lo correcto.

## Vía B — hacerlo uno mismo (con downtime y copia previa)

Solo si Support no responde y el aviso urge. **Pierde la columna
`properties.location`**, que es donde viven las coordenadas: `DROP EXTENSION
postgis CASCADE` se lleva la columna, su índice GiST y los RPC que la usan. Por
eso el paso 1 no es opcional, y la app debe quedar **sin escrituras** (modo
mantenimiento o `deploy` detenido) entre los pasos 3 y 5: una publicación creada
en ese hueco no tendría dónde guardar sus coordenadas.

1. **Copia de la base**: Dashboard → Database → Backups (o `supabase db dump`
   con la contraseña de la base). Verificar que el dump incluye
   `public.properties` **con datos**.
2. Guardar las coordenadas aparte, ya que no hay columnas `lat`/`lng`:
   ```sql
   create table public.properties_coords_backup as
   select id, extensions.st_y(location::extensions.geometry) as lat,
              extensions.st_x(location::extensions.geometry) as lng
   from public.properties;

   -- La copia también vive en public: sin RLS repetiría el mismo aviso.
   alter table public.properties_coords_backup enable row level security;
   ```
3. Recrear la extensión:
   ```sql
   drop extension postgis cascade;
   create schema if not exists extensions;
   create extension postgis with schema extensions;
   ```
4. Restaurar la columna y su índice (los `CREATE TABLE IF NOT EXISTS` de las
   migraciones **no** la vuelven a agregar, porque la tabla ya existe — es la
   trampa que describe `supabase/migrations/LEEME.md`, regla 5):
   ```sql
   alter table public.properties
     add column if not exists location extensions.geography(point, 4326);
   update public.properties p
      set location = extensions.st_setsrid(
            extensions.st_makepoint(b.lng, b.lat), 4326)::extensions.geography
     from public.properties_coords_backup b
    where b.id = p.id and p.location is null;
   alter table public.properties alter column location set not null;
   create index if not exists idx_properties_location_gist
     on public.properties using gist (location);
   ```
5. Recrear los RPC: `npm run db:push` (necesita `SUPABASE_ACCESS_TOKEN`) o
   pegar `0005_properties_rpc.sql` en el SQL Editor. Sin ellos,
   `/api/properties` y la ficha dejan de traer las fichas de la base.
6. Borrar la tabla temporal cuando todo esté verificado:
   `drop table public.properties_coords_backup;`

## Verificación (después de A o B)

En el SQL Editor:

```sql
select n.nspname as esquema, c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relname in ('spatial_ref_sys', 'geometry_columns', 'geography_columns');
-- Esperado: esquema = extensions en las tres (relrowsecurity ya no importa:
-- el linter solo mira public). De paso desaparecen de la Data API.

select count(*) as propiedades,
       count(location) as con_coordenadas
from public.properties;
```

Con la clave pública, desde el repo:

```bash
# Debe dar 404 (la tabla ya no está expuesta), no 200
curl -s -o /dev/null -w '%{http_code}\n' \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/spatial_ref_sys?select=srid&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

Y el portal:

```bash
npm run check:schema      # los objetos que usa el código
curl -s https://rix7.cl/api/properties | head -c 200   # "source":"supabase"
```

El aviso del Security Advisor puede tardar en desaparecer hasta la siguiente
revisión; lo que manda es el `select` de arriba.

## Lo que ya quedó arreglado en el repo

- `0001_extension_postgis.sql` crea la extensión **con `WITH SCHEMA
  extensions`** y el esquema si no existe: una base nueva ya no repite el
  problema. En la base actual ese archivo es un no-op (`CREATE EXTENSION IF NOT
  EXISTS` no mueve una extensión existente), por eso el traslado va aparte.
- `0003_properties.sql` fija `search_path = "$user", public, extensions`
  mientras crea la tabla, para que `GEOGRAPHY` resuelva en una base nueva
  (extensión en `extensions`) y en una vieja (extensión en `public`). No se
  califica el tipo con el esquema a propósito: `CREATE TABLE IF NOT EXISTS`
  resuelve los tipos **antes** de comprobar si la tabla existe, así que
  `extensions.geography` rompería la reaplicación en esta base.
- `scripts/db-push.test.ts` vigila las dos reglas sobre los archivos reales:
  toda extensión declara esquema (y no `public`), y toda tabla de `public` tiene
  su `ENABLE ROW LEVEL SECURITY` en alguna migración.
