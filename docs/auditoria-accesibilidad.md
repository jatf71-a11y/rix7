# Auditoría de accesibilidad (plan fase 3, 3.3)

> Barrido automatizado con **axe-core** (el motor WCAG que usan Lighthouse y
> eslint-plugin-jsx-a11y) inyectado en un Chrome real vía CDP — el mismo criterio
> de `measure-vitals.mjs`: la app de producción, sin runners pesados. Última
> corrida: **2026-10-03** · build local de producción (`next start`), desktop
> (1280×800) y mobile (390×844), 6 rutas que representan cada plantilla.
>
> Comando para reproducir (o re-auditar después de los arreglos):
>
> ```
> npm run check:a11y                     # las 6 rutas, desktop, solo critical+serious
> npm run check:a11y -- --device=mobile  # mismo barrido en viewport mobile
> npm run check:a11y -- --all            # incluye moderados y menores
> npm run check:a11y -- /legal/privacidad --json   # una ruta, salida JSON
> ```
>
> Nota de alcance: axe-core cubre lo automático de WCAG 2.1 AA (~40 % de los
> criterios). Quedan fuera juicios que requieren persona: orden de lectura en
> carruseles, calidad de los textos alternativos, foco visible en overlays del
> mapa. La regla `region` está desactivada a propósito (app con mapa + listado +
> overlays: exigir landmarks perfectos en cada estado infla el informe sin
> proteger nada).

## Resultados por ruta (2026-10-03, build de producción)

| Ruta | Críticos | Serios | Moderados | Menores |
|---|---|---|---|---|
| `/` (desktop) | — | — | — | — |
| `/` (mobile) | — | — | — | — |
| `/properties/[id]` | — | — | — | — |
| `/empresas/[slug]` | — | — | — | — |
| `/compartir/[id]` | — | — | — | — |
| `/favoritos` | — | — | — | — |
| `/legal/privacidad` | — | — | — | — |

**El barrido queda con 0 hallazgos de ningún impacto en las 6 rutas, desktop y
mobile (`--all --fail-on-serious` sale con 0).** Antes del ciclo de arreglos, el
problema dominante era `color-contrast` (50 nodos en todo el portal) y `/` tenía
10 nodos críticos. La auditoría es paso bloqueante del CI (job `a11y` con
`--fail-on-serious`).

## Los problemas reales (ordenados por impacto)

### 1. ✅ Arreglado — Botones y selects sin nombre accesible — crítico, bloqueaba el uso por teclado/lector 🔴

> Re-auditado contra build de producción después del arreglo: **0 críticos en
> las 6 rutas**. El barrido completo de `/` pasó de 10 nodos críticos a 0
> (`button-name` y `select-name` fuera del informe); el único hallazgo crítico
> restante que apareció era la pareja de flechas del carrusel de socios, del
> mismo origen, y quedó incluido en el arreglo.

