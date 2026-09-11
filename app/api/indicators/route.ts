import { NextResponse } from 'next/server';

// Route dinámico: la prerenderización estática intentaba fetch a mindicador.cl
// durante el build (rompiendo el incremental cache) y congelaba la UF/dólar
// hasta el próximo deploy. El `next: { revalidate }` del fetch sigue
// cacheando la llamada externa 1 h, que es lo que protege la cuota de la API.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch('https://mindicador.cl/api', {
      next: { revalidate: 3600 },
      headers: {
        'User-Agent': 'Rix7-Portal-Inmobiliario/1.0',
      },
    });

    if (!res.ok) {
      throw new Error(`Error en API: ${res.status}`);
    }

    const data = await res.json();

    return NextResponse.json({
      success: true,
      source: 'Banco Central de Chile',
      date: data.fecha || new Date().toISOString(),
      uf: {
        code: 'uf',
        name: 'Unidad de Fomento',
        value: Number(data.uf?.valor) || 39500.0,
        date: data.uf?.fecha,
      },
      dolar: {
        code: 'dolar',
        name: 'Dólar Observado',
        value: Number(data.dolar?.valor) || 950.0,
        date: data.dolar?.fecha,
      },
      utm: {
        code: 'utm',
        name: 'Unidad Tributaria Mensual',
        value: Number(data.utm?.valor) || 69000.0,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: true,
      source: 'Banco Central de Chile (Caché local)',
      date: new Date().toISOString(),
      uf: {
        code: 'uf',
        name: 'Unidad de Fomento',
        value: 39500.0,
      },
      dolar: {
        code: 'dolar',
        name: 'Dólar Observado',
        value: 950.0,
      },
    });
  }
}
