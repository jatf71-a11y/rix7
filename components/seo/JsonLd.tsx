import { JsonLdObject, serializeJsonLd } from '@/lib/seo/jsonld';

/**
 * Monta los datos estructurados JSON-LD en el HTML del servidor.
 *
 * Es un componente de servidor a propósito: los buscadores leen el HTML inicial,
 * no necesita hidratación ni interacción. La serialización escapa `<` para que
 * ningún valor pueda cerrar el tag antes de tiempo.
 */
export function JsonLd({ data }: { data: JsonLdObject }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
