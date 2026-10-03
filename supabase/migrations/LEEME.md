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
npm run db:push      # aplica lo que falte
npm run db:status    # solo informa (no toca la base)
npm run db:check     # informa y sale 1 si hay pendientes (para el CI)
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
4. **Ampliaciones de esquema, además, en la última migración con `ALTER`.**
   `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya existe, así que una base
   creada con una versión vieja no recibe las columnas nuevas aunque se apliquen
   todas las migraciones. `0011_properties_partner_id.sql` es el ejemplo: en una
   base nueva no hace nada y en una vieja agrega la columna.

`scripts/db-push.test.ts` verifica las cuatro reglas **sobre los archivos
reales**, así que la garantía no depende de que alguien se acuerde al escribir la
próxima. Añadir una migración que no las cumpla hace fallar la suite.

## Si igual prefieres el SQL Editor

Es válido, pero entonces hazlo en orden y uno por uno: cada archivo está pensado
para aplicarse solo, y el bloque de la sección `12` que antes había que buscar
dentro de un archivo de 700 líneas ahora es `0010_signups.sql`. Después conviene
correr `npm run db:status` para ver qué quedó registrado.

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
