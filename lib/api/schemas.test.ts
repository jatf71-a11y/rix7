import { describe, expect, it } from 'vitest';

import {
  alertsRunQuerySchema,
  favoritesDeleteSchema,
  favoritesPostSchema,
  geocodeQuerySchema,
  leadsPostSchema,
  partnerDeleteSchema,
  partnerPostSchema,
  partnerPutSchema,
  poisQuerySchema,
  propertiesQuerySchema,
  savedSearchDeleteSchema,
  shareReportQuerySchema,
  shareViewSchema,
} from './schemas';
import { searchParamsToObject, validateInput } from './validate';

/** Atajo: valida y devuelve el dato o lanza (para asserting solo el caso feliz). */
function ok<T extends import('zod').ZodTypeAny>(schema: T, input: unknown): import('zod').output<T> {
  const result = validateInput(schema, input);
  if (!result.ok) throw new Error(`Debía validar: ${result.error}`);
  return result.data;
}

function fails(schema: import('zod').ZodTypeAny, input: unknown): string {
  const result = validateInput(schema, input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Debía fallar');
  return result.error;
}

describe('lib/api/schemas', () => {
  describe('favoritesPostSchema', () => {
    it('acepta propertyId individual', () => {
      const data = ok(favoritesPostSchema, { propertyId: 'scl-depto-marco-polo' });
      expect(data.propertyId).toBe('scl-depto-marco-polo');
    });

    it('acepta propertyIds para la migración', () => {
      const data = ok(favoritesPostSchema, { propertyIds: ['a', 'b'] });
      expect(data.propertyIds).toEqual(['a', 'b']);
    });

    it('rechaza un cuerpo sin ningún id', () => {
      expect(fails(favoritesPostSchema, {})).toMatch(/id de la propiedad/i);
      expect(fails(favoritesPostSchema, { propertyIds: [] })).toMatch(/id de la propiedad/i);
    });

    it('no valida los valores: eso lo hace normalizePropertyIds en la ruta', () => {
      // Un id inválido entra a la capa de dominio, que filtra sin rechazar todo.
      const data = ok(favoritesPostSchema, { propertyId: 'a/b' });
      expect(data.propertyId).toBe('a/b');
    });
  });

  describe('favoritesDeleteSchema y savedSearchDeleteSchema', () => {
    it('exigen un id con alfabeto acotado', () => {
      expect(ok(favoritesDeleteSchema, { propertyId: 'a-b_1.2' }).propertyId).toBe('a-b_1.2');
      expect(fails(favoritesDeleteSchema, {})).toMatch(/required|obligatorio|inválido/i);
      expect(fails(favoritesDeleteSchema, { propertyId: 'x y' })).toBeTruthy();
      expect(fails(savedSearchDeleteSchema, { id: '../etc' })).toBeTruthy();
    });
  });

  describe('geocodeQuerySchema', () => {
    it('recorta la consulta y exige el mínimo del autocompletado', () => {
      expect(ok(geocodeQuerySchema, { q: '  providencia  ' }).q).toBe('providencia');
      expect(fails(geocodeQuerySchema, { q: 'a' })).toBeTruthy();
      expect(fails(geocodeQuerySchema, { q: '' })).toBeTruthy();
      expect(fails(geocodeQuerySchema, { q: 'x'.repeat(121) })).toBeTruthy();
    });
  });

  describe('poisQuerySchema', () => {
    it('acepta coordenadas decimales y rechaza fuera de rango o no numéricas', () => {
      expect(ok(poisQuerySchema, { lat: '-33.45', lng: '-70.66' })).toEqual({
        lat: -33.45,
        lng: -70.66,
      });
      expect(fails(poisQuerySchema, { lat: '999', lng: '999' })).toBeTruthy();
      expect(fails(poisQuerySchema, { lat: 'abc', lng: '-70.5' })).toBeTruthy();
      expect(fails(poisQuerySchema, {})).toBeTruthy();
    });
  });

  describe('propertiesQuerySchema', () => {
    it('aplica defaults del catálogo cuando no hay parámetros', () => {
      const data = ok(propertiesQuerySchema, {});
      expect(data.operation).toBe('all');
      expect(data.propertyType).toBe('all');
      expect(data.search).toBe('');
      expect(data.page).toBe(1);
      expect(data.limit).toBe(50);
    });

    it('mapea los alias de la navbar a los valores del catálogo', () => {
      expect(ok(propertiesQuerySchema, { operation: 'sale' }).operation).toBe('sale');
      expect(ok(propertiesQuerySchema, { operation: 'rent' }).operation).toBe('rent');
      expect(ok(propertiesQuerySchema, { operation: 'for_sale' }).operation).toBe('for_sale');
    });

    it('rechaza una operación desconocida', () => {
      expect(fails(propertiesQuerySchema, { operation: 'permuta' })).toMatch(/operación/i);
    });

    it('coacciona números y cae a los defaults ante basura (no rompe la home)', () => {
      expect(ok(propertiesQuerySchema, { minPrice: '250000' }).minPrice).toBe(250000);
      expect(ok(propertiesQuerySchema, { page: 'no-soy-página' }).page).toBe(1);
      expect(ok(propertiesQuerySchema, { limit: '1999999' }).limit).toBe(50);
    });

    it('rechaza precios negativos y newPropertyType ajeno al enum', () => {
      expect(fails(propertiesQuerySchema, { minPrice: '-1' })).toBeTruthy();
      expect(fails(propertiesQuerySchema, { newPropertyType: 'usadas' })).toBeTruthy();
    });

    it('recorta el texto de búsqueda (la normalización la hace la ruta)', () => {
      expect(ok(propertiesQuerySchema, { search: '  Ñuñoa  ' }).search).toBe('Ñuñoa');
    });
  });

  describe('shareViewSchema', () => {
    it('exige propertyId válido pero deja partnerId sin forma (cae al catálogo)', () => {
      const data = ok(shareViewSchema, { propertyId: 'scl-oficina-nueva-york' });
      expect(data.propertyId).toBe('scl-oficina-nueva-york');

      expect(fails(shareViewSchema, {})).toBeTruthy();
      expect(fails(shareViewSchema, { propertyId: 'a b' })).toBeTruthy();
      // Un partnerId absurdo no rechaza: resolvePartnerId decide con el catálogo.
      expect(ok(shareViewSchema, { propertyId: 'x', partnerId: { mal: true } }).partnerId).toEqual({
        mal: true,
      });
    });
  });

  describe('leadsPostSchema', () => {
    it('exige que el cuerpo sea objeto con los campos esperados', () => {
      expect(ok(leadsPostSchema, { name: 'Ana', email: 'ana@ejemplo.cl' })).toBeTruthy();
      expect(fails(leadsPostSchema, 'no soy objeto')).toBeTruthy();
      expect(fails(leadsPostSchema, [1, 2])).toBeTruthy();
      expect(fails(leadsPostSchema, null)).toBeTruthy();
    });
  });

  describe('partnerPostSchema', () => {
    const valid = { name: 'Corredora Sur', slug: 'corredora-sur' };

    it('acepta el mínimo (nombre y slug); el contacto ausente lo resuelve la ruta', () => {
      const data = ok(partnerPostSchema, valid);
      expect(data.name).toBe('Corredora Sur');
      expect(data.contact).toBeUndefined();
    });

    it('completa los campos del contacto si viene parcial', () => {
      const data = ok(partnerPostSchema, { ...valid, contact: { phone: '+56912345678' } });
      expect(data.contact).toEqual({ phone: '+56912345678', whatsapp: '', email: '' });
    });

    it('mantiene el mensaje de error que esperaba el panel', () => {
      expect(fails(partnerPostSchema, {})).toMatch(/name and slug are required/);
      expect(fails(partnerPostSchema, { name: 'X', slug: 'a b' })).toBeTruthy();
    });

    it('rechaza un color fuera del formato hex', () => {
      expect(fails(partnerPostSchema, { ...valid, color: 'azul' })).toBeTruthy();
      expect(ok(partnerPostSchema, { ...valid, color: '#3B82F6' }).color).toBe('#3B82F6');
    });
  });

  describe('partnerPutSchema', () => {
    it('exige id y tolera el resto parcial', () => {
      const data = ok(partnerPutSchema, { id: 'corredora-sur', name: 'Nuevo Nombre' });
      expect(data.name).toBe('Nuevo Nombre');
      expect(fails(partnerPutSchema, { name: 'Sin id' })).toBeTruthy();
    });
  });

  describe('partnerDeleteSchema', () => {
    it('exige id', () => {
      expect(fails(partnerDeleteSchema, {})).toMatch(/id is required/);
    });
  });

  describe('shareReportQuerySchema', () => {
    it('coacciona días y cae a 30 ante cualquier basura', () => {
      expect(ok(shareReportQuerySchema, { days: '7' }).days).toBe(7);
      expect(ok(shareReportQuerySchema, { days: 'ayer' }).days).toBe(30);
      expect(ok(shareReportQuerySchema, { days: '9999' }).days).toBe(30);
      expect(ok(shareReportQuerySchema, {}).days).toBe(30);
    });
  });

  describe('alertsRunQuerySchema', () => {
    it('conserva el contrato 1/true/yes y el resto es falso', () => {
      expect(ok(alertsRunQuerySchema, { dry: '1' }).dry).toBe(true);
      expect(ok(alertsRunQuerySchema, { dry: 'TRUE' }).dry).toBe(true);
      expect(ok(alertsRunQuerySchema, { dry: 'yes' }).dry).toBe(true);
      expect(ok(alertsRunQuerySchema, {}).dry).toBe(false);
      expect(ok(alertsRunQuerySchema, { dry: '0' }).dry).toBe(false);
    });
  });

  describe('validateInput', () => {
    it('separa el caso de éxito del de error', () => {
      const good = validateInput(geocodeQuerySchema, { q: 'las condes' });
      expect(good.ok).toBe(true);

      const bad = validateInput(geocodeQuerySchema, { q: 'x' });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.issues.length).toBeGreaterThan(0);
    });

    it('devuelve mensaje de reserva si ningún issue tiene texto', () => {
      const emptyMessageSchema = {
        safeParse: () => ({ success: false as const, error: { issues: [{ message: '' }] } }),
      } as unknown as import('zod').ZodTypeAny;

      expect(fails(emptyMessageSchema, {})).toBe('Solicitud inválida.');
    });
  });

  describe('searchParamsToObject', () => {
    it('convierte query string a objeto plano', () => {
      const params = new URLSearchParams('lat=-33.45&lng=-70.66&q=providencia');
      expect(searchParamsToObject(params)).toEqual({
        lat: '-33.45',
        lng: '-70.66',
        q: 'providencia',
      });
    });

    it('conserva la última aparición de claves repetidas', () => {
      const params = new URLSearchParams('tag=a&tag=b');
      expect(searchParamsToObject(params).tag).toBe('b');
    });
  });
});
