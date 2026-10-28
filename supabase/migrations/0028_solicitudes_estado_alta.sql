-- ════════════════════════════════════════════════════════════════════════════
-- 0028 · El estado de la bandeja de solicitudes pasa a hablar el idioma del alta
-- ════════════════════════════════════════════════════════════════════════════
-- La bandeja de «Publicar» tenía su propio ciclo (`nueva`, `en_revision`,
-- `contactada`, `cerrada`) y el alta de empresas el suyo (`Recibida`,
-- `En_Evaluacion`, `Pendiente_Informacion`, `Aceptada`, `En_Alta`, `Rechazada`).
-- Dos vocabularios para la misma pregunta obligaban a traducir de cabeza al
-- pasar de una pantalla a la otra, y el panel las muestra juntas.
--
-- Se adopta el del alta, que además tiene la máquina de transiciones probada.
-- El código ya está cambiado en el mismo release: `SOLICITUD_STATUSES` ahora es
-- `KYB_STATUSES`. Esta migración es la que hace que la base acepte esos valores
-- y traduce lo que ya estaba guardado, en ese orden:
--
--   1. Fuera el CHECK viejo: mientras siga puesto, traducir cualquier fila
--      falla con «new row violates check constraint».
--   2. Traducción de las filas existentes. Comprobado contra producción el
--      2026-10-28: había 4 filas, las 4 en `nueva`, así que las otras tres
--      traducciones son defensivas —no hay ninguna fila que las use hoy—.
--   3. `DEFAULT` nuevo. El INSERT de una solicitud no manda estado: lo pone la
--      base, así que el default es lo que determina con qué estado nace.
--   4. El CHECK nuevo, con los seis valores del alta.
--
-- Traducción elegida, y por qué:
--
--   · `nueva`        → `Recibida`              (recién llegada, nadie la miró)
--   · `en_revision`  → `En_Evaluacion`         (alguien la está mirando)
--   · `contactada`   → `Pendiente_Informacion` (se le pidió algo y se espera)
--   · `cerrada`      → `Aceptada`              (terminada)
--
-- Las dos últimas son las discutibles, y ninguna tiene filas: `cerrada` se
-- traduce a `Aceptada` porque en esa bandeja «cerrada» significaba «el equipo
-- terminó con esto», no «rechazamos»; afirmar un rechazo que nadie registró
-- sería peor. Si alguna vez aparece una fila cerrada que en realidad fue un
-- rechazo, se corrige a mano: son cuatro filas, no un padrón.

-- ── 1. Fuera el CHECK viejo ──────────────────────────────────────────────────
ALTER TABLE public.solicitudes
    DROP CONSTRAINT IF EXISTS solicitudes_status_check;

-- ── 2. Traducción de lo guardado ─────────────────────────────────────────────
UPDATE public.solicitudes SET status = 'Recibida'
    WHERE status = 'nueva';
UPDATE public.solicitudes SET status = 'En_Evaluacion'
    WHERE status = 'en_revision';
UPDATE public.solicitudes SET status = 'Pendiente_Informacion'
    WHERE status = 'contactada';
UPDATE public.solicitudes SET status = 'Aceptada'
    WHERE status = 'cerrada';

-- ── 3. Estado inicial ────────────────────────────────────────────────────────
ALTER TABLE public.solicitudes
    ALTER COLUMN status SET DEFAULT 'Recibida';

-- ── 4. El CHECK nuevo ────────────────────────────────────────────────────────
ALTER TABLE public.solicitudes
    ADD CONSTRAINT solicitudes_status_check
    CHECK (status = ANY (ARRAY[
        'Recibida', 'En_Evaluacion', 'Pendiente_Informacion', 'Aceptada', 'En_Alta', 'Rechazada'
    ]));
