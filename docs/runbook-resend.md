# 📧 Runbook — el correo de avisos (Resend)

El portal manda **tres** correos y ninguno se finge. Si falta la clave,
`sendEmail` devuelve `skipped` y quien lo llama lo reporta como tal: el job de
avisos escribe `email-skipped`, el receptor del webhook de Sentry queda en
`skipped` honesto, y el alta de registro tampoco se hace pasar por enviada.

Ese es justamente lo que este runbook cierra: **`email-skipped` no es una falla
que nadie ve**. El sitio responde `degraded` y sigue en verde, el cron sale
verde, y el correo no sale. Todo este documento existe para cambiar eso con
tres comandos y un clic.

---

## 1. La regla

| Correo | Quién lo manda | Cuándo |
|---|---|---|
| Aviso de búsquedas guardadas | `lib/data/alertsRunner.ts` | cada mañana, vía cron |
| Alerta de error (Sentry → correo) | `app/api/webhooks/sentry/route.ts` | cuando Sentry ve un `error`/`fatal` |
| Bienvenida al registrarse | `app/api/registro/route.ts` | cada alta en `/compartir` o el modal |

Los tres pasan por el mismo `lib/email/sendEmail.ts`. **Una sola clave los
habilita a los tres.**

---

## 2. Estado actual (cómo mirarlo)

```bash
curl -sS https://rix7.vercel.app/api/health | jq '.subsystems[] | select(.id=="email")'
#  → configured: false · reason: "Falta RESEND_API_KEY."

curl -sS https://rix7.vercel.app/api/alerts/run | jq .configured
#  → {"cronSecret":true,"serviceRole":true,"email":false}
```

Mientras `email` sea `false`, el cron sale verde y **no manda nada**. Eso no es
un bug: es la regla del proyecto (no se finge un envío). Es un pendiente.

---

## 3. Generar la clave

**URL directa: <https://resend.com/api-keys>** (barra lateral → **API Keys**) →
**Create API Key**.

| Campo | Qué poner |
|---|---|
| **Name** | `rix7-avisos` |
| **Permissions** | **Sending access** — es la recomendada y alcanza; no hace falta Full Access |
| **Expiration** | ⚠️ **No expiration**. Con 90 días la clave muere un martes cualquiera y el cron pasa a `email-skipped` sin que nadie se dé cuenta |
| **Domain** | el que ofrezca la UI; si no verificaste ninguno, `onboarding@resend.dev` |

Al confirmar se muestra **una sola vez** un valor `re_…`. Ahí está la clave: se
copia ahí mismo, porque después no vuelve a aparecer (regenerarla revoca la
anterior).

> **No la pegues en ningún archivo rastreado.** La guardia de secretos busca
> exactamente `re_` + 28 alfanuméricos y te corta el commit. Va a una variable
> de entorno, nunca al árbol.

---

## 4. El remitente: la mitad que se olvida

`fromAddress()` en `lib/email/sendEmail.ts` es:

```
ALERTS_FROM_EMAIL  ||  'Rix7 <avisos@rix7.cl>'
```

Y ahí hay **dos trampas**:

1. **Si `ALERTS_FROM_EMAIL` no existe**, se usa `avisos@rix7.cl`, que sin verificar
   en Resend se rechaza. La clave sola **no alcanza**: `email` pasaría a `true` y
   los envíos fallarían igual.
2. **`Rix7 <onboarding@resend.dev>` solo entrega a la dirección dueña de la
   cuenta de Resend.** Con cualquier otro destinatario, Resend devuelve 403. Es
   la opción correcta para probar el pipeline de punta a punta, no para
   producción con varias personas.

Resumen:

| Remitente | ¿Cuándo sirve | Requiere |
|---|---|---|
| `Rix7 <onboarding@resend.dev>` | solo probando, y solo hacia tu correo | nada |
| `Rix7 <avisos@rix7.cl>` | producción | verificar `rix7.cl` en Resend (§8) |

---

## 5. Variables en Vercel

**Vercel → proyecto `rix7` → Settings → Environment Variables.**

