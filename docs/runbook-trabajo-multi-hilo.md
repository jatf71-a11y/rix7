# 🧵 Runbook — varios hilos de trabajo en el mismo checkout

Varios hilos comparten este árbol de trabajo a propósito (editan los mismos
archivos), pero **no pueden compartir el directorio de artefactos de Next**.
Ese era el problema: `next dev -p 3939` y `next dev -p 3111` escriben los dos en
el mismo `.next`, así que el que compila último evicta los chunks del otro. El
síntoma que lo destapó fue un performance budget en rojo con **todas las rutas
excedidas a la vez** —imposible en un cambio real— porque el gate estaba midiendo
un `.next` de desarrollo: el manifest existía (lo escribe también `next dev`),
pero apuntaba a chunks sin minificar (`.next/static/chunks/main-app.js` llegaba a
**6 MB** en modo dev) y a archivos ya borrados.

Este runbook describe el aislamiento por **slot**: cada puerto de dev tiene su
propio directorio de artefactos, y CI, Vercel y `deploy:prod` siguen viendo
`.next` exactamente como antes.

---

## 1. La regla

| Recurso | Quién lo escribe | Aislamiento |
|---|---|---|
| Dev server (`npm run dev`) | cada hilo | **automático**: un slot por puerto |
| Build de producción (`.next`) | CI, Vercel, `deploy:prod` | **compartido y de un solo escritor**: no corras dos a la vez |
| Verificación del bundle | quien la pide | elige el directorio (`NEXT_DIST_DIR` o `--dir`) |

La consecuencia práctica: **dos dev servers ya no se molestan**, y un dev server
tampoco puede contaminar la build que lee el gate. Lo único que sigue siendo
compartido es la build de producción, que por diseño es un recurso único (es la
que CI y Vercel esperan encontrar en `.next`).

---

## 2. Uso diario

```bash
npm run dev                    # :3000  → artefactos en .freebuff/rix7-next-3000
npm run dev -- --port 3939     # :3939  → artefactos en .freebuff/rix7-next-3939
npm run dev -- --dist .next    # vuelve al directorio compartido, a propósito
npm run dev -- --help          # las opciones
```

Al arrancar, el wrapper imprime dónde está escribiendo:

```
→ distDir: .freebuff/rix7-next-3939
→ http://localhost:3939
```

Cualquier opción que el wrapper no reconoce se reenvía intacta a `next dev`
(`npm run dev -- --port 3939 --turbo` funciona). El default sigue siendo el
puerto **3000** del README.

### 2.1 ¿Qué está corriendo? `npm run slots`

Antes de elegir un puerto o de lanzar una build, mira el registro local:

```bash
npm run slots
# Sesiones locales vivas (2):
#
# PUERTO  MODO   PID    DISTDIR                   ARRANQUE
# 3111    dev    5880   .freebuff/rix7-next-3111  12 min
# —       build  12308  .freebuff/rix7-next-3999  1 min

npm run slots -- --json    # para scripts
npm run slots -- --all     # incluye entradas con PID muerto (no las limpia)
```

Lo alimentan los wrappers: `npm run dev` registra `dev` y `npm run build`
registra `build`, ambos con su PID y su distDir, y se dan de baja al salir. El
puerto sale `—` en una build (no escucha).

Dos detalles que hacen que el registro no estorbe:

- **El PID es la única verdad.** Una entrada se considera viva si el proceso
  responde a la señal 0; las de procesos muertos se limpian solas en la próxima
  lectura. No hay que mantener nada a mano.
- **Es una ayuda, no un candado.** Si el archivo falta o está roto, todo sigue
  funcionando y `npm run dev` arranca igual; solo avisa si detecta el puerto ya
  ocupado por otra sesión registrada.

> Solo aparecen las sesiones lanzadas con los wrappers. Un `npx next dev` a mano,
> o un servidor arrancado antes de esta versión, no se registra: para verlo,
> reinícialo con `npm run dev`.

### 2.2 Node 24: la misma versión que CI y Vercel

El repo fija **Node 24** —la línea que corren CI y Vercel— en dos sitios que
hablan el mismo idioma que las herramientas:

- **`.nvmrc`** (contenido `24`): lo leen `nvm`/`fnm`.
- **`engines.node`** en `package.json` (`"24.x"`): lo lee Vercel al desplegar.

