# Alta de empresas (KYB)

Backend del onboarding automático de empresas: recibe la solicitud, verifica
identidad y reputación sin intervención humana, pide información cuando falta
algo, y habilita el panel de publicaciones con el plan que la empresa elija.

## Estados

```
Recibida → En_Evaluacion → Aceptada → Calificado → Propuesta_Comercial
                        ↘ Pendiente_Informacion → En_Evaluacion → …
                                                      ↓ el candidato rechaza
Propuesta_Comercial → Alta → Operando            Rechazada
```

| Estado | Qué significa |
| --- | --- |
| `Recibida` | La solicitud se guardó y se envió el acuse. |
| `En_Evaluacion` | El motor está corriendo (dura lo que tardan los adaptadores). |
| `Pendiente_Informacion` | Se enviaron preguntas concretas con un enlace para responderlas. |
| `Aceptada` | Las verificaciones pasaron; en la misma corrida pasa a `Calificado`. |
| `Calificado` | Pasó la verificación y el equipo le prepara la propuesta comercial. Antes esta etapa se llamaba «Alta», que era mentira: nadie estaba dado de alta. |
| `Propuesta_Comercial` | Hay una propuesta con plan y precios enviada; la pelota la tiene el candidato, que la acepta o la rechaza desde su enlace. |
| `Alta` | El candidato aceptó: elige plan y se ejecuta el alta en el sistema (ficha y cuenta). Todavía no es cliente activo. |
| `Operando` | Terminal: el alta terminó **y** el período está pagado. Es la columna de clientes activos, y la única que la cobranza considera al día. |
| `Rechazada` | Terminal: no prosperó —lo rechazó el equipo o el candidato— y no se vuelve a evaluar. |

Las transiciones válidas viven en [`lib/kyb/status.ts`](../lib/kyb/status.ts) y
son la única puerta: una ruta no puede mover una solicitud a un estado imposible.
El rechazo también existe (`Rechazada`, decisión manual del equipo con motivo);
lo que no pasa el motor se convierte en una pregunta, y la empresa puede aclarar
y re-evaluar.

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
| `POST` | `/api/kyb/[id]/proposal` | admin | Envía la propuesta comercial (plan y montos) al candidato. |
| `POST` | `/api/kyb/proposal` | token | El candidato acepta o rechaza la propuesta. |
| `POST` | `/api/kyb/activate` | token | Elige plan, autoriza el cobro del CCA (`ccaAccepted`) y habilita el panel. |
| `GET` | `/api/admin/cobranza` | admin | Situación de cobranza de cada socio. |
| `POST` | `/api/admin/cobranza` | admin | Registra un pago o cambia la morosidad. |

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

Un **profesional independiente** (el `kind` que en la base sigue siendo `agente`)
sigue entrando por `/api/solicitudes`: es una persona
natural, sin razón social ni dominio que verificar, y su registro es un contacto
para el equipo. `usesKybFlow` en [`lib/kyb/registration.ts`](../lib/kyb/registration.ts)
es la única regla que separa los dos caminos.

## Panel del equipo

La sección **Solicitudes** del panel (`/admin/solicitudes`) es una sola bandeja
para los socios: las altas evaluadas de corredoras e inmobiliarias y los
registros de profesionales independientes, filtrados por categoría de socio y con
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
rellenarlo, y en ese caso tampoco se le pregunta a la empresa: la pregunta solo
sale cuando puede citar qué reseña y dónde.

Desde ahí se puede **re-evaluar** (reintentar una verificación externa o correr el
motor sobre una ficha histórica). Desde `Calificado` en adelante ya no se
evalúa: el motor solo mira lo que se declaró al registrarse, y una vez que hay
precios y plan de por medio, correrlo de nuevo no aporta nada. Desde `Alta`
tampoco se vuelve atrás: el panel no ofrece el botón y la API responde 409.

El estado de una alta no se cambia con un selector: lo mueven las decisiones del
equipo, que disparan correos y tokens. `/admin/alta-empresas` ya no es una
pantalla: redirige a Solicitudes para no romper enlaces guardados.

### El tramo comercial: Calificado, Propuesta comercial y Alta

Desde la migración `0031` el pipeline separa lo que antes estaba mezclado:

```
Recibida → En_Evaluacion → (Pendiente_Informacion →) Aceptada
   → Calificado → Propuesta_Comercial → (el candidato acepta) → Alta → Operando
```