| Variable | Valor | Entornos | Tipo |
|---|---|---|---|
| `RESEND_API_KEY` | el `re_…` de §3 | Production, Preview, Development | **Secret** |
| `ALERTS_FROM_EMAIL` | `Rix7 <onboarding@resend.dev>` (o `Rix7 <avisos@rix7.cl>` tras §8) | Production, Preview, Development | Variable |

Dos reglas: **nunca** con prefijo `NEXT_PUBLIC_` (lo documenta `.env.example`),
y el valor no se escribe en ningún archivo del repo.

---

## 6. Desplegar y verificar

```bash
vercel env add RESEND_API_KEY      # o lo hace el dueño en el dashboard
vercel env add ALERTS_FROM_EMAIL
npm run deploy:prod                # los env entran en el próximo deploy
```

Y las tres comprobaciones, en orden:

| Comando | Esperado |
|---|---|
| `GET /api/health` | `email: configured true` (sale de `missing.degraded`) |
| `GET /api/alerts/run` | `emailConfigured: true` |
| `GET /api/webhooks/sentry` | `emailProvider: true` (con los otros dos en `true`, los tres) |

Si alguna no cambia, el env no llegó al runtime: revisa el entorno correcto y
redeploya — los variables **no se aplican a un deploy ya construido**.

---

## 7. Prueba de punta a punta

```bash
npm run smoke:prod -- --write --email TU@correo.cl
```

Manda la bienvenida real **y** deja una fila de prueba en `public.signups` que
hay que borrar después (la tabla es solo-anexa: no hay `UPDATE`, solo borrar).
Ese mismo comando es el **punto de control 1** del
[plan de reparación](plan-reparacion-y-mejora.md), así que cierra dos cosas de
una.

Si con `onboarding@resend.dev` el correo **no** te llega, casi siempre es porque
`TU@correo.cl` no es la dirección dueña de la cuenta (§4).

---

## 8. Verificar `rix7.cl` (cuando quieras salir del modo prueba)

### 8.1 Estado el 2026-10-05: **registrado, pero sin delegar**

Whois del registry (`whois.nic.cl`):

```
Registrant name: Javier Torres
Registrar name: NIC Chile
Creation date:  2026-09-08 19:30:31 CLST
Expiration date: 2027-09-08 19:30:31 CLST
                                   ← sin ninguna línea «Name server:»
```

**El dominio es tuyo** — registrado el 08-09-2026 en NIC Chile, vence el
08-09-2027 — y **no hace falta comprar nada**. Lo que no tiene son **servidores
de nombres**: `google.cl` lista sus cuatro NS y `rix7.cl` no lista ninguno. Sin NS
la zona no entra al DNS de la raíz, y por eso todo lo que se consulta devuelve
NXDOMAIN:

```bash
$ nslookup -querytype=NS rix7.cl a.nic.cl
*** a.nic.cl no encuentra rix7.cl: Non-existent domain
```

No es que falte un registro: **no hay dónde caer**. (Una lectura apresurada de
este mismo `nslookup` lleva a concluir que el dominio no está registrado — está
registrado y sin delegar, que es distinto. El whois es lo que despeja la duda.)

**Paso 0: delegar el dominio**, es decir, poner los NS en el panel de NIC Chile.
Dos caminos, ambos válidos:

