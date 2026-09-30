# Línea base de Core Web Vitals (plan fase 3, 3.1)

> Medición contra **producción** (`https://rix7.vercel.app`) con el protocolo DevTools
> de Chrome real (`npm run vitals -- --base=…`), 2–3 corridas por ruta con caché fría,
> mediana reportada. Fecha: 2026-09-30 · commit `7b5ec0a`.
>
> Esta lista es el **input de la fase 4**: los 5 problemas reales más caros, ordenados
> por impacto medido, no por intuición. Umbrales: LCP ≤2500/4000 · CLS ≤0.1/0.25 ·
> INP ≤200/500 · FCP ≤1800 · TTFB ≤800.

## Resultados por ruta

| Ruta | LCP | CLS | INP | TTFB | Veredicto |
|---|---|---|---|---|---|
| `/` desktop | 2.040 ms (MEJORABLE) | **0,458 POBRE** | 72 ms | ~700 ms | 🔴 problemas reales |
| `/` mobile | 1.030 ms | **0,486 POBRE** | 64 ms | 715 ms | 🔴 problemas reales |
| `/properties/[id]` | **288 ms BUENO** | 0,002 BUENO | 32 ms | bajo | 🟢 |
| `/empresas/[slug]` | 608 ms BUENO | 0,002 BUENO | 24 ms | bajo | 🟢 |

La ficha y la página de corredora (ambas con datos en el servidor) están en verde
casi perfecto. Todo el problema concentra en la **home**, que es cliente: `page.tsx`
solo mete metadata y `HomeClient` renderiza todo tras cargar JS + llamar a la API.

> **Actualización 2026-09-30 — problema 1 resuelto.** Con la instrumentación nueva
> de `scripts/measure-vitals.mjs` (reporta el elemento, `dy`, `dh` y los rectángulos
> antes/después de cada `layout-shift`) el CLS de la home bajó de **0,458 a 0,0055**
> en las tres corridas. El diagnóstico original de este documento era
> **parcialmente incorrecto**: la corrección está en el problema 1.

## Los 5 problemas reales más caros

### 1. CLS de la home: 0,46–0,49 — el doble del umbral "pobre" 🟢 **resuelto**

**Corrección del diagnóstico.** Se instrumentó `scripts/measure-vitals.mjs` para
que capture el `e.sources` de cada `layout-shift` —elemento (tag + clases), `dy`,
`dh` y los rectángulos antes/después— y el detalle real no coincidía con la
primera lectura. Ni el esqueleto→listado ni la detección de ciudad eran el
problema: los dos grandes eran el **fallback de `Suspense`** y la **fila de chips
de tipo de propiedad**. Los cuatro desplazamientos medidos, en orden:

| # | Shift | Elemento | Causa real |
|---|---|---|---|
| 1 | `+0,1119` @~550 ms | `footer` | El fallback de `Suspense` (`flex-1` con un texto) medía solo el espacio libre, así que al hidratar el `main` crecía a `100vh-64px` y **el pie de página subía 462 px** |
| 2 | `+0,0019` @~1.247 ms | `div.hidden.md:flex` (Navbar) | El placeholder `animate-pulse` de `isChecking` resuelve a otra altura |
| 3 | `+0,3113` @~1.585 ms | `div.flex-1.grid` | `PropertyFilters` filtraba los chips por stock (`count > 0`): con los contadores en 0 la fila tenía **un** chip (98 px) y al llegar `/api/properties` pasaba a **dos líneas** (+74 px), arrastrando todo el layout |
| 4 | `+0,0329` @~1.636 ms | `div.mb-4` (socios) | El `FeaturedCarousel` devolvía `null` en su primer render por el gate `mounted`: el bloque se colapsaba y al pintar la tarjeta empujaba el carrusel de socios 357 px |

**Arreglo aplicado (3 commits de la tanda, ~2 h):**

