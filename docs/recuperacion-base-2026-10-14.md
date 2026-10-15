# Recuperar la base sin la cuenta dueña — 2026-10-14

El 2026-10-13 el proyecto en vivo de Supabase (`wcxpkfmevrbjrjlbayba`) quedó **sin dueño
accesible**: su cuenta era solo-GitHub y ese GitHub fue eliminado. Este documento registra
cómo se levantó la base de nuevo bajo una cuenta propia, qué defectos destapó el camino y qué
queda pendiente. El detalle de identidades y credenciales está en
[registro-cuentas-y-servicios.md](registro-cuentas-y-servicios.md); el ticket a soporte, en
[ticket-supabase-recuperacion.md](ticket-supabase-recuperacion.md).

**Estado: la base nueva está lista y verificada. Falta el corte de Vercel (una clave) y la
recreación de las cuentas de Auth.**

## 1. El punto de partida

| Lo que había | Estado |
|---|---|
| Proyecto **en vivo** `wcxpkfmevrbjrjlbayba` | Sirviendo, pero **sin administración**: la cuenta dueña no tiene puerta de entrada |
| Catálogo del proyecto en vivo | Legible con la clave pública (14 propiedades, 11 corredoras) |
| Esquema del proyecto en vivo | **Atrasado**: sin `properties.rol`, sin `video_url`, con `property_type = 'vip'` |
| Clave de servicio del proyecto en vivo | Solo dentro de Vercel, marcada como sensible: **no se puede leer** |
| Proyecto de la cuenta accesible `vsqkjimpssdvlvdwrtnh` | Pausado, con un esquema de agosto y datos de prueba |

Lo importante del diagnóstico: **el catálogo es público por diseño** (así lo lee el portal), así
que se puede leer sin la cuenta perdida. Lo que no se puede leer son los datos de personas
(`leads`, `signups`, `saved_searches`): RLS los esconde de la clave pública y la única llave que
los ve vive en Vercel marcada como sensible.

## 2. Lo que se hizo

El proyecto de la cuenta accesible pasa a ser la base de producción. El proyecto viejo **no se
toca** (queda como origen de solo lectura).

1. **`.env.local`** apunta al proyecto nuevo. El anterior queda respaldado en
   `.env.local.pre-migracion-2026-10-14` (nunca se borra: es la única copia local de las
   credenciales del proyecto viejo).
2. **Esquema.** Sin token personal de una cuenta con acceso, la CLI no puede aplicar nada, así
   que se generó **un solo archivo** con las 15 migraciones y su registro:

   ```bash
   npm run db:apply-sql            # → .deploy-tmp/migraciones.sql
   ```

   Ese archivo se ejecuta en el **SQL Editor** del dashboard. Va en una transacción (o entra
   todo, o no entra nada) y deja `public.rix7_migrations` al día, así que el próximo
   `db:push`/`db:status` con token sabe exactamente qué está aplicado.
3. **Esquema, verificación.** No hace falta token para comprobarlo:

   ```bash
   npm run check:schema
   # ✓ properties.rol · ✓ properties.video_url · ✓ properties.video_poster
   # ✓ rix7_partner_id() · ✓ get_properties_filtered(bbox)  → «La base soporta el código»
   ```
4. **Datos del catálogo.** Se leen del proyecto viejo con su clave pública y se escriben en el
   nuevo:

   ```bash
   npm run db:copy -- --from-url https://wcxpkfmevrbjrjlbayba.supabase.co \
                     --from-key <clave pública del viejo> --replace
   # (sin token: `--dry-run --out .deploy-tmp/catalogo.sql` y ese SQL al SQL Editor)
   ```

   `--replace` borra **solo** las filas de `partners` y `properties` del destino antes de
   insertar: en el proyecto nuevo había 28 propiedades de prueba con **acentos rotos**
   (`PanorÃ¡mica`), que no queríamos.
5. **Verificación de punta a punta**, con el portal corriendo contra la base nueva:

   ```bash
   curl -s localhost:3111/api/properties?limit=1   # → "source":"supabase", total 14
   curl -s localhost:3111/api/health               # → supabase «configured: true», no crítico
   ```

