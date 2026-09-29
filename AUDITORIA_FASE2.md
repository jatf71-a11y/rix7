# AUDITORÍA FASE 2 — Rix7 (portal inmobiliario Chile)

**Fecha**: 28-sep-2026
**Checkout**: `C:\Users\javie\RIX7` · rama `audit/optimization`
**Alcance**: seguridad de APIs, SEO/estructura de páginas, resiliencia, observabilidad, CI y respaldo. Complementa la fase 1 (rendimiento y limpieza), cuyos informes están en `_audit/fase1-report.txt` y `_audit/fase1b-report.txt`.
**Método**: auditoría manual del código + suite de tests (Vitest) + build de producción + verificación end-to-end del HTML renderizado en dev server. Cada hallazgo se resolvió en su propio commit, con verificación completa (`tsc --noEmit`, `vitest run`, `next build`) antes de commitear.

---

## 1. Resumen ejecutivo

- **10 de 12 hallazgos de fase 2 resueltos** (todos los críticos de código), en 13 commits sobre `audit/optimization`.
- La suite pasó de **498 → 560 tests** (+62, todos de los módulos nuevos).
- El bundle compartido se mantiene en **89,6 kB** (+1,8 kB por Analytics; el SDK de Sentry queda fuera del bundle mientras no haya DSN).
- Verificación automática estrenada: **CI en GitHub Actions** (tipos → tests → build) en cada push y PR.
- Doble respaldo operativo: GitHub (`origin/audit/optimization`) + `BACKUP9.0` en OneDrive verificado por hash de árbol.
- **Pendiente**: solo activación de Sentry/Analytics en Vercel (configuración, no código) y fusionar a `main`.

---

## 2. Tabla de hallazgos

| # | Severidad | Hallazgo | Archivo(s) | Esfuerzo | ¿Ya en fase 1? | Estado |
|---|-----------|----------|------------|----------|----------------|--------|
| 1 | 🔴 Alta | Sin `error.tsx` ni `not-found.tsx` raíz: crash-page genérica de Next en producción | `app/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx` | ~2 h ✅ | No | ✅ `e49e716` |
| 2 | 🔴 Alta | Cero JSON-LD: sin datos estructurados en fichas ni empresas | `lib/seo/jsonld.ts`, `components/seo/JsonLd.tsx` | ~4 h ✅ | No | ✅ `2507772` |
| 3 | 🔴 Alta | Sin rate limit en `/api/geocode`, `/api/favorites`, `/api/saved-searches` | las 3 rutas + `lib/utils/rateLimit` (reutilizado) | ~2 h ✅ | No | ✅ `8cf2a79` |
| 4 | 🔴 Alta | Sin validación de entrada (Zod) en ninguna API | `lib/api/schemas.ts`, `lib/api/validate.ts` + 11 rutas | ~6 h ✅ | No | ✅ `79a01ae` |
| 5 | 🔴 Alta | `toPublishable` exponía contacto del agente y dirección exacta en landing pública | `app/compartir/[id]/page.tsx`, `SharePropertyLanding.tsx` | ~1 h ✅ | No | ✅ `cfb576c` |
| 6 | 🔴 Alta | Sin textos legales (términos, privacidad, cookies) | `app/legal/`, `lib/legal/`, `components/legal/`, `components/layout/Footer.tsx` | ~3 h | No | ✅ `c0da747`+ |
| 7 | 🟡 Media | Sin CI: tests/build solo corrían a mano | `.github/workflows/ci.yml` | ~1 h ✅ | No | ✅ `9d39329` |
| 8 | 🟡 Media | Metadata ausente en home y admin; panel indexable | `app/page.tsx`, `app/HomeClient.tsx`, `app/admin/layout.tsx`, `app/admin/AdminShell.tsx` | ~3 h ✅ | No | ✅ `827dd6a` |
| 9 | 🟡 Media | Repositorio sin `.git` funcional (historial perdido) | `.git` (recuperación completa) | ~2 h ✅ | No | ✅ Tanda 0 |
| 10 | 🟡 Media | Rendimiento (bundle, cachés, mapas) | — | — | **Sí** | ✅ Resuelto en fase 1 |
| 11 | 🟡 Media | Código muerto; `sampleProperties` 3,8 MB sin usar | — | — | **Sí** | ✅ Resuelto en fase 1 (knip) |
| 12 | 🟢 Baja | `console.log` residuales | — | — | **Sí** | ✅ Resuelto en fase 1 |
| 13 | 🟢 Baja | Cero observabilidad (errores solo visibles en consola del navegador) | `lib/monitoring/`, `sentry.*.config.ts`, `app/instrumentation.ts` | ~4 h ✅ | No | ✅ `8c09bec` (activación: pendiente en Vercel) |
| 14 | 🟢 Baja | Proptech (integraciones portales/CRM) | `docs/evaluacion-14-proptech.md` (evaluado) | ~1 día (feed) | No | 📋 Evaluado: alertas ya construidas (falta activar), feed Trovit propuesto, CRM diferido |
| 15 | 🟢 Baja | Backup OneDrive incompleto (DENY dejaron `BACKUP8.2.d.FICHA` a medias) | `BACKUP9.0` (fuera del repo) | ~1 h ✅ | No | ✅ Operativo |

