import { NextResponse } from 'next/server';
import { listPartners } from '@/lib/data/partners-store';

/**
 * Listado público de corredoras inscritas.
 *
 * Existe porque el carrusel de socios del home vive en un componente de cliente
 * y sus datos ahora están en Supabase: sin esta ruta, el home seguiría mostrando
 * la lista escrita en el código y una edición del panel no se vería.
 *
 * Solo expone lo que ya es público en el portal (nombre, logo, descripción,
 * color y datos de contacto de la corredora). Se cachea en el borde con el mismo
 * criterio que el resto de las rutas de lectura.
 */
export const revalidate = 300;

export async function GET() {
  const { partners, source } = await listPartners();

  return NextResponse.json(
    { success: true, data: partners, source },
    {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
      },
    }
  );
}