| Resultado | Antes (proyecto nuevo) | Después |
|---|---|---|
| Migraciones aplicadas | 0 de 15 | **15 de 15**, registradas |
| `properties` | 28 filas de prueba (mojibake) | **14 filas** del catálogo real, acentos correctos |
| `partners` | no existía | **11 corredoras** |
| `property_type` | `vip` ×4 | **`premium` ×4** (vocabulario del código) |
| Columnas que el código usa | faltaban 3 | presentes |
| Buscador (`get_properties_filtered`) | 300 · PGRST203 | **200** |

## 3. Los dos defectos que destapó una base vieja

Ninguno de los dos se ve en una base creada desde cero, y los dos se arreglaron:

1. **`0003_properties.sql` creaba un índice sobre una columna que quizá no existía.** En una
   base donde `properties` ya existía sin `partner_id`, el `CREATE TABLE IF NOT EXISTS` no toca
   la tabla y el `CREATE INDEX … (partner_id)` siguiente fallaba con `42703`, **cortando la
   cadena entera**. El índice se movió a `0011`, junto al `ALTER TABLE` que garantiza la
   columna. Regla nueva en `supabase/migrations/LEEME.md` (nº 5).
2. **`0005_properties_rpc.sql` dejaba dos `get_properties_filtered`.** `CREATE OR REPLACE` solo
   reemplaza si la lista de argumentos es idéntica; con la firma vieja (sin `p_partner_id`) y la
   nueva quedan **dos sobrecargas**, y PostgREST responde `PGRST203` (HTTP 300) a la llamada que
   hace el portal —que solo manda el recuadro del mapa—. El buscador caía en silencio al
   catálogo del código con la tabla llena. La migración ahora suelta la firma vieja antes de
   recrear (excepción documentada a la regla 3), y **`check:schema` lo vigila**: llama al RPC
   como lo llama el portal y un `PGRST203` es un rojo con el nombre de la migración.

## 4. Lo que falta

