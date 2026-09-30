import { NextRequest, NextResponse } from 'next/server';
import { findPartnerByFeedToken } from '@/lib/feeds/feedStore';
import { listPartnerProperties } from '@/lib/data/partnerProperties';
import { buildTrovitFeed } from '@/lib/feeds/trovit';
import { feedFileSchema, feedTokenSchema } from '@/lib/api/schemas';
import { searchParamsToObject, validateInput } from '@/lib/api/validate';
import { SITE_URL } from '@/lib/site';

/**
 * `/feeds/<slug>.xml` — feed Trovit público de una corredora (hallazgo #14).
 *
 * Es la URL que la corredora registra en el agregador (Trovit/Mitula). La ruta
 * vive **fuera de `/api/`** a propósito: `robots.ts` bloquea `/api/` para
 * crawlers, y el consumidor de un feed es un crawler — servido bajo `/api/`
 * estaría vetado por el propio portal.
 *
 * Autenticación: `?token=<hex>` cuyo hash SHA-256 debe coincidir con el
 * guardado en la corredora **y** cuyo feed esté habilitado. La ruta revalida
 * en tiempo constante (defensa en profundidad sobre la igualdad por query).
 *
 * Caché en el borde por 1 hora: los portales rastrean 1–2 veces al día. La
 * respuesta no depende de cookies (el cliente es un servidor del agregador).
 */

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;

  const fileValidation = validateInput(feedFileSchema, file);
  if (!fileValidation.ok) {
    return NextResponse.json({ success: false, error: 'Archivo inválido.' }, { status: 404 });
  }
  const slug = fileValidation.data.replace(/\.xml$/, '');

  const tokenValidation = validateInput(
    feedTokenSchema,
    searchParamsToObject(request.nextUrl.searchParams).token
  );
  if (!tokenValidation.ok) {
    // Sin token válido ni se busca la corredora: no se filtra si un slug existe.
    return NextResponse.json(
      { success: false, error: 'Token requerido: pide la URL del feed a Rix7.' },
      { status: 401 }
    );
  }

  const match = await findPartnerByFeedToken(tokenValidation.data);
  if (!match || match.partner.slug !== slug) {
    return NextResponse.json(
      { success: false, error: 'Feed no encontrado o token inválido.' },
      { status: 404 }
    );
  }

  // Con `properties.partner_id` (fase 3, 2.1) la atribución sale de la base:
  // datos en caliente de la corredora + su catálogo, deduplicados.
  const { properties, source } = await listPartnerProperties(match.partner.id);

  const xml = buildTrovitFeed({
    properties,
    siteUrl: SITE_URL,
    agency: {
      name: match.partner.name,
      // El contacto del feed es el de la corredora, que es quien decide
      // publicarlo en agregadores (evaluación #14). Los datos vienen del
      // registro del panel; acá solo se informan en el comentario cabecera.
    },
  });

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      'X-Feed-Source': source,
    },
  });
}