- **Calificado** (antes se llamaba «Alta») — pasó la verificación y el equipo le
  prepara la propuesta. Aprobar ya no emite token: no hay nada que el candidato
  pueda hacer todavía.
- **Propuesta comercial** — el equipo envía plan, alta inicial y mensualidad
  desde la ficha (`POST /api/kyb/[id]/proposal`). Los montos salen de **Planes**
  según el perfil del registro y se pueden negociar a mano. El correo lleva un
  enlace de un solo uso a `/empresas/propuesta?token=…`, donde el candidato
  acepta o rechaza (`POST /api/kyb/proposal`). El «de acuerdo» incluye, si lo
  quiere, el **plan de captación**, que se explica en su propio correo
  (`buildKybCaptacionEmail`). El **CCA** no se firma acá: se determina después del
  alta, con la cartera del socio (ver *El CCA se determina después del alta*).
  Aceptar mueve a **Alta** y emite el token para elegir plan; rechazar cierra la
  solicitud como `Rechazada`.
- **Alta** — la empresa ya aceptó: elige plan y se le crea la ficha y la cuenta
  (`provisioning`). El panel queda habilitado, pero **no** es cliente activo.
- **Operando** — el alta terminó **y** el período está pagado. Lo mueve la
  cobranza al registrar el pago.

El historial de propuestas vive en `kyb_applications.proposal` (JSONB, una por
ronda): renegociar agrega, no borra. La solicitud guarda también `partner_id`,
el socio que nace del alta, que es lo que permite que un pago cierre *su* alta.

#### Qué correo sale en cada paso

Los siete pasos avisan al solicitante. En el **alta de empresa**, los dos
primeros ocurren en la misma corrida —el motor evalúa dentro de la petición del
alta— y comparten un solo mensaje cuyo contenido cubre ambos. En el **registro
profesional**, en cambio, van separados: el acuse de recibo no adelanta el
detalle de la evaluación, que sale al entrar en `En_Evaluacion` (también cuando
la evaluación se repite al responder un pedido de información).

| Paso | Correo | Qué informa |
| --- | --- | --- |
| Recibida | `buildKybReceivedEmail` / `buildSolicitudReceivedEmail` | la solicitud entró; en el alta, además, que la evaluación ya está en curso |
| En evaluación | el mismo en el alta; `buildSolicitudEvaluatingEmail` en el registro | con qué datos: los que entregó la empresa y los que Rix7 consigue (SII, reputación, dominio) |
| Pendiente de información | `buildKybPendingEmail` / `buildSolicitudPendingEmail` | las preguntas concretas y el enlace de 7 días; el recordatorio (`buildKybReminderEmail`, `reminder: true`) insiste sobre lo pendiente |
| Aceptada | `buildSolicitudAcceptedEmail` (registro) y, en el alta, el de Calificado | que la verificación salió bien |
| Calificado | `buildKybQualifiedEmail` | perfil de socio (profesional, corredora, inmobiliaria), alta, mensualidad, usuarios y captación, con los montos de **Planes**, y pide un «De acuerdo» |
| Propuesta comercial | `buildKybProposalEmail` + la página del enlace | plan y montos; en la página, la aceptación y la captación; el CCA se avisa como determinación posterior |
| Alta | `buildKybAcceptedEmail` y `buildKybActivatedEmail` | plan confirmado, captación aceptada y autorización del CCA; después, el panel habilitado |

En «Pendiente de información» cada ronda incluye además el **informe de deudas
de la CMF** como documento obligatorio ([`lib/kyb/debtReport.ts`](../lib/kyb/debtReport.ts)):
personas naturales para un profesional independiente, personas jurídicas para
corredora e inmobiliaria. El correo lleva el enlace y las dos pantallas de
respuesta un campo de archivo; al subirlo se guarda en el bucket privado
`kyb-documents` (migración 0035), se lee el texto —total adeudado, acreedores,
impagas y castigadas— y la ficha del equipo muestra el resultado
(`components/admin/kyb/DebtReportPanel.tsx`). Un PDF sin texto queda como
`unreadable`: el archivo se guarda y se avisa, en vez de darlo por bueno.

Aparte del pipeline, **`buildCcaChangeEmail`** avisa al socio cada vez que cambia
el monto mensual de su CCA (ver *La autorización del CCA y su cuenta corriente*).

