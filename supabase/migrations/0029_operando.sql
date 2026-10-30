-- ════════════════════════════════════════════════════════════════════════════
-- 0029 · `Operando`: el cliente ya inscrito, con plan elegido y panel habilitado
-- ════════════════════════════════════════════════════════════════════════════
-- El flujo terminaba en `En_Alta`, que mezclaba dos cosas distintas: la empresa
-- que acaba de recibir su enlace para elegir plan y la que ya lo eligió y está
-- publicando. El panel necesitaba separarlas —una columna «Alta» con gente que
-- todavía tiene algo pendiente y otra con los clientes activos—, y esa
-- distinción es del estado, no de la vista: si vive solo en el front, cualquier
-- consulta a la base las vuelve a mezclar.
--
-- Los dos valores se agregan a los dos CHECK que comparten el vocabulario:
-- `kyb_applications` (el alta de empresas) y `solicitudes` (la bandeja unificada
-- de registros de socios, que desde 0028 habla el mismo idioma).
--
-- `En_Alta` **no** cambia de nombre en la base: sigue siendo el identificador
-- del estado y lo único que cambió es su etiqueta en el panel («Alta»). Renombrar
-- el valor habría obligado a traducir filas y a tocar todos los chequeos de
-- transición para decir lo mismo, sin ganar nada.
--
-- Escrita cuando el token de Supabase estaba vencido: **no se aplicó** a
-- producción todavía. Hasta que se corra (`npm run db:push`), mover una
-- solicitud a `Operando` falla con «violates check constraint» y la activación
-- de un plan responde con error al guardar el estado nuevo; leer el estado no se
-- ve afectado porque el CHECK solo se evalúa al escribir.

-- ── 1. Alta de empresas ─────────────────────────────────────────────────────
ALTER TABLE public.kyb_applications
    DROP CONSTRAINT IF EXISTS kyb_applications_status_check;

ALTER TABLE public.kyb_applications
    ADD CONSTRAINT kyb_applications_status_check
    CHECK (status = ANY (ARRAY[
        'Recibida', 'En_Evaluacion', 'Pendiente_Informacion', 'Aceptada', 'En_Alta',
        'Operando', 'Rechazada'
    ]));

-- ── 2. Bandeja de registros de socios ───────────────────────────────────────
ALTER TABLE public.solicitudes
    DROP CONSTRAINT IF EXISTS solicitudes_status_check;

ALTER TABLE public.solicitudes
    ADD CONSTRAINT solicitudes_status_check
    CHECK (status = ANY (ARRAY[
        'Recibida', 'En_Evaluacion', 'Pendiente_Informacion', 'Aceptada', 'En_Alta',
        'Operando', 'Rechazada'
    ]));

-- ── 3. Las empresas que ya activaron su plan pasan a `Operando` ─────────────
-- Sin esto, cada cliente que ya tiene panel habilitado seguiría apareciendo en
-- «Alta» —esperando algo que ya hizo— hasta que alguien lo moviera a mano. Va
-- después de los dos CHECK nuevos porque es la escritura que los necesita.
-- En `solicitudes` no hay plan ni panel, así que no hay nada que traducir ahí.
UPDATE public.kyb_applications
    SET status = 'Operando'
    WHERE status = 'En_Alta' AND panel_enabled = true;
