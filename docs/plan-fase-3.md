# Plan de fase 3 — activar, endurecer, medir, ampliar

> Sucesor del roadmap de `AUDITORIA_FASE2.md` (sprints 2–3), reordenado con lo aprendido al cierre: parte de la fase 2 quedó **a medio activar** (alertas, feed, monitoreo), el QA de producción destapó un riesgo nuevo (Service Worker con cachés viejas tras cada deploy) y un ítem del roadmap resultó ya resuelto. Principio rector: **primero exprimir lo construido (configuración barata), luego endurecer, medir con datos reales y solo entonces ampliar.** Los ítems condicionales llevan disparador explícito para no construir por anticipado.

## Tanda 0 — Activación (configuración, ~1 h total, sin código)

Lo más barato y de mayor impacto: todo el código ya está en producción esperando variables.

| # | Tarea | Dónde | Verificación de que quedó activa |
|---|---|---|---|
| 0.1 | **Sentry**: `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` (+ org/project/token para sourcemaps) | Vercel → env vars → redeploy | Error de prueba visible en Sentry → Issues con `environment: production`; guía `docs/activar-monitoreo-vercel.md` |
| 0.2 | **Vercel Web Analytics**: toggle | Dashboard → Analytics | Tráfico en la pestaña tras ~10 min |
| 0.3 | **Alertas**: `ALERTS_CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ALERTS_FROM_EMAIL` | Vercel + GitHub secrets (el cron ya configurado) | `GET /api/alerts/run` → tres `true`; dry-run del workflow limpio; primera corrida real fija línea base |
| 0.4 | **Migración del feed**: ejecutar el `supabase/schema.sql` actualizado (columnas `feed_enabled`/`feed_token_hash`) | Supabase SQL Editor | Activar feed de una corredora en el panel genera token y modal de única vez |

**Criterio de éxito de la tanda**: un error real llega a Sentry, el cron corre solo cada mañana, y la URL `/feeds/<slug>.xml?token=…` de la corredora piloto devuelve XML válido.

## Tanda 1 — Endurecimiento inmediato (días 1–3)

| # | Tarea | Motivo | Esfuerzo |
|---|---|---|---|
| 1.1 | ✅ **Hecha** — **Service Worker resistente a deploys**: bump de versión de caché por deploy (`?v=<SHA>` → `rix7-runtime-<SHA>`) + `skipWaiting` solo bajo aviso de "nueva versión disponible" | El QA de producción lo evidenció: un navegador con la caché `rix7-v2` vieja sirvió recursos muertos (imágenes y tiles fallando) hasta desregistrarlo a mano. Cada deploy vuelve a exponerlo para todos los visitantes recurrentes | ~3 h |
| 1.2 | ✅ **Hecha** — **knip + guard CSP como gating del CI** | Ya existen como tests; hacerlos bloqueantes evita regresiones de dependencias muertas y de hosts sin permiso (la CSP ya costó dos sustos: tiles y Sentry) | ~1 h |
| 1.3 | ✅ **Hecha** — **Performance budget en el CI**: techo de First Load JS (línea base gzip auto-generada + tolerancia 5 kB, fail-closed) que falla el build si se supera | Proteger las ganancias de fase 1: hoy cualquier dependencia puede inflar el bundle sin que nadie lo note | ~3 h |
| 1.4 | ✅ **Hecha** (receptor desplegado; falta conectar la regla en el dashboard de Sentry cuando exista la cuenta — pasos en `docs/activar-monitoreo-vercel.md`, Parte 3) — **Alertas de Sentry → correo** con umbral de severidad (`error`/`fatal`) | Depende de 0.1: que un error avise solo, no que haya que mirar el dashboard | ~2 h |

**Criterio de éxito**: un visitante recurrente no nota jamás un deploy (1.1); el CI bloquea un PR que infle el bundle o introduzca un host sin CSP (1.2–1.3); un error pico despierta a alguien (1.4).

## Tanda 2 — SEO y datos (semanas 1–2)

| # | Tarea | Motivo | Esfuerzo |
|---|---|---|---|
| 2.1 | ✅ **Hecha** (falta ejecutar `supabase/migracion-partner-id.sql` en el SQL Editor) — **`partner_id` en la tabla `properties`** de Supabase (columna + política del RPC `get_properties_filtered`) | La tabla no puede atribuir propiedades a corredoras: el feed solo exporta catálogo, y `/empresas/[slug]` filtra en cliente. Es la ampliación de esquema que la evaluación #14 dejó documentada | ~3 h |
| 2.2 | ✅ **Hecha** — **Sitemap dinámico completo**: propiedades publicadas en caliente dentro del `sitemap.xml` (tabla + catálogo deduplicados, revalidate 1 h) | Lo publicado hoy no se indexa hasta el próximo deploy | ~2 h |
| 2.3 | ✅ **Hecha** — **`opengraph-image` dinámico por ficha** (reutiliza `ShareCardLandscape` de `/compartir`) | CTR en redes para URLs de `/properties/[id]`: hoy comparten tarjeta genérica | ~4 h |
| 2.4 | **Piloto del feed**: registrar la URL de la corredora piloto en un agregador y confirmar el rastreo | Criterio de negocio del #14: que los avisos aparezcan fuera | ~1 h + espera del rastreo |