El correo de calificación lo manda también el puente registro→alta
(`notifyQualifiedForApplication`), así un socio aprobado desde Solicitudes recibe
su perfil y sus condiciones igual que una empresa del formulario, y en el orden
del pipeline: primero la aprobación, después las condiciones.

### Cobranza: quién paga y quién está moroso

La sección **Cobranza** (`/admin/cobranza`) es el control de la suscripción.
`partner_billing` guarda un período por fila (`YYYY-MM`), con monto, vencimiento
(día 10), pago y nota; el estado **no** se guarda, se deriva de la fecha y del
pago, con 5 días de gracia (`lib/data/cobranza.ts`).

Registrar un pago hace dos cosas: marca el período y, si el socio estaba en
`Alta`, la mueve a `Operando`. La **morosidad** es distinta de «vencido»: la
confirma el equipo (`partners.moroso`, `moroso_desde`, `moroso_nota`) y mientras
esté activa:

- las propiedades del socio no aparecen en el buscador ni en su ficha —los RPC
  `get_properties_filtered` y `get_property_by_id` las filtran—;
- su página de empresa y sus feeds quedan vacíos (`listPartnerProperties`);
- el panel del socio muestra el aviso con la deuda (`app/socio/MorosidadBanner`)
  y el alta de publicaciones responde 409.

Al registrar un pago que deja al socio sin períodos vencidos, la marca se
levanta sola y sus fichas vuelven con la misma URL.

### Precios de los planes

La sección **Planes** (`/admin/planes`) tiene dos productos en paralelo, y los
dos viajan en la misma fila de `plan_settings` (migración `0030_plan_settings`):
**Planes de Suscripción** (lo de siempre) y **Planes de Captación** (pagar por
recibir leads).

**Planes de Suscripción** guarda el precio de cada **perfil** de socio: alta inicial,
mensualidad base y usuarios incluidos. Sin fila guardada se usan los valores de
partida de [`lib/kyb/planPricing.ts`](../lib/kyb/planPricing.ts) —profesional
$19.990 / $14.990 / 1 usuario; corredora $49.990 / $39.990 / 5; inmobiliaria
$99.990 / $99.990 / 15—, así que la pantalla abre con lo que definió el equipo.

El **CCA** es la suma de todas las publicaciones de un socio, en UF, y se pasa a
pesos con `$CCA = CCA × valor de la UF ÷ 1.000.000 × %CCA`; el resultado **es el
monto en pesos**. Con el `%CCA` de partida (8.333,33) la fórmula se reduce a la
cartera dividida por 12.000: **0,1 % de la cartera al año**, facturado mes a mes.
Una cartera de $180 millones paga $15.000 al mes. No se guarda: depende del stock
publicado de cada socio y de la UF del día, que se trae de `/api/indicators`. La
cuenta vive en `ccaAmountClp`.

El `÷ 1.000.000` es el **factor**, y el **%CCA** lo ajusta desde el panel: es un
valor guardado con los precios (entre 1 y 50.000, con dos decimales) y no una
constante del código. El de partida es `8.333,33`, que deja el factor en 12.000;
`%CCA = 100` deja el factor en 1.000.000 —la fórmula original—; `200` lo baja a
500.000 y cobra el doble. `ccaFactor` devuelve el divisor equivalente, que el
panel muestra al lado del campo para no tener que despejarlo a mano.

#### El CCA se determina después del alta

El CCA **no es un producto que se contrate, ni un servicio que se active, ni un
cobro por publicación**: es la suma de la cartera del socio, en UF, y una
**determinación** que se resuelve después del alta. Está ligada al volumen de
publicaciones que el socio maneja, no a cuántas fichas están hoy en la vidriera.
Antes se firmaba en la **propuesta comercial** con una estimación en UF de
propiedades que el candidato todavía no había cargado: el número era una promesa.
Ahora sale de su cartera:

- el CCA suma los precios de **todas sus propiedades** —sin filtrar por estado— y
  los divide por la UF del día, así que cambia solo cuando suma una propiedad;
- el `%CCA` es el que el equipo fija en **Planes** (`plan_settings`), y es lo
  único discrecional de la regla;
- se cobra junto a la mensualidad, y el panel del socio lo muestra en **Tu CCA**
  (`/socio`, lectura de `/api/partner/cca`), sin contador de publicaciones: no se
  cobra por aviso.

