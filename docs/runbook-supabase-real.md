# 🔌 Runbook — pasar Supabase de placeholder a real en producción

Hoy producción corre con el **proyecto placeholder** (`NEXT_PUBLIC_SUPABASE_URL`
apuntando a `https://placeholder-project.supabase.co`). Consecuencia medible:
`/api/registro` y `/api/leads` responden **503**, el alta no se guarda y
`GET /api/health` marca `supabase` como **crítico**.

Este runbook lleva de ese estado a una base real, sin sorpresas. Al terminarlo:

- `GET /api/health` deja de listar `supabase` entre los críticos.
- `/api/registro` y `/api/leads` responden 201/200 en lugar de 503.
- Las altas **persisten** en `public.signups` y quedan visibles en `/admin/registros`.

Tiempo estimado: **30–45 min**, casi todo esperando la creación del proyecto y el build.

---

## 0. Antes de empezar

| Necesitas | Dónde |
|---|---|
| Cuenta de Supabase | <https://supabase.com> |
| Token personal de Supabase | <https://supabase.com/dashboard/account/tokens> → **Generate new token** |
| Acceso al proyecto en Vercel (`rix7`) | Settings → Environment Variables |
| CLI de Vercel autenticado | `npx vercel whoami` debe responder tu usuario |
| El repo clonado con `.env.local` a mano | raíz del proyecto |

> **Cuidado con el orden.** Las credenciales públicas (`NEXT_PUBLIC_*`) se
> **incrustan en el build**: cambiarlas en Vercel **no basta**, hay que
> **volver a desplegar**. En este proyecto el deploy es `npm run deploy` (para
> solo republicar el árbol con su identificador, `npm run deploy:prod`). Un
> `git push` a `main` **sí** publica y mueve el alias de `rix7.cl`, pero lo hace
> **sin el identificador de la build**: no sirve para dar un cambio de variables
> por hecho (ver [`AGENTS.md`](../AGENTS.md)).

---

## 1. Crear el proyecto Supabase

1. <https://supabase.com/dashboard/new> → **New project**.
2. **Región: `South America (São Paulo)`.** Es la más cercana a las funciones de
   Vercel (`gru1`, São Paulo): las funciones deben correr junto a la base, no
   junto a las personas.
3. Genera una contraseña de base fuerte y guárdala en tu gestor (no la pega en
   este repo: el acceso de la app no la usa, va por las API keys).
4. Espera a que el proyecto quede **Active** (~2 min).

---

## 2. Obtener las tres credenciales

En el dashboard del proyecto → **Project Settings → API**:

| Valor | Dónde | Va a |
|---|---|---|
| **Project URL** | `https://<ref>.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL` (Vercel **y** `.env.local`) |
| **Publishable** key (`sb_publishable_…`) | Settings → **API Keys** | `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel **y** `.env.local`) |
| **Secret** key (`sb_secret_…`) | Settings → **API Keys** (**Reveal**) | `SUPABASE_SERVICE_ROLE_KEY` (**solo** Vercel, sin `NEXT_PUBLIC_`) |

Anota también la **ref** del proyecto: es el `<ref>` de la URL.

> **Llaves nuevas vs clásicas.** Los proyectos creados hoy **ya no traen** `anon`
> ni `service_role` (JWT largo que empieza por `eyJ`): Supabase las retiró para
> proyectos nuevos y las deprecia a fines de 2026. En su lugar hay **publishable**
> (`sb_publishable_…`, ocupa el lugar de la anon) y **secret** (`sb_secret_…`, el
> de la service_role). El SDK del proyecto (`@supabase/supabase-js` ≥ 2.115) y el
> validador de `db:push` ya aceptan las nuevas. Si en el panel todavía aparece la
> pestaña **Legacy API keys**, esas llaves también sirven. Las variables del
> proyecto conservan el nombre histórico (`..._ANON_KEY`, `..._SERVICE_ROLE_KEY`).

> La `service_role` **salta RLS**: es la que necesita el job de alertas para leer
> las búsquedas de todas las personas. Nunca lleva prefijo `NEXT_PUBLIC_` y
> nunca se comitea.
>
> Quien impide que se comite es la **guardia de secretos**: corre sola antes de
> cada `git commit`, antes de `npm run dev` y antes de `npm run deploy:prod`, y
> también es el primer job de CI. Se llama a mano con `npm run check:secrets`.
> Detalle en [runbook-guardia-de-secretos.md](runbook-guardia-de-secretos.md).

---

## 3. Poner las credenciales en `.env.local` (para migrar desde tu máquina)

Edita `.env.local` en la raíz:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...   # o la anon clásica (eyJ...)

# Token personal, solo para aplicar migraciones. NO va a Vercel.
# Se emite desde la cuenta **dueña del proyecto de la URL de arriba**: la API de
# administración solo ve los proyectos de la cuenta del token. Hoy esa cuenta es
# jatf71@gmail.com y el proyecto, vsqkjimpssdvlvdwrtnh
# (registro-cuentas-y-servicios.md §3).
SUPABASE_ACCESS_TOKEN=sbp_...
```

