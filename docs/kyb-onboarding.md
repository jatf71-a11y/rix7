# Alta de empresas (KYB)

Backend del onboarding automático de empresas: recibe la solicitud, verifica
identidad y reputación sin intervención humana, pide información cuando falta
algo, y habilita el panel de publicaciones con el plan que la empresa elija.

## Estados

```
Recibida → En_Evaluacion → Aceptada → En_Alta → Operando
                        ↘ Pendiente_Informacion → En_Evaluacion → …
```

| Estado | Qué significa |
| --- | --- |
| `Recibida` | La solicitud se guardó y se envió el acuse. |
| `En_Evaluacion` | El motor está corriendo (dura lo que tardan los adaptadores). |
| `Pendiente_Informacion` | Se enviaron preguntas concretas con un enlace para responderlas. |
| `Aceptada` | Las verificaciones pasaron; en la misma corrida pasa a `En_Alta`. |
| `En_Alta` | La empresa tiene token para elegir plan. El panel la muestra como «Alta». |
| `Operando` | Terminal: la empresa eligió su plan y su panel quedó habilitado. Es la columna de clientes activos. |

Las transiciones válidas viven en [`lib/kyb/status.ts`](../lib/kyb/status.ts) y
son la única puerta: una ruta no puede mover una solicitud a un estado imposible.
`Operando` se alcanza al confirmar el plan (no hay cobro en línea todavía: el
sistema sabe que el plan se eligió, el pago se confirma fuera). El rechazo
también existe (`Rechazada`, decisión manual del equipo con motivo); lo que no
pasa el motor se convierte en una pregunta, y la empresa puede aclarar y
re-evaluar.

## Modelo de datos (`0026_kyb_onboarding`)

- `kyb_applications`: solicitud, estado, puntaje, plan, token (hash) y resultado del panel.
  Guarda además los datos operativos del registro de empresas —cobertura, regiones,
  mensaje, tipo de registro y cargo del contacto—, que no entran al motor pero el
  equipo necesita para operar la ficha.
- `kyb_evaluations`: cada corrida del motor con sus verificaciones y el estado antes/después.
- `kyb_information_requests`: preguntas enviadas y respuestas recibidas (insumo de la re-evaluación).

Las tres tablas tienen RLS **sin políticas**: solo accede la clave de servicio.
El flujo corre en el servidor y la empresa se identifica con el token del correo.

## Endpoints

| Método | Ruta | Quién | Qué hace |
| --- | --- | --- | --- |
| `POST` | `/api/kyb` | público | Alta: valida, guarda, envía acuse y evalúa. |
| `GET` | `/api/kyb` | admin | Listado de solicitudes. |
| `GET` | `/api/kyb/[id]` | admin | Detalle + última evaluación. |
| `POST` | `/api/kyb/[id]/evaluate` | admin | Reintenta la evaluación. |
| `POST` | `/api/kyb/access` | token | Estado, preguntas abiertas y si ya puede elegir plan. |
| `POST` | `/api/kyb/answers` | token | Guarda respuestas y re-evalúa. |
| `POST` | `/api/kyb/activate` | token | Elige plan y habilita el panel. |

Ejemplo de alta:

```bash
curl -X POST https://rix7.cl/api/kyb \
  -H 'content-type: application/json' \
  -d '{
    "legalName": "Catedral Propiedades SpA",
    "rut": "76.543.210-3",
    "website": "https://catedralpropiedades.cl",
    "email": "contacto@catedralpropiedades.cl",
    "contactName": "Ana Torres",
    "phone": "+56 9 8765 4321",
    "consent": true
  }'
```

## Registro público

`/registro/corredora` y `/registro/inmobiliaria` crean una solicitud evaluada: el
formulario manda a `POST /api/kyb` y la pantalla de cierre muestra el resultado
—aceptada, o las preguntas concretas que faltan aclarar— en vez de un «te
contactamos» genérico. El siguiente paso (elegir plan o responder) viaja al
correo con un token nuevo.

Un **agente independiente** sigue entrando por `/api/solicitudes`: es una persona
natural, sin razón social ni dominio que verificar, y su registro es un contacto
para el equipo. `usesKybFlow` en [`lib/kyb/registration.ts`](../lib/kyb/registration.ts)
es la única regla que separa los dos caminos.

## Panel del equipo

La sección **Solicitudes** del panel (`/admin/solicitudes`) es una sola bandeja
para los socios: las altas evaluadas de corredoras e inmobiliarias y los
registros de agentes independientes, filtrados por categoría de socio y con
vista de pipeline por etapa. Los propietarios que piden propuestas **no** están
ahí: se revisan en **Leads → Propietarios** (`/admin/leads/propietarios`),
porque no son el registro de un socio.

Cada fila de alta muestra su estado y puntaje; al abrirla, la última corrida
del motor: el resumen que **nombra** qué verificaciones advirtieron o fallaron, y
cada verificación con su peso, el detalle de lo que encontró, los datos concretos
que revisó (`facts`: el registro consultado, las reseñas contadas, **a qué se
deben** y su umbral, el dominio de cada lado, el tramo de tamaño y la facturación
aproximada del registro), de dónde salió el dato, los motivos de la decisión y las
preguntas abiertas con la empresa, además de los datos operativos del registro.