> Vercel **discontinuó Node 20.x**: su build falla con «Node.js Version "20.x" is
> discontinued and must be upgraded», así que la línea subió a 24 y local, CI y
> Vercel corren la misma major. De paso, el `WebSocket` global que usa la
> auditoría a11y es estable desde Node 22.

```bash
nvm use      # o `fnm use`; ambos leen .nvmrc
node -v      # v24.x
```

Los wrappers (`dev.mjs`, `build.mjs`) **avisan** —no fallan— si la major en uso
no es la 24:

```
⚠ Node en uso: v20; el proyecto fija Node 24 (.nvmrc), la misma línea de CI y Vercel.
  Otra major puede cambiar el comportamiento de los workers de `next dev` y del build.
  Alinea con `nvm use` o `fnm use` (lee .nvmrc) antes de seguir.
```

El aviso es a propósito: hay una sola copia del repo y a veces conviene probar
otra versión. Si no tienes `nvm`/`fnm`, puedes correr puntualmente con la Node 24
sin instalarla:

```bash
npx -y node@24 scripts/dev.mjs --port 3111
```

> Por qué importa: un desalineamiento de major no da la cara en un test. Se
> manifiesta como rarezas de plataforma —workers internos de `next dev`
> cayéndose, builds que se comportan distinto— y cuesta atribuirlas a la causa
> real. Fijar la versión vuelve el entorno local **reproducible** frente a CI.

---

## 3. Cómo funciona

Cinco piezas, todas en `scripts/next-paths.mjs` como fuente única:

1. **`distDir` configurable.** `next.config.js` usa `NEXT_DIST_DIR || '.next'`.
   Sin la variable, nada cambia: CI, Vercel y `deploy:prod` no la definen.
2. **El slot.** `scripts/dev.mjs` ata el puerto a
   `.freebuff/rix7-next-<puerto>` y lo pasa como `NEXT_DIST_DIR` al proceso hijo.
3. **El tsconfig del slot.** `.freebuff/rix7-next-<puerto>.tsconfig.json`,
   generado en cada arranque (ver la gotcha 2).
4. **El gate.** `scripts/check-bundle-budget.mjs` resuelve el mismo `distDir`
   (con `--dir` como override) y **aborta** si el directorio no es una build de
   producción, en lugar de comparar chunks de dev contra la línea base.
5. **El registro.** `scripts/slots.mjs` guarda en `.freebuff/slots.json` una
   entrada por sesión viva; `dev.mjs` y `build.mjs` lo alimentan y `npm run
   slots` lo lee (y limpia).

---

## 4. Las tres gotchas

Estas tres restricciones explican por qué el slot vive donde vive. Si alguna se
rompe, hay un test que lo avisa (`scripts/next-paths.test.ts`).

### 4.1 `.gitignore` — por eso el slot no es `.next-3939/`

`.gitignore` ignora `.next/` y nada más. Un directorio nuevo dentro del repo
aparecería como no rastreado y podría colarse en un commit.

En cambio `.freebuff/` **ya está ignorado** (línea de «estado local de las
herramientas»), así que los slots van ahí y `git status` queda limpio.

> No comitees nada de `.freebuff/`. Si aparece en `git status`, es que alguien
> tocó `.gitignore`. El registro de sesiones (`slots.json`) también vive ahí por
> esa razón.

### 4.2 `tsconfig.json` — Next lo reescribe, y hay que desviarlo

Cuando el `distDir` no es `.next`, Next agrega su carpeta `types` al `include` de
`tsconfig.json` y **regraba el archivo entero, reformateado**. Ese archivo está
versionado: con un slot por hilo, cada arranque dejaría un diff ajeno en
`git status` y dos hilos se pisarían entre sí.

Por eso el wrapper genera un tsconfig propio del slot y se lo declara a Next
(`typescript.tsconfigPath`, vía `NEXT_SLOT_TSCONFIG`). Next descarga ahí su
escritura y el tsconfig de la raíz **no se toca**.

Dos detalles que costaron dos intentos cada uno:

- **El tsconfig del slot no puede vivir dentro del `distDir`**: `next dev` vacía
  el distDir al arrancar y lo borraba antes de leerlo. Va al lado:
  `.freebuff/rix7-next-3999` (distDir) y `.freebuff/rix7-next-3999.tsconfig.json`.
