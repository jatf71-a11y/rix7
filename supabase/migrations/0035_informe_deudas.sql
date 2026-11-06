-- ════════════════════════════════════════════════════════════════════════════
-- 0035 · Informe de deudas de la CMF en «Pendiente de información»
-- ════════════════════════════════════════════════════════════════════════════
-- La etapa «Pendiente de información» dejó de ser solo preguntas: a todos los
-- que quedan detenidos ahí se les pide el **informe de deudas de la CMF**, que es
-- el documento que puede contradecir lo que la empresa declara. Cuál se pide
-- depende del perfil —personas naturales para un profesional independiente,
-- personas jurídicas para una corredora o inmobiliaria— y eso lo resuelve el
-- código (`lib/kyb/debtReport.ts`), no la base: la regla es de producto y
-- cambia con el negocio, no con la operación.
--
-- Dos piezas nuevas:
--
-- 1. **El bucket `kyb-documents`, privado.** Son datos financieros de una
--    persona o de una empresa: no pueden quedar en el bucket público de las
--    fotos de propiedades. El acceso es por URL firmada, generada en el servidor
--    con `service_role`, y dura una hora.
--
-- 2. **`kyb_documents`.** Guarda el archivo (ruta, nombre, tamaño), a qué ficha
--    pertenece y el **resultado de leerlo**: total adeudado, acreedores, deudas
--    impagas y castigadas, y el RUT que trae el informe. Se guarda el análisis y
--    no solo el PDF porque el equipo necesita decidir sin abrir cada archivo, y
--    porque el texto extraído es la evidencia de qué se leyó.
--
-- El dueño es polimórfico a propósito (`owner_kind` + `owner_id`): la etapa
-- existe en los dos caminos —el alta de empresas y el registro de socios— y
-- duplicar la tabla para cada uno obligaría a mantener dos veces el mismo
-- comportamiento. `owner_id` es TEXT porque las solicitudes usan ids de texto y
-- las altas UUID; lo valida el servidor contra el token, nunca el navegador.
--
-- RLS cerrada sin políticas, igual que el resto del flujo KYB: el solicitante
-- escribe por `/api/kyb/documents` (con su token) y el equipo lee por el panel;
-- las dos rutas usan `service_role` en el servidor.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Bucket privado de informes ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'kyb-documents',
    'kyb-documents',
    false,
    10485760, -- 10 MB, el mismo tope que valida la aplicación
    ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Documentos de la ficha ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kyb_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- A qué ficha pertenece: `alta` (kyb_applications) o `solicitud`.
    owner_kind TEXT NOT NULL CHECK (owner_kind = ANY (ARRAY['alta', 'solicitud'])),
    owner_id TEXT NOT NULL,

    -- Qué informe es. El perfil del registro decide cuál corresponde.
    kind TEXT NOT NULL CHECK (kind = ANY (ARRAY['natural', 'juridica'])),

    -- Ruta dentro del bucket privado. El nombre original se guarda aparte para
    -- mostrarlo; la ruta no lo usa nunca tal cual.
    storage_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/pdf',
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),

    -- `analyzed` = se extrajeron datos; `unreadable` = el PDF no tenía texto
    -- (una captura o un escaneo) y el equipo tiene que abrirlo a mano.
    status TEXT NOT NULL DEFAULT 'analyzed'
        CHECK (status = ANY (ARRAY['analyzed', 'unreadable'])),

    -- Resultado de leer el informe: montos, acreedores, RUT y notas.
    analysis JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- La ficha pide «los informes de esta solicitud», siempre por fecha.
CREATE INDEX IF NOT EXISTS kyb_documents_owner_idx
    ON public.kyb_documents (owner_kind, owner_id, created_at DESC);

ALTER TABLE public.kyb_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.kyb_documents IS
    'Informes de deudas de la CMF subidos por el solicitante en «Pendiente de Información», con el análisis del texto. La fila apunta a un objeto del bucket privado kyb-documents.';

-- Los grants son explícitos porque Supabase dejó de conceder la Data API a las
-- tablas nuevas: sin ellos, una base creada desde estas migraciones responde
-- «permission denied» antes de llegar a RLS. La RLS está **cerrada sin
-- políticas**, así que `anon` y `authenticated` no ven ni una fila: los datos
-- financieros solo salen por las rutas del servidor, con la clave de servicio.
GRANT SELECT ON public.kyb_documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_documents TO service_role;
