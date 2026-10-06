# Rix7 - Portal Inmobiliario Inteligente (Santiago de Chile)

Plataforma inmobiliaria moderna de alto rendimiento inspirada en Zillow, adaptada al mercado de **Santiago de Chile**, construida **100% con herramientas de código abierto y capas gratuitas** (sin APIs de pago de Google Maps o Mapbox).

---

## 🚀 Stack Tecnológico

- **Frontend**: [Next.js 14+ (App Router)](https://nextjs.org/), TypeScript, Tailwind CSS, Lucide Icons.
- **Web GIS & Mapas**: [Leaflet.js](https://leafletjs.com/) + [React-Leaflet](https://react-leaflet.js.org/) con teselas libres de [CartoDB Voyager](https://carto.com/basemaps/) y [OpenStreetMap](https://www.openstreetmap.org/) centradas en **Santiago de Chile**.
- **Backend & Base de Datos**: [Supabase](https://supabase.com/) (PostgreSQL 15+ con extensión nativa **PostGIS** `GEOGRAPHY(POINT, 4326)`, Supabase Auth `@supabase/ssr`, y Supabase Storage).
- **Tipos de Propiedades**: Departamentos, Casas, VIP, Parcelas, Oficinas y Terrenos.
- **Operaciones**: Venta y Arriendo.

---

## 🛠️ Guía de Ejecución Local

```bash
# 1. Iniciar el servidor de desarrollo:
npm run dev
```
Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

---

## 🗄️ Base de Datos Supabase & PostGIS

1. Ejecuta el archivo [`supabase/schema.sql`](file:///c:/Users/javie/OneDrive/12.%20RIX/supabase/schema.sql) en el **SQL Editor** de tu proyecto Supabase.
2. Ejecuta [`supabase/seed.sql`](file:///c:/Users/javie/OneDrive/12.%20RIX/supabase/seed.sql) para sembrar propiedades reales en Vitacura, Las Condes, Lo Barnechea, Providencia, Ñuñoa, Peñalolén y Chicureo.
3. Copia tus credenciales en `.env.local` y despliega en Vercel.