1. `HomeClient` — el fallback de `Suspense` reserva `h-[calc(100vh-64px)]`, la misma
altura que el contenido real: el documento mide lo mismo antes y después de hidratar.
2. `PropertyFilters` — se pintan **siempre** las 10 categorías, incluso con `count`
en 0: la fila ya no cambia de una a dos líneas.
3. `FeaturedCarousel` — se quitó el gate `mounted` (el componente solo se monta en el
cliente después de tener datos, así que no había riesgo de hidratación) y
`HomeClient` reserva el hueco del carrusel con un `FeaturedSkeleton` del mismo alto,
que se muestra mientras carga el catálogo.

**Resultado:** CLS **0,458 → 0,0055** (BUENO) en las tres corridas, con los dos
shifts que quedan por debajo de 0,006 (placeholder de la Navbar y el ancho del
botón «Mi Ubicación»). Medido con `npm run build && npm run start` + 3 corridas de
`npm run vitals`. Objetivo **CLS < 0,1**: cumplido.

### 2. LCP de la home en desktop: 2,0–2,7 s y con inicio de descarga a 1.706 ms 🔴

La imagen del LCP (portada del carrusel destacado, con `priority` bien puesto)
**no comienza a bajar hasta 1.706 ms** porque existe hasta que React hidrata y
resuelve los datos: el HTML del servidor llega casi vacío. El recurso en sí es
chico (18 KB, 227 ms): el problema es la **cola**, no el peso.

**Arreglo (~1 día):** server-render del carrusel destacado con las propiedades
resueltas en el servidor (mismo patrón que ya se aplicó en `/empresas/[slug]`,
2.1) + `<link rel="preload" as="image">` del primer hero. Objetivo: **LCP < 1,5 s**.

### 3. `maplibre-gl-shared.mjs` (481 KB) se descarga en la home 🔴

El mapa de la home lo usa, así que el chunk llega; pero es el recurso más pesado
del sitio entero, compite por ancho de banda con el LCP, y en la corrida midió
965 ms. Hoy se carga aunque el visitante nunca mueva el mapa (en mobile el
default es ver el mapa, en desktop lo es el listado).

**Arreglo (~3 h):** cargar el mapa bajo demanda — montarlo al primer scroll/clic
sobre su contenedor o IntersectionObserver — y precargarlo solo cuando haya
pista de intención (hover sobre "TU CIUDAD GIS", clic en un pin de la lista).

### 4. Logos del carrusel de socios con descargas lentas y sin dimensiones 🟡

Los logos remotos (`yapo.png` 1.319 ms, `toctoc.png` 1.081 ms, `portalinmobiliario.png`
1.080 ms — ¡1–2 KB cada uno!) arrastran la conexión en el arranque. Además
`PartnerLogo` renderiza `<img>` **sin `width`/`height`** (solo clases contenedoras),
que es una de las fuentes del CLS del problema 1 cuando algún logo llega tarde.

**Arreglo (~2 h):** localizar esos logos en `/public` (o pasarlos por `next/image`
con `width`/`height` fijos y `loading="lazy"`; son iconos, no contenido).

### 5. FCP≈LCP y TTFB ~700 ms en la home 🟡

En mobile, primer contenido pintado recién a 1.030 ms y TTFB de 715 ms: el HTML
del servidor no trae nada útil, así que ni FCP ni LCP pueden arrancar antes. Es la
misma raíz de los problemas 1 y 2 — se arregla con el mismo trabajo (server-render
parcial de la home), no con un esfuerzo separado.

**Arreglo:** incluido en el punto 2. Objetivo: **FCP < 900 ms** en mobile.

## Qué NO es problema (medido, no asumido)

- **INP**: 24–72 ms en todas las rutas (BUENO) — la interacción está sana.
- **Fichas y /empresas**: verde casi perfecto tras mover los datos al servidor (2.1):
  es la evidencia de que el patrón "server-render + revalidate" funciona y es
  exactamente el que hay que llevar a la home.
- **TTFB de Vercel** (gru1): dentro de umbral en todas las rutas.

## Orden sugerido de la fase 4

1. CLS de la home (problema 1) — el más visible y barato de medir.
2. Server-render del carrusel destacado (2 + 5 juntos).
3. Mapa bajo demanda (3) — también ayuda al LCP al liberar ancho de banda.
4. Logos locales con dimensiones (4).
5. Re-medir con este mismo script y comparar contra esta línea base.