El monto **no se guarda como un valor único**: la tabla de precios ya dice el
`%CCA`, las fichas ya dicen la cartera y la UF viene de `/api/indicators`.
Persistir «el CCA actual» obligaría a recalcularlo en cada propiedad y una cifra
vieja se cobraría como si fuera la de hoy. La cuenta pura vive en
[`lib/kyb/cca.ts`](../lib/kyb/cca.ts) y la lectura del socio en
[`lib/data/ccaDetermination.ts`](../lib/data/ccaDetermination.ts).

#### La autorización del CCA y su cuenta corriente (0033)

Como el CCA es un **cargo mensual que depende de las publicaciones**, hay dos
cosas que el sistema tiene que poder probar:

1. **Que el solicitante lo autorizó.** En la etapa de **Alta**, el paso de plan
   muestra la fórmula y una casilla propia —«Autorizo el cobro mensual del CCA
   sobre mis publicaciones»—; el botón no se habilita sin ella. `/api/kyb/activate`
   exige `ccaAccepted: true` y `activateKybPlan` no cierra el alta sin eso: sin
   autorización no se crea el socio ni el panel. La fecha queda en
   `kyb_applications.cca_authorized_at` y la ficha de la solicitud en el panel la
   muestra (o avisa que un alta anterior no tiene autorización registrada).
2. **Cuánto se le va a facturar cada mes y por qué.** `partner_cca_ledger`
   guarda **un movimiento por cada cambio de monto**, con la cuenta completa:
   cartera en pesos, CCA en UF, UF del día, `%CCA` y monto resultante, más el
   monto anterior y el motivo (`alta`, `cartera` o `planes`). Así se explica una
   factura de hace tres meses sin recalcularla con datos de hoy.

El movimiento se registra con `syncPartnerCca` después de **cada escritura de
publicaciones** (`POST`, `PUT` y `DELETE` de `/api/partner/properties`) y con
`syncAllPartnerCca` cuando **cambia el `%CCA`** en Planes —ese número multiplica
la cartera de todos—. Si el monto cambió, sale un correo al socio
(`buildCcaChangeEmail`) con el monto nuevo, el anterior y la cuenta completa; el
correo dice explícitamente que no genera ningún cobro. El alta deja una línea
base de $0: es contra la que se compara el primer cambio real, y no manda correo.

El socio ve el historial en la tarjeta **CCA** de `/socio`
(`/api/partner/cca` devuelve determinación, movimientos y fecha de autorización).
Un fallo al registrar la cuenta **no revierte** la publicación ya guardada: se
informa en la respuesta (`cca.error`). Sin cambios de monto no se escribe ni se
avisa: editar el título de una ficha no mueve la factura.

**Planes de Captación** no reemplazan a los de suscripción: un socio puede tener
uno, el otro o los dos. Tienen una **Suscripción Captación Activa** por perfil
—profesional $9.990, corredora $19.990, inmobiliaria $39.990 al mes de partida— y
una tabla de **acceso por lead** que se cobra cada vez que el socio abre uno:

| Ventas · valor de la propiedad | Acceso |
| --- | --- |
| Hasta UF 5.000 | $3.000 |
| UF 5.001 – 10.000 | $5.000 |
| UF 10.001 – 20.000 | $8.000 |
| UF 20.001 – 40.000 | $12.000 |
| Más de UF 40.000 | $20.000 |

| Arriendos · canon mensual | Acceso |
| --- | --- |
| Hasta $500.000 | $2.000 |
| $500.001 – $1.500.000 | $3.000 |
| Más de $1.500.000 | $5.000 |

Los **cortes** de los tramos son parte del producto y no se editan en el panel;
lo que se ajusta es lo que se cobra dentro de cada uno. La validación exige que
los tramos sean corridos, que empiecen en 0 y que solo el último quede sin tope:
un lead que no caiga en ningún tramo —o en dos— no tiene precio, y eso no puede
descubrirse al cobrar. Los valores viven en `DEFAULT_LEAD_BRACKETS` y la fila
guardada de una versión anterior entra con ellos (`PLAN_PRICING_VERSION` 4).