| Opción | Dónde caen los registros | Cuándo conviene |
|---|---|---|
| **DNS de Vercel** (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`) | dashboard de Vercel, donde ya estás | el sitio ya vive ahí: una sola pantalla para A, TXT, MX |
| **Cloudflare** (NS que te da al crear la zona) | panel de Cloudflare | si querés CDN/proxy y control DNS separado de Vercel |

**En NIC Chile** (camino exacto, el del panel):

1. [nic.cl](https://www.nic.cl) → **Servicios para clientes** → iniciá sesión.
2. Elegí el dominio **`rix7.cl`** de la lista.
3. Bajá a la **sección 4 · «Servidores de nombre (DNS)»** y pegá los dos NS:
   - `ns1.vercel-dns.com`
   - `ns2.vercel-dns.com`
4. Dejá **desmarcada** la casilla *«Configurar a NIC Chile como servidor
   secundario»*: no tiques, apuntaría NS que no gestionan tu zona.
5. Botón **«Actualizar datos de dominios»**, esquina inferior derecha.
6. Propagación: **hasta 24 h**.

Antes de nada, en Vercel: **Settings → Domains → `rix7.cl`** para que el
proyecto ya esté esperando el dominio. No hay registros previos que copiar
(ninguna zona), así que no se pierde nada.

Verificación de que la delegación llegó:

```bash
nslookup -querytype=NS rix7.cl
#  → ns1.vercel-dns.com / ns2.vercel-dns.com
```

Recién ahí sirve de algo cualquier registro del §8.2: **sin NS delegados no
existe la zona y no hay dónde pegar nada**.

Mientras tanto, el correo sigue en §4 (`onboarding@resend.dev`). Delegar además
desbloquea lo demás: `SITE_URL`, los redirect URLs de Supabase y el dominio en
Vercel.

### 8.2 Los registros (una vez delegado)

Los registros van en el proveedor DNS que elegiste en §8.1. Para obtenerlos:
**Resend → Domains → Add Domain** → `rix7.cl`. La pestaña *Records* genera
valores **únicos por dominio** —una clave DKIM y un token de verificación—, así
que **los valores se copian de ahí y de ningún otro sitio**. Lo que sigue es la
estructura exacta y el host donde va cada uno, que es donde se falla.

| # | Tipo | Host (en el panel DNS) | Valor | Cuándo va |
|---|---|---|---|---|
| 1 | **TXT** (SPF) | `send` → `send.rix7.cl` | el que Resend muestra (cierra en `~all`) | si la UI muestra TXT |
| 2 | **MX** | `send` → `send.rix7.cl` | `feedback-smtp.<región>.amazonses.com.` | si la UI muestra TXT (va junto al 1) |
| 3 | **CNAME** ×2 | los que Resend indique | los hosts que Resend genera | si la UI muestra CNAME — dominios creados **desde agosto de 2026** |
| 4 | **TXT** (DKIM) | `resend._domainkey` | la clave pública que Resend genera, **entera** | siempre |
| 5 | **TXT** (DMARC) | `_dmarc` → `_dmarc.rix7.cl` | `v=DMARC1; p=none;` | ⭕ recomendado |

Resend usa **dos formas distintas** de SPF según cuándo se creó el dominio
(TXT+MX, o dos CNAME) — mirá la pestaña *Records* y replicá exactamente lo que
muestre, sin mezclarlas.

**Los cinco errores típicos:**

1. **Pegar los registros en la raíz.** El SPF y el MX van en el subdominio
   `send`, no en `@`. Es el fallo nº1 según la propia base de conocimiento.
2. **MX sin punto final.** El valor `feedback-smtp.…amazonses.com` debe ir con
   **punto final**: si no, algunos proveedores lo reescriben a
   `…amazonses.com.rix7.cl` y no verifica.
3. **Región que no coincide.** El MX apunta a una región (`us-east-1`,
   `eu-west-1`, `ap-northeast-1` o `sa-east-1`); tiene que ser la que muestra
   Resend. Una región distinta da error `region-mismatch`, y dos regiones
   distintas, `multiple-regions`.
4. **CNAME proxio.** En Cloudflare el nube debe estar **gris (DNS only)**: un
   CNAME con proxy no resuelve como CNAME y la verificación nunca termina.
5. **DKIM truncado o con comillas.** Se copia **entero**, sin agregar nada.

### 8.3 Verificación

```bash
nslookup -querytype=TXT resend._domainkey.rix7.cl   # la clave DKIM, visible
nslookup -querytype=TXT send.rix7.cl                 # el SPF, en el subdominio
nslookup -querytype=TXT _dmarc.rix7.cl               # si pusiste DMARC
```

Y en Resend, si no avanza, el botón **Restart verification**. La propagación
puede tardar **hasta 72 h** (normalmente mucho menos); recién pasado eso
conviene volver a intentar el §7.

### 8.4 Plan de ejecución del día del dominio (orden, dependencias, verificación)

Valoración hecha el 2026-10-05: canonical, `og:url` y `sitemap.xml` apuntan
hoy a `https://rix7.vercel.app`, es decir que `NEXT_PUBLIC_SITE_URL` está en el
dominio temporal, y `vars.SITE_URL` de GitHub también.

El plan arranca con `rix7.cl` registrado y sin delegar (§8.1); si la delegación
ya propagó, entrá directo al paso 2, y si Resend ya está **Verified**, al paso 3.
Cada paso dice **de qué depende**, **qué hacer** y **cómo verificarlo** — no se
avanza sin que la verificación anterior dé. Orden real:

```
1 → (2 ∥ 3) → (4 ∥ 5 ∥ 6) → 7 → 8 → 9
```

Dos esperas mandan el día: la propagación de los NS del paso 1 (≤ 24 h) y la
verificación de Resend del paso 2 (≤ 72 h); el resto son minutos.

| Paso | Depende de | Desbloquea |
|---|---|---|
| 1 · Delegación NS | dominio registrado (§8.1) | 2, 3 |
| 2 · Resend **Verified** | 1 | 4b (remitente del correo del paso 8) |
| 3 · Dominio + TLS en Vercel | 1 | 4, 5, 6, 7 |
| 4 · Variables en Vercel | 3 · **4b** además exige 2 | 7 |
| 5 · Supabase Auth URLs | 3 | 8 |
| 6 · GitHub `vars.SITE_URL` | 3 | 8 |
| 7 · `npm run deploy:prod` | 3 + 4 | 8 |
| 8 · Verificación final | 5, 6, 7 | 9 |
| 9 · DMARC `p=quarantine` | 2 con ≥ 7 días de logs | — (no bloquea) |

**Paso 1 · Delegar el dominio** (el «paso 0» del §8.1)

- **Depende de:** nada — `rix7.cl` ya está registrado (§8.1).
- **Hacer:** (a) Vercel → Settings → Domains → añadir `rix7.cl` para que el
  proyecto quede esperándolo; (b) NIC Chile → sección 4 · *Servidores de
  nombre* → pegar `ns1.vercel-dns.com` y `ns2.vercel-dns.com`, casilla
  *secundario* **desmarcada**, botón *Actualizar datos de dominios*.
- **Verificar:** `nslookup -querytype=NS rix7.cl` → `ns1.vercel-dns.com` y
  `ns2.vercel-dns.com` (hasta 24 h). Sin esto no hay zona: los pasos 2–8 no
  tienen dónde apoyarse.

**Paso 2 · Verificar `rix7.cl` en Resend** *(corre en paralelo con el 3)*

- **Depende de:** 1 — con los NS delegados recién resuelven los registros.
- **Hacer:** Resend → Domains → Add `rix7.cl`; copiar de la pestaña *Records*
  los valores **únicos** (clave DKIM y token) al proveedor DNS del §8.1 — SPF y
  MX en el subdominio `send`, DKIM en `resend._domainkey`, DMARC en `_dmarc`.
  Replicá la forma exacta que muestre la UI (TXT+MX o CNAME×2) y esquivá los
  **cinco errores típicos** del §8.2.
- **Verificar:** los tres `nslookup` del §8.3 responden y Resend muestra
  **Verified** (≤ 72 h; *Restart verification* si se queda). Hasta entonces el
  paso **4b no se toca**.

**Paso 3 · Dominio activo en Vercel** *(corre en paralelo con el 2)*

- **Depende de:** 1.
- **Hacer:** en Settings → Domains, añadir `www.rix7.cl` si falta, dejar
  `rix7.cl` como **primario** y `www` con redirect **308**; revisar registros
  (apex → A `76.76.21.21`, `www` → CNAME `cname.vercel-dns.com` — si Vercel
  gestiona el DNS los crea al adjuntar el dominio, verificalos igual; si no,
  pegalos en el proveedor elegido en §8.1).
- **Verificar:** certificado **TLS Active** en el panel (DNS-01, automático,
  minutos) y `curl -sI https://rix7.cl | head -1` → `HTTP/2 200`; además
  `curl -sI https://www.rix7.cl | head -1` → `308`. Ya sirve el dominio, pero el
  contenido sigue siendo el del temporal: el canonical cambia en el paso 7.

**Paso 4 · Variables en Vercel**

- **Depende de:** 3 (nada apunta todavía a un dominio caído); **4b** depende
  además de 2 en **Verified**.
- **Hacer:**
  - **4a** `NEXT_PUBLIC_SITE_URL` = `https://rix7.cl` **sin barra final**, en
    Production, Preview y Development (hoy `https://rix7.vercel.app`).
  - **4b** `ALERTS_FROM_EMAIL` = `Rix7 <avisos@rix7.cl>` — solo si el paso 2
    está **Verified**; si no, se queda como está (§4).
  - **4c** `RESEND_API_KEY` presente como Secret en los tres entornos (§5).
- **Verificar:** las tres variables con ese valor en los tres entornos en el
  panel. **Ninguna surte efecto todavía**: entran en build, en el paso 7.

**Paso 5 · Supabase — URL de Auth** *(paralelo con el 4 y el 6)*

- **Depende de:** 3.
- **Hacer:** Authentication → URL Configuration → Site URL `https://rix7.cl`;
  en Redirect URLs añadir `https://rix7.cl/**` y `https://www.rix7.cl/**` y
  **conservar** `https://rix7.vercel.app/**` mientras se use (si lo sacás, los
  enlaces mágicos ya enviados dejan de redirigir). *(opcional)* Auth → SMTP con
  el dominio verificado.
- **Verificar:** un login real por enlace mágico — el correo llega con un
  enlace `https://rix7.cl/...` y abre la sesión — e igual la recuperación de
  contraseña; las tres URLs figuran en Redirect URLs.

**Paso 6 · GitHub — `vars.SITE_URL`** *(paralelo)*

- **Depende de:** 3 — el workflow usa `vars.SITE_URL || 'https://rix7.cl'`:
  cambiarlo antes de que el dominio sirva haría que la próxima corrida del cron
  enlace un sitio caído.
- **Hacer:** `gh variable set SITE_URL --body "https://rix7.cl"` (borrarla
  también sirve: el fallback ya es `rix7.cl`).
- **Verificar:** `gh variable list | grep SITE_URL` → `https://rix7.cl`.

**Paso 7 · Desplegar**

- **Depende de:** 3 + 4 (4a es la que exige redeploy: las `NEXT_PUBLIC_*` se
  inlinean en build).
- **Hacer:** `npm run deploy:prod`.
- **Verificar:** deploy **Ready** en el panel y
  `curl -s -o /dev/null -w '%{http_code}\n' https://rix7.cl/` → `200`. Sin este
  paso, canonical, `og:url` y `sitemap.xml` siguen en `rix7.vercel.app`.

**Paso 8 · Verificación final**

- **Depende de:** 5, 6 y 7.
- **Verificar:**
  - **Salud:** `curl -s https://rix7.cl/api/health` → `site_url` sigue `true` y sin notas.
  - **Canonical:** `curl -s https://rix7.cl | grep -o '<link rel="canonical" href="[^"]*"'` → contiene `https://rix7.cl/`; `og:url`, lo mismo.
  - **Sitemap:** `curl -s https://rix7.cl/sitemap.xml | grep -c rix7.vercel.app` → `0`.
  - **Humo:** `npm run smoke:prod -- --url https://rix7.cl` → verde.
  - **Correo:** repetir §7 (`--write --email TU@correo.cl`) — sale desde `avisos@rix7.cl` si se hizo 4b — y **borrar la fila** de `public.signups`.

**Paso 9 · Endurecer el DMARC** *(no bloquea)*

- **Depende de:** 2 con **≥ 7 días** de logs.
- **Hacer:** en `_dmarc.rix7.cl`, `v=DMARC1; p=none;` → `p=quarantine;`.
- **Verificar:** `nslookup -querytype=TXT _dmarc.rix7.cl` → `p=quarantine` y una
  semana más de envíos en verde (health `ok`, §7 sin fallos).

**Queda apuntando al dominio temporal** (cosmético, no bloquea):
`DEFAULT_HEALTH_URL` en `scripts/check-health.mjs`, `DEFAULT_BASE_URL` en
`scripts/smoke-prod.mjs` y los `SELF` de los tests de CSP. Se sobreescriben con
`--base` / `--url`.

Mientras el dominio no esté verificado, **no** cambies a `avisos@rix7.cl`: es
peor que `onboarding@resend.dev`, porque ni siquiera te llega a ti.

---

## 9. Probar en local sin clave

Con `DEV_EMAIL_OUTBOX=1`, cada mensaje que pasa por `sendEmail` queda en el
buzón de salida (`lib/email/outbox`) y se abre en el navegador: sirve para
probar el registro de punta a punta con una clave falsa. El buzón guarda el
resultado **tal cual** — también el `skipped` — así que nunca convierte un envío
que no ocurrió en uno que sí.

---

## 10. Si algo falla

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| `email: false`, `reason: "Falta RESEND_API_KEY."` | no existe el env | §5 + `deploy:prod` |
| `email: true` pero `sent: false`, `skipped: false` | rechazo de Resend (4xx) | mirá el `error` crudo que devuelve `sendEmail`; los dos casos típicos abajo |
| 403 | remitente `onboarding@resend.dev` hacia un tercero | §4 — o verificá el dominio |
| error de dominio no verificado | `ALERTS_FROM_EMAIL` apunta a `rix7.cl` sin verificar | volvé a `onboarding@resend.dev` o hacé §8 |
| clave inválida (401) | se regeneró o expiró | crear una nueva con **No expiration** |
| llegó a `true` y un día dejó de mandar | clave expirada por timeout | §3, elegir **No expiration** |
| `email-skipped` en el cron | lo mismo, visto desde el job | idem |

---

## 11. Apagar

| Objetivo | Cómo |
|---|---|
| Cortar los tres correos | borra `RESEND_API_KEY` → `isEmailConfigured()` es `false`, todo `skipped` |
| Cortar solo los avisos de búsqueda | borrá `ALERTS_FROM_EMAIL` y… mejor: desactivá el cron en `.github/workflows/alerts-run.yml` |
| Cortar solo las alertas de Sentry | borrá `SENTRY_WEBHOOK_SECRET` → el receptor responde 503 sin procesar |
| Prueba local sin tocar nada | `DEV_EMAIL_OUTBOX=1` |

---

## 12. Checklist de cierre

- [ ] Cuenta de Resend creada y clave con **Sending access** + **No expiration**
- [ ] `RESEND_API_KEY` en los tres entornos de Vercel, como Secret
- [ ] `ALERTS_FROM_EMAIL` definido (no el default de `.env.example`)
- [ ] `npm run deploy:prod` corrido **después** de los env
- [ ] `/api/health` → `email: configured true`
- [ ] `/api/alerts/run` → `emailConfigured: true`
- [ ] `/api/webhooks/sentry` → los tres `true`
- [ ] Correo de prueba recibido (`smoke:prod --write`)
- [ ] Fila de prueba borrada de `public.signups`
- [ ] *(opcional)* `rix7.cl` verificado → `avisos@rix7.cl`

---

## 13. Lo que esto no cambia

- **No valida el contenido.** El asunto, el HTML y el texto los siguen mandando
  `alertEmail`, `sentryAlertEmail` y `welcomeEmail`; esto solo enciende la línea.
- **No reemplaza al cron.** El envío depende de la clave *y* de que el job corra.
- **No mide entrega.** Si Resend acepta el mensaje, este runbook da por bueno el
  trabajo: abrir, clics y spam son otra capa.
- **No guarda secretos en el repo.** Nunca, por ninguna razón.

---

**Archivos:** [lib/email/sendEmail.ts](../lib/email/sendEmail.ts) (envío) ·
[lib/email/outbox.ts](../lib/email/outbox.ts) (buzón local) ·
[lib/data/alertsRunner.ts](../lib/data/alertsRunner.ts) (avisos) ·
[app/api/webhooks/sentry/route.ts](../app/api/webhooks/sentry/route.ts)
(alertas) · [app/api/registro/route.ts](../app/api/registro/route.ts) (bienvenida)
· [docs/runbook-supabase-real.md](runbook-supabase-real.md) ·
[docs/runbook-guardia-de-secretos.md](runbook-guardia-de-secretos.md)
