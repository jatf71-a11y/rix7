# Rix7 - Portal Inmobiliario Inteligente (Chile)

Plataforma inmobiliaria moderna de alto rendimiento para el mercado de **Chile completo**, construida **100% con herramientas de código abierto y capas gratuitas** (sin APIs de pago de Google Maps o Mapbox).

### ✨ Novedades v7
- Heatmap de densidad por precio en el mapa
- Selector de monedas CLP/UF/USD con tasas oficiales del Banco Central
- Selector de 16 regiones + comunas integrado al GIS
- Catálogo nacional de propiedades en 8 regiones

---

## 🚀 Stack Tecnológico

- **Frontend**: [Next.js 14+ (App Router)](https://nextjs.org/), TypeScript, Tailwind CSS, Lucide Icons.
- **Web GIS & Mapas**: [MapLibre GL JS](https://maplibre.org/) con teselas libres de [OpenStreetMap](https://www.openstreetmap.org/), geolocalización y filtrado por cercanía.
- **Backend & Base de Datos**: [Supabase](https://supabase.com/) (PostgreSQL 15+ con extensión nativa **PostGIS** `GEOGRAPHY(POINT, 4326)`, Supabase Auth `@supabase/ssr`, y Supabase Storage).
- **Tipos de Propiedades**: Departamentos, Casas, VIP, Parcelas, Oficinas y Terrenos.
- **Operaciones**: Venta y Arriendo.

---

## 🛠️ Guía de Ejecución Local

```bash
# 1. Iniciar el servidor de desarrollo:
npm run dev
```
Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

---

## 📊 Medición de Core Web Vitals

```bash
npm run vitals                                  # mide la ficha por defecto
npm run vitals -- --path=/ --path=/properties/…  # varias rutas
npm run vitals -- --base=https://rix7.vercel.app # contra el deploy
```

Mide **LCP, CLS, INP, FCP y TTFB** con `PerformanceObserver` en un Chrome real, vía protocolo DevTools — sin instalar dependencias nuevas (usa el `WebSocket` nativo de Node 24). Reporta la mediana de N corridas en frío, el elemento LCP y los recursos más lentos, para poder comprobar cada optimización con números.

Medí siempre contra `next start` o el deploy: `next dev` infla los valores.

---

## 🔗 Landing compartible (`/compartir/[id]`)

Es la página que se manda por WhatsApp, correo o redes. Los botones de compartir de la ficha (WhatsApp, *Copiar enlace* y el compartir nativo del sistema) apuntan **acá**, no a la URL de la ficha: quien recibe el enlace no conoce la propiedad y necesita un resumen que se entienda solo.

**Qué trae**: carrusel de fotos con visor completo, video si la propiedad lo tiene, precio y operación, dormitorios/baños/superficie/estacionamiento/privados/año, la **descripción del entorno a 15 minutos caminando** por categoría de POIs, la descripción, el equipamiento, un **mapa del sector dibujado en SVG** (calles con nombre, anillo de 15 minutos y POIs, todo desde el snapshot) y el CTA de la corredora.

### La tarjeta del enlace (lo que se ve en el chat)

Antes del clic, lo único que ve quien recibe el enlace es la **tarjeta de vista previa**: en WhatsApp, correo, Telegram o redes, esa tarjeta *es* el anuncio. Se arma en dos piezas, y ninguna reutiliza el texto crudo de la propiedad.

**Título y descripción** (`lib/utils/shareMeta.ts`, puro y con tests):

- El **precio encabeza** y no se recorta nunca. Si el título no entra en el límite, se sacrifican palabras del tipo o de los dormitorios antes que el precio o la comuna.
- La **descripción** es especificación + primera oración de la corredora + cierre con su nombre (el CTA dentro del propio chat), cortada a 200 caracteres **por palabra** para no compartir una palabra partida.
- `redactSensitive` filtra la dirección, los correos y los teléfonos **aunque vengan dentro del texto** de la corredora.
- El título de la **pestaña** sigue siendo el nombre largo; el de la tarjeta es el corto con precio. Son públicos distintos.

**La imagen** (`/compartir/[id]/opengraph-image`, 1200×630) la genera `next/og` sobre la foto de la propiedad, con el precio, el título, la especificación, la marca Rix7 y el logo de la corredora. El lienzo vive en `app/compartir/[id]/ShareCard.tsx`, que es el mismo que dibuja la tarjeta vertical que la corredora descarga. Tres cosas que no son obvias:

- Corre en **runtime Node**, y no en edge: el plan Hobby de Vercel limita **cada Edge Function a 1 MB** y `next/og` (satori + resvg) pesa **1.05 MB** —medido por Vercel al desplegar—, así que ninguna de las dos tarjetas cabe ahí. El precio de usar Node es un bug de Next en Windows (`ERR_INVALID_URL` al resolver sus fuentes; vercel/next.js#77164), que se arregla en `postinstall` con `scripts/patch-next-og.mjs`: sin ese parche las rutas solo funcionarían en el deploy, no en local.
- Las imágenes se convierten a `data:` **antes** de dibujarlas y el oscurecido va con capas `rgba` en vez de un gradiente: si satori falla con una foto o un fondo, la tarjeta entera no se genera y el enlace se comparte **sin imagen**. Con esto, un fallo de la foto degrada a una tarjeta de marca, que sigue sirviendo.
- El desplazamiento vertical del logo/`og:image` no se toca: la URL absoluta, el `content-type` y las dimensiones las publica Next desde el propio archivo, así que no hay dos fuentes de verdad. Se cachea una hora en el borde (`s-maxage=3600`).

### La tarjeta que la corredora descarga (1080×1350)

Lo que circula por WhatsApp no suele ser el enlace sino la **imagen**: la corredora la adjunta y el chat la muestra entera, sin recortar. Por eso hay una segunda tarjeta, en proporción 4:5, que se baja desde el botón **Descargar tarjeta** de la landing (`/compartir/[id]/share-card`).

Es la única pieza del proyecto que **imprime el enlace al pie**. La horizontal no lo necesita —el enlace va escrito en el propio mensaje—, pero la vertical viaja sola, sin texto que la acompañe: sin el enlace impreso, quien la recibe no tiene forma de llegar a la ficha. Se imprime sin protocolo (`shareLinkLabel`), porque `https://` no se puede tocar y solo gasta el ancho que necesita el nombre del portal.

Los dos formatos comparten datos y ayudantes en `ShareCard.tsx`, así que un cambio en lo que la tarjeta muestra vale para las dos. Ojo con el `download` del botón y `Content-Disposition: inline` de la route: la route no fuerza la descarga a propósito, para que la URL se pueda abrir y revisar como cualquier imagen.

### El entorno se arma sin red

`lib/data/poiSnapshotLookup` lee los POIs de la **celda del snapshot estático** (4 decimales, ~11 m) que ya se genera con `npm run snapshot:pois` y el job diario. Si la celda existe, la sección se renderiza con el HTML y no hay ninguna llamada a Overpass al abrir el enlace — un enlace reenviado tiene que abrir rápido y no puede depender de que Overpass esté arriba. Si la celda no está (propiedad nueva), la sección simplemente **no aparece**: mejor sin bloque que a medio armar. La clave de celda vive en `snapshotCellKey` y la comparten la ruta, el script y este lookup, para que no puedan divergir.

### Lo que la landing NO publica (y por qué)

La regla es que el enlace no puede ser un atajo que deje a la corredora fuera de la operación:

| Dato | Qué se hace |
|---|---|
| Dirección exacta, número y piso | No aparece en la página ni en la metadata (OG/Twitter). Se muestra **comuna y región** |
| Ubicación en el mapa | Punto desplazado 130-230 m con `approximatePoint` (determinista por id) y **sin pin**. El SVG del sector se dibuja en el servidor alrededor de ese punto difuminado: no hay iframe ni petición a ningún proveedor de mapas |
| Conteos del entorno | Se miden desde el **punto difuminado**, no desde la propiedad. La sección publica el conteo por categoría y su desglose por subtipo, **sin nombres de lugares ni distancias** |
| Teléfono y correo del agente | No se muestran; los canales de contacto se habilitan con el **formulario de registro**, que es el que asigna el contacto a la corredora |
| Estos datos dentro del texto de la corredora | `redactSensitive` los quita igual: la metadata viaja por chats ajenos, no solo se muestra en la página |

El punto clave es que la landing es un componente de cliente: **todo lo que se le pasa queda escrito en el HTML** (`self.__next_f`), aunque el JSX no lo muestre. Por eso la página arma una versión publicable de la propiedad (`toPublishable`) antes de pasarla — con la propiedad completa, la dirección y el teléfono del agente eran legibles con «ver código fuente».

Ese mismo criterio rige el entorno, que necesitaba dos puntos distintos: el **pool** de POIs se busca con la celda de las coordenadas reales (el snapshot está indexado así, y esas coordenadas no salen del servidor), pero **todo lo que se muestra se mide desde el punto difuminado**. Es seguro porque el pool cubre 1500 m y solo se mide un radio de 1200 m desde un punto a lo más 230 m de distancia: `SNAPSHOT_POOL_RADIUS_M ≥ WALKABLE_RADIUS_M + MAX_OFFSET_M`, con un test que vigila la invariante (si se rompiera, la landing omitiría lugares cercanos **sin ningún error**: se vería bien y estaría mintiendo por omisión).

La página se cachea con ISR de 60 s (`revalidate` + `generateStaticParams` vacío), igual que la ficha.

### Qué enlaces traen interesados (`public.share_views`)

Aperturas de las landings, cruzadas con los contactos que ya guarda `leads`. La pregunta que responde no es cuánta gente vio la página, sino **qué enlaces conviene seguir moviendo**: una corredora manda el mismo departamento por WhatsApp a diez personas y necesita saber si funcionó. El informe está en `/admin/landings`.

| Métrica | De dónde sale |
|---|---|
| Aperturas | `public.share_views`, contadores agregados por propiedad y día |
| Contactos | `public.leads`, que ya guardaba `partner_id`, `property_id` y canal |
| Contactos / apertura | Calculada en `buildShareReport` (módulo puro, con tests) |

**Cuenta enlaces, no personas.** No se guarda IP, ni user agent, ni ningún identificador: una fila es «cuántas veces se abrió esta propiedad este día». Con una fila por visita el panel podría responder lo mismo, pero además acumularía un historial de quién abrió qué, que es justo lo que no hace falta para decidir.

**Una apertura por sesión del navegador.** La regla vive en `claimShareViewMarker` (pura, con test): recargar o volver a la página en la misma pestaña no vuelve a contar; cerrar la pestaña y abrir el enlace de nuevo sí. La landing se sirve cacheada, así que el aviso lo manda el navegador con un `fetch` en segundo plano (`POST /api/share/view`, con rate limit por IP).

**La escritura pasa por una RPC, no por la tabla.** `increment_share_view` es `SECURITY DEFINER` y solo suma de a uno: la `share_views` no tiene política de INSERT ni de UPDATE, así que con la anon key nadie puede inventar filas ni fijar un contador a gusto. Límite honesto: cualquiera puede invocar la función muchas veces para inflar un enlace propio — sirve para decidir, no para facturar.

**Tasa sin datos no es 0 %.** Si un enlace no tuvo aperturas, la tasa se muestra como `—` en lugar de `0 %`: no hubo fracaso, no hay dato.

---

## 🗄️ Base de Datos Supabase & PostGIS

1. Ejecuta el archivo [`supabase/schema.sql`](file:///c:/Users/javie/OneDrive/12.%20RIX/supabase/schema.sql) en el **SQL Editor** de tu proyecto Supabase.
2. Ejecuta [`supabase/seed.sql`](file:///c:/Users/javie/OneDrive/12.%20RIX/supabase/seed.sql) para sembrar propiedades reales en Vitacura, Las Condes, Lo Barnechea, Providencia, Ñuñoa, Peñalolén y Chicureo, y las **11 corredoras inscritas** (`public.partners`).
3. Copia tus credenciales en `.env.local` y despliega en Vercel.

### Corredoras inscritas (`public.partners`)

Los socios estratégicos son filas de la tabla `partners`, no una lista en el código: lo que se da de alta o se edita en `/admin/empresas` queda guardado.

- **La semilla no pisa nada**: usa `ON CONFLICT (id) DO NOTHING`, así que volver a ejecutar `seed.sql` solo crea las que falten y nunca revierte una edición hecha desde el panel.
- **Sin Supabase configurado** (o con la tabla vacía) el portal sigue funcionando con el catálogo de `lib/data/partners.ts`, y el panel de admin muestra un aviso de que los cambios son temporales. Nunca se queda sin corredoras.
- **Datos de contacto**: `contact_phone` (fijo, para *Llamar*), `contact_whatsapp` (móvil, para *WhatsApp*) y `contact_email` (para *Mail*). El móvil va separado del fijo porque `api.whatsapp.com` rechaza un número fijo.
- **Escribir exige rol admin**: las políticas RLS lo exigen vía `app_metadata.role = 'admin'` (helper `public.is_rix7_admin()`). Un usuario autenticado sin ese rol no puede modificar la tabla, ni siquiera con la anon key.
- **Los teléfonos de la semilla son placeholder** (`+56 2 2000 00XX` / `+56 9 0000 00XX`): reemplazalos por los reales desde `/admin/empresas`.

### Contactos de visitas interesadas (`public.leads`)

Cuando una visita deja sus datos en una ficha y toca Llamar, WhatsApp o Mail, el contacto se registra en `public.leads` para que el equipo pueda hacerle seguimiento. **Antes se perdía**: el dato solo quedaba en el teléfono del propio visitante.

- **Se consultan en `/admin/leads`** (nueva sección del panel): listado con nombre, correo y teléfono accionables, la propiedad que generó el interés, la corredora y el canal usado.
- **Privacidad**: el alta es pública porque la visita no tiene cuenta, pero la **lectura y el borrado son solo del equipo** (RLS con `public.is_rix7_admin()`). Los contactos nunca se exponen en el portal.
- **Validación doble**: la misma que corre en el servidor (`normalizeLead`) está repetida en la política RLS de la tabla, así que un POST manual tampoco puede meter basura.
- **Rate limit**: 30 altas por IP cada 10 minutos en `/api/leads` (comparte el limitador con `/api/pois`, ver `lib/utils/rateLimit.ts`). Es por instancia, no global.
- **Sin Supabase configurado** los contactos quedan en memoria del proceso y el panel muestra un aviso ámbar de que se pierden al reiniciar. En producción van a la tabla.

### Cuentas de usuario (Google o enlace mágico)

Hay **dos puertas y ninguna contraseña**, y las dos llevan a la misma cuenta cuando el correo coincide (así nadie termina con dos identidades por haber entrado de otra forma):

1. **Google, en un clic.** Google ya trae el correo verificado, así que la cuenta queda lista sin pasar por la bandeja de entrada. Se pide `prompt=select_account` para poder elegir cuenta: en un computador compartido evita entrar como el otro.
2. **Enlace mágico**: se escribe el correo y llega un enlace que deja a la persona dentro. Sigue igual que antes, porque es la salida para quien no tiene cuenta de Google, no quiere usarla para esto, o tiene un correo corporativo.

**Si Google no está configurado**, el botón lo dice en español (*"El acceso con Google todavía no está disponible. Puedes entrar con el enlace al correo."*) en vez de mostrar el error técnico de Supabase, y el enlace mágico sigue funcionando. La traducción de errores vive en `lib/utils/authMessages.ts`.

**Al volver de Google** (o de un enlace vencido) Supabase deja el error en la URL: la app lo lee, **abre el diálogo con el motivo** y limpia la URL para que recargar no repita el aviso. Sin eso, un acceso fallido se vería como si no hubiera pasado nada. La limpieza toca **solo** los parámetros de error: el `code` y el `state` no, porque son los que canjean la sesión cuando el acceso sale bien.

**Entrar cierra el diálogo solo.** Antes quedaba abierto mostrando el formulario encima de la página, ya adentro.

- **No hay contraseña**, y registrarse o entrar es la **misma acción**: por eso el Navbar tiene una sola entrada ("Entrar") y el modal no tiene pestañas.
- El **nombre y el móvil de WhatsApp no se piden** al entrar. Si la persona ya los dejó al contactar a una corredora, `AuthProvider` los pasa a su cuenta (`user_metadata.full_name` y `user_metadata.phone`). El teléfono se guarda en **formato internacional** (`+56912345678`), normalizado con `lib/utils/phone.ts`; la ficha conserva el del dispositivo si la cuenta no lo trae.
- **Contactar a una corredora no requiere cuenta**: alcanza con dejar nombre, correo y móvil en la ficha (ver *Contactos*). La cuenta sirve para favoritos y alertas.
- El reenvío del enlace tiene una **espera de 60 s**, porque un botón libre agota el límite de correo del proveedor.
- Si el envío no sale (sin red o proyecto mal configurado), el modal muestra un mensaje entendible en vez del `Failed to fetch` del navegador.

#### Puesta en marcha del acceso, paso a paso

Nada de esto vive en el repositorio: el enlace mágico depende de configuración del proyecto Supabase. Si se omite, la app **avisa** en vez de fallar en silencio, pero el acceso no funciona.

**0. Variables de entorno.** `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` en `.env.local` (local) y en Vercel (producción). Sin esto, el cliente ni siquiera encuentra el proyecto: en el bundle desplegado queda el placeholder y **ningún** acceso funciona —ni el enlace mágico, ni Google, ni los favoritos, ni las alertas—.

**1. SMTP propio** (*Authentication » Emails » SMTP Settings*). Es el paso más importante y el más fácil de saltarse: el proveedor integrado de Supabase permite **2 correos por hora**, así que el acceso se corta al tercer usuario de la hora. Con Resend, los campos son:

| Campo de Supabase | Valor |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | la **API key** de Resend (empieza con `re_`) |
| Sender email | un correo de un **dominio verificado** en Resend (ej. `avisos@rix7.cl`) |
| Sender name | `Rix7` |

Hace falta verificar el dominio en Resend (registros **SPF** y **DKIM** en el DNS). Sin eso los correos salen y caen en spam, que para un enlace de acceso es lo mismo que no llegar.

**2. URLs de redirección** (*Authentication » URL Configuration*):

| Campo | Valor |
|---|---|
| Site URL | `https://rix7.cl` |
| Redirect URLs | `http://localhost:3000/**`, `https://rix7.cl/**` y `https://*-<tu-team>.vercel.app/**` si se quieren probar previews |

Sin la URL exacta en la lista, el enlace **vuelve al inicio** en vez de a la ficha desde la que se pidió. El síntoma es sutil (entra igual, pero pierde el contexto), así que conviene comprobarlo con el clic real.

**3. Plantilla del correo** (*Authentication » Emails » Magic Link*): asunto `Tu enlace para entrar a Rix7` y el contenido de [`supabase/email-templates/magic-link.html`](supabase/email-templates/magic-link.html). Instrucciones en [`supabase/email-templates/LEEME.md`](supabase/email-templates/LEEME.md).

**4. Para el acceso con Google** (si se omite, ese botón avisa que no está disponible y todo lo demás sigue igual):
   a. En *Google Cloud Console » APIs y servicios » Credenciales*, crear un **ID de cliente OAuth 2.0** de tipo *Aplicación web* y poner como **URI de redirección autorizado**: `https://<project-ref>.supabase.co/auth/v1/callback`.
   b. En Supabase, *Authentication » Providers » Google*: habilitarlo y pegar el **Client ID** y el **Client Secret**. El *Callback URL* que muestra Supabase es el mismo del punto anterior.
   c. Verificar que los dominios de la app estén en *URL Configuration » Redirect URLs* (los mismos que usa el enlace mágico): el acceso vuelve **a la misma página** desde la que se pidió.
   d. En la pantalla de consentimiento de Google, cargar nombre, logo y dominio de Rix7: es lo que ve la persona y evita el aviso de "app no verificada" con dominios propios.

#### Verificación de punta a punta

```bash
npm run check:auth                          # diagnóstico: credenciales y proveedores
npm run check:auth -- --email tu@correo.cl  # manda un enlace real
```

El script (`scripts/check-auth-config.mjs`) comprueba lo que se puede comprobar por API —que el proyecto sea real y no el placeholder, que el correo esté habilitado, si Google lo está— y **manda un enlace real** si se le pasa un correo. Imprime además los mismos endpoints para poder repetirlo con `curl`, y el destino al que debe volver el enlace.

Lo que hay que mirar con los propios ojos, porque la API no lo expone: **si el correo llegó** (SMTP), **si está en español con la marca** (plantilla) y **a dónde volvió al hacer clic** (Redirect URLs). El script imprime esa lista con lo que prueba cada cosa.

Un detalle importante: el script manda el enlace por el flujo clásico, que entra desde cualquier navegador. El botón de la web usa PKCE y solo lo puede canjear el navegador que lo pidió. **Probar los dos es lo que cubre el camino completo**; con el script solo, la mitad de PKCE queda sin verificar.

### Favoritos de la cuenta (`public.favorites`)

Los favoritos vivían en `localStorage`, así que se quedaban en ese navegador: quien guardaba desde el celular no los veía en el computador. Ahora viven en la cuenta y **viajan** — es lo que justifica entrar, más allá de las alertas.

- **Se guardan desde el corazón** de la barra de la ficha. Con sesión van a la cuenta; sin sesión quedan en el dispositivo, como antes.
- **La migración es automática y sin pérdida**: si la cuenta todavía no tiene favoritos, los del dispositivo se suben al entrar y recién ahí se limpia el navegador. Si la cuenta ya tiene, **la cuenta manda** y lo del dispositivo se ignora (a propósito: reimportar lo local resucitaría un favorito que la persona quitó en otro dispositivo).
- **La lista está en `/favoritos`**, renderizada en el servidor: el id de sesión y los favoritos ya vienen en el HTML, sin segunda vuelta. El corazón del Navbar lleva ahí y muestra el contador.
- **Privacidad**: RLS con `auth.uid() = user_id` en las cuatro operaciones. Sin política de lectura pública: un favorito no es información de nadie más. Sin sesión, `/api/favorites` responde 401 (no una lista vacía: vacío y «no hay sesión» son cosas distintas).
- **Alta idempotente**: guardar dos veces la misma propiedad no es error (`upsert` con `ignoreDuplicates`), porque apretar el corazón dos veces es normal, no un conflicto.
- **Tope de 200** por cuenta (`MAX_FAVORITES`): no es una regla de negocio, es cordura para que un script no llene la tabla.
- `property_id` es **TEXT y sin clave foránea**, igual que en `leads`: los ids del catálogo son legibles (`scl-depto-marco-polo`), no UUID.

### Búsquedas guardadas y avisos por correo (`public.saved_searches`)

Es lo que le da un **propósito real a la cuenta**: la persona guarda desde el buscador lo que estaba mirando y recibe un correo cuando aparece una propiedad que coincide. Sin esto, entrar al portal solo servía para publicar, que es cosa de las corredoras.

- **Se guarda desde el botón “Guardar búsqueda”**, junto al contador de resultados. Guarda los filtros tal como están en pantalla (operación, tipo, comuna/región, texto, precios, dormitorios, baños, privados) y el resumen legible se calcula **al guardar**, no al enviar.
- **Mismas reglas que el buscador**: el job filtra con `lib/data/propertyFilters`, el mismo módulo que usa `/api/properties`. Si usara otras reglas, el correo anunciaría propiedades que al abrirlas no aparecen en la búsqueda.
- **Cada quien ve solo las suyas**: RLS con `auth.uid() = user_id` y, además, la ruta filtra por el id de la sesión. El `user_id` que venga en el cuerpo de la petición se ignora.
- **Un aviso, una vez**: se guarda `last_notified_at` y solo se avisa de las propiedades publicadas **después** de esa fecha. Si el envío falla, la fecha **no avanza**, así el aviso no se pierde: se reintenta en la próxima corrida.
- **La primera corrida fija la línea base sin enviar nada**: la persona acaba de ver esos resultados en pantalla; avisarle de lo mismo por correo sería ruido.
- **Se borra desde el mismo botón** (lista de búsquedas guardadas), con `DELETE /api/saved-searches?id=…`.

#### El job diario

`.github/workflows/alerts-run.yml` llama a `POST /api/alerts/run` del **sitio desplegado** (no corre en el runner): así los secretos viven solo en Vercel y no hay que duplicarlos en GitHub.

| Configuración | Dónde | Para qué |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel | Leer las búsquedas de todas las personas (RLS lo impide con la anon key) |
| `RESEND_API_KEY` | Vercel | Enviar el correo. Sin él el job informa que no salió, no finge |
| `ALERTS_FROM_EMAIL` | Vercel | Remitente (dominio verificado en Resend) |
| `ALERTS_CRON_SECRET` | Vercel **y** GitHub (secret) | Autentica la llamada del cron. Sin él, la route responde 503 |
| `SITE_URL` | GitHub (variable) | Dominio a llamar. Por defecto `https://rix7.cl` |

**Para probarlo sin enviar nada**: `POST /api/alerts/run?dry=1` informa qué correos mandaría y a quién, sin enviar ni tocar fechas. `GET /api/alerts/run` devuelve qué está configurado. El workflow también se puede lanzar a mano desde la pestaña *Actions* con la opción de simulación.

El informe de cada corrida queda en el resumen del job: una tabla por búsqueda con el resultado (`sent`, `baseline`, `no-matches`, `no-recipient`, `email-skipped`, `error`, `skipped`) y cuántas propiedades coincidieron.

## 🛡️ CSP y recursos externos

La `Content-Security-Policy` vive en `vercel.json`, y eso tiene una consecuencia que ya costó dos veces: **los headers de ese archivo solo se aplican en Vercel**. Un recurso sin permiso se ve perfecto en local y se rompe recién al desplegar. Así se descubrieron los tiles del mapa (estaban en `img-src`, pero MapLibre los pide con `fetch`, o sea `connect-src`) y el video remoto de una ficha (no había `media-src`).

**La regla que hay que respetar**: un host no va en "alguna" directiva, va en la que corresponde según **cómo** se pide el recurso.

| Cómo se pide | Directiva | Ejemplo en este proyecto |
|---|---|---|
| `fetch()`, XHR, WebSocket | `connect-src` | teselas de MapLibre, Supabase (REST y realtime) |
| `<img>`, `background-image` | `img-src` | teselas de Leaflet, fotos de Unsplash, logos |
| `<video>`, `<audio>` | `media-src` | el video de la ficha |
| `<script>`, `new Worker` | `script-src` / `worker-src` | worker de MapLibre |
| `<a href>`, `og:*`, canónicas | *(no aplica)* | WhatsApp, sitios de las corredoras |

**Para auditar todo de una vez** —en vez de descubrirlos uno por uno en producción—: `npx vitest run lib/utils/cspCoverage.test.ts`. Recorre el código de cliente, clasifica cada host por su forma de pedido y lo cruza contra el CSP real; el mismo test corre en `npm test`, así que **falla el build si aparece un host nuevo sin clasificar o sin permiso**. Un comodín como `https://*.ejemplo.cl` cubre subdominios pero **no** el dominio raíz: si hace falta el raíz, se lista aparte.

Los iconos por defecto de Leaflet se sirven desde `/leaflet/` (los copia `scripts/sync-leaflet-icons.mjs` en `postinstall`): antes venían de `cdnjs`, que el CSP bloqueaba.
