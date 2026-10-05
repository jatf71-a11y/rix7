# 🛡️ Runbook — la guardia de secretos (commit, dev, deploy y CI)

Nació de un susto real: durante la puesta en marcha de Supabase, el token
personal (`sbp_…`) vivió un rato en `.env.local` y `deploy:prod` lo copiaba al
árbol de publicación sin filtrarlo. **Nada de eso llegó a un commit**, pero
dependía de que nadie se equivocara. Este runbook documenta la regla que
convirtió esa suerte en algo verificable: si un secreto entra al árbol de
trabajo, **cinco superficies** lo ven antes que el siguiente `git push`.

La idea es una sola: **la misma guardia, cinco veces**. El CLI que corre a
mano, el hook del commit, el wrapper de `dev`, el de `deploy:prod` y el job de
CI comparten `scripts/check-secrets.mjs`, así que no pueden divergir.

---

## 1. La regla

| Superficie | Cuándo | Qué hace si encuentra algo |
|---|---|---|
| **CLI** (`npm run check:secrets`) | cuando quieras | imprime los hallazgos y sale con `1` |
| **Hook pre-commit** | antes de cada `git commit` | aborta el commit (exit `1`) |
| **`npm run dev`** | antes de levantar el servidor | no arranca `next dev` |
| **`npm run deploy:prod`** | antes de copiar el árbol a Vercel | no despliega |
| **CI** (job `secrets`) | en cada push y PR | pone el check en rojo |

Todas hablan por el mismo camino: `runSecretGuard()` (informe) y
`assertNoSecrets({ action })` (veredicto). Un solo sitio para cambiar el
comportamiento.

---

## 2. Uso diario

```bash
npm run check:secrets         # revisa el árbol, sale con 1 si hay hallazgo
node scripts/check-secrets.mjs --help   # qué y cómo busca
npm run hooks:install         # (re)instala el hook pre-commit
```

Salida limpia:

```
== Guardia de secretos · 330 archivos ==

  · Omitidos por tamaño o por binarios (15): public/brand-logo.png, …
  ✓ Sin secretos en el árbol de trabajo.
```

Salida con hallazgo (el código de error es el `1` del primer check):

```
  ✗ src/config.ts:7:12 — Token de GitHub (ghp_/gho_/ghu_/ghs_/ghr_) (ghp_A1b2C…•••••••• (40 caracteres))
::error file=src/config.ts,line=7::Token de GitHub (ghp_/gho_/ghu_/ghs_/ghr_). Rota el secreto y quitálo del árbol.

  Un hallazgo: no lo subas. Rotá el secreto y pasalo por variable de entorno.
```

El secreto **nunca se imprime entero**: `mask()` muestra los primeros siete
caracteres, una raya de puntos y el largo total. Lo justo para ubicarlo, sin
volver a filtrarlo en un log de CI.

---

## 3. Qué detecta

El escáner separa dos reglas. (1) **Ningún `.env*` rastreado** salvo la plantilla
`.env.example(.…)` —un marcador es documentación, un valor real es una fuga.
(2) **Formas de secreto de alta confianza**: cada patrón exige el largo y el
alfabeto reales, así que un marcador no coincide.

| Patrón | Qué es | Detecta | No detecta a propósito |
|---|---|---|---|
| `supabase-pat` | token personal de Supabase | `sbp_` + ≥32 hex | `sbp_tu_token` |
| `supabase-secret` | service_role de Supabase | `sb_secret_` + ≥28 | la anon |
| `resend-key` | API key de Resend | `re_` + ≥28 alfanuméricos | `share_views`, `fire_station` |
| JWT | clave de servicio | payload con `role: "service_role"` | la anon (es pública) |
| `github-token` | tokens clásicos | `gh[pousr]_` + 36 | cualquier string corto |
| `github-fine-grained-token` | token fino | `github_pat_` + ≥22 | — |
| `stripe-secret-key` | claves secretas | `(sk\|rk)_(live\|test)_` + ≥24 | `pk_` (es publicable) |
| `google-api-key` | API key de Google | `AIza` + 35 | — |
| `sentry-token` | token de org | `sntrys_` + ≥20 | el DSN (se publica a propósito) |
| `private-key-block` | clave privada | `-----BEGIN … PRIVATE KEY-----` | `PUBLIC KEY`, `CERTIFICATE` |

