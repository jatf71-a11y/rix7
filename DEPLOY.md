# 🚀 Rix7 — Deployment Runbook

Guía operativa para desplegar Rix7 (Next.js 14 + Supabase + MapLibre) en **Vercel** con base de datos **Supabase (PostgreSQL + PostGIS)**.

---

## 1. Requisitos previos

- Cuenta de [Vercel](https://vercel.com) (plan Hobby funciona: 1 región de funciones es suficiente).
- Proyecto en [Supabase](https://supabase.com) con PostGIS habilitado (el propio `schema.sql` lo habilita).
- Repo GitHub: `jatf71-a11y/rix7` (rama `main`).

---

## 2. Variables de entorno

Configúralas en **Vercel → Project → Settings → Environment Variables** (aplica a Production, Preview y Development).

| Variable | Obligatoria | Ejemplo | Descripción |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | `https://abcdefgh.supabase.co` | URL del proyecto Supabase (Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | `eyJhbGciOi...` (larga) | Clave anónima pública (Settings → API → Project API keys → `anon` `public`) |
| `NEXT_PUBLIC_DEFAULT_MAP_LAT` | — | `-33.4190` | Centro inicial del mapa (Santiago) |
| `NEXT_PUBLIC_DEFAULT_MAP_LNG` | — | `-70.5870` | Centro inicial del mapa (Santiago) |
| `NEXT_PUBLIC_DEFAULT_MAP_ZOOM` | — | `12` | Zoom inicial del mapa |

> **Sin Supabase configurado la app sigue funcionando**: las APIs caen al catálogo nacional en memoria (modo demo). En Vercel deja las variables apuntando a tu proyecto real para datos en vivo.

---

## 3. Base de datos Supabase (orden estricto)

Ejecuta en **Supabase Dashboard → SQL Editor** (o `psql`), en este orden:

1. **`supabase/schema.sql`** — completo. Crea:
   - Extensión `postgis`
   - Tabla `public.properties` + índices (GiST espacial + B-Tree)
   - RPC `get_properties_filtered` (listado con bounding box)
   - RPC `get_property_by_id` (detalle individual, usada por `/api/properties/[id]`)
   - Políticas RLS (lectura pública, escritura solo autenticados)
   - Bucket de Storage `properties-media`
2. **`supabase/seed.sql`** — siembra el catálogo inicial (Vitacura, Las Condes, Lo Barnechea, Providencia, Ñuñoa, Peñalolén, Chicureo).

Verificación rápida en SQL Editor:

```sql
SELECT count(*) FROM public.properties;                              -- > 0 tras el seed
SELECT * FROM get_property_by_id('<uuid-de-una-propiedad>');        -- devuelve 1 fila
SELECT * FROM get_properties_filtered(-76, -56, -66, -17, null, null, null, null, null); -- catálogo completo
```

---

## 4. Primer despliegue en Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** del repo `jatf71-a11y/rix7`.
2. Framework Preset: **Next.js** (auto-detectado). No cambies build command ni output.
3. Agrega las variables de entorno de la sección 2 **antes** del primer deploy.
4. **Deploy** (~1 min).

### Región de funciones (optimizado para Chile)

`vercel.json` fija `"regions": ["gru1"]` (São Paulo) — la región de cómputo más cercana a Chile; Vercel no tiene región en Santiago. El contenido estático se sirve desde el CDN global de todos modos (PoP Santiago incluido). Si un día tu base de datos vive en otro lugar, mueve la región junto a la base de datos: las funciones deben correr cerca de la DB, no de los usuarios.

> `regions` es válido en Hobby (1 región). Failover multi-región (`functionFailoverRegions`) requiere plan Enterprise — no está configurado.

---

## 5. Despliegues automáticos

- Cada `git push` a `main` → deploy de **Production**.
- Cada push a otras ramas / PRs → deploy de **Preview** con su URL propia.
- Variables `NEXT_PUBLIC_*` nuevas **requieren re-deploy** para incluirse en el bundle del cliente.

### Deploy manual por CLI (opcional)

```bash
npm i -g vercel
vercel login
vercel --prod          # deploy directo a producción
```

---

## 6. Verificación post-deploy

| Check | Cómo |
|---|---|
| Home carga | `curl -s -o /dev/null -w "%{http_code}" https://<tu-dominio>/` → `200` |
| Listado API | `curl -s https://<tu-dominio>/api/properties?limit=5` → `success:true` |
| Detalle API | `curl -s https://<tu-dominio>/api/properties/<id>` → `success:true` (o `404` con `success:false` si no existe) |
| Detalle UI | abrir `/properties/<id>` en el navegador → galería, specs y agente con datos reales |
| Mapa (tiles) | el mapa pinta OSM; la consola no muestra errores de CSP |
| Supabase activo | respuesta de `/api/properties` con `"source":"supabase"` |
| Modo catálogo | respuesta con `"source":"national_catalog"` = Supabase no configurado/alcanzable |
| Headers de seguridad | `curl -sI https://<tu-dominio>/ | grep -i content-security` |

---

## 7. Rollback

1. Vercel → tu proyecto → **Deployments**.
2. Elige el último deploy bueno → menú `⋯` → **Instant Rollback (Promote to Production)**.
3. Los rollbacks son instantáneos (mismo build, sin recompilar).

Para revertir código: `git revert <commit>` + push (dispara nuevo deploy).

---

## 8. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `"source":"national_catalog"` cuando esperabas DB | Env vars faltantes/mal escritas en Vercel, o RPC `get_property_by_id` no ejecutada | Revisa Settings → Environment Variables; ejecuta `schema.sql` (sección 3) |
| Detalle 404 de propiedades que sí existen en DB | RPC `get_property_by_id` no existe en la DB | Ejecuta el bloque 4.b de `supabase/schema.sql` |
| Mapa en blanco + errores CSP en consola | CSP bloqueando tiles | Verifica que `*.tile.openstreetmap.org` sigue en `img-src` de `vercel.json` |
| Error de build en Vercel | Type error local no detectado | Corre `npx tsc --noEmit && npm run build` antes de push |
| Funciones lentas en Chile | DB en región lejana a `gru1` | Aloja la DB en la región más cercana a São Paulo (Supabase ofrece `South America (São Paulo)`) |

> **Tip Supabase:** al crear el proyecto elige la región **South America (São Paulo)** para que la DB quede junto a las funciones (`gru1`).

---

## 9. Dominio propio (opcional)

1. Vercel → Settings → **Domains** → agrega `rix7.cl` (o el que uses).
2. En tu registrador crea CNAME → `cname.vercel-dns.com`.
3. Vercel emite SSL automático (Let's Encrypt). HSTS ya está activo vía `vercel.json`.
