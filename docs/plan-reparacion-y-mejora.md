# Plan acotado de reparación y mejora — Rix7

> Fecha: **2026-10-03**. Base: `audit/optimization` (`a2478a6`, en remoto) +
> `fase3/velocimetros` (`f3fef5f`, local). Este documento responde a una sola
> pregunta: **¿cuál es el objetivo de todo este trabajo y cómo lo cierro para
> poder seguir desarrollando sin volver a reparar?**
>
> Regla de oro: **una fase a la vez, con su punto de control en verde antes de
> pasar a la siguiente.** Nada se da por hecho «porque compila».

---

## 1. El objetivo (la estrella polar)

Convertir Rix7 de un portal que **funciona pero degrada a memoria** en un portal
con **datos reales, verificado y con un solo camino de desarrollo**.

En una frase:

> **Que una persona real se registre, deje un contacto y ese dato exista mañana
> — y que `main` sea la base estable desde la que se sigue construyendo.**

Todo lo demás (accesibilidad, presupuesto de bundle, infra de hilos,
velocímetros) no es el objetivo: es **el andamiaje que evita volver a romperlo**.

### Cómo se ve «terminado»

| Señal | Antes (hoy) | Después (final de este plan) |
|---|---|---|
| `GET /api/health` | `503`, `supabase` crítico | `200`, sin críticos |
| `/api/properties` | `source: national_catalog` | `source: supabase` |
| `smoke:prod --write` | no aplica (nada persiste) | `persisted: true` |
| Alta de registro | 503, se pierde | fila visible en `/admin/registros` |
| Ramas | dos, con trabajo partido | **una sola**, integrada |
| Gates | verdes por rama, no sobre el todo | **los 7 en verde sobre `main`** |

---

## 2. Diagnóstico: qué está roto y qué solo está desordenado

### 2.1 Bloqueantes reales (impiden que el portal «sea de verdad»)

1. **Producción corre con Supabase placeholder.** `NEXT_PUBLIC_SUPABASE_URL`
   apunta a `https://placeholder-project.supabase.co`. Consecuencia medida:
   `/api/registro` y `/api/leads` → **503**, el alta no se guarda y
   `/api/health` marca `supabase` como **crítico**.
2. **Migraciones sin aplicar.** `0010_signups` (registros), `0011_properties_partner_id`
   (atribución a corredoras) y `0012_property_views` (contador de la ficha) están
   versionadas pero **no aplicadas**. Sin la base real y el token, `db:push` es
   *fail-closed*: «Nada se modificó» (verificado en esta sesión).

### 2.2 Desorden que cuesta trabajo (no bloquea, pero frena)

3. **El trabajo está partido en dos ramas de intersección vacía.**
   `audit/optimization` = 43 archivos (infra, a11y, integración, docs);
   `fase3/velocimetros` = 17 archivos (velocímetros). **Ninguna rama por separado
   da la suite de integración 15/15**: `audit` da 12/15 (le faltan los 3 checks
   de fase 3) y `fase3` da 13/15 (le fallan los 2 de `/api/leads`, por el
   `.env.local` placeholder con el que se compiló ese worktree). La **unión** de
   ambas reproduce byte a byte el commit consolidado `e29b6a2` y sí pasa.
4. **`main` va 4 commits por detrás.** Un PR de `audit/optimization` no traería
   «solo la consolidación», sino también `e7c4578`, `70e3d43` y `57f723f`.
5. **Worktrees y artefactos sueltos.** Existe `C:\Users\javie\RIX7-fase3` con un
   `.env.local` placeholder que **yo** creé para compilar, y
   `scripts/integration-nosupabase.mjs` quedó **sin versionar** en ese worktree.

### 2.3 Deuda conocida (no bloquea, anotada para no perderla)

- Autor de los commits (`jtorres-ops`) ≠ dueño de Vercel (`jatf71-a11y`) → por eso
  `git push` no despliega y se publica con `npm run deploy:prod`.
- Dominio `rix7.cl` sin apuntar; `SITE_URL` cae al default.
- Turbopack no es viable (MapLibre + Sentry).
- `fase3/velocimetros` **no está en el remoto**: la feature de velocímetros solo
  existe en tu máquina.

---

## 3. El plan

### Fase 0 — Orden: un solo camino (½ día)

**Objetivo:** que exista **una** rama que contenga todo y pase la verificación
completa. Es la reparación del desorden, no del producto.

| Paso | Acción |
|---|---|
| 0.1 | Decidir la estrategia: **fusionar `fase3/velocimetros` dentro de `audit/optimization`** (o rebasar ambas sobre `main`). Recomendado: merge de fase 3 sobre `audit/optimization`, porque `audit` ya está en el remoto y es la rama «seria». |
| 0.2 | Versionar `scripts/integration-nosupabase.mjs` en la rama ganadora (hoy está suelto en el worktree). |
| 0.3 | Retirar el worktree `RIX7-fase3` cuando la rama quede fusionada (evita dos checkouts compitiendo). |

**Punto de control 0** — sobre la rama única, con la build **recompilada con el
`.env.local` real** (no placeholder):

- [ ] `npx tsc --noEmit` limpio
- [ ] `npx vitest run` → **955/955**
- [ ] `npm run check:knip` limpio
- [ ] `npm run check:bundle` dentro del techo
- [ ] `npm run build` sin errores
- [ ] `npm run check:a11y -- --all --fail-on-serious` → 0 críticos/0 serios
- [ ] `npm run test:integration:nosupabase` → **15/15**

> Si la Fase 0 termina con estos 7 en verde, **el código ya está sano**. Lo que
> falta es activarlo.