Los prefijos de arriba se escriben cortos a propósito: **este doc no es un
hallazgo del escáner**, y si agregás uno largo de verdad, sí lo será.

Un caso que costó: la clave de Google **no usa `\b` final**, porque puede
terminar en `-` o `_`, que no son frontera de palabra. Se resuelve con un
lookahead `(?![\w-])`.

---

## 4. Qué no detecta, a propósito

- Cadena corta o genérica: un detector que grita se aprende a ignorar, y un
  check que se ignora no protege nada.
- `pk_` (Stripe publicable) y la clave anónima de Supabase: **son públicas**.
- Certificados y claves públicas PEM.
- Archivos de más de 8 MB (`MAX_FILE_BYTES`) y binarios: no hay texto que
  revisar. Ojo: un binario *falso* sí se lee. `_audit/fase1-report.txt` está en
  UTF-16 y antes caía en el descarte; ahora lo decodifica y lo revisa.
- Lo que está en `.gitignore`: **a propósito**. `.env.local` existe para guardar
  secretos; el chequeo sondea lo que `git add` podría llevarse, no lo que tenés
  en disco.

---

## 5. Cómo funciona

```bash
git ls-files --cached --others --exclude-standard -z
```

Esa lista (rastreados + no ignorados) es todo lo que `git` podría llevarse. En
el CI el árbol es el checkout, así que equivale a revisar el repositorio entero.

- `decodeText()` acepta UTF-8 con y sin BOM, UTF-16LE/BE; devuelve `null` si
  hay bytes nulos, que es como se descartan las imágenes y el video.
- Los patrones se recorren línea por línea para devolver **línea y columna**
  exactas (`::error file=…,line=…` para que GitHub ane el error al archivo).
- `git add -f` de un `.env*` lo detecta la regla 1 (no el patrón), y un archivo
  borrado entre listar y leer simplemente se ignora.

Núcleo exportado: `SECRET_PATTERNS`, `JWT_REGEX`, `jwtRole`, `isAllowedEnvFile`,
`isEnvFile`, `decodeText`, `mask`, `findSecretsInText`, `scanRepository`,
`listCandidateFiles`, `repositoryRoot`, `MAX_FILE_BYTES`, `runSecretGuard`,
`assertNoSecrets`.

---

## 6. El hook local (pre-commit)

```bash
npm run hooks:install     # escribe .git/hooks/pre-commit
```

`.git/hooks` **no se versiona**, por eso existe el instalador
(`scripts/install-git-hooks.mjs`) en vez de un hook suelto: se puede regenerar
en cualquier clone sin depender de la memoria de nadie. No cuelga de
`postinstall` a propósito —en el CI la guardia ya corre como job propio— así que
se instala a mano, cuando querés.

El hook es un envoltorio fino:

```sh
cd "$(git rev-parse --show-toplevel)" || exit 1
command -v node >/dev/null 2>&1 || exit 0     # sin node, avisa y no corta
node scripts/check-secrets.mjs || exit 1
```

Comportamiento:

- **Cambia el hook:** no se edita a mano. Editá `scripts/check-secrets.mjs` y
  volvé a correr `npm run hooks:install`.
- **Hook ajeno:** si ya había un `pre-commit`, lo respalda en `pre-commit.bak`.
  Si ese respaldo ya existe, **falla** en vez de pisarlo — a mano, entonces.
- **Saltarlo a sabiendas:** `git commit --no-verify`. Es un escape, no la vía
  normal.
- **Quitarlo:** `node scripts/install-git-hooks.mjs --uninstall`.
- **Reinstalar** es idempotente: sobre el hook propio no crea respaldo.

Test (`scripts/install-git-hooks.test.ts`): 4 tests sobre escritura, respaldo,
conflicto de respaldo e idempotencia.

---

## 7. El paso previo de `dev` y `deploy:prod`

`assertNoSecrets({ action })` devuelve `false` si hay hallazgos **o si la
guardia no pudo correr** (p. ej. sin `git` en el PATH). Ese detalle importa:
un fallo del chequeo nunca se confirma como «todo bien».