**Qué NO dejar:** el detector de `scripts/check-auth-config.mjs` rechaza
cualquier URL o llave que contenga `placeholder`, y exige que la llave pública
empiece por `sb_publishable_` (nueva) o `eyJ` (clásica). Ese chequeo es el que
evita que producción "parezca configurada" sin estarlo.

---

## 4. Aplicar las migraciones

Las migraciones son **numeradas e idempotentes** en `supabase/migrations/`. Se
aplican con el token, sin pegar nada en el dashboard:

```bash
npm run db:status     # muestra qué falta. No toca nada. Sale 1 si hay pendientes.
npm run db:push       # aplica lo que falte, en orden, y lo registra
npm run db:status     # ahora todo debe salir aplicado
```

Qué deja la base al terminar: extensión `postgis`, `partners`, `properties`
(+ índices GiST/B-Tree), los RPC `get_properties_filtered` y
`get_property_by_id`, políticas RLS, el bucket `properties-media` y las tablas
`leads`, `saved_searches`, `favorites`, `share_views`, `share_events`,
`property_views`, `solicitudes` y **`signups`** (esta última es la que faltaba y
por eso el alta no persistía). `0019` agrega los `GRANT` explícitos de la Data
API que Supabase deja de conceder sola desde el 2026-10-30.

`db:push` se detiene en el primer error y registra cada migración aplicada en
`public.rix7_migrations`, así que re-ejecutarlo es seguro. Verifica:

```sql
SELECT name, applied_at FROM public.rix7_migrations ORDER BY name;
```

### Estado verificado el 2026-10-21 (después de `0019`)

La base quedó en **19 migraciones** (`0001 … 0019`), `npm run db:status` dice
«al día» y `npm run check:schema` sale verde con los ocho objetos que usa el
código.

Lo que `0019` **no** hace —y conviene tener presente— es retirar los grants
viejos. Medido ese mismo día contra `information_schema.role_table_grants`, las
diez tablas del portal siguen con los siete privilegios
(`SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`) para `anon`,
`authenticated` y `service_role`: son los que Supabase concedía sola al crear
cada tabla. Hoy lo que protege las filas es **RLS**, no la lista de grants;
`TRUNCATE` no se alcanza por PostgREST (no tiene ruta HTTP) y `UPDATE`/`DELETE`
de `anon` no tienen política que los permita.

Dejar la base en lo mínimo que el portal usa requiere una migración que
**revoque** lo que sobra. No está hecha: es un cambio de privilegios sobre
producción y merece su propia ventana y su propia medición antes/después.

