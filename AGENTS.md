# AGENTS.md — Rix7

Instrucciones del proyecto para cualquier agente que trabaje en este repositorio.

## Desplegar: `npm run deploy`, siempre a `rix7.cl`

Cuando el usuario diga «despliega», «publica», «subí esto a producción» o
equivalente, el comando es:

```bash
npm run deploy
```

Es el release de punta a punta (`scripts/release-prod.mjs`): build → migraciones
→ esquema → deploy → verificación, y **aborta en el primer paso que falle**. No
inventes un camino más corto.

- **Producción es `https://rix7.cl` y nada más.** No es `rix7.vercel.app` ni la
  URL `rix7-<hash>.vercel.app` del deployment: esas son alias y snapshots del
  mismo proyecto, sirven para revisar, no para aprobar un deploy.
- El release **verifica en `rix7.cl`**: compara el `build.id` de `/api/health`
  contra el hash del árbol de trabajo. Si el dominio público no quedó sirviendo
  lo recién publicado, sale en rojo aunque el deployment responda bien en su
  propia URL. Un rojo así se arregla mirando el alias, no repitiendo a ciegas.
- `npm run deploy:prod` existe pero **solo publica** (sin build, sin esquema, sin
  verificación): no es «el deploy». `vercel --prod` a mano, tampoco.
- `git push` **sí publica** en este proyecto: un push a `main` hace que la
  integración de Git despliegue a producción y **mueva el alias** de `rix7.cl` y
  `www.rix7.cl` a ese deployment. Ese deployment no lleva `RIX7_BUILD`, así que
  `/api/health` responde `build: null` aunque el código sea correcto: el sitio
  sigue sirviendo, pero ya no se puede afirmar cuál es. Pasó el 2026-10-23 con el
  commit `6f6951c`: el alias saltó a `rix7-hmxa0binc` y la build dejó de
  identificarse. **Después de cualquier push a `main`, corré `npm run deploy`** y
  no des por buena la producción hasta que `check:health` confirme el
  identificador. No confíes en «el push no despliega».
- El deploy publica el árbol de trabajo, así que lo que se publica es lo que hay
  en disco, incluidos los cambios sin commitear; el informe lo dice (`dirty`).

## Si producción deja de identificarse

Los tres síntomas, de más barato a más preciso:

```bash
curl -s https://rix7.cl/api/health
# mirá "build" y "release": si son null, ese deployment no se identifica.
```

```bash
npm run check:health
# · Identificador de la build: el despliegue no publica identificador de la build (RIX7_BUILD).
```

Esa línea es una **nota**, no un rojo: `check:health` sale con 0 igual, porque no
poder identificar la build no es una caída. Verde acá **no** significa
«identificado»; hay que leer esa línea.

```bash
npx vercel alias ls
```

La columna `source` de `rix7.cl` y `www.rix7.cl` dice qué deployment sirve el
dominio. Si no es el que publicó el último release —por ejemplo, un
`rix7-git-main-*`— la integración de Git se llevó el alias.

El arreglo es volver a publicar con el comando del repositorio:

```bash
npm run deploy
```

Eso reinyecta `RIX7_BUILD`, versión y tag, reasigna el alias y la verificación del
release lo comprueba en `rix7.cl`. Si el alias se mueve cada vez que se pusea, la
causa está en la integración de Git de Vercel —publica a producción y se queda
con el dominio— y se corta desde el panel de Vercel, no desde el repo.

## Después de desplegar

```bash
npm run smoke:prod    # portada, /admin/registros, /socio y las APIs protegidas
npm run check:health  # subsistemas críticos y comparación con el árbol
```

Las dos apuntan a `rix7.cl` por defecto. `--url` sirve para probar un preview o
un `localhost`, no para cambiar qué es producción.

## Qué no hacer sin que te lo pidan

- No commitear, pushear ni abrir un PR.
- No cambiar de proyecto Supabase (`npm run corte:supabase`) ni rotar
  credenciales.
- No tocar `www.rix7.cl` ni el panel: `www` redirige al dominio principal y el
  panel vive en `rix7.cl/admin` (protegido por `requireAdmin`; sin sesión se
  sirve solo la pantalla de acceso). Separarlo en `admin.rix7.cl` exige las tres
  cosas a la vez —dominio en Vercel, DNS y Redirect URLs de Supabase—; con dos
  el panel queda inalcanzable.