```js
// scripts/dev.mjs — después de validar args, antes de tocar Next
if (!assertNoSecrets({ action: 'arranco el servidor de desarrollo' })) process.exit(1);

// scripts/deploy-prod.mjs — antes de preparar el staging
if (!assertNoSecrets({ action: 'despliego a producción' })) process.exit(1);
```

Por qué el de deploy es el que más importa: los `.env*` ya quedan **fuera de la
copia** (`entry.name.startsWith(".env")`), pero un secreto suelto en un archivo
normal viajaría igual. El gate corre antes de crear `.deploy-staging`, así que
ni siquiera se copia.

Por qué `dev` también: es el único camino a `next dev`, así que un descuido se
nota en el primer arranque, no en producción.

Un test de cableado (mismo estilo de invariante textual que
`next-paths.test.ts`) lee los dos wrappers y falla si el paso previo se cae.

---

## 8. CI: el job `secrets`

En `.github/workflows/ci.yml`, **primero y sin dependencias**:

```yaml
secrets:
  name: Sin secretos en el árbol
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 24 }
    - run: npm run check:secrets
```

Sin `npm ci` y sin `cache: npm`: no necesita dependencias, así que un token
filtrado se ve en segundos antes de gastar minutos instalando y compilando.

---

## 9. Si te marca algo

1. **No corrijas el escáner.** El patrón existe porque un valor real lo cumple.
2. **Rotá el secreto en su panel** (Supabase, GitHub, Stripe, Google, Sentry…).
   Consideralo filtrado: el valor ya estuvo en tu disco o en un log.
3. Pasalo a **variable de entorno** (Vercel) o, si es local, a `.env.local`
   (que `.gitignore` ya cubre).
4. Borrá el valor del archivo y reintentá.

---

## 10. Problemas comunes

| Síntoma | Causa | Arreglo |
|---|---|---|
| El hook no corre | clon nuevo | `npm run hooks:install` |
| `✖ No se pudo correr la guardia` | sin `git` o no en el PATH | instalá git / revisá PATH |
| Algo no relacionado bloquea el commit | el hook mira **todo el árbol** | borralo o agregalo a `.gitignore` |
| Falso positivo legítimo | patrón demasiado laxo | usá una variable de entorno, o ajustá el patrón |
| `npm run dev` no arranca y hay hallazgos | gate del wrapper | idem |
| Querís subir igual | hay que hacerlo consciente | `git commit --no-verify` (y rotá el secreto) |

---

## 11. Checklist de cierre

- [ ] `npm run check:secrets` sale limpio.
- [ ] `npm run hooks:install` corre en el clone y el hook corta con secreto
      plantado.
- [ ] `npm run dev` y `npm run deploy:prod` abortan con hallazgos y siguen
      normales sin ellos.
- [ ] CI verde con el job `secrets` (primero).
- [ ] `npx tsc --noEmit`, `npm run check:knip` y `npx vitest run` en verde.
- [ ] Ningún `.env*` salvo `.env.example` en `git status`.

---

## 12. Lo que esto no cambia

- **No reemplaza a CI.** El hook es local y se salta con `--no-verify`; el job
  de GitHub es el que no se salta. Las dos capas se complementan.
- **No busca «claves débiles».** No adivina, solo reconoce formas concretas.
  Añadir un proveedor nuevo es sumar una entrada a `SECRET_PATTERNS` (con su
  test) en `scripts/check-secrets.mjs`.
- **No protege el contenido de `.env.local`.** Por diseño ese archivo está
  ignorado: ahí los secretos sí viven.
- **No cumple el rotado.** Si aparece un hallazgo, el rota es cosa tuya.

---

**Archivos:** [scripts/check-secrets.mjs](../scripts/check-secrets.mjs) (núcleo
+ CLI) · [scripts/install-git-hooks.mjs](../scripts/install-git-hooks.mjs)
(instalador del hook) · [scripts/check-secrets.test.ts](../scripts/check-secrets.test.ts)
· [scripts/install-git-hooks.test.ts](../scripts/install-git-hooks.test.ts) ·
[.github/workflows/ci.yml](../.github/workflows/ci.yml) (job `secrets`)