**Criterio de éxito**: la corredora piloto ve sus avisos en el agregador; una ficha compartida por WhatsApp muestra tarjeta propia; el sitemap incluye propiedades creadas tras el último deploy.

## Tanda 3 — Medir con datos reales (semana 2–3, depende de Tanda 0)

| # | Tarea | Motivo | Esfuerzo |
|---|---|---|---|
| 3.1 | ✅ **Hecha** — **Línea base de CWV** medida contra producción (`docs/cwv-baseline.md`): los 5 problemas reales ordenados por impacto — el mayor: CLS de la home 0,46–0,49 (POBRE) y LCP 2–2,7 s por render 100% cliente; fichas y /empresas en verde | Sin números no hay prioridades: LCP de fichas con imágenes remotas era el candidato y resultó sano; el problema real está en la home | ~2 h |
| 3.5 | **Arreglo del CLS de la home** (0,458 → 0,0055, ver `docs/cwv-baseline.md`) | Era el mayor problema medido del portal y el más barato de arreglar: dos de los cuatro desplazamientos aportaban 0,42 del total | ~2 h |
| 3.2 | **Revisión de Sentry a 2 semanas**: top errores, rutas más lentas (traces al 10%) | Priorizar la fase siguiente con evidencia, no con intuición | ~2 h |
| 3.4 | ✅ **Hecha** — **Registro de la visita desde el Navbar** (`RegistrationModal`): botón «Regístrate» en lugar de «Entrar», datos de contacto + los cuatro bloques de autorización (dos obligatorios, dos opcionales sin premarcar) y permisos del navegador, con correo de bienvenida vía Resend | El formulario de contacto volvía a pedir nombre, correo y teléfono en cada ficha; registrarse una vez elimina esa fricción y deja rastro de las autorizaciones | ~1 día |
| 3.3 | ✅ **Hecha** — **Auditoría de accesibilidad con axe-core** (`docs/auditoria-accesibilidad.md`, script `npm run check:a11y`): 5 problemas reales — el mayor crítico: botones del carrusel y selects de precio sin nombre accesible; color-contrast concentra 50 nodos; además destapó que las clases de `lib/legal/content.tsx` no entran al content-scan de Tailwind (enlaces sin subrayado en producción) | La fase 1 no la cubrió; el portal tiene divs con roles complejos (mapas, carruseles). El gating en CI queda para después de los arreglos (mismo patrón que knip/budget) | ~1 día |
| 3.6 | ✅ **Hecha** (falta ejecutar el bloque de `public.signups` en el SQL Editor) — **Persistencia de los registros y sus autorizaciones**: tabla `public.signups` solo-anexa (INSERT público con el mínimo legal exigido por la propia política, SELECT y DELETE de admin, **sin UPDATE**), alta conectada en `/api/registro` y pantalla `/admin/registros` con las cuatro autorizaciones de cada persona y el resumen de las opcionales | La constancia de consentimiento vivía solo en una línea de log que se pierde en cada deploy: no había forma de responder quién autorizó publicidad o cesión a socios, ni desde cuándo | ~4 h |

**Criterio de éxito**: documento de una página con los 5 problemas reales más caros ordenados por impacto medido — esa lista es el input de la fase 4.

## Disparadores para lo condicional

| Ítem | Se construye solo cuando… |
|---|---|
| **Webhooks CRM** (diferido de #14) | …una corredora nombre su CRM. Punto de emisión único ya identificado (`lib/api/leads`) |
| **Rate limit distribuido (Upstash)** | …el tráfico multi-instancia vuelva real el límite por instancia (medir en Analytics/Sentry) |
| **Feed de import / CRMs entrantes** | …haya 2+ corredoras pidiendo sincronizar su inventario |

## Fuera de alcance de la fase 3 (recordatorios de negocio)

- **Revisión profesional de los textos legales** (DMA / Ley 19.628) antes de operar con datos personales reales — bloqueante comercial, no técnico. El registro de autorizaciones ya queda en `public.signups` con la versión de los textos aceptados (`CONSENT_VERSION`): lo que falta revisar son los textos, no el mecanismo.
- **Dominio rix7.cl**: conectarlo cuando esté disponible y actualizar `SITE_URL` (GitHub variable + Vercel) y los redirect URLs de Supabase.
- Corredoras reales: contactos placeholder del catálogo (`+56 2 2000 00XX`) deben reemplazarse antes de cualquier campaña.

## Orden resumido

```
T0 (1h)   Activar: Sentry · Analytics · Alertas · migración feed
T1 (3d)   Endurecer: SW por deploy · CI gating (knip/CSP/budget) · alertas Sentry
T2 (2sem) Datos: partner_id en Supabase · sitemap · OG images · piloto feed
T3 (2sem) Medir: CWV baseline · revisión Sentry · accesibilidad axe
→ input de fase 4: la lista de problemas medidos, no supuestos
```
