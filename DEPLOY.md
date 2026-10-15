# 🚀 Rix7 — Deployment Runbook

Guía operativa para desplegar Rix7 (Next.js 14 + Supabase + MapLibre) en **Vercel** con base de datos **Supabase (PostgreSQL + PostGIS)**.

---

## 1. Requisitos previos

- Cuenta de [Vercel](https://vercel.com) (plan Hobby funciona: 1 región de funciones es suficiente).
- Proyecto en [Supabase](https://supabase.com) con PostGIS habilitado (lo habilita la migración `0001_extension_postgis.sql`).
- Token personal de Supabase (`SUPABASE_ACCESS_TOKEN`) para aplicar las migraciones desde la terminal.
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

## 3. Base de datos Supabase

El esquema son **migraciones numeradas e idempotentes** en `supabase/migrations/`
(detalle y reglas en [`supabase/migrations/LEEME.md`](supabase/migrations/LEEME.md)).
Se aplican desde la terminal —no hay que pegar nada en el dashboard—
con un token personal de <https://supabase.com/dashboard/account/tokens>
en `SUPABASE_ACCESS_TOKEN`:

```bash
npm run db:push        # aplica lo que falte (crea desde cero o completa una base vieja)
npm run db:status      # dice qué está aplicado sin tocar nada
npm run db:apply-sql   # sin token: genera UN archivo para pegar en el SQL Editor
```

Sin token **de una cuenta con acceso al proyecto** —es el caso de una base que
pertenece a otra persona— la CLI no puede aplicar nada: `db:apply-sql` genera un
solo `.sql` con las migraciones y su registro, en una transacción, para pegar
entero en el SQL Editor (`.deploy-tmp/migraciones.sql`). Después `npm run
check:schema` dice si quedó aplicado, sin token.

Aplicarlas deja la base con:

- Extensión `postgis`
- Tabla `public.partners` (corredoras) + `public.properties` + índices (GiST espacial + B-Tree)
- RPC `get_properties_filtered` (listado con bounding box) y `get_property_by_id` (detalle, usada por `/api/properties/[id]`)
- Políticas RLS de todas las tablas, bucket de Storage `properties-media`
- Tablas `leads`, `saved_searches`, `favorites`, `share_views` y `signups`

Si prefieres el SQL Editor, no apliques los archivos **en orden y uno por uno**:
`npm run db:apply-sql` arma el archivo con el libro de migraciones y los quince
archivos en orden, y `npm run check:schema` confirma qué quedó aplicado.

Luego, la semilla: **`supabase/seed.sql`** siembra el catálogo inicial
(Vitacura, Las Condes, Lo Barnechea, Providencia, Ñuñoa, Peñalolén, Chicureo) y
las corredoras inscritas.

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

## 5. Cómo se publica: `deploy:prod`

- Con el repo conectado, cada `git push` a `main` generaría un deploy de
  **Production** y cada PR uno de **Preview** con su URL propia — **pero en este
  repositorio eso no llega a publicar** (ver el aviso de abajo).
- Variables `NEXT_PUBLIC_*` nuevas **requieren re-deploy** para incluirse en el bundle del cliente.

> ⚠️ **En este repositorio el push no publica.** Los commits van firmados por un
autor que no es miembro del equipo Hobby de Vercel, y ese plan solo deja crear
deployments al dueño de la cuenta: Vercel acepta el push, compila y descarta el
deployment con «the commit author doesn't have permission to create deployments».
El camino real es el comando de abajo (el porqué completo está en la cabecera de
[`scripts/deploy-prod.mjs`](scripts/deploy-prod.mjs): publica el árbol de trabajo
**sin metadata de git**, así el deployment queda atribuido a la cuenta dueña).

### El comando

```bash
npm run release:prod   # build + migraciones + esquema + deploy + verificación (sección 6)
npm run deploy:prod    # solo publica, sin build ni verificación
```

Para **cambiar de proyecto Supabase** (URL y claves nuevas) hay un comando aparte:
`npm run corte:supabase` comprueba las tres variables contra la base —forma,
pertenencia y una sonda real con cada clave— antes de escribir en Vercel, y
termina llamando a `release:prod --no-db`. El detalle está en
[`docs/recuperacion-base-2026-10-14.md`](docs/recuperacion-base-2026-10-14.md) §4.

La verificación en vivo de `release:prod` usa la misma sonda que el CI
(`check:health`), así que incluye el cotejo de **de quién es la base**: publicar
un build cuyas variables apunten al proyecto de otra cuenta no pasa la
verificación. Ese chequeo (subsistema `supabase_owner` de `/api/health`) existe
por el incidente del 2026-10-13, cuando el portal funcionaba entero sobre una
base sin dueño accesible; el porqué y cómo se saltea a propósito están en
[`docs/registro-cuentas-y-servicios.md`](docs/registro-cuentas-y-servicios.md) §7.

Y para que las socias y corredoras **vuelvan a entrar** en esa base nueva —que
llega sin ninguna cuenta— está `npm run accesos:socias`: con `-- --aplicar`
crea cada cuenta con su rol y su corredora (sin eso, la primera en entrar queda
de Visita y `/socio` le responde «sin corredora vinculada»), verifica contra la
base y con `-- --enviar` manda su enlace de un solo uso por lotes. Sin banderas
solo lee y muestra el plan. El plan completo, con lo que hay que armar antes,
está en [`docs/runbook-accesos-socias.md`](docs/runbook-accesos-socias.md).

---

## 6. Un solo comando: `npm run release:prod`

Las secciones 3, 4 y 5 son los pasos del despliegue. Están encadenados en un
comando que **aborta en el primero que falle**: no hay que recordar el orden, ni
decidir en el medio, ni verificar a mano después.

```bash
npm run release:prod
```

| # | Paso | Qué corre | Por qué está en ese lugar |
|---|---|---|---|
| 1 | Build de producción | `npm run build` | un error de tipos descubierto acá se arregla en un minuto; descubierto por Vercel, en un deploy fallido |
| 2 | Migraciones pendientes | `npm run db:push` (sección 3) | **la base primero soporta, el código después usa**: publicar antes de migrar deja el portal en vivo contra columnas que no existen |
| 3 | Esquema de la base | `npm run check:schema` | aplicar una migración no es lo mismo que **comprobar que quedó aplicada**: lee la base real y dice qué falta. Solo necesita la clave pública, así que sirve aunque no tengas el token |
| 4 | Deploy a producción | `npm run deploy:prod` (sección 5) | publica el árbol de trabajo sin metadata de git, tras la guardia de secretos, y publica el **identificador de la build** (el hash de este árbol) |
| 5 | Verificación en vivo | `smoke:prod` + `check:health` | portada, `/admin/registros`, `/api/registro`, las rutas del panel de socios (`/socio`, `/api/partner/access`, `/api/admin/socios`) y los críticos de `/api/health`, contra la URL publicada. Además **compara el identificador**: si lo que está en vivo no es este árbol, el release falla |

Antes de todo corre la **guardia de secretos** (sobre el árbol de trabajo): un
token suelto corta el release antes de aplicar migraciones o publicar nada.

### El identificador de la build: «¿producción es este código?»

El release publica, además, **qué árbol publicó**. Calcula un hash del árbol de
trabajo —los archivos versionados y los no versionados no ignorados, es decir
exactamente lo que viaja al deployment, con el fin de línea normalizado para que
el mismo árbol dé el mismo número en Windows y en Linux— y lo manda al
deployment como variable de entorno (`RIX7_BUILD`). `/api/health` lo devuelve ya
traducido:

```bash
curl -s https://rix7.cl/api/health | grep -o '"build":[^}]*}'
# "build":{"id":"4f2a3c4b5d6e7f80","commit":"9d1c3ab…","dirty":true,"builtAt":"…"}
```

La verificación del release compara ese valor con el del árbol que acaba de
publicar, y **falla** si no coinciden:

| Qué encontró | Qué significa |
|---|---|
| **Coincide** | lo que está en vivo es este código (queda dicho en el informe, con el identificador) |
| En vivo hay **otra cosa** que lo recién publicado | el borde todavía sirve el deployment anterior (se reintenta) o alguien publicó en el medio: hay que mirarlo |
| En vivo **sí** es lo publicado, pero el árbol cambió | algo se editó mientras corría el release: lo publicado existe, pero ya no es «este árbol» — hay que volver a correrlo |
| El despliegue **no publica** identificador | se desplegó sin este comando (o es anterior a esta función): no se puede afirmar que sea este árbol, y el informe lo dice así en vez de dar por bueno lo que no comprobó |

Nada de esto depende de que el árbol esté commiteado: el hash es del contenido,
no del commit. Un release desde un árbol con cambios sin commitear publica ese
contenido y coincide con él; lo que no va a coincidir es con **otro** checkout
del repositorio, y eso es justo lo que hay que ver.

La [sonda de salud](.github/workflows/health-check.yml) —que corre sola cada 6
horas— hace la misma comparación contra el checkout del CI y lo deja en su
resumen: si producción quedó atrás, se ve ahí (y con `npm run check:health`,
que además cuenta **cuántos commits** va atrás cuando puede).

### El rojo no se queda en la pestaña de Actions

Cuando la sonda encuentra algo crítico, el job se pone rojo —y eso está bien—
pero un rojo en Actions hay que ir a mirarlo. Así que además **abre un issue**:
uno solo, siempre el mismo (`Salud de producción en rojo`), que se mantiene al
día en cada corrida roja, **comenta únicamente cuando el motivo cambia** y se
cierra solo cuando la sonda vuelve a estar verde. El correo lo manda GitHub al
abrir el issue, así que el aviso no necesita ninguna clave nueva en el CI.

Ese aviso lo maneja [`scripts/notice-health.mjs`](scripts/notice-health.mjs) y
se puede ensayar sin tocar nada: `npm run aviso:salud -- --dry-run` (dice qué
haría y con qué texto). Si el script no recibe el dato de si hubo fallo, se
niega a actuar en vez de suponer que todo está bien: suponerlo **cerraría** un
aviso legítimo.

### El paso que no corre por defecto: `--with-tests`

El build de Next typechequea, pero **no corre la suite**: un test rojo llega a
producción sin que nadie se entere hasta que el CI de otro commit lo dice.

```bash
npm run release:prod -- --with-tests
```

Agrega, como **paso 1**, `tsc --noEmit` y `vitest run` (≈1 min). Va primero a
propósito: es la señal más barata y la que más rápido falla, así que aborta en
segundos en vez de gastar un build y un deploy para llegar a la misma
conclusión. Cuando no se pide, el plan lo anuncia igual, y su `--no-tests` **no
existe**: el paso se agrega con su flag, no se saltea.

La verificación va contra el **alias de producción** que acaba de imprimir
Vercel, y reintenta hasta 3 veces (10 s entre intentos) porque un deploy recién
promovido puede tardar unos segundos en propagarse por el borde: un rojo por
llegar un instante temprano no es información.

### Cuándo te conviene cada bandera

| Bandera | Para qué |
|---|---|
| `--dry-run` | ver el plan (con el porqué de cada paso) y salir **sin ejecutar nada** |
| `--with-tests` | agrega el paso 1: tipos y suite completa antes del build |
| `--no-db` | el esquema ya está al día y no tenés el token a mano |
| `--no-schema` | publicar sin comprobar la base (no recomendado: es la red que atrapa el esquema incompleto) |
| `--no-build` | el build ya lo corrió el CI o no querés esperarlo |
| `--no-deploy` | **verificar** lo que ya está publicado (o un `localhost`) sin desplegar |
| `--url <url>` | verificar otra URL (un preview, `http://localhost:3111`) |
| `--attempts <n>` | menos reintentos (p. ej. `1` cuando verificás un servidor local) |

Salida del proceso: **0** todo lo que corrió salió bien · **1** un paso falló y el
release se detuvo ahí · **2** el comando se usó mal (un argumento desconocido, un
`--no-…` que no existe) y **nada se ejecutó**.

### Qué NO hace

- **No escribe nada que no sean migraciones.** No da el alta de prueba: la
  persistencia (`persisted: true`) se comprueba aparte con
  `npm run smoke:prod -- --write --email tu@correo.cl`, que manda un correo real.
  El informe final lo dice en vez de dar por probado lo que no se probó.
- **No hace `git push`.** El deploy publica el árbol de trabajo, no el commit;
  el informe avisa si quedaron cambios sin commitear o commits sin empujar.
- **No revierte.** Si el deploy salió bien y la verificación falla, el camino es
  la sección 8 (Rollback), y el informe lo dice: distingue «no se publicó nada
  nuevo» de «ya se publicó, pero la verificación falló».

### «¿Está al día la base?» tiene dos respuestas, y hacen falta las dos

Son dos preguntas distintas y por eso son dos pasos distintos:

| Pregunta | Quién la responde | Qué necesita |
|---|---|---|
| ¿Qué migraciones **falta aplicar**? | `npm run db:status` / el paso 2 | `SUPABASE_ACCESS_TOKEN` (escribe y consulta la Management API) |
| ¿La base **tiene** lo que este código usa? | `npm run check:schema` / el paso 3 | nada más que la clave pública: lee PostgREST |

Esa distinción es la que faltaba: sin token, la única respuesta disponible era
«no se puede saber», y así se puede publicar código contra una base incompleta
sin que nada lo advierta —pasó con `properties.rol` y con el vínculo de socio—.
Con `--no-db`, el paso 3 **sigue corriendo**: aplicar migraciones y comprobar el
esquema son cosas distintas, y la segunda es la red que no conviene saltar.

```bash
npm run check:schema              # contra el proyecto de .env.local
npm run check:schema -- --json     # el veredicto en JSON
```

Sale **1** cuando falta algo y nombra la migración a aplicar; sale **2** cuando
no pudo mirar (sin URL o sin clave), que no es un «está bien».

---

## 7. Verificación post-deploy

El paso 5 de `npm run release:prod` (sección 6) cubre automáticamente las tres
primeras filas, las rutas del panel de socios y los críticos de `/api/health`, así
que esta tabla queda para lo que sí hay que mirar a mano.

| Check | Cómo |
|---|---|
| Home carga | `curl -s -o /dev/null -w "%{http_code}" https://<tu-dominio>/` → `200` |
| Listado API | `curl -s https://<tu-dominio>/api/properties?limit=5` → `success:true` |
| Detalle API | `curl -s https://<tu-dominio>/api/properties/<id>` → `success:true` (o `404` con `success:false` si no existe) |
| Detalle UI | abrir `/properties/<id>` en el navegador → galería, specs y agente con datos reales |
| Mapa (tiles) | el mapa pinta OSM; la consola no muestra errores de CSP |
| Supabase activo | respuesta de `/api/properties` con `"source":"supabase"` |
| Modo catálogo | respuesta con `"source":"national_catalog"` = Supabase no configurado/alcanzable |
| Build en vivo | `npm run check:health` (la compara con el árbol del repo) o mirar el campo `build` de `/api/health`: si difiere, producción no es este código |
| Headers de seguridad | `curl -sI https://<tu-dominio>/ | grep -i content-security` |

---

## 8. Rollback

1. Vercel → tu proyecto → **Deployments**.
2. Elige el último deploy bueno → menú `⋯` → **Instant Rollback (Promote to Production)**.
3. Los rollbacks son instantáneos (mismo build, sin recompilar).

Si el que falló fue `npm run release:prod` **en la verificación**, el deploy ya
está publicado: esto es el paso que hay que hacer. Si falló antes del deploy, no
hay nada que revertir.

Para revertir código: `git revert <commit>` y volver a publicar con
`npm run release:prod` (el push **no** despliega, ver la sección 5).

---

## 9. Solución de problemas

**Antes de buscar:** `npm run smoke:prod` comprueba desde afuera que la portada,
`/admin/registros`, `/socio`, `/api/partner/access`, `/api/admin/socios` y
`/api/registro` estén vivas en el despliegue, y con
`-- --write --email tu@correo.cl` además da un alta de prueba para confirmar que
el registro **persiste** (una fila de prueba, marcada como tal, en
`public.signups`). Sale con 1 si algo falla.

**Y `curl https://<tu-dominio>/api/health`.** Informa qué subsistemas
quedaron sin configurar en ese despliegue —proyecto Supabase, clave de servicio,
Resend, secreto del cron, Sentry, URL canónica— con qué deja de funcionar cada
uno y qué hacer. Solo dice si están o no, nunca ningún valor, así que es
seguro consultarlo desde cualquier lado. Responde `503` únicamente si falta algo
crítico (sin Supabase real no se guarda nada de lo que hace la gente).

También trae `build`: **qué árbol está publicado** (ver la sección 6). Si su
`id` no es el del árbol del repositorio, lo que está en vivo no es este código
—y `npm run check:health` lo dice con los dos identificadores y cuántos commits
va atrás, sin entrar al panel de Vercel.

| Síntoma | Causa probable | Solución |
|---|---|---|
| `"source":"national_catalog"` cuando esperabas DB | Env vars faltantes/mal escritas en Vercel, o RPC `get_property_by_id` no ejecutada | Revisa Settings → Environment Variables; aplica las migraciones (`npm run db:push`, sección 3) |
| `check:schema` en rojo por `get_properties_filtered(bbox)` | La base quedó con **dos firmas** de la función (una vieja sin `p_partner_id`): PostgREST responde `PGRST203` | `npm run db:push` (0005 suelta la firma vieja antes de recrear) |
| Migrar una base ajena: `42703 column partner_id does not exist` | La base venía de un `0003` sin esa columna y el índice estaba en ese archivo | Ya corregido (el índice vive en `0011`); actualizá el repo y regenerá el SQL |
| Detalle 404 de propiedades que sí existen en DB | RPC `get_property_by_id` no existe en la DB | Aplica las migraciones: `npm run db:push` (la crea `0005_properties_rpc.sql`) |
| Mapa en blanco + errores CSP en consola | CSP bloqueando tiles | Verifica que `*.tile.openstreetmap.org` sigue en `img-src` de `vercel.json` |
| Error de build en Vercel | Type error local no detectado | Corre `npx tsc --noEmit && npm run build` antes de push |
| `/api/health` responde `"build": null` | el despliegue se publicó sin el comando del repo (o es anterior al identificador) | publica con `npm run release:prod`, o al menos `npm run deploy:prod` desde el repo |
| Un release falla en la verificación diciendo que producción no coincide con el árbol | el alias todavía sirve el deployment anterior, o el árbol cambió mientras corría el release | el informe dice cuál de las dos cosas fue; si es lo segundo, volvé a correr `npm run release:prod` |
| Funciones lentas en Chile | DB en región lejana a `gru1` | Aloja la DB en la región más cercana a São Paulo (Supabase ofrece `South America (São Paulo)`) |

> **Tip Supabase:** al crear el proyecto elige la región **South America (São Paulo)** para que la DB quede junto a las funciones (`gru1`).

---

## 10. Dominio propio: rix7.cl

1. Vercel → Settings → **Domains** → agrega `rix7.cl` (y `www.rix7.cl`, con redirect automático al dominio principal).
2. En tu registrador crea CNAME → `cname.vercel-dns.com` (o los nameservers de Vercel si prefieres delegar todo).
3. Vercel emite SSL automático (Let's Encrypt). HSTS ya está activo vía `vercel.json`.
4. SEO ya está cableado al dominio: `NEXT_PUBLIC_SITE_URL=https://rix7.cl` (ver `.env.example`) fija `metadataBase`, Open Graph y el host en `robots.txt`; `https://rix7.cl/sitemap.xml` se genera con todas las propiedades y empresas.
5. Verifica tras el deploy: `curl -s https://rix7.cl/robots.txt` y `curl -s https://rix7.cl/sitemap.xml | head -20`.
