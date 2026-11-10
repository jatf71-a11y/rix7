-- Correo de la empresa.
--
-- El registro de corredoras e inmobiliarias guardaba un solo correo: el de la
-- persona que completa el formulario. Cuando esa persona usa un correo personal,
-- la empresa quedaba sin correo corporativo y el equipo no tenía dónde anotarlo:
-- el motor volvía a preguntarlo aunque la respuesta ya estuviera en el registro.
--
-- `null` = no se informó (el alta directa por API no lo pide).

alter table public.kyb_applications
  add column if not exists company_email text;

comment on column public.kyb_applications.company_email is
  'Correo corporativo declarado en el registro; null = no se informó.';
