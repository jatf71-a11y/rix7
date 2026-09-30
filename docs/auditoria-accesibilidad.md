# Auditoría de accesibilidad (plan fase 3, 3.3)

> Barrido automatizado con **axe-core** (el motor WCAG que usan Lighthouse y
> eslint-plugin-jsx-a11y) inyectado en un Chrome real vía CDP — el mismo criterio
> de `measure-vitals.mjs`: la app de producción, sin runners pesados. Fecha:
> 2026-09-30 · build local de producción (`next start`, fase 3 al día), desktop
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

## Resultados por ruta

| Ruta | Críticos | Serios | Reglas falladas | Veredicto |
|---|---|---|---|---|
| `/` (desktop) | **10 nodos · 2 reglas** | 9 | 5 | 🔴 la peor: teclado inutilizable en carrusel y filtros de precio |
| `/` (mobile) | 2 nodos · 1 regla | 7 | 3 | 🟠 |
| `/properties/[id]` | — | 9 | 3 | 🟠 |
| `/empresas/[slug]` | — | 8 | 2 | 🟠 |
| `/compartir/[id]` | — | 17 | 3 | 🟠 |
| `/favoritos` | — | 4 | 1 | 🟡 |
| `/legal/privacidad` | — | 7 | 2 | 🟡 |

**El problema dominante es color-contrast (50 nodos en todo el portal). Los
críticos de teclado/lector de pantalla (botones y selects sin nombre) quedaron
arreglados el mismo día de la auditoría — ver «Estado de los arreglos» al pie.**

## Los 5 problemas reales más caros (ordenados por impacto)

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

### 2. color-contrast — 50 nodos en todo el portal 🟠

El clúster más grande, con 3 fuentes concretas:

| Fuente | Ejemplo | Arreglo |
|---|---|---|
| Badge `bg-emerald-600` con texto blanco a 10px bold (`Arriendo`) en las tarjetas | `/empresas`, fichas | `emerald-600` (#059669) vs blanco ≈ 3,0:1. Usar `emerald-700` (#047857 ≈ 4,5:1) en el badge |
| Toggle UF/US$ inactivo `text-slate-500` a 10px sobre `bg-slate-100` | header de todas las páginas | `text-slate-600` (#475569 ≈ 7:1) para el estado inactivo |
| Textos "apagados" `text-slate-400` a 10–12px (labels del footer, "Completa tus datos…", ©) | footer global, formularios, legal | `text-slate-500` en los que sean contenido informativo; los puramente decorativos pueden mantenerse |

No es un tema de gusto: 10px es el tamaño más usado del portal y justo el que
más exige contraste. La revisión completa nodo a nodo está en la salida de
`npm run check:a11y -- --all` (agrupa por regla con selector y HTML de cada nodo).

### 3. Enlaces legales sin subrayado — serio, y evidencia un bug de build 🟠

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

**Arreglo (~15 min):** agregar `'./lib/**/*.{js,ts,jsx,tsx,mdx}'` a
`content` de Tailwind. Además, el par azul #2563eb sobre #475569 cumple el 3:1
que `link-in-text-block` exige **solo** si el subrayado está presente — con el
bug arreglado, la regla queda verde sin tocar colores.

### 4. Marcador de la ficha sin nombre — serio 🟠

El `divIcon` principal del mapa de `/properties/[id]`
([PropertyMapLeaflet.tsx:133](components/map/PropertyMapLeaflet.tsx#L133)) es un
`<div>` decorativo que Leaflet envuelve con `role="button" tabindex="0"`: axe lo
reporta como `aria-command-name`. El usuario de teclado puede enfocarlo pero
no sabe qué es ("botón" sin más); Enter no hace nada visible sin popup previo.

**Arreglo (~15 min):** construir el HTML del divIcon con
`aria-label="<título de la propiedad>"` en el div interior (Leaflet copia los
atributos del html al elemento interactivo). Aplica a los tres divIcon
(propiedad, POI, cluster): los POI y clusters no aparecieron en el barrido de
esta ruta pero comparten el mismo patrón.

### 5. Jerarquía de encabezados y alts redundantes — moderado, pulido 🟡

- `/compartir/[id]`: un `h4` aparece sin `h2`/`h3` previos (`heading-order`).
  Revisar [ShareViewClient](components/share) al moverlo a la fase de arreglos.
- `/compartir/[id]`: el logo del header repite el nombre del sitio en `alt` y
  en el texto al lado (`image-redundant-alt`) → `alt=""` si el texto ya está.
- Home (18 nodos, mobile): las imágenes del carrusel repiten el alt en el texto
  de la tarjeta — mismo arreglo: si el texto visible ya describe la imagen, el
  alt debe ser vacío o complementario, no duplicado.

## Qué NO es problema (medido, no asumido)

- **`meta-viewport`**: el zoom no está bloqueado (regla verde en todas las rutas).
- **Estructura de listas y formularios de contacto**: sin violaciones.
- **`/favoritos` y `/legal`**: solo contraste; estructura limpia.
- La brecha desktop/mobile es solo el carrusel (los botones de la barra de
  progreso no existen en mobile): los problemas de fondo son los mismos.

## Orden sugerido de arreglos (input de la fase de corrección)

1. ✅ **Hecho (2026-09-30)** — **Nombres accesibles** (problema 1): `aria-label`
   en los 6 botones de progreso del carrusel destacado
   ([FeaturedCarousel.tsx](components/properties/FeaturedCarousel.tsx)), en los
   selects de precio mín/máx ([PropertyFilters.tsx](components/properties/PropertyFilters.tsx))
   y en las flechas del carrusel de socios
   ([PartnerLogosCarousel.tsx](components/properties/PartnerLogosCarousel.tsx)).
   Verificado re-auditando contra build de producción: 0 críticos.
2. **Content-glob de Tailwind + subrayado legal** (problema 3) — 15 min y
   elimina una clase entera de violación por la raíz.
3. **Contraste** (problema 2) — ~2 h de barrido: badge emerald → 700, slate-500
   → 600, revisar los `text-slate-400` caso a caso. Re-auditar con
   `--fail-on-serious` para fijar línea base.
4. **divIcon del mapa con aria-label** (problema 4) — 15 min.
5. **Encabezados y alts redundantes** (problema 5) — 30 min.

Después del paso 3, sumar `npm run check:a11y -- --fail-on-serious` como paso
del CI (mismo patrón que knip/budget) para que las regresiones no vuelvan a
entrar — requiere un servidor corriendo, así que es un job separado con
`next start` sobre la build del job `verify` (igual que el budget usa su
artifact).

## Cómo se midió

Script propio [scripts/audit-a11y.mjs](../scripts/audit-a11y.mjs) (npm run
`check:a11y`): levanta un Chrome headless real, navega cada ruta, espera el
settle de hidratación (2,5 s), inyecta `axe.min.js` y corre `axe.run` con
`resultTypes: ['violations']`. El informe agrupa por regla con impacto, selector
y snippet de cada nodo, y cierra con el ranking "los 5 arreglos más caros".
Mismo enfoque sin dependencias de runtime pesadas que `measure-vitals.mjs`;
`axe-core` es devDependency y viaja solo hasta el script.
