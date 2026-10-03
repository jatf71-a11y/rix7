# Auditoría de correctitud sin Supabase

Fecha: 2026-10-02 · Rama: `audit/optimization`

## Qué se auditó y por qué

El portal funciona **sin un proyecto Supabase configurado**: el catálogo y las
corredoras salen de datos en memoria, y varias funciones de cuenta o de conteo
degradan a un respaldo del proceso. La pregunta de esta auditoría es doble:

1. ¿Esos caminos **degradan bien** (la persona puede seguir usando el portal)?
2. ¿Hay algún **fallo en silencio** (algo que no se guardó y nadie se entera)?

Se revisaron los cuatro caminos que tocan Supabase: **favoritos**,
**búsquedas guardadas**, **contactos** y **vistas**. Se leyó el store, la ruta
API y el consumidor de cada uno, y se probaron los endpoints contra el dev
server local (`.env.local` con
`NEXT_PUBLIC_SUPABASE_URL=https://placeholder-project.supabase.co`, o sea
**no configurado**).

El discriminador es `isSupabaseConfigured()`
([lib/supabase/config.ts](../lib/supabase/config.ts)): exige URL y anon key y
rechaza el valor `placeholder`. Todas las capas consultan eso **antes** de crear
un cliente, así que sin Supabase no se dispara ni un request al dominio de
ejemplo.

## Resultado por camino

| Camino | Sin configurar | ¿Degrada bien? | ¿Falla en silencio? |
| --- | --- | --- | --- |
| Favoritos | respaldo en `localStorage` del dispositivo | Sí | No |
| Búsquedas guardadas | sin efecto; invita a entrar | Sí | No |
| Contactos | respaldo en memoria del proceso + aviso en el panel | Sí | **Sí (corregido)** |
| Vistas de la ficha | contador en memoria del proceso | Sí | Parcial (solo observabilidad) |

### 1. Favoritos — degrada bien

- `listFavoriteIds` / `addFavorites` / `removeFavorite` devuelven vacío o
  `unconfigured` sin intentar red
  ([lib/data/favoritesStore.ts](../lib/data/favoritesStore.ts)).
- `/api/favorites` responde **401** con mensaje claro (no una lista vacía que
  mienta): la lista vacía significaría "no tiene favoritos", cuando en realidad
  es "no hay sesión".
- En el cliente, `FavoritesProvider`
  ([components/auth/FavoritesProvider.tsx](../components/auth/FavoritesProvider.tsx))
  detecta `success: false` y cae a `localStorage`: el corazón sigue funcionando y
  el aviso de error del contexto queda disponible.
- `/favoritos` muestra una tarjeta que **explica** dónde quedaron los del
  dispositivo e invita a entrar
  ([app/favoritos/page.tsx](../app/favoritos/page.tsx)).

Conclusión: el modo dispositivo es un camino de primera clase, documentado, no
una degradación silenciosa.

### 2. Búsquedas guardadas — degrada bien

- Sin sesión, el botón ni siquiera llama a la API: abre el modal de acceso
  ([components/properties/SaveSearchButton.tsx](../components/properties/SaveSearchButton.tsx)).
- Si llegara igual un POST, el store responde `unconfigured` y la ruta lo traduce
  a **503** con un mensaje explícito (`Guardar búsquedas necesita Supabase
  configurado.`), que el botón muestra como error.

Conclusión: no hay forma de que alguien crea que guardó una búsqueda cuando no
lo hizo.

### 3. Contactos — hallazgo: fallo en silencio (corregido)

El alta es **pública** y "dispara y olvida": la acción del usuario (llamar,
WhatsApp, correo) no debe esperar ni fallar porque el registro interno no llegue.
Eso está bien. El problema era el otro extremo:

- En `ContactAgentForm.recordLead`, la respuesta del `fetch('/api/leads')` se
  **descartaba entera** (`.catch(() => {})`). Con Supabase configurado pero una
  inserción rechazada (RLS, caída, red), el contacto se perdía y **nadie se
  enteraba**: ni el visitante (correcto, ya contactó) ni el equipo.
- El comentario de la propia ruta decía que "el cliente lo ve en el log"
  ([app/api/leads/route.ts](../app/api/leads/route.ts)), pero el cliente no
  registraba nada.

Corrección aplicada en
[components/properties/ContactAgentForm.tsx](../components/properties/ContactAgentForm.tsx):