El precio configurado **es** el que se cobra en el alta. El catálogo de
[`lib/kyb/plans.ts`](../lib/kyb/plans.ts) ya no tiene precios ni cupo de
publicaciones: solo nombres, usuarios y beneficios. No hay cupo porque no se
cobra por publicación —lo que se factura sobre la cartera es el CCA—, así que
ningún plan limita cuántas propiedades puede publicar un socio. Los montos salen
de `plan_settings` por
perfil, y `altaPlanSummary` arma lo que la empresa confirma en el paso de plan:
el plan de la propuesta aceptada con sus montos —los del correo de la propuesta—
y, si la solicitud llegó al alta sin propuesta, los de Planes para su perfil. Por
eso el paso dejó de ofrecer los tres planes: cambiarlos ahí invalidaría lo que
el candidato ya aceptó.

### Los registros de socios también se evalúan solos

Un registro de corredora, inmobiliaria o profesional independiente que llega por
`/registro/*` o
`/publicar/agente` no espera a que alguien lo mire: al guardarse corre el motor
de [`lib/data/solicitudEvaluation.ts`](../lib/data/solicitudEvaluation.ts) y el
autómata de [`lib/data/solicitudAutopilot.ts`](../lib/data/solicitudAutopilot.ts)
lo mueve en la misma corrida.

| Verificación | Peso empresa | Peso profesional | Qué mira |
| --- | --- | --- | --- |
| `rut` | 20 | 25 | Módulo 11 sobre el RUT informado |
| `correo` | 20 | 10 | Correo corporativo vs. proveedor gratuito |
| `sitio` | 25 | 10 | Sitio declarado y coincidencia de dominio con el correo |
| `cobertura` | 15 | 20 | Nacional, o regional con al menos una región |
| `contacto` | 10 | 20 | Teléfono con forma de número chileno |
| `duplicado` | 10 | 15 | Mismo RUT o correo que otra solicitud |

Las dos columnas suman 100: cambia el peso, no el umbral. Para una empresa, el
correo y el sitio son la mitad de lo que se acredita; para una persona, lo que
define es su identidad, su alcance y su teléfono. Por eso un **profesional
independiente** con Gmail y sin sitio se acepta con **90** puntos y sin preguntas
—no se le pide un dominio que su forma de trabajar no tiene—, mientras que una
corredora con esas mismas faltas queda en **78** y recibe las dos preguntas.

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

### Del registro aprobado al alta (un solo camino)

Antes, aprobar un registro lo dejaba en `Aceptada` y ahí terminaba: la propuesta,
el token de alta y el panel solo existían para las altas de empresa, así que un
socio que entraba por el formulario público nunca llegaba a operar sin que
alguien lo creara a mano. El tablero, que mezcla las dos tablas, mostraba un
pipeline que no era real para tres de los cuatro perfiles.

Ahora, cuando el registro queda aprobado —por el autómata o por el equipo— se
crea su alta en `kyb_applications` ya en `Calificado`, con
[`lib/data/socioAltaBridge.ts`](../lib/data/socioAltaBridge.ts):

- la razón social es la empresa; para un profesional independiente, su nombre;
- el perfil (`registration_kind`) es el camino del registro (`corredora`,
`inmobiliaria` o `agente`), así que Planes elige los precios correctos;
- la fila guarda `solicitud_origen`, y el registro guarda `kyb_application_id`
en su `payload`.

A partir de ahí el panel muestra **una sola tarjeta** —la del alta, que es la que
tiene propuesta, plan y panel— y el registro deja de listarse. El vínculo es
idempotente por los dos lados (el `payload` y un índice único en
`solicitud_origen`): reintentar la conversión no duplica nada. Si el registro ya
estaba aprobado antes de este cambio, **Re-evaluar** sobre la tarjeta crea el
alta; no hay que recrear la solicitud.

La migración `0032` amplía el `CHECK` de `registration_kind` para aceptar
`agente` y agrega `solicitud_origen`, `reminders_sent` y `last_reminder_at`.

Ese camino tiene su propia comprobación contra producción:
`npm run smoke:prod -- --bridge --email tu@correo.cl` da un registro de prueba por
el endpoint público, exige que quede como alta en `Calificado` vinculada por los
dos lados y **borra el registro y su alta** al terminar. El release lo corre en la
verificación cuando se le pasa `--smoke-email` (o `SMOKE_EMAIL`); el correo del
registro va a un alias `+puente…` del buzón indicado.

### Recordatorios, reenvío y cierre

Un trámite detenido no se quedaba solo: el token vence a los 7 días y la persona
se quedaba sin enlace y sin aviso. El job de
[`lib/data/socioNudges.ts`](../lib/data/socioNudges.ts) recorre altas y registros
detenidos y, con la misma regla para los dos caminos:

| Días desde el inicio del paso | Qué hace |
| --- | --- |
| 3 | Recordatorio con un enlace nuevo |
| 10 | Segundo recordatorio |
| 30 | Cierra el trámite (`Rechazada`) y avisa el motivo |

Los pasos que atiende son `Pendiente_Informacion`, `Propuesta_Comercial` y
`Alta` sin plan confirmado. En `Alta` solo recuerda: la propuesta ya está
aceptada y descartar esa venta es una decisión del equipo, no del cron. El
conteo vive en `reminders_sent` (altas) y en `solicitud_nudges` del `payload`
(registros), así que reejecutar el job no repite correos.

Se dispara con `POST /api/socios/nudges/run` (cabecera `x-alerts-secret`, el
mismo `ALERTS_CRON_SECRET` del job de alertas) y el workflow diario
[`.github/workflows/socio-nudges.yml`](../.github/workflows/socio-nudges.yml).
`?dry=1` calcula sin enviar ni escribir, y `503` significa que falta el secreto
(la corrida no falla por eso).

El mismo módulo resuelve el **reenvío** que pide el equipo desde el panel
(«no me llegó», «venció»): `POST /api/kyb/[id]/resend` para un alta y
`POST /api/admin/solicitudes/[id]/resend` para un registro. El token en claro no
se guarda, así que se emite uno nuevo del paso vigente y el anterior muere. Por
último, `sendEmail` reintenta los fallos transitorios de Resend (429 y 5xx) con
espera creciente: el estado ya avanzó y la persona necesita el enlace.

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

### Preguntas que se pueden contestar

El motor no manda una pregunta que la empresa no pueda responder. La de
reputación **cita** las reseñas que leyó: el motivo, el fragmento de la página y
su dominio; cuando lo que apareció es una señal de fraude, nombra las menciones.
Si la búsqueda no trae ni motivo ni páginas, no hay pregunta: la advertencia
queda en la ficha, baja el puntaje y no pide explicaciones por algo que nadie
puede ver.

La **simulación** no bloquea ni pregunta nunca. Sin proveedor de búsqueda
configurado (`EXA_API_KEY` o `KYB_SEARCH_URL`) sus señales —reseñas o fraude—
quedan como advertencia en la ficha, con el detalle diciendo que salieron de la
simulación, y no pueden detener una solicitud por un dato que no existe.

### Profesional independiente

Un profesional independiente (`registration_kind = 'agente'`) es una persona, no
una empresa: trabajar sin sitio propio y con un correo personal es lo normal. En
las tres verificaciones que miden presencia corporativa —sitio, correo y
coincidencia entre los dos— el motor **advierte y baja el puntaje** (84 con todo
lo demás en orden, por encima del mínimo de 75) en vez de pedirle un dominio que
su forma de trabajar no tiene. Una corredora o una inmobiliaria con esos mismos
huecos sí recibe las preguntas: ahí la presencia corporativa es parte de lo que
se acredita.

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
«cobros no informados»). Sin `topics` la ficha declara que no hay detalle y no se
le pregunta a la empresa. Con Exa cada motivo viaja con el dominio de la página
donde apareció, para que la cita se pueda buscar tal cual.

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
Cada propósito sirve en una sola etapa: `answers` en `Pendiente_Informacion`,
`proposal` en `Propuesta_Comercial` y `activation` en `Alta`. Al activar se
conserva hasta su vencimiento para tolerar reintentos: una segunda activación no
crea nada de nuevo y responde `already: true`.

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
| `Propuesta_Comercial` | La propuesta con sus números y los botones de aceptar o rechazar (`/empresas/propuesta`). |
| `Alta` sin plan | La tarjeta del plan de la propuesta —mensualidad, alta inicial, cupo y usuarios— y una casilla de confirmación que habilita el botón. |
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
npx vitest run lib/kyb lib/email/kybEmails.test.ts app/api/kyb app/empresas/onboarding components/admin/kyb lib/data/socios.test.ts lib/data/socioAltaBridge.test.ts lib/data/socioNudges.test.ts
```

Cubren la máquina de estados, la normalización, el motor con adaptadores
deterministas, las plantillas, el flujo completo (aceptación, preguntas,
re-evaluación, activación idempotente), las rutas HTTP, el mapeo del registro
público al alta, la estructura de los pasos de la pantalla (campo por pregunta,
radios reales, nada preseleccionado) y la ficha de evaluación del panel.
