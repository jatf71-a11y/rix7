-- ════════════════════════════════════════════════════════════════════════════
-- 0043 · Códigos de recuperación del segundo factor del equipo
-- ════════════════════════════════════════════════════════════════════════════
-- El 2FA del equipo protege la cuenta más valiosa del sistema: la que administra
-- socios, planes y accesos. Pero un segundo factor sin salida es una forma
-- elegante de perder el panel: si alguien cambia de teléfono, se queda afuera de
-- su propia cuenta y —si es el único admin— deja a Rix7 sin administración.
--
-- Supabase solo emite códigos TOTP de la app; no tiene códigos de recuperación.
-- Por eso viven acá:
--
-- - **Un código sirve una vez.** Se guarda su hash (SHA-256), nunca el código:
--   quien lea la tabla no puede usarla. El hash de un código de 8 caracteres de
--   un alfabeto de 32 no es atacable por fuerza bruta en un intento: se borra al
--   usarse y hay un lote por cuenta.
-- - **Se regeneran en lote**: al pedir un lote nuevo, los códigos anteriores sin
--   usar de esa cuenta se descartan. Un código viejo impreso en un papel no
--   sobrevive a «generé códigos nuevos».
-- - **Quién lo usó y cuándo** queda en la propia fila (`used_at`, `used_note`) y
--   se registra además en `admin_events` con la acción
--   `admin_mfa.recovery_code`: la bitácora del equipo es la de siempre.
--
-- Se escribe solo desde el servidor con `service_role`; RLS cerrada sin
-- políticas, como `admin_events` y `email_log`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    -- Cuenta del equipo a la que pertenece el código.
    user_id UUID NOT NULL,

    -- SHA-256 del código normalizado (mayúsculas, sin guiones). Nunca el código.
    code_hash TEXT NOT NULL,

    -- Se completa al usarse: un código usado no vuelve a servir.
    used_at TIMESTAMPTZ,
    used_note TEXT,

    -- Lote al que pertenece, para poder descartar los anteriores de una vez.
    batch_id UUID NOT NULL DEFAULT gen_random_uuid(),

    UNIQUE (user_id, code_hash)
);

-- «¿Cuántos códigos le quedan a esta cuenta?» y «¿este código sirve?».
CREATE INDEX IF NOT EXISTS admin_recovery_codes_user_idx
    ON public.admin_recovery_codes (user_id, used_at);

ALTER TABLE public.admin_recovery_codes ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.admin_recovery_codes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_recovery_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_recovery_codes TO service_role;

COMMENT ON TABLE public.admin_recovery_codes IS
    'Códigos de recuperación de un solo uso para el 2FA del equipo. Guarda el hash, nunca el código.';
COMMENT ON COLUMN public.admin_recovery_codes.used_at IS
    'Momento en que el código se canjeó. Un código usado no vuelve a servir.';
