# Informe técnico consolidado — Rix7

> Documento único de referencia: qué compone el proyecto, qué servicios usa, con
> qué cuentas, y dónde vive cada credencial. Fecha: **2026-10-03**.
>
> **Sobre las contraseñas:** este informe **no incluye ningún valor secreto** —ni
> contraseñas, ni tokens, ni claves— y no debería: el repositorio es la peor caja
> fuerte posible y estos documentos suelen terminar compartidos. Lo que sí dice,
> para cada servicio, es **con qué usuario se entra** y **en qué dashboard o
> variable vive el secreto**, que es lo que hace falta para administrarlo sin
> exponerlo. Los valores reales se leen en su panel y se rotan ahí.

## 1. Estado de la consolidación

El árbol de trabajo tiene **58 archivos** sin commitear (modificados y nuevos)
acumulados por dos conversaciones en paralelo sobre el mismo checkout. Este
informe cierra esa etapa: la verificación completa quedó **en verde** y no queda
ningún error que reparar.

| Comprobación | Comando | Resultado |
|---|---|---|
| Tipos | `npx tsc --noEmit` | ✅ limpio |
| Tests | `npx vitest run` | ✅ **955 / 955** en 65 archivos |
| Código muerto | `npm run check:knip` | ✅ limpio |
| Presupuesto de bundle | `npm run check:bundle` | ✅ 87,5 kB (límite 87,5 +5 kB) · 21 rutas |
| Build de producción | `npm run build` | ✅ 23 rutas |
| Accesibilidad | `npm run check:a11y -- --all --fail-on-severity` | ✅ 0 hallazgos (desktop y mobile) |
| Integración sin Supabase | `npm run test:integration:nosupabase` | ✅ 15/15 |

> **Para no tener que reparar más**: la regla es no dejar que dos hilos editen el
> mismo checkout a la vez. El procedimiento de consolidación está en la §6.

## 2. La aplicación

| Componente | Versión / detalle |
|---|---|
| Framework | **Next.js 14.2.23** (App Router, React Server Components) |
| Lenguaje | **TypeScript 5.7** (`strict`, `incremental`) |
| UI | **React 18.3** + **Tailwind CSS 3.4** + **lucide-react** (iconos) |
| Mapas | **MapLibre GL 6.6** (home) + **Leaflet 1.9** + `leaflet.markercluster` (ficha) |
| Validación | **Zod 3.25** (esquemas de las rutas `/api/*`) |
| Virtualización | **@tanstack/react-virtual** (listados largos) |
| Tests | **Vitest 3.2** · **axe-core 4.13** (accesibilidad) · **knip 6.38** (código muerto) |
| Node | **20.x** fijado en `.nvmrc` y `engines` (misma línea que CI y Vercel) |
| Runtime | Node (no Edge: `next/og` pesa 1,05 MB y el plan Hobby limita a 1 MB) |
| Región | **gru1** (São Paulo, la más cercana a Chile) |

**Estructura**: `app/` (rutas y páginas), `components/` (UI), `lib/` (datos,
utilidades, integraciones), `scripts/` (dev, build, deploy, migraciones, auditorías),
`supabase/migrations/` (esquema), `docs/` (runbooks y auditorías).

## 3. Servicios externos

### 3.1 GitHub — repositorio y CI

| Dato | Valor |
|---|---|
| Repositorio | `github.com/jatf71-a11y/rix7` |
| Remoto | `origin` (HTTPS) |
| Rama de trabajo | `audit/optimization` |
| Workflows | `ci.yml`, `health-check.yml`, `alerts-run.yml`, `snapshot-pois.yml` |

El CI (`.github/workflows/ci.yml`) corre en cada push a `main`/`audit/**`:
tipos → tests → knip → build → **performance budget** → **accesibilidad**
(`--fail-on-serious`). Los jobs `budget` y `a11y` bajan el artifact de la build.

### 3.2 Vercel — hosting y producción

