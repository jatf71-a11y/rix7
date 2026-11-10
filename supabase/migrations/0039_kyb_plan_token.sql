-- 0039 · Enlace para elegir plan desde el correo de calificación
--
-- El correo de «Calificado» deja de anunciar un plan fijo y pasa a llevar un
-- enlace con el que la empresa elige básico, profesional o premium. Ese enlace
-- usa un propósito propio (`plan`): sirve solo mientras la solicitud está en
-- `Calificado` y, al elegir, se reemplaza por el de la propuesta comercial.
--
-- El CHECK de 0031 solo conocía `answers`, `proposal` y `activation`, así que
-- guardar el token nuevo fallaba. Se amplía sin tocar los existentes: un enlace
-- de una etapa anterior sigue siendo válido para su etapa.

ALTER TABLE kyb_applications
  DROP CONSTRAINT IF EXISTS kyb_applications_token_purpose_check;

ALTER TABLE kyb_applications
  ADD CONSTRAINT kyb_applications_token_purpose_check
  CHECK (token_purpose IS NULL OR token_purpose = ANY (ARRAY['answers', 'plan', 'proposal', 'activation']));

COMMENT ON COLUMN kyb_applications.token_purpose IS
  'Etapa a la que sirve el token: answers (aclaraciones), plan (elegir plan), proposal (aceptar la propuesta) o activation (habilitar el panel).';
