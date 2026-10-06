# Material fuente rescado

Estos archivos se extrajeron el **2026-10-06** del repositorio privado
`jatf71-a11y/rix7-portal-inmobiliario` (commit único `4c1babb`,
2026-08-28, rama `master`), **antes de eliminarlo**.

Ese repositorio era un esqueleto temprano del proyecto, ya superado por
`jatf71-a11y/rix7` (v10.0.0). El código no aportaba nada, pero estos dos
documentos **no existen en el repositorio principal** y son material de
origen del producto, así que se conservan aquí.

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `Comunas.xlsx` | 34359 | `925f47e337cd7e16f06a5b75d1f47193322204815f2be240041f9a61b8275c67` |
| `Prompt_Master_Web_Inmobiliaria_Zillow.docx` | 66256 | `95e1e22d38d8f83b13ed8c083273e7e1e41d518a990b4f7eaf887d77a3988670` |

Además se copiaron para trazabilidad:

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `.env.example` | 356 | `78519c1bc671b46b7a77bb6090a64fadabb0635e24e01bb0f87a7dccdc0ab77e` |
| `README.md` | 1677 | `70d00f81867dc9ddfd91e2bb45b0955ee0c2e125b66428d1eb67dc788ed30c0f` |

Los cuatro coinciden byte a byte con lo que devolvió la API de GitHub para
ese commit (verificado por tamaño). El `.env.example` contiene **solo
marcadores** (`https://tu-proyecto-id.supabase.co`,
`tu-clave-anon-publica-aqui`); no se rescató ningún secreto.

Copias equivalentes de este material, y bastante más, ya existen en
`OneDrive/RX7 PROYECTO/` (`comunas_de_chile.docx`,
`RIX7_Prompt_Maestro_Registro.txt`, `RIX7_Tipos_de_Propiedades_Chile_v1.0-1.docx`,
`Barrios_Chile.xlsx`, `DEV.docx`, `POI.docx`).

## `codigo-viejo/` — versiones obsoletas

De las 43 rutas del repositorio viejo, solo 5 no existían en el repositorio
principal. Estas tres se guardan solo por trazabilidad; están **superadas**:

- `chile-properties.ts.txt` — catálogo nacional ficticio de 23 propiedades
  (Vitacura, Puerto Varas, Iquique, Punta Arenas, Villarrica…), con fotos de
  Unsplash y agentes inventados. **Cero solapamiento** con el catálogo real:
  los 23 ids son distintos de los 14 de producción y de las corredoras
  reales del catálogo actual. Útil como dataset de demo, inservible en
  producción.
- `PropertyMarker.tsx.txt` — marcador previo del mapa, reemplazado por
  `PropertyMapLeaflet`.
- `schema.sql` — esquema previo a la adopción de las 12 migraciones.

Se renombran a `.txt` a propósito: el `tsconfig` incluye `**/*.ts` y
`**/*.tsx`, así que dejarlos con su extensión original rompía el typecheck
y el build. Renombrados, `npx tsc --noEmit` pasa limpio.