> **Sin token** (el proyecto es de otra persona, o todavía no hay token):
> `npm run db:apply-sql` genera **un solo archivo** con todas las migraciones y su
> registro, para pegar entero en el SQL Editor. Va en una transacción y deja
> `public.rix7_migrations` al día, así que después `npm run db:status` (con
> token) dice «al día» en vez de repetir todo. No hace falta ir archivo por
> archivo. Ver [recuperacion-base-2026-10-14.md](recuperacion-base-2026-10-14.md).

---

## 5. Sembrar el catálogo y las corredoras

`supabase/seed.sql` **no** lo aplica la CLI: hay que ejecutarlo a mano en el
**SQL Editor** (Project → SQL Editor → New query → pegar → Run).

```sql
SELECT count(*) FROM public.properties;   -- > 0 tras el seed
SELECT count(*) FROM public.partners;     -- las corredoras inscritas
```

Sin esto la tabla `properties` queda **vacía**: el listado funciona (cae al
catálogo nacional en memoria) pero las fichas reales no aparecen.

---

## 6. Poner las variables en Vercel y desplegar

**Vercel → proyecto `rix7` → Settings → Environment Variables.** Agrega cada una
a **Production, Preview y Development**:

| Variable | Obligatoria | Notas |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | El Project URL real |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | La **publishable** key (o la anon clásica) |
| `SUPABASE_SERVICE_ROLE_KEY` | recomendada | Server-only, para el job de alertas |
| `NEXT_PUBLIC_SITE_URL` | ya está | `https://rix7.cl` |

Luego **despliega** para que el build tome las claves nuevas:

```bash
npm run deploy:prod       # republica con el identificador; el push no lo inyecta
```

> **Todo junto y con preflight.** Reemplazar las tres variables de un proyecto por
> las de otro —el corte de base— se hace en un solo comando:
>
> ```bash
> npm run corte:supabase -- --dry-run   # solo comprueba: sondea la base con cada clave
> npm run corte:supabase                # comprueba, aplica y despliega
> ```
>
> Antes de tocar Vercel valida la forma y la pertenencia de las tres variables,
> sondea `/auth/v1/admin/users` con la clave de servicio (un 403 significa que se
> copió la pública) y el catálogo con la pública, y coteja que el proyecto enlazado
> sea `rix7`. **Se detiene en el primer fallo**: si algo falla antes de aplicar,
> Vercel no se toca y producción sigue igual.


Espera el alias a `https://rix7.vercel.app` (~2 min).

---

## 7. Verificar

### 7.1 Los dos chivatos baratos

```bash
curl -s https://rix7.vercel.app/api/health    | head -40
curl -s "https://rix7.vercel.app/api/properties?limit=3" | head -c 300
npm run check:schema            # contra la base real: ¿está aplicado? (solo clave pública)
```

En `/api/health`, `supabase` debe **desaparecer de la lista de críticos** (el
endpoint responde 200 en vez de 503). En `/api/properties`, la respuesta debe
traer `"source":"supabase"` — si dice `national_catalog`, las claves no llegaron
al build (¿olvidaste redeployar?) o son inválidas.

### 7.2 La prueba de humo

```bash
npm run smoke:prod                              # solo mira; no escribe nada
npm run smoke:prod -- --write --email tu@correo.cl
```

El modo `--write` da un alta de prueba real y comprueba que **persista**:
debe reportar `persisted: true`. Si dice `persisted: false`,
`npm run db:status` (o el bloque de `0010_signups.sql`) es lo que falta.

### 7.3 En el navegador

Abre `https://rix7.vercel.app/admin/registros`: la fila de prueba
«Prueba de humo (no es una persona)» tiene que aparecer.

---

## 8. Limpieza

1. **Borra la fila de prueba** (la tabla es solo-anexa: el panel no borra filas
   de a una con un clic en todas las versiones, así que hazlo por SQL):

   ```sql
   DELETE FROM public.signups WHERE name = 'Prueba de humo (no es una persona)';
   ```

2. **Revoca el token personal** si ya no lo vas a usar para migrar:
   <https://supabase.com/dashboard/account/tokens> → revocar `sbp_...`.
   Quítalo también de `.env.local`.

