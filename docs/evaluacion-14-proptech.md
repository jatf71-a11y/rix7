# Evaluación hallazgo #14 — Proptech (feed XML y alertas)

> Evaluación de alcance pedida en el roadmap de fase 2 («½ día de análisis»). Conclusión en una línea: **las alertas ya están construidas — solo falta activarlas; el feed XML vale la pena y cabe en ~1 día; los webhooks CRM se difieren hasta que haya una corredora que los pida.**

## 1. Veredicto por mitad

| Mitad del hallazgo | Estado real | Trabajo restante |
|---|---|---|
| **Alertas de búsquedas guardadas** | ✅ **Construida y testeada** (cron, endpoint con secreto, dry-run, email HTML+texto, runner con línea base y reintentos) | Solo **configuración**: 4 variables en Vercel + 1 secret en GitHub + verificación con dry-run (~30 min) |
| **Feed XML de inmuebles** | ❌ No existe nada | Diseño propuesto abajo: **~1 día de desarrollo** |
| **Webhooks CRM** | ❌ No existe nada | **Diferir** — no construir integraciones sin cliente concreto |

La mitad de alertas no estaba «pendiente»: es infraestructura previa a la fase 2 que el informe registró como parte del hallazgo opcional. Su única deuda es de configuración (mismo patrón que Sentry/Analytics en #13).

## 2. Alertas: qué hay que hacer para activarlas

El código completo ya vive en el repo:

- `.github/workflows/alerts-run.yml` — cron diario a las 09:17 Chile (12:17 UTC, fuera del minuto 0 por la carga del scheduler de GitHub), con `workflow_dispatch` y modo simulación.
- `app/api/alerts/run` — POST protegido por `x-alerts-secret`, GET de estado, validación Zod, `?dry=1`.
- `lib/data/alertsRunner.ts` — recorre búsquedas activas, filtra novedades desde el último aviso, **primera corrida = línea base sin envío**, si el correo falla no avanza la fecha (reintento), máx. 20 propiedades por correo, informe detallado sin excepciones.
- `lib/email/alertEmail.ts` + `sendEmail.ts` — correo HTML/texto con escape, vía Resend.

**Checklist de activación** (todo configuración, cero código):

1. Vercel: `ALERTS_CRON_SECRET` (cadena larga inventada), `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ALERTS_FROM_EMAIL` (dominio verificado en Resend, p. ej. `Rix7 <avisos@rix7.cl>`).
2. GitHub → Secrets de Actions: `ALERTS_CRON_SECRET` (mismo valor); Variable `SITE_URL=https://rix7.cl` (opcional).
3. En GitHub Actions: correr «Avisos de búsquedas» a mano con **dry_run=true** y revisar el resumen.
4. Primera corrida real: fija línea base (no envía nada — a propósito). Desde la segunda, envía novedades.
5. DNS/Resend: verificar el dominio remitente antes de la primera corrida real, o los correos no salen.

⚠️ Nota del propio workflow: GitHub desactiva schedules tras 60 días sin pushes al repo — con este proyecto en desarrollo activo no aplica, pero hay que saberlo.

## 3. Feed XML: propuesta de alcance

### Dirección correcta: export, no import

- **Export** (Rix7 genera el feed que las corredoras registran en portales agregadores): bajo riesgo, reutiliza el modelo `Property`, un route handler, valor comercial inmediato («publica en Rix7 una vez, distribuye a todos lados»).
- **Import** (ingestar feeds de CRMs externos): parsing de N formatos, deduplicación, sincronía de disponibilidad, moderación — **no** es el momento (catálogo demo, integración sin clientes).

### Formato: compatible con Trovit

Estándar de facto de los agregadores en LatAm/España (red Trovit/Mitula). El mapeo desde `Property` es completo y directo:

| Trovit | Property |
|---|---|
| `id` | `id` |
| `url` | `${SITE_URL}/properties/${id}` |
| `title`, `content` | `title`, `description` |
| `type` | `property_type` (mapa: apartment→flat, house→house, land/parcel→land, office, local→commercial, warehouse→warehouse, parking→parking) |
| `price` | `price` (+ `period` mensual si `status=for_rent`) |
| `address`, `city`, `region`, `postcode` | `address`, `city`, `state`, `zip_code` |
| `latitude`, `longitude` | `lat`, `lng` |
| `photos` | `images[]` (+ `video_url` como `multimedia`) |
| `floor_area`, `rooms`, `bathrooms`, `parking` | `area_sqm`, `bedrooms`, `bathrooms`, `parking_spots` |
| `date` | `created_at` |

### Arquitectura propuesta

- `lib/feeds/trovit.ts` — generador puro `Property[] → XML` con escape correcto y **tests** (XML bien formado, mapeo de tipos, arriendo con `period`, escape de `&<>'` en títulos).
- **Ruta `/feeds/trovit.xml`** (⚠️ **fuera de `/api/`**: `robots.ts` hoy bloquea `/api/` para crawlers, y el consumidor de un feed es un crawler — servido en `/api/` estaría vetado por el propio robots.txt).
- Por corredora con token: `/feeds/[partner].xml?token=...` (token estable por partner en Supabase). Per-feed evita publicar en abierto el contacto de agentes de todas las corredoras a cualquiera que encuentre la URL — el feed **debe** incluir contacto (es su propósito), pero eso lo decide cada corredora al activarlo.
- Cache ISR `revalidate: 3600`; los portales rastrean 1–2 veces al día.
- Sin CSP nueva: el feed lo consume un servidor, no el navegador.
- Sitemap: **no** incluir los feeds (no son páginas para buscadores genéricos).

### Esfuerzo total del feed

| Tarea | Esfuerzo |
|---|---|
| Generador Trovit + tests | ~3 h |
| Ruta + token por corredora + cache | ~2 h |
| Token en el modelo de partners + panel admin (activar/desactivar feed) | ~2 h |
| Documentación + `.env.example` + robots (excepción) | ~1 h |
| **Total** | **~1 día** |

## 4. Webhooks CRM: por qué diferirlos

Push de leads (`ContactAgentForm` → webhook de la corredora) tiene sentido solo con un CRM concreto que reciba: firma HMAC, reintentos con backoff, dead-letter, panel de estado. Son 2–3 días **sin cliente que lo pida**. La regla honesta: no se construye integración hasta que una corredora nombre su CRM. Costo de retomarlo después: nulo (el punto de emisión único sería `lib/api/leads`).

## 5. Alcance propuesto para el próximo sprint

| # | Tarea | Tipo | Esfuerzo |
|---|---|---|---|
| 1 | Activar alertas: variables en Vercel + secret en GitHub + dominio en Resend + dry-run | Configuración | ~30 min |
| 2 | Feed XML Trovit por corredora (generador + tests + ruta `/feeds/*.xml` + token + panel) | Desarrollo | ~1 día |
| 3 | Pilotear el feed con **una** corredora socia (elegir la que ya publique en portales) | Negocio | ~1 h |
| 4 | Webhooks CRM | **Diferido** — resolver cuando haya CRM nombrado | — |

Criterio de éxito del sprint: una corredora registra `https://rix7.cl/feeds/<partner>.xml` en un portal agregador y sus avisos aparecen allí; y al menos una persona recibe un correo de alerta con una propiedad nueva real.
