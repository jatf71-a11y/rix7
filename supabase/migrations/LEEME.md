# Migraciones de la base

Un archivo por cambio de esquema, numerado, **idempotente** y aplicable por
línea de comandos. Reemplazan al `schema.sql` monolítico que había que pegar a
mano en el SQL Editor del dashboard.

```
0001_extension_postgis.sql
0002_partners.sql
0003_properties.sql
...
```

## Aplicarlas

```bash
npm run db:push        # aplica lo que falte
npm run db:status      # solo informa (no toca la base)
npm run db:check       # informa y sale 1 si hay pendientes (para el CI)
npm run check:schema   # contra la base real: ¿está aplicado? (no necesita token)
npm run db:apply-sql   # sin token: genera el SQL para pegar en el SQL Editor
```

Necesitan `SUPABASE_ACCESS_TOKEN` (un token personal de
<https://supabase.com/dashboard/account/tokens>), que se puede dejar en
`.env.local`. La referencia del proyecto se deduce de `NEXT_PUBLIC_SUPABASE_URL`;
si usas un dominio propio, pásala con `--ref` o en `SUPABASE_PROJECT_REF`.

El script usa la API de administración de Supabase
(`POST /v1/projects/<ref>/database/query`) —la misma puerta que el SQL Editor—
así que no hace falta `psql`, ni Docker, ni pegar nada en el navegador. Ese
endpoint está marcado como **beta**, así que puede cambiar: por eso los archivos
siguen el formato estándar de migraciones y la alternativa oficial
`npx supabase db push` los lee **tal cual**. Si algún día el script deja de
funcionar, no hay que reescribir ninguna migración, solo aplicar con la CLI.

## Qué ya se aplicó

Se registra en la tabla `public.rix7_migrations` (versión, nombre, huella y
fecha), con RLS habilitado y sin políticas: nadie la lee por la API pública. Eso
permite que `db:status` responda «¿la base está al día?» en lugar de tenerlo que
adivinar, y que `db:push` no repita trabajo.

Si un archivo ya aplicado se edita, la huella cambia y `db:push` lo vuelve a
aplicar (son idempotentes) avisando en el informe: la promesa es que la base
quede igual que los archivos, y una migración editada es una base desactualizada
aunque su número ya esté registrado.

## Reglas para escribir una nueva

1. **Numera con el siguiente número**, sin huecos: `0012_mi-cambio.sql`.
2. **Que se pueda aplicar dos veces.** `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, y **toda política
   con su `DROP POLICY IF EXISTS` inmediatamente antes**.
3. **Que no borre datos.** `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` y `DELETE` no
   están permitidos: el punto de poder aplicarlas sin preguntar es que solo
   agregan. Si alguna vez hace falta una operación destructiva, va aparte, a
   mano y con una copia de seguridad.
   **Única excepción: `DROP FUNCTION` de una firma obsoleta**, siempre que el
   mismo archivo vuelva a crear la función (`0005` lo hace con la firma vieja de
   `get_properties_filtered`). No es un dato: es la única forma de deshacer una
   sobrecarga, porque `CREATE OR REPLACE` solo reemplaza cuando la lista de
   argumentos es idéntica. El test que vigila esta regla acepta `DROP POLICY` y
   `DROP FUNCTION` —y exige que la función se recree— y sigue rechazando el
   resto.
4. **Ampliaciones de esquema, además, en la última migración con `ALTER`.**
   `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya existe, así que una base
   creada con una versión vieja no recibe las columnas nuevas aunque se apliquen
   todas las migraciones. `0011_properties_partner_id.sql` es el ejemplo: en una
   base nueva no hace nada y en una vieja agrega la columna.
5. **Nada en un archivo puede depender de una columna que ese mismo archivo
   quizá no creó.** Si la tabla ya existía, el `CREATE TABLE IF NOT EXISTS` se
   saltea y cualquier sentencia siguiente sobre una columna nueva —un
   `CREATE INDEX`, un `GRANT`, un `UPDATE`— falla y **corta la cadena entera**.
   Por eso todo lo que toca una columna nueva va junto al `ALTER` que la agrega
   (`0011` crea la columna *y* su índice), no en el archivo de la tabla.

6. **Grants explícitos en `public`.** Desde el **2026-10-30** Supabase deja de
   conceder la Data API automáticamente a las tablas nuevas: toda tabla que cree
   una migración necesita su `GRANT`. El mínimo es `SELECT` para `anon`, DML
   para `authenticated` y `service_role`, y **nunca `ALL`** (incluye `TRUNCATE`,
   que no pasa por RLS). `0019_grants_data_api.sql` concede las diez actuales; si
   agregás una tabla, poné sus grants en el mismo archivo que la crea.

`scripts/db-push.test.ts` verifica estas reglas **sobre los archivos reales**,
así que la garantía no depende de que alguien se acuerde al escribir la
próxima. Añadir una migración que no las cumpla hace fallar la suite.

## Si no hay token: el SQL Editor, con un archivo generado

`db:push` necesita un token **de una cuenta con acceso al proyecto**. Cuando esa
cuenta no está (el proyecto es de otra persona y no hay forma de entrar), queda el
SQL Editor del dashboard — pero no conviene ir archivo por archivo: son todas y
el orden importa.

```bash
npm run db:apply-sql          # → .deploy-tmp/migraciones.sql
npm run db:apply-sql -- --stdout      # o por la salida, para tuberías
```

Ese archivo trae el libro de migraciones primero, cada migración y **su registro
pegado al lado**, y todo dentro de una transacción. Se pega entero en el SQL
Editor y se ejecuta: o entra completo, o no cambia nada. Al terminar, la base
queda igual que con `db:push` —incluido `public.rix7_migrations`—, así que el
primer `npm run db:status` que se corra con token dirá que está al día en vez de
intentar todo de nuevo.

Comprobar no necesita token: `npm run check:schema` lee la base real con la clave
pública y dice qué falta.

## Historia

- `schema.sql` y `migracion-partner-id.sql` **se retiraron** en favor de esta
  carpeta. El reparto conserva línea por línea el contenido del esquema anterior
  (verificado con una comparación de sentencias) y solo agrega seis
  `DROP POLICY IF EXISTS` que faltaban en las políticas de `properties` y de
  Storage: sin ellos, la segunda ejecución del archivo fallaba con «policy
  already exists».
- El orden cambió: `partners` (0002) va **antes** de `properties` (0003) porque
  `properties.partner_id` tiene clave foránea contra esa tabla. El archivo
  monolítico las creaba al revés, así que no podía crear una base desde cero.
