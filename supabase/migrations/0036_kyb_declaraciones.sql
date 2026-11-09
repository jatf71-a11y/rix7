-- Declaraciones del registro de empresas.
--
-- El formulario pregunta explícitamente si la empresa tiene sitio web y si el
-- correo es de la empresa o personal. Sin estas columnas, «no tengo sitio» era
-- indistinguible de «no lo llené», y el motor le preguntaba por un dominio a
-- quien acababa de decir que no tiene: el perfil de un socio más básico.
--
-- `null` = no se preguntó (alta directa por API) o no se respondió.

alter table public.kyb_applications
  add column if not exists has_website boolean,
  add column if not exists has_company_email boolean;

comment on column public.kyb_applications.has_website is
  'false = la empresa declaró no tener sitio web; null = sin dato.';
comment on column public.kyb_applications.has_company_email is
  'false = el contacto declaró usar un correo personal; null = sin dato.';