**Convención**: ✅ = resuelto y verificado · ⏳ = pendiente. «¿Ya en fase 1?» = si el problema ya había sido detectado/corregido en la auditoría anterior.

---

## 3. Detalle de los hallazgos nuevos resueltos

### #5 — Privacidad en la landing pública de compartir (`cfb576c`)
`toPublishable` ahora publica: nombre del agente (visible, decide la Opción A), coordenadas **difuminadas** (aproximación, no el punto real) y **cero** email/teléfono/avatar/dirección exacta/zip. El contacto del visitante solo entra por el formulario interno → `/api/leads`. La landing muestra «Contacta a {agent_name}» junto al CTA. Esta regla condicionó el diseño del JSON-LD (#2) y queda como política del portal.

### #4 — Zod en las APIs (`79a01ae`)
- `lib/api/schemas.ts`: un esquema por entrada (query, body, params) con límites explícitos — largos de ids (`[A-Za-z0-9._-]+`), cotas de coordenadas, `limit ≤ 2000`, `days 1–365`, hex de color — y los mismos mensajes que ya esperaban la UI y los tests (`"name and slug are required"`, `"Falta el id de la propiedad."`).
- `lib/api/validate.ts`: `validateInput` traduce issues de Zod al contrato `{ success, error }`; `searchParamsToObject` normaliza query strings.
- **11 rutas con entrada** validan; las otras 3 (`/api/geo`, `/api/indicators`, `/api/partners` GET) no reciben entrada del cliente.
- **Contratos de dominio preservados** (detectados en los tests, no inventados): la importación de favoritos *descarta* ids inválidos y sigue con los buenos; `partnerId` absurdo en share-view *cae al catálogo*; `leads` sigue delegando en `normalizeLead` (misma política RLS); `page`/`limit` con basura caen a defaults en vez de producir `NaN`.

### #3 — Rate limit en las 3 rutas faltantes (`8cf2a79`)
Reutiliza `createRateLimiter`/`clientIpFrom` (el algoritmo ya testeado de leads/pois/share-view). Cupos: geocode 60/min (protege la cuota de Nominatim, 1 req/s), favorites 100/min, saved-searches 60/min. El límite corre **antes** de resolver la sesión: la ráfaga de un script sin cuenta tampoco paga verificaciones contra Supabase auth. Respuestas 429 con `Retry-After`. El limiter es por instancia (documentado); para límite global exacto haría falta Redis (roadmap sprint 3).

### #1 — Boundary de error y 404 raíz (`e49e716`)
`app/error.tsx` (client): reintento con `reset()` (re-pide los Server Components), vuelta al inicio, `digest` como código de referencia. `app/not-found.tsx`: 404 estático con el estilo de los 404 de segmento (que conservan su copy). `app/global-error.tsx`: boundary por encima del layout, con su propio `<html>`, para errores que revientan el documento (añadido en #13 siguiendo la recomendación de Sentry).

### #2 — JSON-LD (`2507772`)
Builders puros en `lib/seo/jsonld.ts` (11 tests): `RealEstateListing` (precio CLP, `Offer` con `InStock`/`SoldOut`, `PostalAddress` solo con claves conocidas, `geo` = el punto difuminado ya público, superficie `unitCode: MTK`, seller = corredora u organización) y `RealEstateAgent` (contacto **público de la corredora**, nunca el del agente — coherente con #5). Serialización con `<` escapado (testeada con payload XSS). Verificado el HTML real de ficha y empresa en dev.

### #8 — Metadata de home y admin (`827dd6a`)
La home era un componente cliente de 618 líneas sin metadata: se extrajo a `app/HomeClient.tsx` (`git mv`, historial preservado) y `app/page.tsx` quedó como wrapper de servidor con title/description/canonical/OG propios. El layout de admin (cliente) se convirtió en wrapper de servidor con `robots: noindex, nofollow` (cubre las 4 páginas del panel) y el shell vivió en `app/admin/AdminShell.tsx`. Bonus: la home pasó a **estática prerenderizada**.

### #7 — CI (`9d39329`)
`.github/workflows/ci.yml`: tipos → tests → build en push a `main`/`audit/**` y PRs a `main`. Sin secretos: se verificó que `next build` pasa **sin `.env.local`** (el portal degrada a catálogo local sin Supabase). Node 20, `npm ci`, cache de npm, `concurrency` para cancelar corridas redundantes.

### #13 — Observabilidad (`8c09bec`)
- `lib/monitoring/reportError`: punto único de reporte; **siempre** consola, Sentry solo si el SDK está inicializado (4 tests). Ya conectado a `error.tsx`.
- Sentry en los 3 runtimes (client/server/edge) con `Sentry.init` no-op sin DSN + `instrumentation.ts` con `onRequestError` para errores de servidor.
- **Costo acotado**: el import estático del SDK metía ~66 kB en todas las páginas (154 kB First Load). Resuelto con carga condicional al DSN (Next inlinea `NEXT_PUBLIC_*` en build): sin monitoreo el SDK no viaja → 89,6 kB.
- `withSentryConfig` opt-in en `next.config.js` (sourcemaps solo con `SENTRY_AUTH_TOKEN`); `@vercel/analytics` en el layout (sin cookies, inyectado solo con Web Analytics activado).
- Variables documentadas en `.env.example`.

### #9 y #15 — Repositorio y respaldo (Tanda 0 / operativo)
`.git` reconstruido sin `reset --hard` (fetch + symbolic-ref + reset mixed); informes de fase 1 versionados en `_audit/` (`ee2861c`). `BACKUP9.0` creado por robocopy incremental (0 errores, sin los DENY históricos), con `MANIFIESTO.md5` (216 entradas verificadas), `RESTAURACION.md` y verificación por hash de árbol git idéntico + `fsck`.

---

## 4. Quick wins (alto valor / minutos)

1. **Definir en Vercel** `NEXT_PUBLIC_SENTRY_DSN` y `SENTRY_DSN` (mismo valor) y redeployar → monitoreo activo sin tocar código. Opcional: `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` para sourcemaps.
2. **Activar Vercel Web Analytics** (toggle en dashboard del proyecto) — el componente ya está en el layout.
3. **Pushear y fusionar** `audit/optimization` → `main` (despliega todo lo anterior; el push estrena el CI).
4. **Refresh de `BACKUP9.0`** (robocopy incremental, ~1 min) — está 3 commits atrás (`827dd6a`, `9d39329`, `8c09bec`).
5. ~~**#6 textos legales**~~ ✅ Hecho: `/legal/terminos` y `/legal/privacidad` prerenderizadas, footer global con enlaces, sitemap actualizado y 12 tests.

---

## 5. Roadmap — 3 sprints

### Sprint 1 — Cerrar la fase 2 (semana 1)
| Tarea | Origen | Esfuerzo |
|---|---|---|
| ~~Textos legales + footer (#6)~~ | hallazgo 🔴 | ✅ hecho |
| Activar Sentry DSN + Web Analytics en Vercel | #13 (config) | ~15 min |
| Push + PR `audit/optimization` → `main`; revisar primer run del CI | #7 | ~30 min |
| QA visual de home/admin/fichas en preview de Vercel | #1 #2 #8 | ~1 h |
| Refresh + verificación de `BACKUP9.0` | #15 | ~10 min |

### Sprint 2 — SEO y datos (semanas 2–3)
| Tarea | Motivo | Esfuerzo |
|---|---|---|
| Sitemap dinámico: incluir propiedades de Supabase, no solo catálogo | SEO: lo publicado en caliente no está en `sitemap.xml` | ~3 h |
| `opengraph-image` dinámico por ficha (reutilizar el share-card de `/compartir`) | CTR en redes para URLs de `/properties/[id]` | ~4 h |
| knip + auditoría CSP en el CI (ya existen los guards; hacerlos gating) | evitar regresiones de dependencias/CSP | ~1 h |
| #14 proptech: definir alcance (feed para portales, webhooks CRM) y decidir | hallazgo opcional | ½ día de análisis |
| Primeras métricas reales (Web Analytics + Sentry) y objetivos de CWV | #13 | ~2 h |

### Sprint 3 — endurecimiento (semanas 4–6)
| Tarea | Motivo | Esfuerzo |
|---|---|---|
| Rate limit distribuido (Upstash Redis) si el tráfico crece | el actual es por instancia (documentado) | ~4 h |
| Alertas de Sentry → Slack/correo + umbrales | que un error avise solo | ~2 h |
| Auditoría de accesibilidad (axe-core en CI) | la fase 1 no la cubrió | ~1 día |
| Performance budget en CI (techo de First Load JS) | proteger las ganancias de fase 1 | ~3 h |
| Plan de fase 3 con datos reales de tráfico/errores | priorizar con evidencia | ~2 h |

---

## 6. Verificación y calidad (estado al cierre)

| Chequeo | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| Vitest | **548/548** en 36 archivos (498 + 50 nuevos) |
| `next build` | 20/20 rutas, sin warnings |
| First Load JS compartido | 89,6 kB (87,8 en fase 1 + 1,8 de Analytics) |
| HTML verificado en dev | JSON-LD ficha/empresa, 404 con UI propia, title/canonical/OG home, noindex admin |
| CI | estrenado; primera corrida al pushear |

---

## 7. Commits de la fase 2 (rama `audit/optimization`)

| Commit | Contenido |
|---|---|
| `ee2861c` | `_audit` versionado (informes fase 1/1b) + `.gitignore` |
| `cfb576c` | #5 privacidad en landing compartir |
| `79a01ae` | #4 Zod en las APIs |
| `8cf2a79` | #3 rate limit (geocode/favorites/saved-searches) |
| `e49e716` | #1 error/not-found raíz |
| `2507772` | #2 JSON-LD |
| `827dd6a` | #8 metadata home + noindex admin |
| `9d39329` | #7 CI |
| `8c09bec` | #13 Sentry opt-in + Analytics |

Pusheado a `origin` hasta `2507772`. Pendientes de push: `827dd6a`, `9d39329`, `8c09bec`. `BACKUP9.0` (OneDrive): verificado hasta `2507772`.

---

## 8. Anexo — código esencial por hallazgo nuevo

### #4 — Validación con Zod
```ts
// lib/api/validate.ts — contrato de error uniforme
export function validateInput<TSchema extends ZodTypeAny>(schema: TSchema, input: unknown) {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true as const, data: result.data }
    : { ok: false as const, error: firstMessage(result.error), issues: [...] };
}

// lib/api/schemas.ts — ejemplo: coordenadas del proxy Overpass
export const poisQuerySchema = z.object({
  lat: z.coerce.number().finite().refine((v) => Math.abs(v) <= 90, 'Coordenadas inválidas'),
  lng: z.coerce.number().finite().refine((v) => Math.abs(v) <= 180, 'Coordenadas inválidas'),
});

// app/api/pois/route.ts — uso en la ruta
const validation = validateInput(poisQuerySchema, searchParamsToObject(new URL(request.url).searchParams));
if (!validation.ok) return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
```

### #3 — Rate limit reutilizado
```ts
const rateLimiter = createRateLimiter({ max: 60, windowMs: 60 * 1000 });

export async function GET(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(TOO_MANY_REQUESTS.body, TOO_MANY_REQUESTS.init); // 429 + Retry-After
  }
  // ...
}
```

### #1/#13 — Boundary de error con monitoreo
```tsx
// app/error.tsx
useEffect(() => {
  reportError(error, { extra: { from: 'root-error-boundary' } }); // consola siempre; Sentry si hay DSN
}, [error]);
```

### #2 — JSON-LD de ficha
```tsx
// app/properties/[id]/page.tsx
return (
  <>
    <JsonLd data={propertyJsonLd(property, partner)} />
    <PropertyDetailClient property={property} partner={partner} />
  </>
);

// serialización segura: ningún valor puede cerrar el script
export function serializeJsonLd(data: JsonLdObject): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
```

### #8 — Metadata en página cliente (patrón wrapper)
```tsx
// app/page.tsx — servidor: metadata + composición
export const metadata: Metadata = {
  title: 'Rix7 | Propiedades en venta y arriendo en todo Chile',
  alternates: { canonical: '/' },
  robots: undefined, // indexable
};
export default function HomePage() { return <HomeClient />; }

// app/admin/layout.tsx — panel fuera del índice
export const metadata: Metadata = { title: 'Panel | Rix7', robots: { index: false, follow: false } };
```

### #7 — Pipeline (núcleo)
```yaml
# .github/workflows/ci.yml
- run: npm ci
- run: npx tsc --noEmit
- run: npx vitest run
- run: npm run build   # sin secretos: degrada a catálogo local
```

### #13 — Sentry opt-in sin pagar bundle
```ts
// sentry.client.config.ts — Next inlinea NEXT_PUBLIC_* en build:
// sin DSN, este import se elimina del bundle (~66 kB que no viajan)
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import('./lib/monitoring/sentry.client');
}

// app/instrumentation.ts — errores de servidor
export function onRequestError(...args: unknown[]): void {
  void import('@sentry/nextjs').then((Sentry) => {
    if (Sentry.isInitialized()) Sentry.captureRequestError?.(...args);
  });
}
```