Cuando la reputación sale de la simulación, la ficha lo declara: sin un proveedor
de búsqueda configurado (`EXA_API_KEY` o `KYB_SEARCH_URL`) las reseñas contadas no tienen páginas
que mostrar detrás, la mención de cada hallazgo aparece recién con uno real y los
motivos son el repertorio de la simulación, no un hallazgo. Una búsqueda real que
no discrimine el motivo lo dice («sin detalle en la fuente consultada») en vez de
rellenarlo.

Desde ahí se puede **re-evaluar** (reintentar una verificación externa o correr el
motor sobre una ficha histórica). Desde `En_Alta` en adelante ya no se evalúa:
`Operando` es terminal, la API responde 409 y el panel no ofrece el botón; en
`En_Alta` la empresa está eligiendo plan y tampoco se vuelve atrás.

El estado de una alta no se cambia con un selector: lo mueven las decisiones del
equipo, que disparan correos y tokens. `/admin/alta-empresas` ya no es una
pantalla: redirige a Solicitudes para no romper enlaces guardados.

### Los registros de socios también se evalúan solos

Un registro de corredora, inmobiliaria o agente que llega por `/registro/*` o
`/publicar/agente` no espera a que alguien lo mire: al guardarse corre el motor
de [`lib/data/solicitudEvaluation.ts`](../lib/data/solicitudEvaluation.ts) y el
autómata de [`lib/data/solicitudAutopilot.ts`](../lib/data/solicitudAutopilot.ts)
lo mueve en la misma corrida.

| Verificación | Peso | Qué mira |
| --- | --- | --- |
| `rut` | 20 | Módulo 11 sobre el RUT informado |
| `correo` | 20 | Correo corporativo vs. proveedor gratuito (un agente puede usar Gmail) |
| `sitio` | 25 | Sitio declarado y coincidencia de dominio con el correo |
| `cobertura` | 15 | Nacional, o regional con al menos una región |
| `contacto` | 10 | Teléfono con forma de número chileno |
| `duplicado` | 10 | Mismo RUT o correo que otra solicitud |

Se acepta con 80 puntos o más y sin verificaciones en rojo. Si no, queda en
`Pendiente_Informacion`, se guardan las preguntas que fallaron y se emite un
token de 7 días. Los dos caminos escriben al solicitante: el correo de
«necesitamos algunos datos» lleva las preguntas y el enlace
`/socios/responder/<token>`; el de aceptación dice qué sigue.

Cuando la persona responde, `POST /api/solicitudes/answers` vuelve a correr el
motor con lo aclarado, mueve el estado y avisa de nuevo. Si todavía falta algo,
queda otra ronda con preguntas nuevas y un token fresco —el anterior deja de
servir—. El resultado, las respuestas y el **hash** del token viven en la
columna `payload` (JSONB), así que no hizo falta una migración.

El panel muestra ese puntaje y el sustento de cada verificación en la tarjeta
del registro, y conserva el selector de estado y **Re-evaluar** para las
excepciones. Mover el estado a `Aceptada` o `Rechazada` a mano también manda
correo: una decisión del equipo no puede dejar al solicitante en silencio.

## Verificaciones del motor

| Verificación | Peso | Fuente |
| --- | --- | --- |
| `tax_rut` | 18 | Módulo 11 local |
| `tax_registry` | 22 | Adaptador fiscal (SII o simulación) |
| `reputation` | 18 | Adaptador de búsqueda (o simulación) |
| `domain_web` | 14 | Dominio informado, alojamiento propio |
| `email_corporate` | 9 | Proveedor del correo |
| `email_domain_match` | 9 | Correo vs. sitio |
| `company_size` | 10 | Dotación y ventas del adaptador fiscal |

Los pesos suman 100; al sumar la séptima verificación, los seis originales se
reescalaron manteniendo su proporción.

Se acepta solo si ninguna verificación falla, no quedan preguntas y el puntaje
llega a 75. Las respuestas de la empresa suben un escalón las verificaciones
discutibles (`fail → warn`, `warn → pass`), salvo las fiscales, que se vuelven a
consultar al registro.

El **tramo de tamaño** se calcula por dotación de trabajadores (micro 1-9, pequeña
10-49, mediana 50-199, grande 200 o más). Al lado, la ficha muestra la
**facturación aproximada** del último ejercicio cerrado que publica el registro,
como referencia de la escala: no decide el tramo y **nunca se le pide a la
empresa** —si el registro no la publica, la ficha dice «sin dato»—. Si tampoco
informa la dotación, el motor lo advierte y le pregunta a la empresa cuántas
personas trabajan en ella.

## Adaptadores y variables

Sin configuración, ambos adaptadores son **simulados y deterministas** (hash del
RUT/dominio), así que el flujo completo se puede probar sin claves. La reputación
sí tiene un proveedor real conectado: con `EXA_API_KEY` la verificación busca en la
web de verdad, y el detalle de qué cuenta y qué no está en el contrato de abajo.

