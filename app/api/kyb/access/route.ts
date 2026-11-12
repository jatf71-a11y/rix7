import { NextRequest, NextResponse } from 'next/server';
import { kybAccessPostSchema } from '@/lib/api/schemas';
import { validateInput } from '@/lib/api/validate';
import { readUfClp } from '@/lib/data/ccaLedger';
import { readPlanPricing } from '@/lib/data/planPricingStore';
import { ccaExample as buildCcaExample, type CcaExample } from '@/lib/kyb/cca';
import { kybStatusByToken } from '@/lib/kyb/onboarding';
import { clientIpFrom, createRateLimiter } from '@/lib/utils/rateLimit';

/**
 * `/api/kyb/access` — estado de la solicitud con el token del correo.
 *
 * Devuelve solo lo que la empresa necesita ver: su estado, las preguntas
 * abiertas y, cuando corresponde, que ya puede elegir plan. Nada del puntaje ni
 * de las verificaciones internas: eso es del equipo.
 */
const rateLimiter = createRateLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(clientIpFrom(request.headers))) {
    return NextResponse.json(
      { success: false, error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Cuerpo inválido' }, { status: 400 });
  }

  const shape = validateInput(kybAccessPostSchema, body);
  if (!shape.ok) {
    return NextResponse.json({ success: false, error: shape.error }, { status: 400 });
  }

  const result = await kybStatusByToken(shape.data.token);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'El enlace no es válido.' },
      { status: 403 }
    );
  }

  // El ejemplo del CCA se arma solo cuando el paso de plan se va a mostrar. La
  // UF se pide a un servicio externo (cacheado una hora), así que no se consulta
  // para un enlace que solo va a decir «en evaluación». Sin UF no se inventa un
  // monto: el paso muestra la fórmula, que es igual de cierta.
  let ccaExample: CcaExample | null = null;
  if (result.planSummary) {
    const [ufClp, pricing] = await Promise.all([readUfClp(), readPlanPricing()]);
    ccaExample = buildCcaExample({ ufClp, ccaPct: pricing.config.ccaPct });
  }

  return NextResponse.json({
    success: true,
    data: {
      status: result.status,
      legalName: result.legalName,
      questions: result.questions ?? [],
      plan: result.plan ?? null,
      panelEnabled: result.panelEnabled ?? false,
      // Solo con la propuesta aceptada (etapa `Alta`) y el panel sin habilitar.
      canChoosePlan: result.status === 'Alta' && !result.panelEnabled,
      // Los montos del paso de plan: los de la propuesta aceptada, que nacen de
      // los precios que el equipo definió en Planes.
      planSummary: result.planSummary ?? null,
      ccaExample,
    },
  });
}
