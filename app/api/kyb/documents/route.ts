import { NextRequest, NextResponse } from 'next/server';

import { saveDebtReport } from '@/lib/kyb/documents';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `POST /api/kyb/documents` — subida del informe de deudas de la CMF.
 *
 * Es público porque quien lo sube no tiene sesión: se identifica con el mismo
 * token del correo de «Pendiente de información». El formulario manda
 * `multipart/form-data` con `token` y `file`; el servidor resuelve a qué alta o
 * registro pertenece, guarda el PDF en el bucket privado y lo lee para devolver
 * el resultado en la misma respuesta.
 *
 * `nodejs` y no edge: la lectura del PDF usa una librería de Node.
 */
export const runtime = 'nodejs';

/** Un informe pesa: no hace falta subir diez veces en diez minutos. */
const rateLimiter = createRateLimiter({ max: 20, windowMs: 10 * 60 * 1000 });

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiados intentos. Espera unos minutos.' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { success: false, error: 'El envío del archivo no se pudo leer.' },
      { status: 400 }
    );
  }

  const result = await saveDebtReport({
    token: form.get('token'),
    file: form.get('file'),
  });

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        document: {
          id: result.document.id,
          kind: result.document.kind,
          fileName: result.document.fileName,
          sizeBytes: result.document.sizeBytes,
          status: result.document.status,
          analysis: result.document.analysis,
        },
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