- **Su `baseUrl` tiene que ser absoluto.** Next resuelve un `baseUrl` relativo
  contra la raíz del proyecto y TypeScript contra la carpeta del tsconfig: con un
  relativo, uno de los dos se equivoca y **todo el alias `@/` deja de resolverse**
  (el dev server responde 500 con «Can't resolve '@/components/…'»).

Además, `tsconfig.json` de la raíz excluye `.freebuff` y `.build-check` para que
el typecheck no compile los tipos generados dentro de esas carpetas.

### 4.3 `deploy` — por eso el slot no viaja a Vercel

`deploy-prod.mjs` copia el árbol a un staging sin metadata de git. Su lista
`EXCLUDED` ya contiene `.freebuff`, así que los artefactos de dev **no viajan** a
Vercel. Un `.next-3939/` dentro del repo sí lo habría hecho.

> Si algún día mueves los slots fuera de `.freebuff/`, agrega la carpeta nueva a
> `EXCLUDED` **y** al `exclude` de `tsconfig.json` **y** al `.gitignore`, en ese
> orden de importancia.

---

## 5. Construir y medir

### 5.1 La build de producción (compartida)

```bash
npm run build && npm run check:bundle
```

Escribe `.next` y mide `.next`. Es lo que corre el CI. **Un solo escritor**: no
lances dos builds a la vez, ni una build mientras otro hilo espera medir `.next`.

### 5.2 Una build propia, sin tocar `.next`

Un solo comando, con el puerto como única cosa que recordar:

```bash
npm run build:slot -- --port 3999
```

Equivale a construir en `.freebuff/rix7-next-3999` **y** medir ahí, sin repetir a
mano `NEXT_DIST_DIR` ni el `--dir` del gate (que era justo lo que se prestaba a
construir en un directorio y medir en otro). El wrapper deriva el distDir y el
tsconfig del slot del puerto —los mismos de `npm run dev`— y, al terminar, corre
el gate en ese directorio y propaga su código de salida.

```bash
npm run build:slot -- --port 3999 --no-measure   # solo construir
npm run check:bundle -- --dir .freebuff/rix7-next-3999  # medir después
```

El tsconfig del slot se escribe en cada build (y en cada `npm run dev`), así que
la build del slot no toca ni `.next` ni el `tsconfig.json` de la raíz aunque el
puerto nunca haya tenido un dev server.

### 5.3 Medir un directorio cualquiera

```bash
npm run check:bundle -- --dir /ruta/al/dist        # una copia de verificación
NEXT_DIST_DIR=.freebuff/rix7-next-3999 npm run check:bundle
```

Si el directorio es de desarrollo, el gate **falla a propósito** con un mensaje
que lo dice (ver §7).

---

### 5.4 Disco

Cada slot guarda su propio caché de webpack (una build de producción en un slot
llegó a pesar **647 MB**) y `.next` con su caché también engorda (esta máquina lo
tuvo en **~1 GB**). Los slots **no se acumulan solos**: se nombran por puerto, así
que reutilizas el mismo mientras uses el mismo puerto.

Para limpiar de una vez sin recordar la lista:

```bash
npm run clean -- --dry-run   # qué borraría, sin borrar
npm run clean                # build, slots, copias y logs
npm run clean -- --deep      # además node_modules (hay que reinstalar)
```

`clean` respeta por defecto los slots de las sesiones que `npm run slots` ve
vivas: nunca borra el distDir de un dev server que está trabajando. Todo lo
borrado se regenera en el próximo arranque.

También conserva `tsconfig.tsbuildinfo`, la caché incremental del typecheck
(~280 KB): borrarla no ahorra espacio y encarece el próximo `npx tsc --noEmit`
de ~18 s a ~56 s. Solo `--deep` —el «reset total»— la elimina.

---

## 6. Verificar que el aislamiento está en pie

Cuatro comprobaciones, todas de segundos:

```bash
# 1. Un dev server no toca la build compartida: el mtime no debe cambiar.
stat -c '%y %n' .next/BUILD_ID
npm run dev -- --port 3999 &   # ...y vuelve a mirar el mtime

# 2. Nada de .freebuff aparece en git.
git status --short | grep freebuff      # sin salida

# 3. El tsconfig de la raíz no acumula entradas de slot.
git diff tsconfig.json                  # solo el `exclude` de la estrategia

# 4. dev y el typechecker miran los mismos archivos.
npx tsc -p .freebuff/rix7-next-3999.tsconfig.json --noEmit --listFilesOnly | wc -l
npx tsc --noEmit --listFilesOnly | wc -l   # el mismo número
```

Y la suite fija los invariantes de §4 sin que nadie tenga que recordarlos:

```bash
npx vitest run scripts/next-paths.test.ts scripts/dev.test.ts scripts/build.test.ts scripts/slots.test.ts
```

---

## 7. Lo que falla a propósito

| Acción | Qué pasa y por qué es correcto |
|---|---|
| `--dist` con ruta absoluta | Error explicado: Next une el `distDir` a la raíz, así que un absoluto no es «otro sitio», es una ruta imposible (`C:\repo\C:\Users\…`) y el servidor muere con un ENOENT ilegible. |
| `build:slot -- --port no-es-puerto` | Error explicado: `--port` espera un número; sin él no hay slot que derivar. |
| Gate sobre un slot de dev | `✖ … no es una build de producción: hay manifest pero falta …/BUILD_ID`. Es el guard que impide el rojo falso que originó todo esto. |
| Gate sobre un directorio inexistente | `✖ No existe …/app-build-manifest.json`. Falla cerrado, nunca «verde» por ausencia de datos. |

---

## 8. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| 500 con «Can't resolve '@/components/…'» | El tsconfig del slot no existe (lo borró algo) o alguien lo editó con `baseUrl` relativo | Reinicia con `npm run dev`; lo regenera |
| `ENOENT` con una ruta tipo `C:\repo\C:\Users\…` | `NEXT_DIST_DIR` (o `--dist`) absoluto | Usa una ruta relativa al repo |
| `tsconfig.json` con entradas `rix7-next-` en `git status` | Alguien corrió `next dev` a mano con `NEXT_DIST_DIR` y sin `NEXT_SLOT_TSCONFIG` | `git checkout -- tsconfig.json` y usa `npm run dev` |
| El puerto está ocupado | Otro hilo (o un dev server viejo) en ese puerto | Otro `--port`; con slots, cada puerto es un mundo |
| `Jest worker encountered 2 child process exceptions` o `patchFetch is not a function` en el log del dev | Caché del slot inconsistente (tras un error de compilación, un crash o una sesión muy larga): el worker de rutas estáticas carga un `ComponentMod` a medias | Reinicia el dev server; si vuelve, `npm run clean` y arranca en un slot fresco |
| Windows: `EPERM`/`EBUSY` al borrar `.freebuff` | El dev server tiene archivos abiertos | Detén el dev server antes de borrar |
| El gate dice que falta el chunk X | La build se interrumpió o el `distDir` apunta a un `.next` de dev | `npm run build` y reintenta |
| Demo/preview apunta a datos raros | El dev server viejo en otro puerto sigue vivo | `npm run slots` lista lo vivo; si no aparece, `netstat -ano` (estado `LISTENING`) y ciérralo |

---

## 9. Checklist de cierre

- [ ] Los dev servers que quedan corriendo usan `npm run dev` (slot propio).
- [ ] `npm run slots` muestra lo que esperas y nada obsoleto.
- [ ] `git status` sin nada de `.freebuff/`.
- [ ] `git diff tsconfig.json` sin entradas de slot.
- [ ] Ninguna build de producción corriendo a la vez sobre `.next`.
- [ ] `npm run check:bundle` verde sobre la build que quieres publicar.
- [ ] Nada de `.freebuff/` en un commit.

---

## 10. Lo que esto no cambia

- **CI**: no define `NEXT_DIST_DIR`, así que el job de budget reconstruye `.next`
  desde el artefacto y mide exactamente como medía. `npm run build` pasa por
  `scripts/build.mjs`, que lanza el mismo `next build` (mismo distDir, mismas
  variables, mismo código de salida) y solo suma un archivo de estado local en
  `.freebuff/`; la build resultante es idéntica.
- **Vercel**: no define la variable; build y start siguen usando `.next`.
- **`deploy:prod`**: sin cambios; `.freebuff` ya estaba en su lista de exclusiones.