---

## 9. Rollback (volver al placeholder)

Solo si hay que sacar producción del aire con la base por delante:

1. En Vercel, restaura el valor placeholder de `NEXT_PUBLIC_SUPABASE_URL` /
   `..._ANON_KEY`.
2. `npm run deploy:prod`.
3. La app vuelve al catálogo nacional en memoria y los POST responden 503 —
   igual que hoy.

El **build de Vercel** también se puede revertir desde Deployments → menú `⋯` →
**Instant Rollback** (instantáneo, no recompila).

---

## 10. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `/api/health` sigue con `supabase` crítico tras desplegar | Variables mal pegadas o solo en Production (falta Preview/Development), o no se redeployó | Revisa los 3 entornos y `npm run deploy:prod` |
| `/api/properties` → `"source":"national_catalog"` | Igual que arriba, o el proyecto Supabase está pausado | Reactiva el proyecto en el dashboard |
| `corte:supabase` → «403 — la clave es válida pero no tiene permiso de administración: es la anon key» | En `.env.local` quedó la clave pública en el lugar de la de servicio | Copiá la **service_role** (Project Settings » API, pestaña *Legacy API keys* si tus claves son JWT) y guardala con `npm run env:secret -- --name SUPABASE_SERVICE_ROLE_KEY` |
| `db:push` → «Falta SUPABASE_ACCESS_TOKEN» | Token ausente en `.env.local` | Genera uno en supabase.com/dashboard/account/tokens **desde la cuenta dueña del proyecto** (hoy `jatf71@gmail.com`) y ponlo en `.env.local` (nunca en Vercel) |
| `db:push` → «No se pudo deducir la referencia» | `NEXT_PUBLIC_SUPABASE_URL` no tiene la ref, **o el token es de otra cuenta** (la API de administración solo ve los proyectos de la cuenta del token) | Pasa `--ref <ref>` o define `SUPABASE_PROJECT_REF`; si el token es de otra cuenta, emite uno desde la dueña del proyecto |
| Alta aceptada pero `persisted: false` | Falta la migración `0010_signups.sql` | `npm run db:push` |
| Detalle 404 de propiedades que existen | Falta el RPC `get_property_by_id` | `npm run db:push` (lo crea `0005_properties_rpc.sql`) |
| `/api/properties` con **0 propiedades** y la tabla llena | La base vieja tenía `get_properties_filtered` sin `p_partner_id`: quedaron **dos firmas** y PostgREST responde `PGRST203` (300) | `npm run db:push` (0005 suelta la firma vieja) y `npm run check:schema`, que ahora vigila `get_properties_filtered(bbox)` |
| `db:apply-sql` falla con `42703: column partner_id does not exist` | La base venía de una versión anterior de `0003` (sin la columna) y el índice de la columna estaba en ese archivo | Ya está corregido: el índice vive en `0011`, junto al `ALTER TABLE` |
| Funciones lentas en Chile | Base en región lejana a `gru1` | Migra el proyecto a `South America (São Paulo)` |

---

## 11. Checklist de cierre

- [ ] Proyecto Supabase creado en **São Paulo** y activo.
- [ ] `.env.local` con la URL real y la llave pública (publishable o anon, sin placeholder).
- [ ] `npm run db:push` sin errores y `npm run db:status` todo aplicado.
- [ ] `supabase/seed.sql` ejecutado (`properties` y `partners` > 0).
- [ ] Variables en Vercel en **Production + Preview + Development**.
- [ ] `npm run deploy:prod` y alias a `https://rix7.vercel.app`.
- [ ] `/api/health` sin `supabase` crítico.
- [ ] `/api/properties` → `"source":"supabase"`.
- [ ] `npm run smoke:prod -- --write --email …` → `persisted: true`.
- [x] Token personal revocado (2026-10-05).
- [ ] Fila de prueba borrada.