- **Carrusel destacado de la home** ([FeaturedCarousel.tsx:181](components/properties/FeaturedCarousel.tsx#L181)):
  los 8 botones de la barra de progreso son segmentos de `h-1` **vacíos**: sin
  texto ni `aria-label`. Un usuario de lector de pantalla escucha "botón, botón,
  botón…" ×8 sin saber que navegan el carrusel, y son el único control de
  navegación del carrusel (las flechas no existen).
- **Filtros de precio de la home** ([PropertyFilters.tsx:569-579](components/properties/PropertyFilters.tsx#L569-L579)):
  los 2 `<select>` de precio mín/máx no tienen `<label>` ni `aria-label`.
  "Cuadro combinado, 0 seleccionado" ×2 es indistinguible.

**Arreglo (~30 min):** `aria-label={`Ir al destacado ${idx + 1} de ${featured.length}`}`
en los botones del carrusel y `aria-label="Precio mínimo"` / `"Precio máximo"` en
los selects. Es de los arreglos más baratos y de mayor impacto del portal.

### 2. ✅ Arreglado — color-contrast: era 50 nodos en todo el portal 🟠

El clúster más grande, con 3 fuentes concretas:

| Fuente | Ejemplo | Arreglo |
|---|---|---|
| Badge `bg-emerald-600` con texto blanco a 10px bold (`Arriendo`) en las tarjetas | `/empresas`, fichas | `emerald-600` (#059669) vs blanco ≈ 3,0:1. Usar `emerald-700` (#047857 ≈ 4,5:1) en el badge |
| Toggle UF/US$ inactivo `text-slate-500` a 10px sobre `bg-slate-100` | header de todas las páginas | `text-slate-600` (#475569 ≈ 7:1) para el estado inactivo |
| Textos "apagados" `text-slate-400` a 10–12px (labels del footer, "Completa tus datos…", ©) | footer global, formularios, legal | `text-slate-500` en los que sean contenido informativo; los puramente decorativos pueden mantenerse |

No es un tema de gusto: 10px es el tamaño más usado del portal y justo el que
más exige contraste. La revisión completa nodo a nodo está en la salida de
`npm run check:a11y -- --all` (agrupa por regla con selector y HTML de cada nodo).

### 3. ✅ Arreglado — Enlaces legales sin subrayado — serio, y evidencia un bug de build 🟠

`/legal/privacidad` y `/legal/terminos`: los enlaces del cuerpo
(`privacidad@rix7.cl`, Vercel, Supabase) violan `link-in-text-block` porque axe
los ve **sin subrayado y con contraste 1,46:1 contra el texto circundante**
(#2563eb vs #475569). El código sí pone `underline underline-offset-2`
([content.tsx:40](lib/legal/content.tsx#L40))…

**Causa raíz:** [tailwind.config.ts](tailwind.config.ts) escanea solo `pages/`,
`components/` y `app/` — las clases de [lib/legal/content.tsx](lib/legal/content.tsx)
**no entran al content-scan y Tailwind nunca genera ese CSS**. El subrayado no
existe en producción. Enlaza con los sustos previos de CSP/config: contenido
fuera de los globs = clases muertas silenciosas.

**Arreglo (hecho 2026-09-30):** se agregó `'./lib/**/*.{js,ts,jsx,tsx,mdx}'` a
`content` de [tailwind.config.ts](tailwind.config.ts). Re-auditado: `link-in-text-block`
fuera del informe, `/legal/*` queda sin hallazgos critical/serious.

### 4. ✅ Arreglado — Marcador de la ficha sin nombre — serio 🟠

El `divIcon` principal del mapa de `/properties/[id]`
([PropertyMapLeaflet.tsx:133](components/map/PropertyMapLeaflet.tsx#L133)) es un
`<div>` decorativo que Leaflet envuelve con `role="button" tabindex="0"`: axe lo
reporta como `aria-command-name`. El usuario de teclado puede enfocarlo pero
no sabe qué es ("botón" sin más); Enter no hace nada visible sin popup previo.

**Arreglo (hecho 2026-09-30):** `title` de Leaflet en los marcadores de
propiedad y POIs ([PropertyMapLeaflet.tsx](components/map/PropertyMapLeaflet.tsx)):
Leaflet lo copia al elemento interactivo (`role="button"` con `tabindex="0"`)
que envuelve al divIcon, que es exactamente el nombre accesible que axe exigía —
y de paso da tooltip nativo. Los clusters no lo necesitan: su ícono ya lleva el
número como texto. Re-auditado: `aria-command-name` fuera del informe.

### 5. ✅ Arreglado (2026-10-03) — Jerarquía de encabezados y alts redundantes 🟡

Los tres moderados de la ronda anterior quedaron cerrados:

- **`heading-order` en la home** (un `h3` de la tarjeta destacada saltaba desde
  `h2`): el título del carrusel destacado pasó de `h3` a `h2`
  ([FeaturedCarousel.tsx](components/properties/FeaturedCarousel.tsx)) y el título
  del panel de contacto de la ficha de `h4` a `h3`
  ([ContactAgentForm.tsx](components/properties/ContactAgentForm.tsx)).
- **`image-redundant-alt`** (18 nodos en la home y en `/compartir/[id]`): los
  logos que ya van acompañados del nombre en texto pasan a decorativos con
  `alt=""` y `aria-hidden` ([PartnerLogo.tsx](components/properties/PartnerLogo.tsx),
  [PartnerLogosCarousel.tsx](components/properties/PartnerLogosCarousel.tsx),
  [SharePropertyLanding.tsx](app/compartir/[id]/SharePropertyLanding.tsx)).
- **`/empresas/[slug]`**: el listado de propiedades va precedido de un `h2`
  solo-para-lectores que da contexto a la sección
  ([EmpresaDetail.tsx](app/empresas/[slug]/EmpresaDetail.tsx)).

### 6. ✅ Arreglado (2026-10-03) — La home mobile podía quedar sin `h1` 🟡

Era el último hallazgo del barrido, y solo en **mobile**: `page-has-heading-one`.
Causa: el `h1` de la home («Propiedades en … en …») vive dentro del panel de
listado ([HomeClient.tsx:543](app/HomeClient.tsx#L543)), y en mobile ese panel se
oculta (`hidden md:block`) cuando la vista activa es el mapa. Con el mapa en
pantalla no había ningún `h1` en el documento.

**Arreglo:** un `h1` solo-para-lectores, **fuera** del panel y siempre presente
([HomeClient.tsx](app/HomeClient.tsx)), con `sr-only md:hidden`: cubre el estado
mobile sin panel y se oculta en `md` para no duplicar el encabezado cuando el
panel —y su `h1` visible— ya está en pantalla. Verificado en el navegador: en
mobile el `h1` existe siempre; en desktop hay exactamente un `h1` visible.
Re-auditado: `page-has-heading-one` fuera del informe, en los dos viewports.

## Qué NO es problema (medido, no asumido)

- **`meta-viewport`**: el zoom no está bloqueado (regla verde en todas las rutas).
- **Estructura de listas y formularios de contacto**: sin violaciones.
- **`/favoritos` y `/legal`**: estructura limpia.
- **Desktop y mobile dan el mismo informe**: sin hallazgos. Los `color-contrast`
  y `video-caption` que axe marca como indeterminados quedan para revisión a
  mano (no son violaciones), igual que antes.

## Orden sugerido de arreglos (input de la fase de corrección)

1. ✅ **Hecho (2026-09-30)** — **Nombres accesibles** (problema 1): `aria-label`
   en los 6 botones de progreso del carrusel destacado
   ([FeaturedCarousel.tsx](components/properties/FeaturedCarousel.tsx)), en los
   selects de precio mín/máx ([PropertyFilters.tsx](components/properties/PropertyFilters.tsx))
   y en las flechas del carrusel de socios
   ([PartnerLogosCarousel.tsx](components/properties/PartnerLogosCarousel.tsx)).
   Verificado re-auditando contra build de producción: 0 críticos.
2. ✅ **Hecho (2026-09-30)** — **Content-glob de Tailwind** (problema 3):
   `lib/` entra al content-scan; los subrayados legales ya se generan.
3. ✅ **Hecho (2026-09-30)** — **Contraste** (problema 2): toggles de moneda
   inactivos `slate-500→600` (PropertyFilters y CurrencySelector), badges
   `emerald-600→700` en tarjetas/fichas/compartir, botón «Nuevas»
   `emerald-600→700` con checks `emerald-700`, textos informativos
   `slate-400→500` (footer, «Cargando», formularios de contacto, titulares de
   sección de la home y nota metodológica de POIs), y la **paleta completa de
   POIs 500→700** ([poiCategories.ts](lib/data/poiCategories.ts)) — pinta chips,
   contadores y clusters con blanco a 10px. Re-auditoría completa: 0 serios en
   5 de 6 rutas; queda el marcador del mapa (4) y los moderados (5).
4. ✅ **Hecho (2026-09-30)** — **Marcadores del mapa con nombre** (problema 4):
   `title` de Leaflet en propiedad y POIs; verificado con re-auditoría.
5. ✅ **Hecho (2026-10-03)** — **Encabezados y alts redundantes** (problema 5):
   `h3→h2` en el carrusel destacado, `h4→h3` en el contacto de la ficha, logos
   redundantes a decorativos y `h2` `sr-only` en `/empresas`. Re-auditado: fuera
   del informe.
6. ✅ **Hecho (2026-10-03)** — **`h1` de la home siempre presente** (problema 6):
   un `h1` `sr-only md:hidden` fuera del panel que se oculta en mobile. El barrido
   queda sin hallazgos de ningún impacto en los dos viewports.

✅ **Hecho (2026-09-30)** — paso bloqueante del CI (job `a11y` en
[ci.yml](../.github/workflows/ci.yml)): levanta la build del PR con `next start`
y corre `npm run check:a11y -- --fail-on-serious` con el Chrome preinstalado del
runner. El artifact del job `verify` ahora viaja completo (sin `.next/cache`)
para que el budget y este job bajen la misma build.

## Cómo se midió

Script propio [scripts/audit-a11y.mjs](../scripts/audit-a11y.mjs) (npm run
`check:a11y`): levanta un Chrome headless real, navega cada ruta, espera el
settle de hidratación (2,5 s), inyecta `axe.min.js` y corre `axe.run` con
`resultTypes: ['violations']`. El informe agrupa por regla con impacto, selector
y snippet de cada nodo, y cierra con el ranking "los 5 arreglos más caros".
Mismo enfoque sin dependencias de runtime pesadas que `measure-vitals.mjs`;
`axe-core` es devDependency y viaja solo hasta el script.

La corrida del 2026-10-03 se hizo contra la **build de producción** (`next start`)
en los dos viewports, para que lo medido sea lo que verá el usuario y no el
resultado de `next dev`:

```
npm run build
npx next start -p 3311
npm run check:a11y -- --base=http://localhost:3311 --all --fail-on-serious
npm run check:a11y -- --base=http://localhost:3311 --all --device=mobile --fail-on-serious
```

Los dos barridos salen con código 0 y sin hallazgos de ningún impacto. La
re-auditoría del problema 6 (el `h1` mobile) se hizo sobre la misma build de
producción, repitiendo los dos comandos.
