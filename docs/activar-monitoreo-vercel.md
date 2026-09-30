# Activar Sentry + Vercel Web Analytics (hallazgo #13)

> **Proyecto Vercel**: `rix7` (org `ctd5`, región `gru1`) · Repo: `jatf71-a11y/rix7` · Producción: https://rix7.vercel.app
>
> Todo el código ya está integrado (`8c09bec`): SDK opt-in con carga condicional al DSN — sin variables el bundle no paga ni un byte del SDK. **Activar es solo configuración en Vercel + redeploy.**

---

## Parte 1 — Sentry (errores y rendimiento)

### Paso 1. Crear el proyecto en Sentry

1. Entra a [sentry.io](https://sentry.io) (el free tier cubre de sobra este portal: ~5k errores/mes).
2. **Settings → Projects → Create Project**:
   - Plataforma: **JavaScript — Next.js (client + server)**.
   - Nombre: **`rix7`**.
3. Del panel del proyecto copia el **DSN**: `https://<publicKey>@o<orgId>.ingest.<region>.sentry.io/<projectId>`.

> 💡 Para sourcemaps también necesitas el nombre corto de la org: **Settings → Organization Settings** (p. ej. `jatf71`).

### Paso 2. Definir las variables en Vercel

**Vercel → proyecto `rix7` → Settings → Environment Variables.**

| Variable | Valor | Entornos | ¿Obligatoria? |
|---|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | `https://<key>@o<id>.ingest.<region>.sentry.io/<proj>` | Production, Preview, Development | ✅ Sí — activa el SDK del navegador |
| `SENTRY_DSN` | **El mismo valor**, sin `NEXT_PUBLIC_` | Production, Preview, Development | ✅ Sí — activa server + edge (middleware) |
| `SENTRY_ORG` | nombre corto de la org (p. ej. `jatf71`) | Production | ⭕ Opcional — sourcemaps |
| `SENTRY_PROJECT` | `rix7` | Production | ⭕ Opcional — sourcemaps |
| `SENTRY_AUTH_TOKEN` | User Auth Token con scope `org:ci` | Production | ⭕ Opcional — sourcemaps |

Notas:
- `NEXT_PUBLIC_SENTRY_DSN` se inlinea **en build**: por eso hay que redeployar después de definirla.
- `SENTRY_AUTH_TOKEN` es un secreto de build; **nunca** con prefijo `NEXT_PUBLIC_` (lo documenta `.env.example`).

### Paso 3. Redeployar

**Deployments → último deploy de producción → ⋯ → Redeploy** (sin cache de build: el DSN público debe inlinearse). `withSentryConfig` detecta token+org+project y sube los sourcemaps del build.

### Paso 4. Verificar

1. **Humo**: abre https://rix7.vercel.app — DevTools → Network, filtra `sentry`: conexión a `ingest.<region>.sentry.io` **sin bloqueos de CSP**.
2. **Evento**: provoca un error real (o espera uno) y búscalo en Sentry → Issues (environment `production`, puede tardar ~1 min).
3. **Server**: los errores de rutas API llegan vía `onRequestError` (`app/instrumentation.ts`); el middleware (CSP) reporta por el runtime edge.

### Lo que ya funciona sin tocar nada

- `reportError()` (`lib/monitoring/reportError.ts`): consola siempre; Sentry solo con DSN. Ya usado por el boundary raíz (`app/error.tsx`).
- Release = commit SHA (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`), environment automático por Vercel.
- Muestreo 10% (`tracesSampleRate: 0.1`), sin PII en servidor (`sendDefaultPii: false`).

### CSP ya ajustada (`0f19dd5`)

`vercel.json` permite `connect-src … *.ingest.sentry.io` (+ regionales `us`/`de`) e `img-src … *.sentry.io` (screenshots de replay). Sin esto el SDK carga pero sus eventos salen bloqueados en producción — el mismo fallo silencioso de los tiles del mapa (los headers de `vercel.json` solo existen en Vercel). El guard `lib/utils/cspCoverage.test.ts` no puede verlo: el DSN llega por variable, no como literal en el código.

---

## Parte 2 — Vercel Web Analytics

1. **Vercel → proyecto `rix7` → pestaña Analytics** → **Enable**.
2. El componente `<Analytics />` (`@vercel/analytics@1.5.0`) ya está en `app/layout.tsx`: el script solo se inyecta si el proyecto lo tiene activado — si no, no viaja nada.
3. Sin variables de entorno ni código. Datos sin cookies ni PII (la política de privacidad ya lo declara así).

Verificar: tras ~10 min, la pestaña Analytics muestra tráfico.

---

## Parte 3 — Alertas Sentry → correo (ítem 1.4) · tras crear la cuenta

La mitad de código ya está desplegada: el receptor `POST /api/webhooks/sentry`
(firma HMAC + ventana anti-replay + re-chequeo de severidad) arma y envía el
correo con Resend. Lo que falta es del dashboard, y son ~5 minutos:

### Paso 1. Crear el webhook interno

**Settings → Integrations → Create Integration** (o Developer Settings → Custom
Webhook, según el plan): plataforma **Webhook**, nombre `rix7-avisos`, URL
`https://rix7.vercel.app/api/webhooks/sentry`, eventos **issue** y **error**.
Copia el **Client Secret** que genera.

### Paso 2. Variables en Vercel

| Variable | Valor | Entornos |
|---|---|---|
| `SENTRY_WEBHOOK_SECRET` | el Client Secret del paso 1 | Production |
| `SENTRY_ALERT_EMAIL` | tu correo de guardia (uno por ahora) | Production |

(`RESEND_API_KEY` ya llega con la Tanda 0. Nota: Resend exige remitente de
 dominio verificado para mandar fuera de tu propia cuenta — con
 `onboarding@resend.dev` solo llega a ti; para el equipo, `avisos@rix7.cl`.)

### Paso 3. Regla de alerta en Sentry

**Project → Alerts → Create Alert → Issue**:
- "An issue is **new**" **o** "The issue is **seen more than N times** in **1h**"
  (sugerido: nuevo evento con `level:error` o superior).
- Destino: **Integration → rix7-avisos** (el webhook del paso 1).

### Paso 4. Verificar

1. `GET https://rix7.vercel.app/api/webhooks/sentry` → los tres `true`.
2. Provoca un error real en producción (o el botón **Send Test** del webhook):
   debe llegar el correo con asunto `[Sentry:ERROR] production · …`.
3. Correos de prueba `warning/info`: **no** deben llegar (el receptor
   re-chequea severidad).

### Rollback de alertas

| Objetivo | Cómo |
|---|---|
| Apagar avisos | Desactiva la regla en Sentry (o borra `SENTRY_ALERT_EMAIL` → el receptor queda en `skipped` honesto) |
| Apagar el endpoint | Borra `SENTRY_WEBHOOK_SECRET` → responde 503 sin procesar nada |

---

## Parte 4 — Rollback

| Objetivo | Cómo |
|---|---|
| Apagar Sentry | Elimina `NEXT_PUBLIC_SENTRY_DSN` y `SENTRY_DSN` → redeploy: el bundle vuelve a no incluir el SDK |
| Apagar solo sourcemaps | Quita `SENTRY_AUTH_TOKEN` |
| Apagar Analytics | Toggle **Disable** en la pestaña Analytics |