| Variable | Uso |
| --- | --- |
| `KYB_TAX_URL` | Endpoint de verificación fiscal. Sin ella, simulación. |
| `KYB_TAX_TOKEN` | Bearer opcional para ese endpoint. |
| `EXA_API_KEY` | Búsqueda real de reputación (Exa). Sin ella, simulación. |
| `KYB_SEARCH_URL` | Endpoint propio de reputación. Manda sobre `EXA_API_KEY`. |
| `KYB_SEARCH_API_KEY` | Bearer para ese endpoint propio. |
| `SUPABASE_SERVICE_ROLE_KEY` | Necesaria para guardar, emitir tokens y habilitar el panel. Sin ella el flujo corre en memoria y la activación responde 502. |
| `RESEND_API_KEY` | Correos del flujo. Sin ella se responde `email.skipped` (no se finge el envío). |

Contrato del endpoint fiscal:
`{ exists, active, businessName, activity, workers, revenueClp, revenueYear }`,
donde `workers` es la dotación (entero ≥ 0) o `null` si el registro no la informa,
y `revenueClp` son las ventas del ejercicio `revenueYear` en pesos. Un valor que no
sea un número no negativo se trata como «sin dato», no se interpreta a la buena.

Contrato de reputación:
`{ flags: string[], negativeReviews: number, topics: string[], mentions: [{ title, url }] }`,
donde `topics` es el motivo de cada reseña negativa («demoras en la entrega»,
«cobros no informados»). Sin `topics` la ficha declara que no hay detalle.

Con **Exa** no hay contrato que respetar: el adaptador arma las consultas
—razón social, RUT, el sitio propio y términos de fraude y de reclamo—, deduplica
las páginas por URL y traduce cada una a la misma estructura. Dos precisiones que
importan al leer una advertencia:

- `negativeReviews` cuenta **páginas que nombran a la empresa y traen un término
de reclamo**, no reseñas verificadas de una plataforma de opiniones. Por eso cada
motivo viaja con el fragmento de la página que lo sustenta y la ficha muestra las
URLs: el número sin la cita sería una acusación sin prueba.
- Un término de **fraude** exige además que la página nombre a la empresa por su
razón social, su dominio o su RUT. «Estafa» o «denuncia» sueltos aparecen en
cualquier crónica policial; que esta empresa esté nombrada, no.

Las consultas de fraude y de reclamo son las que deciden: si una no responde, la
verificación no concluye y el motor lo reporta, en vez de afirmar «sin señales»
habiendo buscado la mitad. Las de contexto (razón social, RUT y sitio propio) solo
aportan páginas a la ficha, así que un tropiezo de red ahí no le pide nada a la
empresa.

## Tokens

32 bytes aleatorios en base64url; en la base queda solo su SHA-256. Valen 7 días.
`answers` sirve solo en `Pendiente_Informacion`; `activation`, en `En_Alta`. Al
activar se conserva hasta su vencimiento para tolerar reintentos: una segunda
activación no crea nada de nuevo y responde `already: true`.

## Alta del panel

`lib/kyb/provisioning.ts` crea (o reutiliza) la ficha en `partners` sin categoría
—el equipo la clasifica después— y deja la cuenta lista: vincula la existente o
crea una confirmada, con `role: member` y `partner_id`, más un enlace mágico de
un solo uso que viaja en el correo.

## Pantalla de alta

`/empresas/onboarding?token=…` es el destino de los enlaces del correo. Es
pública (el token identifica la solicitud), `noindex` y `no-referrer`.

Muestra una cosa a la vez según `POST /api/kyb/access`:

| Estado | Qué ve la empresa |
| --- | --- |
| `Recibida` / `En_Evaluacion` | El aviso de que la verificación corre sola. |
| `Pendiente_Informacion` | Las preguntas abiertas, una por verificación, con el formulario para responderlas. |
| `En_Alta` sin plan | Las tres tarjetas de plan y el botón de confirmar (deshabilitado hasta elegir uno). |
| `Operando` | El acceso al panel y el plan registrado. |

Después de responder o activar la pantalla **no vuelve a consultar** con el
token actual: cada cambio de estado emite un token nuevo y el anterior deja de
servir. El cierre del paso dice qué sigue y que el enlace viaja por correo.

Un 403 se muestra como «este enlace ya no sirve» (con la explicación de que
los enlaces valen 7 días); un fallo de red ofrece reintentar sin pedir otro
correo. La lógica de qué bloque mostrar y la validación de las respuestas viven
en [`lib/kyb/portal.ts`](../lib/kyb/portal.ts), con test propio.

## Pruebas

```bash
npx vitest run lib/kyb lib/email/kybEmails.test.ts app/api/kyb app/empresas/onboarding components/admin/kyb lib/data/socios.test.ts
```

Cubren la máquina de estados, la normalización, el motor con adaptadores
deterministas, las plantillas, el flujo completo (aceptación, preguntas,
re-evaluación, activación idempotente), las rutas HTTP, el mapeo del registro
público al alta, la estructura de los pasos de la pantalla (campo por pregunta,
radios reales, nada preseleccionado) y la ficha de evaluación del panel.
