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
- `git push` **no publica** en este proyecto (plan Hobby: los deployments de un
  autor que no es miembro del equipo los descarta Vercel). El deploy publica el
  árbol de trabajo, así que lo que se publica es lo que hay en disco, incluidos
  los cambios sin commitear; el informe lo dice (`dirty`).

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
