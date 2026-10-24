# Alta de empresas (KYB)

Backend del onboarding automático de empresas: recibe la solicitud, verifica
identidad y reputación sin intervención humana, pide información cuando falta
algo, y habilita el panel de publicaciones con el plan que la empresa elija.

## Estados

```
Recibida → En_Evaluacion → Aceptada → En_Alta
                        ↘ Pendiente_Informacion → En_Evaluacion → …
```

| Estado | Qué significa |
| --- | --- |
| `Recibida` | La solicitud se guardó y se envió el acuse. |
| `En_Evaluacion` | El motor está corriendo (dura lo que tardan los adaptadores). |
| `Pendiente_Informacion` | Se enviaron preguntas concretas con un enlace para responderlas. |
| `Aceptada` | Las verificaciones pasaron; en la misma corrida pasa a `En_Alta`. |
| `En_Alta` | Terminal. La empresa tiene token para elegir plan; al confirmarlo se habilita `/socio`. |

Las transiciones válidas viven en [`lib/kyb/status.ts`](../lib/kyb/status.ts) y
son la única puerta: una ruta no puede mover una solicitud a un estado imposible.
No hay estado de rechazo: lo que no pasa se convierte en una pregunta, y la
empresa puede aclarar y re-evaluar.

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

`/admin/alta-empresas` (dentro de la sección «Alta de empresas» del panel) lista
las solicitudes con su estado y puntaje. Al abrir una, muestra la última corrida
del motor: cada verificación con su peso, el detalle de lo que encontró, los
motivos de la decisión y las preguntas abiertas con la empresa, además de los
datos operativos del registro.

Desde ahí se puede **re-evaluar** (reintentar una verificación externa o correr el
motor sobre una ficha histórica). `En_Alta` es terminal: la API responde 409 y el
panel no ofrece el botón.

## Verificaciones del motor

| Verificación | Peso | Fuente |
| --- | --- | --- |
| `tax_rut` | 20 | Módulo 11 local |
| `tax_registry` | 25 | Adaptador fiscal (SII o simulación) |
| `reputation` | 20 | Adaptador de búsqueda (o simulación) |
| `domain_web` | 15 | Dominio informado, alojamiento propio |
| `email_corporate` | 10 | Proveedor del correo |
| `email_domain_match` | 10 | Correo vs. sitio |

Se acepta solo si ninguna verificación falla, no quedan preguntas y el puntaje
llega a 75. Las respuestas de la empresa suben un escalón las verificaciones
discutibles (`fail → warn`, `warn → pass`), salvo las fiscales, que se vuelven a
consultar al registro.

## Adaptadores y variables

Sin configuración, ambos adaptadores son **simulados y deterministas** (hash del
RUT/dominio), así que el flujo completo se puede probar sin claves.

| Variable | Uso |
| --- | --- |
| `KYB_TAX_URL` | Endpoint de verificación fiscal. Sin ella, simulación. |
| `KYB_TAX_TOKEN` | Bearer opcional para ese endpoint. |
| `KYB_SEARCH_URL` | Endpoint de búsqueda de reputación. Sin ella, simulación. |
| `KYB_SEARCH_API_KEY` | Bearer para la búsqueda. |
| `SUPABASE_SERVICE_ROLE_KEY` | Necesaria para guardar, emitir tokens y habilitar el panel. Sin ella el flujo corre en memoria y la activación responde 502. |
| `RESEND_API_KEY` | Correos del flujo. Sin ella se responde `email.skipped` (no se finge el envío). |

Contrato del endpoint fiscal: `{ exists, active, businessName, activity }`.
Contrato de reputación: `{ flags: string[], negativeReviews: number, mentions: [{ title, url }] }`.

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
| `En_Alta` con panel | El acceso al panel y el plan registrado. |

Después de responder o activar la pantalla **no vuelve a consultar** con el
token actual: cada cambio de estado emite un token nuevo y el anterior deja de
servir. El cierre del paso dice qué sigue y que el enlace viaja por correo.

Un 403 se muestra como «este enlace ya no sirve» (con la explicación de que
los enlaces valen 7 días); un fallo de red ofrece reintentar sin pedir otro
correo. La lógica de qué bloque mostrar y la validación de las respuestas viven
en [`lib/kyb/portal.ts`](../lib/kyb/portal.ts), con test propio.

## Pruebas

```bash
npx vitest run lib/kyb lib/email/kybEmails.test.ts app/api/kyb app/empresas/onboarding app/admin/alta-empresas
```

Cubren la máquina de estados, la normalización, el motor con adaptadores
deterministas, las plantillas, el flujo completo (aceptación, preguntas,
re-evaluación, activación idempotente), las rutas HTTP, el mapeo del registro
público al alta, la estructura de los pasos de la pantalla (campo por pregunta,
radios reales, nada preseleccionado) y la ficha de evaluación del panel.