- Se inspecciona la respuesta y, si no es `ok`, se reporta con
  `reportError(...)` ([lib/monitoring/reportError.ts](../lib/monitoring/reportError.ts)),
  que **siempre** deja rastro en consola y, con DSN, lo manda a Sentry.
- El `catch` de red también reporta, en vez de tragarse el error.
- Se añadió `keepalive: true` para que el aviso sobreviva cuando el canal
  elegido (`tel:` / `mailto:`) haga que el navegador abandone la página. Es la
  misma opción que ya usaba el ping de visitas.

En modo sin Supabase el alta sigue siendo `persisted: false` con `201`, y el
**panel de contactos lo avisa en pantalla** ("Modo de prueba: los contactos no
se guardan"), así que ese camino tampoco es silencioso
([app/admin/leads/page.tsx](../app/admin/leads/page.tsx)).

### 4. Vistas de la ficha — degrada y ahora avisa

- `getPropertyViews` / `recordPropertyView` usan un `Map` en `globalThis` cuando
  no hay Supabase
  ([lib/data/propertyViewsStore.ts](../lib/data/propertyViewsStore.ts)), para
  poder ver el velocímetro en desarrollo. Se pierden al reiniciar: documentado.
- El cliente (`PropertyGauges`) muestra el número y nunca rompe; si el POST
  falla, se queda con el total que trajo el render ISR.
- **`persisted` ya viaja de punta a punta** (antes se perdía): `getPropertyViews`
  devuelve `{ views, persisted }` —el mismo contrato `persistent`/`persisted` de
  `listLeads` y `listPartners`—, la ruta lo responde en **ambas** ramas (`200`
  cuando solo lee, `202` cuando cuenta) y el velocímetro lo usa para no presentar
  un conteo de prueba como si fuera real:
  - El render del servidor baja `viewsPersisted` en `RentInsights`
    ([lib/utils/propertyInsights.ts](../lib/utils/propertyInsights.ts)).
  - El ping del navegador refresca el número **y** el flag.
  - Con `persisted: false` el pie del velocímetro de interés dice
    «Conteo de prueba · se pierde al reiniciar» en vez de «Visitas a esta ficha»
    ([components/properties/PropertyGauges.tsx](../components/properties/PropertyGauges.tsx)).

### 5. Cobertura de tests

- `/api/favorites`, `/api/saved-searches` y `/api/leads` ya tenían tests de sus
  caminos sin sesión / sin configurar.
- **`/api/properties/[id]/view` no tenía ninguno**, siendo el único endpoint
  público que además escribe. Se añadió
  [app/api/properties/[id]/view/route.test.ts](../app/api/properties/[id]/view/route.test.ts)
  cubriendo: id inválido (400), conteo por defecto (202), `counted:false` solo
  lee, cuerpo no-JSON tratado como visita nueva, el corte por rate limit (deja
  de sumar pero **sigue devolviendo el total**, para que el velocímetro nunca
  muestre un error) y la propagación de `persisted` en ambas ramas.

## Cómo reproducir la comprobación

Con el dev server levantado sin Supabase:

```bash
B=http://localhost:3111
curl -s -w " [%{http_code}]" $B/api/favorites                 # 401
curl -s -w " [%{http_code}]" $B/api/saved-searches            # 401
curl -s -w " [%{http_code}]" -X POST -H 'Content-Type: application/json' \
  -d '{"property_id":"scl-depto-marco-polo","name":"Prueba","email":"a@b.cl","phone":"+56912345678","channel":"form"}' \
  $B/api/leads                                                # 201 {"persisted":false}
curl -s $B/api/leads                                          # source:"memory", persistent:false
curl -s -w " [%{http_code}]" -X POST -H 'Content-Type: application/json' \
  -d '{"counted":true}' $B/api/properties/scl-depto-marco-polo/view   # 202 {"persisted":false}
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"counted":false}' $B/api/properties/scl-depto-marco-polo/view  # 200 {"persisted":false}
```

## Pendiente / no bloqueante

- ~~**Vistas**: pasar `persisted` en la respuesta de la ruta~~ — **hecho**: la
  ruta lo responde en ambas ramas y el velocímetro rotula el conteo de prueba.
- **Respaldo en memoria** de contactos y vistas: vive en `globalThis` del
  proceso, así que con varias instancias de Next (varios workers o varias
  regiones) cada una tendría su propio `Map`. En desarrollo local es una sola
  instancia; en producción el estado real está en Supabase.
