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
> **volver a desplegar**. En este proyecto el deploy es `npm run deploy:prod`
> (`git push` **no** despliega: el plan Hobby bloquea al autor de los commits).

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
| **anon / public** key | API keys → `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel **y** `.env.local`) |
| **service_role** key | API keys → `service_role` (**Reveal**) | `SUPABASE_SERVICE_ROLE_KEY` (**solo** Vercel, sin `NEXT_PUBLIC_`) |

Anota también la **ref** del proyecto: es el `<ref>` de la URL.

> La `service_role` **salta RLS**: es la que necesita el job de alertas para leer
> las búsquedas de todas las personas. Nunca lleva prefijo `NEXT_PUBLIC_` y
> nunca se comitea.

---

## 3. Poner las credenciales en `.env.local` (para migrar desde tu máquina)

Edita `.env.local` en la raíz:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key larga>

# Token personal, solo para aplicar migraciones. NO va a Vercel.
SUPABASE_ACCESS_TOKEN=sbp_...
```

**Qué NO dejar:** el detector de placeholder de `lib/utils/supabaseEnv.ts` trata
como inválido cualquier valor que contenga `placeholder`, `tu-proyecto`,
`tu-clave`, `example` o `changeme`, y exige que la anon key tenga **≥ 30
caracteres**. Si mezclas pegado y copy-paste, ese chequeo es el que evita que
producción "parezca configurada" sin estarlo.

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
`leads`, `saved_searches`, `favorites`, `share_views` y **`signups`** (esta
última es la que faltaba y por eso el alta no persistía).

`db:push` se detiene en el primer error y registra cada migración aplicada en
`public.rix7_migrations`, así que re-ejecutarlo es seguro. Verifica:

```sql
SELECT name, applied_at FROM public.rix7_migrations ORDER BY name;
```

> Alternativa sin CLI: aplica los archivos de `supabase/migrations/` **en orden
> y uno por uno** en el SQL Editor. Después `npm run db:status` confirma qué
> quedó registrado.

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
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | La anon key real |
| `SUPABASE_SERVICE_ROLE_KEY` | recomendada | Server-only, para el job de alertas |
| `NEXT_PUBLIC_SITE_URL` | ya está | `https://rix7.cl` |

Luego **despliega** para que el build tome las claves nuevas:

```bash
npm run deploy:prod       # NO `git push`
```

Espera el alias a `https://rix7.vercel.app` (~2 min).

---

## 7. Verificar

### 7.1 Los dos chivatos baratos

```bash
curl -s https://rix7.vercel.app/api/health    | head -40
curl -s "https://rix7.vercel.app/api/properties?limit=3" | head -c 300
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
| `db:push` → «Falta SUPABASE_ACCESS_TOKEN» | Token ausente en `.env.local` | Genera uno y ponlo en `.env.local` (nunca en Vercel) |
| `db:push` → «No se pudo deducir la referencia» | `NEXT_PUBLIC_SUPABASE_URL` no tiene la ref | Pasa `--ref <ref>` o define `SUPABASE_PROJECT_REF` |
| Alta aceptada pero `persisted: false` | Falta la migración `0010_signups.sql` | `npm run db:push` |
| Detalle 404 de propiedades que existen | Falta el RPC `get_property_by_id` | `npm run db:push` (lo crea `0005_properties_rpc.sql`) |
| Funciones lentas en Chile | Base en región lejana a `gru1` | Migra el proyecto a `South America (São Paulo)` |

---

## 11. Checklist de cierre

- [ ] Proyecto Supabase creado en **São Paulo** y activo.
- [ ] `.env.local` con URL y anon key reales (sin marcadores de placeholder).
- [ ] `npm run db:push` sin errores y `npm run db:status` todo aplicado.
- [ ] `supabase/seed.sql` ejecutado (`properties` y `partners` > 0).
- [ ] Variables en Vercel en **Production + Preview + Development**.
- [ ] `npm run deploy:prod` y alias a `https://rix7.vercel.app`.
- [ ] `/api/health` sin `supabase` crítico.
- [ ] `/api/properties` → `"source":"supabase"`.
- [ ] `npm run smoke:prod -- --write --email …` → `persisted: true`.
- [ ] Fila de prueba borrada y token personal revocado.