---

### Fase 1 — Supabase real (1 h, casi todo espera)

**Objetivo:** que los datos persistan. Es **el desbloqueo de todo lo demás**.

Sigue `docs/runbook-supabase-real.md` (ya escrito). Resumen:

| Paso | Acción |
|---|---|
| 1.1 | Crear proyecto en **São Paulo** (junto a `gru1` de Vercel). |
| 1.2 | Obtener URL + anon key + `service_role`; anotar la **ref**. |
| 1.3 | `.env.local`: URL real, anon key, **`SUPABASE_ACCESS_TOKEN`** (personal). |
| 1.4 | `npm run db:status` → `npm run db:push` → `npm run db:status` (aplica **0010, 0011, 0012**). |
| 1.5 | Ejecutar `supabase/seed.sql` a mano en el SQL Editor (`properties` y `partners` > 0). |
| 1.6 | Variables en **Vercel → Production + Preview + Development**. |
| 1.7 | `npm run deploy:prod` (recordar: `git push` **no** despliega). |

**Punto de control 1** — contra producción:

- [ ] `GET /api/health` → `supabase` **fuera** de críticos
- [ ] `GET /api/properties` → `"source":"supabase"`
- [ ] `npm run smoke:prod -- --write --email tu@correo.cl` → **`persisted: true`**
- [ ] La fila de prueba aparece en `/admin/registros`
- [ ] Fila de prueba borrada y token personal **revocado**

> Aquí el portal deja de ser una demo honesta y pasa a ser un producto que
> guarda lo que le das.

---

### Fase 2 — Integrar la fase 3 (½ día)

**Objetivo:** que los velocímetros de la ficha vivan en la base estable, con su
migración aplicada.

| Paso | Acción |
|---|---|
| 2.1 | Fusionar `fase3/velocimetros` en la rama única (si no se hizo en 0.1) y **aplicar `0012_property_views.sql`** con `db:push` desde la base ya real. |
| 2.2 | Confirmar la propagación de `persisted` de punta a punta (render + ping + rótulo «Conteo de prueba»). |
| 2.3 | Volver a correr la suite de integración: los 3 checks de fase 3 deben pasar **contra producción real**. |

**Punto de control 2:**

- [ ] `POST /api/properties/[id]/view` → `202` con `persisted: true` en producción
- [ ] `db:status` → `0012_property_views` registrada
- [ ] La ficha en producción muestra el conteo **real** (sin el aviso ámbar de prueba)

---

### Fase 3 — Cierre: `main` como base estable (½ día)

**Objetivo:** dejar de tener ramas de auditoría y tener un `main` que sea el
punto de partida del desarrollo normal.

| Paso | Acción |
|---|---|
| 3.1 | Abrir el PR de la rama única contra `main`, con el cuerpo que recorra los temas (infra, a11y, integración, velocímetros, docs). |
| 3.2 | Fusionar. `main` queda al día y **es la referencia**. |
| 3.3 | (Higiene) Unificar el autor de los commits con la cuenta de GitHub, o invitar a `jtorres-ops` como miembro → así `git push` vuelve a desplegar y `deploy:prod` deja de ser obligatorio. |
| 3.4 | (Opcional) Apuntar `rix7.cl` y actualizar `SITE_URL` + redirect URLs de Supabase. |

**Punto de control 3 (el final claro):**

- [ ] `main` contiene todo; no queda ninguna rama con trabajo sin fusionar
- [ ] Los 7 gates corren en CI sobre `main` y están en verde
- [ ] Producción: datos persistentes, health sin críticos, a11y sin serios
- [ ] Un solo checkout, un solo hilo
- [ ] El worktree `RIX7-fase3` y los artefactos sueltos están retirados

> **Cuando esto se cumple, Rix7 v1 es real y el desarrollo normal puede
> empezar.** No es el final del producto: es el final de la etapa de reparación.

---

## 4. Lo que NO entra en este plan (para no dispersarse)

- **Fase 4 del roadmap** (medir con Sentry/CWV y decidir la siguiente ampliación):
  empieza **después** del Punto de control 3. Su input ya está escrito en
  `docs/cwv-baseline.md` y `docs/plan-fase-3.md`.
- Webhooks CRM, rate limit distribuido (Upstash), feed de import: condicionales,
  con disparador explícito en `docs/plan-fase-3.md`.
- Revisión legal de los textos (DMA / Ley 19.628): **bloqueante comercial**, no
  técnico, y no se resuelve con código.

---

## 5. Resumen en una línea por fase

```
F0 (½d)  Orden:  una rama, 7 gates en verde  → el código está sano
F1 (1h)  Activar: Supabase real + db:push     → los datos persisten
F2 (½d)  Integrar: fase 3 sobre la base real  → los velocímetros son reales
F3 (½d)  Cerrar: PR a main + higiene          → main es la base estable
→ FIN: Rix7 v1 real, listo para seguir desarrollando
```

## 6. Qué puedes delegarme, en orden

1. **F0** completo: fusionar las ramas, versionar el script suelto, correr los 7 gates.
2. **F1.4**: `db:push` + `db:status` en cuanto pongas el token (ya acordamos que
   lo haces tú; yo ejecuto y confirmo).
3. **F2** completo: integrar fase 3 y verificar los 3 checks nuevos.
4. **F3.1–3.2**: PR y fusión cuando lo pidas.

Lo único que **no** puedo hacer yo solo es lo que exige tus credenciales
(1.2, 1.3, 1.6, 3.3) y las decisiones de negocio (dominio, textos legales).