| Dato | Valor |
|---|---|
| Sitio en producción | **https://rix7.vercel.app** |
| Dominio objetivo | **https://rix7.cl** (aún no apuntado) |
| Plan | **Hobby** |
| Región | `gru1` |
| Cabeceras | `vercel.json` (CSP, HSTS, X-Frame-Options, cache de `_next/static`) |

**Limitación clave del plan Hobby**: solo el **dueño de la cuenta** puede crear
deployments. Por eso `git push` **no despliega** (los commits van firmados por un
autor que no es miembro y Vercel los marca `BLOCKED`): se publica con
`npm run deploy:prod`, que sube el árbol **sin metadata de git**.

### 3.3 Supabase — base de datos y autenticación

| Dato | Valor |
|---|---|
| Uso | Postgres, RLS, RPC y Auth (enlace mágico + Google) |
| Esquema | `supabase/migrations/` (numeradas, aplicadas con `npm run db:push`) |
| Estado local | **No configurado** (`.env.local` tiene un proyecto `placeholder`) |

Tablas principales: `properties`, `partners`, `favorites`, `saved_searches`,
`leads`, `signups` (solo-anexa), `share_views`, `property_views`, `rix7_migrations`.

### 3.4 Correo, monitoreo y datos externos

| Servicio | Para qué | Variables |
|---|---|---|
| **Resend** (`resend.com`) | Correo de bienvenida y avisos de búsquedas | `RESEND_API_KEY`, `ALERTS_FROM_EMAIL` |
| **Sentry** (`sentry.io`) | Monitoreo de errores (opcional, no-op sin DSN) | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_AUTH_TOKEN` |
| **Vercel Web Analytics** | Tráfico | (se activa en el dashboard, sin variables) |
| **OpenStreetMap** | Tiles (`*.tile.openstreetmap.org`), Nominatim (geocoding), Overpass (POIs) | — |
| **Unsplash** | Imágenes del catálogo | — |
| **mindicador.cl** | UF y dólar del día | — |
| **ipwho.is** | Geolocalización por IP (respaldo) | — |
| **WhatsApp** (`api.whatsapp.com`) | Contacto desde la ficha | — |

Todos los hosts que el navegador toca están declarados en la **CSP** de
`vercel.json`; un host sin permiso funciona en local y se rompe solo al desplegar.

## 4. Cuentas, usuarios y credenciales

### 4.1 Identidades de Git

| Identidad | Correo | Dónde se usa |
|---|---|---|
| `jtorres-ops` | `jtorres@catedralpropiedades.com` | Autor de los commits (config global) |
| `jatf71-a11y` | `313025432+jatf71-a11y@users.noreply.github.com` | Cuenta de GitHub / dueña de Vercel |

> `npm run deploy:prod` existe justamente por la brecha entre estas dos: los
> commits los firma `jtorres-ops`, pero el deployment lo tiene que crear la cuenta
> dueña (`jatf71-a11y`). **Pendiente de higiene**: unificar el autor de los commits
> con la cuenta de GitHub (o invitar a `jtorres-ops` como miembro del equipo).

### 4.2 Dónde vive cada credencial (nunca el valor)

| Secreto | Servicio | Usuario / cuenta | Dónde se administra |
|---|---|---|---|
| Contraseña de la cuenta | GitHub | `jatf71-a11y` | github.com → Settings → Password |
| Token de acceso personal | GitHub | `jatf71-a11y` | Settings → Developer settings → Tokens |
| Contraseña / login | Vercel | cuenta dueña (`jatf71-a11y`) | vercel.com → Account Settings |
| Vercel OIDC token | Vercel | — | generado por la CLI (`.env.local`, rotable) |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Supabase | proyecto del equipo | Dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | proyecto del equipo | Dashboard → API (⚠️ **nunca** al navegador) |
| `SUPABASE_ACCESS_TOKEN` | Supabase | cuenta personal | supabase.com/dashboard/account/tokens |
| `RESEND_API_KEY` | Resend | cuenta del equipo | resend.com → API Keys |
| `ALERTS_CRON_SECRET` | propio | — | se genera; vive en **Vercel + secrets de GitHub** |
| `SENTRY_*` | Sentry | organización del equipo | sentry.io → Settings → Auth Tokens |

**Regla**: los valores de `.env.local` son solo para la máquina local y **nunca**
se commitean (`.env.local` está en `.gitignore`). En producción, cada variable se
define en **Vercel → Project → Settings → Environment Variables**. La referencia
completa de qué variable va dónde está en el `README.md` (§Variables) y en
`.env.example`.

### 4.3 Qué falta configurar en producción

Para que el portal guarde datos de verdad (hoy degrada a memoria, que es honesto
pero no persistente):

1. `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` del proyecto real.
2. `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ALERTS_FROM_EMAIL`,
   `ALERTS_CRON_SECRET` (este último también en los secrets de GitHub).
3. `npm run db:push` para aplicar las migraciones.
4. Opcional: Sentry (DSN) y activar Web Analytics.

`GET /api/health` dice en una sola respuesta qué subsistema falta y qué deja de
funcionar mientras falte. `npm run check:health` lo vigila solo desde el CI.

## 5. Comandos de referencia

```bash
npm run dev                      # servidor de desarrollo (slot propio por puerto)
npm run build                    # build de producción
npm test                         # suite completa (vitest)
npm run check:knip               # código muerto
npm run check:bundle             # performance budget
npm run check:a11y -- --all      # accesibilidad (axe-core)
npm run test:integration:nosupabase   # integración sin Supabase
npm run smoke:prod               # prueba de humo contra producción
npm run check:health             # sonda de configuración
npm run db:push / db:status      # migraciones de Supabase
npm run deploy:prod              # publicar a producción
```

## 6. Cómo consolidar en una sola conversación (y no volver a reparar)

El problema no es de código: es de **dos conversaciones editando el mismo
checkout**. La consolidación se hace una vez, en este orden:

1. **Terminar el otro hilo.** No se puede fusionar dos procesos que siguen
   escribiendo. Cerrar la conversación paralela (o pausarla) hasta que este árbol
   sea el único activo.
2. **Una sola rama.** Hoy todo el trabajo está en `audit/optimization` sin
   commitear. Crear una rama limpia desde `main` (`main` → `consolidacion/final`),
   o directamente commitear aquí sobre `audit/optimization`.
3. **Commit único y revisable.** Los 58 archivos son de dos temas (infra/Node,
   accesibilidad, auditoría sin Supabase, integración y velocímetros). Un commit
   por tema deja historia legible; un commit único deja el árbol congelado.
4. **Verificación antes del commit**: `tsc` → `vitest` → `knip` → `check:bundle`
   → `build` → `check:a11y` → `test:integration:nosupabase`. Los siete en verde
   es la definición de «versión final que funciona».
5. **Push y PR** solo cuando el usuario lo pida. Con el plan Hobby, publicar es
   `npm run deploy:prod`.
6. **Regla permanente**: una sola conversación por checkout a la vez. Si hace
   falta paralelizar, usar `git worktree` (checkouts separados) o los **slots**
   de dev (`npm run dev -- --port NNNN`, cada uno con su `distDir`).

## 7. Deuda conocida (no bloquea)

- Supabase local sin configurar → el portal degrada a memoria (por diseño, y lo
  informa en `/api/health` y en los paneles con el aviso ámbar).
- Autor de commits (`jtorres-ops`) distinto del dueño de Vercel (`jatf71-a11y`).
- Dominio `rix7.cl` aún no apuntado; `SITE_URL` cae al default `https://rix7.cl`.
- Turbopack no es viable (MapLibre + Sentry no lo soportan).
- Favoritos y búsquedas exigen sesión; sin Supabase real responden 401 (correcto).