1. **El corte de Vercel.** Cambiar `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   y `SUPABASE_SERVICE_ROLE_KEY` en los tres entornos y desplegar. Son dos comandos, y ninguna
   clave pasa por la pantalla:

   ```bash
   npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY   # se pega sin eco, va a .env.local
   npm run corte:supabase                                   # comprueba, aplica y despliega
   ```

   `corte:supabase` es el corte entero, con **preflight**: valida que las tres variables tengan
   forma y pertenezcan al proyecto de la URL, sondea la base —la clave de servicio contra
   `/auth/v1/admin/users`, la misma API del panel, y la pública contra el catálogo; las dos son
   de solo lectura—, coteja que el proyecto enlazado en Vercel sea `rix7`, aplica las variables y
   recién ahí despliega y verifica. **Se detiene en el primer fallo**, y el informe dice si Vercel
   llegó a tocarse: si algo falla en el preflight, producción sigue con las claves que ya tenía.

   ```bash
   npm run corte:supabase -- --dry-run      # solo el preflight: sondas sí, Vercel no
   npm run corte:supabase -- --no-deploy    # deja las variables aplicadas, sin publicar
   ```

   Los pasos por separado, si hace falta ver el detalle de cada uno:

   ```bash
   npm run vercel:sync -- --dry-run    # dice qué cambiaría
   npm run vercel:sync                 # lo aplica en los 3 entornos
   npm run deploy:prod                 # las NEXT_PUBLIC_* viajan en el build
   ```

   > **De qué cuenta sale cada clave.** Las tres son del proyecto **nuevo**
   > (`vsqkjimpssdvlvdwrtnh`, cuenta `jatf71@gmail.com`): la URL y la anon key ya están en
   > `.env.local`, y a la service role key le falta este paso. La service role key del
   > proyecto viejo es de la cuenta B y **no** se usa acá. Si en algún momento hace falta un
   > token personal (`db:status`/`db:push`), también se emite desde la cuenta A.

   > **La clave de servicio es obligatoria para el corte.** La del proyecto viejo sirve *para el
   > proyecto viejo*: con la URL nueva y esa clave, `/api/alerts/run` y el panel responden 401.
   > Y al revés: hoy producción funciona entera contra el proyecto viejo, así que **no hay
   > apuro** — el corte se hace cuando la clave nueva esté guardada.

2. **Las cuentas de Auth se recrean: nadie restablece contraseñas.** El portal no usa
   contraseñas —se entra con Google o con un enlace al correo—, así que lo que hay que reponer es
   la cuenta **con su rol y su corredora ya escritos**; si no, la primera en entrar queda de
   Visita y `/socio` le responde «sin corredora vinculada» (migración `0014`). Eso lo hace un
   solo comando, con plan de solo lectura, verificación contra la base y los avisos por lotes:

   ```bash
   npm run accesos:socias                        # plan: no escribe nada
   npm run accesos:socias -- --aplicar --enviar  # crea, vincula y manda el enlace
   ```

   El plan, las fases y lo que queda a mano están en
   [runbook-accesos-socias.md](runbook-accesos-socias.md). Las propiedades que pertenecían a una
   cuenta de Auth se copian **sin ese vínculo** (`properties.user_id`), que **no hace falta
   rehacer**: la política de socio trabaja por `partner_id` (`0014`), así que la corredora
   recupera su stock al quedar vinculada. `--keep-user-id` existe para el caso contrario:
   copiar a una base que ya tiene esas cuentas.
3. **Consultas y altas que no se pudieron leer.** `leads` y `signups` del proyecto viejo
   quedaron fuera por no tener una clave con permiso de lectura. No se pierden: siguen en el
   proyecto viejo. Si el soporte devuelve el acceso, se copian con
   `npm run db:copy -- --tables leads,signups --from-key <clave de servicio del viejo>`.
   Y los usuarios de Auth del viejo se pueden **migrar** entonces —la guía oficial de Supabase
   permite copiar todo el esquema `auth`, hashes incluidos—, con lo que no habría que avisarle a
   nadie: es el camino sin avisos del [runbook](runbook-accesos-socias.md) §7.

## 5. Cómo se repite (o se hace para otro proyecto)

```bash
# 1. Destino nuevo en .env.local (URL + clave pública) y respaldo del anterior
cp .env.local .env.local.pre-migracion
# 2. Esquema: con token, `npm run db:push`; sin token, este archivo al SQL Editor
npm run db:apply-sql
# 3. Comprobar
npm run check:schema
# 4. Datos del origen (clave pública: el catálogo es público por diseño)
npm run db:copy -- --from-url https://<ref-viejo>.supabase.co --dry-run --out .deploy-tmp/catalogo.sql
# 5. Corte y verificación (un solo comando, con preflight y freno en el primer fallo)
npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY
npm run corte:supabase
npm run smoke:prod
# 6. Las cuentas de socias y corredoras (plan, luego aplicar y avisar)
npm run accesos:socias
npm run accesos:socias -- --aplicar --enviar
```

Después del corte, la comprobación en un minuto:

- [ ] `npm run check:schema` → las 5 ✓ contra la URL de producción.
- [ ] `curl -s https://rix7.vercel.app/api/properties?limit=1` → `"source":"supabase"` y `total: 14`.
- [ ] `curl -s https://rix7.vercel.app/api/health` → `supabase` **no** entre los críticos, y
      `service_role` en verde. Y `supabase_owner` —el cotejo de que la base sea la del proyecto de
      la cuenta dueña— tampoco: **antes del corte ese subsistema está en rojo a propósito**,
      porque producción sigue apuntando a `wcxpkfmevrbjrjlbayba` (cuenta B), y la sonda de salud
      del CI lo dice cada 6 horas.
- [ ] `/admin/registros` y `/admin/empresas` abren con la sesión de administración.
- [ ] `npm run accesos:socias` → el plan no deja ninguna persona en «sin corredora»; con
      `--aplicar`, el paso «Verificar» dice que todas tienen rol y corredora.
- [ ] `npm run smoke:prod -- --write --email <tu correo>` → `persisted: true`.
- [ ] Una ficha del catálogo abre con su galería y su video (cuando la publicación tenga video).

## 6. Reglas que dejó el incidente

1. **Ninguna cuenta de proyecto con un solo método de ingreso externo.** GitHub como única
   puerta es exactamente lo que falló.
2. **Toda credencial de producción se reemite desde dos caminos o dos personas.** Si no, se
   anota como punto único de falla en el registro.
3. **La aplicación no debe depender de una cuenta, sino de un proyecto.** Repuntar la URL y las
   claves es un corte de 10 minutos; recuperar una cuenta puede no tener solución.
4. **El catálogo es público y por eso se puede rescatar.** Los datos de personas, no: para esos
   hace falta una llave, y por eso el registro de credenciales existe.
