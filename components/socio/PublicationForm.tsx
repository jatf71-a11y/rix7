'use client';

import React, { useMemo, useState } from 'react';
import {
  ImagePlus,
  MapPin,
  Navigation,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  AlertCircle,
} from 'lucide-react';
import type { PanelProperty } from '@/lib/data/propertiesStore';
import type { RolCandidate } from '@/lib/data/siiRol';
import { CHILE_REGIONS } from '@/lib/data/chileLocations';
import { getPropertyTypeLabel } from '@/lib/utils/formatters';
import { isValidRol, ROL_MAX_LENGTH } from '@/lib/utils/rol';
import { uploadMedia } from '@/lib/utils/uploadMedia';

/**
 * Formulario de publicación, compartido por el alta (`/socio/publicar`) y la
 * edición (`/socio/publicaciones/[id]`): un solo lugar para la forma de los
 * datos y sus errores en pantalla.
 *
 * Decisiones que no son de manual:
 *
 * - **Los números viajan como cadena** (todo input de HTML da string) y se
 *   convierten al enviar: Zod igual los coercioniza en el servidor, pero acá
 *   se hace explícito para que un campo vacío no se envíe `NaN`.
 * - **`year_built`, `state`, `zip_code` y el contacto son opcionales**: vacío
 *   significa «no sé», y en el payload simplemente no viajan (nada de `''` ni
 *   `0` que la ficha tendría que filtrar después).
 * - **Las coordenadas se pueden obtener por dirección** con el proxy de
 *   geocodificación que ya usa el buscador: `location` es NOT NULL en la base,
 *     sin par no hay fila posible, y pedirle a una corredora que copie
 *   lat/lng a mano es la forma más segura de que los ponga mal.
 */

/** Lo que el formulario emite ya convertido (contrato del `onSubmit`). */
export interface PublicationPayload {
  title: string;
  description: string;
  price: number;
  property_type: string;
  status: 'for_sale' | 'for_rent' | 'sold' | 'rented';
  bedrooms: number;
  bathrooms: number;
  area_sqm: number;
  parking_spots: number;
  year_built?: number;
  address: string;
  city: string;
  state?: string;
  zip_code?: string;
  images: string[];
  features: string[];
  lat: number;
  lng: number;
  agent_name?: string;
  agent_email?: string;
  agent_phone?: string;
  /** ROL (SII): identificación interna, vacío = sin ROL. */
  rol: string;
  /** Video de la ficha: vacío = sin video (y en edición, quitarlo). */
  video_url: string;
  /** Costos de la ficha en CLP: vacío = no informado, no viaja. */
  common_expenses?: number;
  property_taxes?: number;
  deposit?: number;
  /** Procedencia del monto de contribuciones (0023); vacío = ingresado a mano. */
  property_taxes_source: string;
  property_taxes_checked_at: string;
}

interface FormState {
  title: string;
  description: string;
  price: string;
  property_type: string;
  status: string;
  bedrooms: string;
  bathrooms: string;
  area_sqm: string;
  parking_spots: string;
  year_built: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  lat: string;
  lng: string;
  agent_name: string;
  agent_email: string;
  agent_phone: string;
  rol: string;
  video_url: string;
  common_expenses: string;
  property_taxes: string;
  deposit: string;
  property_taxes_source: string;
  property_taxes_checked_at: string;
}

/** Resultado de «Buscar por dirección» en el SII, mientras se está editando. */
interface RolSearch {
  loading: boolean;
  candidates: RolCandidate[];
  total: number;
  note: string | null;
  error: string | null;
}

const EMPTY_ROL_SEARCH: RolSearch = {
  loading: false,
  candidates: [],
  total: 0,
  note: null,
  error: null,
};

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  price: '',
  property_type: 'apartment',
  status: 'for_sale',
  bedrooms: '1',
  bathrooms: '1',
  area_sqm: '',
  parking_spots: '0',
  year_built: '',
  address: '',
  city: '',
  state: '',
  zip_code: '',
  lat: '',
  lng: '',
  agent_name: '',
  agent_email: '',
  agent_phone: '',
  rol: '',
  video_url: '',
  common_expenses: '',
  property_taxes: '',
  deposit: '',
  property_taxes_source: '',
  property_taxes_checked_at: '',
};

/** Las mismas claves que acepta `publicationPostSchema` (lib/api/schemas.ts). */
const PROPERTY_TYPES = [
  'apartment',
  'house',
  'premium',
  'parcel',
  'office',
  'land',
  'parking',
  'local',
  'warehouse',
] as const;

const STATUSES = [
  { value: 'for_sale', label: 'En venta' },
  { value: 'for_rent', label: 'En arriendo' },
  { value: 'sold', label: 'Vendido' },
  { value: 'rented', label: 'Arrendado' },
] as const;

function fromProperty(property: PanelProperty): FormState {
  return {
    title: property.title ?? '',
    description: property.description ?? '',
    price: property.price ? String(property.price) : '',
    property_type: property.property_type ?? 'apartment',
    status: property.status ?? 'for_sale',
    bedrooms: String(property.bedrooms ?? 1),
    bathrooms: String(property.bathrooms ?? 1),
    area_sqm: property.area_sqm ? String(property.area_sqm) : '',
    parking_spots: String(property.parking_spots ?? 0),
    year_built: property.year_built ? String(property.year_built) : '',
    address: property.address ?? '',
    city: property.city ?? '',
    state: property.state ?? '',
    zip_code: property.zip_code ?? '',
    lat: property.lat ? String(property.lat) : '',
    lng: property.lng ? String(property.lng) : '',
    agent_name: property.agent_name ?? '',
    agent_email: property.agent_email ?? '',
    agent_phone: property.agent_phone ?? '',
    rol: property.rol ?? '',
    video_url: property.video_url ?? '',
    common_expenses: property.common_expenses ? String(property.common_expenses) : '',
    property_taxes: property.property_taxes ? String(property.property_taxes) : '',
    deposit: property.deposit ? String(property.deposit) : '',
    property_taxes_source: property.property_taxes_source ?? '',
    property_taxes_checked_at: property.property_taxes_checked_at ?? '',
  };
}

/** Región elegida a partir del `state` guardado (tolerando variantes de texto). */
function regionOf(state: string): string {
  if (!state) return '';
  const exact = CHILE_REGIONS.find((r) => r.name === state);
  if (exact) return exact.name;
  const loose = CHILE_REGIONS.find(
    (r) => r.name.includes(state) || state.includes(r.name.replace('Región ', ''))
  );
  return loose?.name ?? '';
}

const inputBase =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

const labelBase = 'block text-xs font-semibold text-slate-600 mb-1.5';

export default function PublicationForm({
  initial,
  saving,
  error,
  onSubmit,
}: {
  initial?: PanelProperty;
  saving: boolean;
  error: string | null;
  onSubmit: (payload: PublicationPayload) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    initial ? fromProperty(initial) : EMPTY_FORM
  );
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [features, setFeatures] = useState<string[]>(initial?.features ?? []);
  const [newImage, setNewImage] = useState('');
  const [newFeature, setNewFeature] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeNote, setGeocodeNote] = useState<string | null>(null);
  /** Subida en curso (foto o video) y error del último intento, por origen. */
  const [uploading, setUploading] = useState<'photo' | 'video' | null>(null);
  const [uploadError, setUploadError] = useState<
    { kind: 'photo' | 'video'; message: string } | null
  >(null);
  /** Consulta de contribuciones al SII: en curso, resultado y error. */
  const [taxesLookup, setTaxesLookup] = useState<{
    loading: boolean;
    note: string | null;
    error: string | null;
  }>({ loading: false, note: null, error: null });
  /** Búsqueda del ROL por dirección en el SII: en curso, predios y error. */
  const [rolLookup, setRolLookup] = useState<RolSearch>(EMPTY_ROL_SEARCH);

  const regionName = useMemo(() => regionOf(form.state), [form.state]);
  const region = CHILE_REGIONS.find((r) => r.name === regionName);
  const communes = region?.communes.map((c) => c.name) ?? [];

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** Comunas: si la guardada no está en la región elegida, se conserva como opción. */
  const communeOptions = useMemo(() => {
    const list = [...communes];
    if (form.city && !list.includes(form.city)) list.unshift(form.city);
    return list;
  }, [communes, form.city]);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (form.title.trim().length < 3) errors.title = 'Escribe un título de al menos 3 letras.';
    if (form.address.trim().length < 3) errors.address = 'Falta la dirección.';
    if (!form.city.trim()) errors.city = 'Elige la comuna.';
    const price = Number(form.price);
    if (form.price === '' || !Number.isFinite(price) || price < 0)
      errors.price = 'Precio inválido.';
    const area = Number(form.area_sqm);
    if (form.area_sqm === '' || !Number.isFinite(area) || area < 1)
      errors.area_sqm = 'La superficie debe ser al menos 1 m².';
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    if (form.lat === '' || form.lng === '' || !Number.isFinite(lat) || !Number.isFinite(lng))
      errors.lat = 'Faltan las coordenadas: usa «Ubicar por dirección».';
    else if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
      errors.lat = 'Coordenadas fuera de rango.';
    if (form.year_built && !/^\d{4}$/.test(form.year_built.trim()))
      errors.year_built = 'Año inválido (4 dígitos).';
    // Costos opcionales: si se escriben, tienen que ser un monto en CLP. Vacío
    // es «no informado» y la ficha no muestra esa línea.
    for (const key of ['common_expenses', 'property_taxes', 'deposit'] as const) {
      const value = form[key].trim();
      if (!value) continue;
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) errors[key] = 'Monto inválido.';
    }
    // Misma regla que `rolSchema` (lib/api/schemas.ts), para fallar en pantalla
    // antes de viajar; la autoridad sigue siendo el servidor.
    const rol = form.rol.trim();
    if (rol && !isValidRol(rol)) errors.rol = 'ROL inválido (ej: 15234-67).';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !validate()) return;

    const optional = (value: string) => (value.trim() ? value.trim() : undefined);
    const amount = (value: string) => (value.trim() ? Number(value) : undefined);

    onSubmit({
      title: form.title.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      property_type: form.property_type,
      status: form.status as PublicationPayload['status'],
      bedrooms: Number(form.bedrooms) || 0,
      bathrooms: Number(form.bathrooms) || 0,
      area_sqm: Number(form.area_sqm),
      parking_spots: Number(form.parking_spots) || 0,
      year_built: form.year_built ? Number(form.year_built) : undefined,
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim() || undefined,
      zip_code: optional(form.zip_code),
      images,
      features,
      lat: Number(form.lat),
      lng: Number(form.lng),
      agent_name: optional(form.agent_name),
      agent_email: optional(form.agent_email),
      agent_phone: optional(form.agent_phone),
      // Siempre como cadena: '' es el valor con que la edición pide borrar
      // el ROL o el video (el store lo convierte en NULL).
      rol: form.rol.trim(),
      video_url: form.video_url.trim(),
      common_expenses: amount(form.common_expenses),
      property_taxes: amount(form.property_taxes),
      deposit: amount(form.deposit),
      // Vacío = borrar la marca: un monto que se escribió a mano no se atribuye
      // al SII. El store convierte la cadena vacía en NULL.
      property_taxes_source: form.property_taxes_source,
      property_taxes_checked_at: form.property_taxes_checked_at,
    });
  }

  /**
   * Sube un archivo a Storage y lo coloca (foto → lista, video → campo).
   * Nunca lanza: `uploadMedia` devuelve todo como resultado legible.
   */
  async function handleUpload(kind: 'photo' | 'video', file?: File | null) {
    if (!file || uploading) return;
    setUploading(kind);
    setUploadError(null);
    const result = await uploadMedia(file);
    setUploading(null);
    if (!result.ok || !result.url) {
      setUploadError({ kind, message: result.error ?? 'No se pudo subir el archivo.' });
      return;
    }
    const url = result.url;
    if (kind === 'photo') {
      if (images.length >= 30) {
        setUploadError({ kind, message: 'Máximo 30 fotos por publicación.' });
        return;
      }
      setImages((prev) => (prev.includes(url) ? prev : [...prev, url]));
    } else {
      setForm((prev) => ({ ...prev, video_url: url }));
    }
  }

  function addImage() {
    const url = newImage.trim();
    if (!url || images.includes(url) || images.length >= 30) return;
    if (!/^(https?:\/\/|\/)/.test(url)) {
      setFieldErrors((prev) => ({
        ...prev,
        image: 'La imagen debe ser una URL (http/https) o una ruta que empiece con "/".',
      }));
      return;
    }
    setFieldErrors((prev) => ({ ...prev, image: '' }));
    setImages((prev) => [...prev, url]);
    setNewImage('');
  }

  function addFeature() {
    const value = newFeature.trim();
    if (!value || features.includes(value) || features.length >= 40) return;
    setFeatures((prev) => [...prev, value]);
    setNewFeature('');
  }

  /**
   * Rellena lat/lng desde la dirección escrita. Usa el mismo proxy de
   * geocodificación del buscador (con su rate limit), así que un clic por
   * publicación no le cuesta nada a Nominatim.
   */
  async function locate() {
    const query = [form.address, form.city].filter(Boolean).join(', ');
    if (query.trim().length < 4) {
      setGeocodeNote('Escribe primero la dirección (y la comuna).');
      return;
    }
    setGeocoding(true);
    setGeocodeNote(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      const first = data?.results?.[0];
      if (data.success && first && Number.isFinite(first.lat) && Number.isFinite(first.lng)) {
        setForm((prev) => ({ ...prev, lat: String(first.lat), lng: String(first.lng) }));
        setGeocodeNote(`Ubicado en: ${first.name}`);
      } else {
        setGeocodeNote('Sin resultados: corrige la dirección o escribe las coordenadas.');
      }
    } catch {
      setGeocodeNote('No se pudo consultar el geocodificador.');
    } finally {
      setGeocoding(false);
    }
  }

  /**
   * Trae el monto anual de contribuciones desde el SII con el ROL y la comuna
   * de la ficha.
   *
   * Rellena el campo y deja marcada la procedencia; **no** guarda nada: el
   * guardado sigue siendo el botón del formulario, así la persona ve el monto y
   * decide. Si después lo edita a mano, la marca se borra al escribir.
   */
  async function lookupTaxes() {
    const rol = form.rol.trim();
    const comuna = form.city.trim();
    if (!rol || !comuna) {
      setTaxesLookup({
        loading: false,
        note: null,
        error: 'Para consultar al SII necesitas el ROL y la comuna.',
      });
      return;
    }

    setTaxesLookup({ loading: true, note: null, error: null });
    try {
      const params = new URLSearchParams({ rol, comuna });
      if (form.state.trim()) params.set('region', form.state.trim());

      const response = await fetch(`/api/contribuciones?${params.toString()}`, {
        cache: 'no-store',
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setTaxesLookup({
          loading: false,
          note: null,
          error: body?.error ?? 'No se pudo consultar el SII. Intenta de nuevo.',
        });
        return;
      }

      const annual = Number(body?.data?.annual);
      if (!Number.isFinite(annual) || annual <= 0) {
        setTaxesLookup({
          loading: false,
          note: null,
          error: 'El SII no informó un monto para ese ROL.',
        });
        return;
      }

      const year = Number(body?.data?.year);
      const checkedAt = String(body?.data?.checkedAt ?? '');
      setForm((prev) => ({
        ...prev,
        property_taxes: String(annual),
        property_taxes_source: 'sii',
        property_taxes_checked_at: checkedAt,
      }));
      setTaxesLookup({
        loading: false,
        note: `SII ${Number.isFinite(year) ? year : ''}: $${annual.toLocaleString('es-CL')} al año. Revisa el monto antes de guardar.`,
        error: null,
      });
    } catch {
      setTaxesLookup({
        loading: false,
        note: null,
        error: 'Sin conexión con el servidor. Intenta de nuevo.',
      });
    }
  }

  /**
   * Busca en el SII los roles de la dirección escrita (calle, número y, si la
   * trae, la unidad).
   *
   * No escribe el ROL: una dirección puede tener varios predios —un
   * estacionamiento por rol— y el SII también devuelve predios de otras calles
   * que comparten el número. La persona ve la lista con la dirección tal como
   * la registra el SII y elige; el campo se completa recién con ese clic.
   */
  async function lookupRol() {
    const direccion = form.address.trim();
    const comuna = form.city.trim();
    if (!direccion || !comuna) {
      setRolLookup({
        ...EMPTY_ROL_SEARCH,
        error: 'Para buscar el ROL necesitas la dirección y la comuna.',
      });
      return;
    }

    setRolLookup({ ...EMPTY_ROL_SEARCH, loading: true });
    try {
      const params = new URLSearchParams({ direccion, comuna });
      const response = await fetch(`/api/rol?${params.toString()}`, { cache: 'no-store' });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setRolLookup({
          ...EMPTY_ROL_SEARCH,
          error: body?.error ?? 'No se pudo consultar el SII. Intenta de nuevo.',
        });
        return;
      }

      const candidates: RolCandidate[] = Array.isArray(body?.data?.candidates)
        ? body.data.candidates
        : [];
      const total = Number(body?.data?.total) || candidates.length;

      setRolLookup({
        loading: false,
        candidates,
        total,
        note:
          total > candidates.length
            ? `Hay ${total} predios en esa dirección: agrega el departamento u oficina para acotar la lista.`
            : null,
        error: null,
      });
    } catch {
      setRolLookup({
        ...EMPTY_ROL_SEARCH,
        error: 'Sin conexión con el servidor. Intenta de nuevo.',
      });
    }
  }

  /** Elige un ROL de la lista: recién acá se completa el campo. */
  function pickRol(rol: string) {
    setForm((prev) => ({ ...prev, rol }));
    setFieldErrors((prev) => ({ ...prev, rol: '' }));
    setRolLookup(EMPTY_ROL_SEARCH);
  }

  /** Fecha de la consulta al SII, solo si es una fecha válida. */
  function checkedAtLabel(iso: string): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(date);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Identificación ─────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-slate-900">Identificación</h2>

        <div>
          <label className={labelBase} htmlFor="pub-title">
            Título *
          </label>
          <input
            id="pub-title"
            className={inputBase}
            value={form.title}
            onChange={(e) => set('title')(e.target.value)}
            placeholder="Ej: Departamento con vista en Av. Providencia"
            maxLength={140}
          />
          {fieldErrors.title && (
            <p className="text-xs text-red-600 mt-1">{fieldErrors.title}</p>
          )}
        </div>

        <div>
          <label className={labelBase} htmlFor="pub-description">
            Descripción
          </label>
          <textarea
            id="pub-description"
            className={`${inputBase} min-h-[110px]`}
            value={form.description}
            onChange={(e) => set('description')(e.target.value)}
            placeholder="Qué tiene de especial la propiedad, el sector, el edificio…"
            maxLength={4000}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelBase} htmlFor="pub-price">
              Precio en CLP *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                $
              </span>
              <input
                id="pub-price"
                type="number"
                min={0}
                step={100_000}
                className={`${inputBase} pl-7`}
                value={form.price}
                onChange={(e) => set('price')(e.target.value)}
                placeholder="85000000"
              />
            </div>
            {fieldErrors.price && (
              <p className="text-xs text-red-600 mt-1">{fieldErrors.price}</p>
            )}
          </div>

          <div>
            <label className={labelBase} htmlFor="pub-type">
              Tipo de propiedad
            </label>
            <select
              id="pub-type"
              className={inputBase}
              value={form.property_type}
              onChange={(e) => set('property_type')(e.target.value)}
            >
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {getPropertyTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelBase}>Operación</label>
            <div className="grid grid-cols-2 gap-2">
              {STATUSES.map((status) => (
                <button
                  key={status.value}
                  type="button"
                  onClick={() => set('status')(status.value)}
                  className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold border transition-colors ${
                    form.status === status.value
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {status.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <label className={labelBase} htmlFor="pub-rol">
            ROL (SII)
          </label>
          <input
            id="pub-rol"
            className={inputBase}
            value={form.rol}
            onChange={(e) => set('rol')(e.target.value)}
            placeholder="15234-67"
            maxLength={ROL_MAX_LENGTH}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={lookupRol}
              disabled={rolLookup.loading || saving || !form.address.trim() || !form.city.trim()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
              title="Buscar en el SII los roles de la dirección y la comuna de la ficha"
            >
              <Search className="w-3 h-3" />
              {rolLookup.loading ? 'Buscando…' : 'Buscar por dirección'}
            </button>
            {rolLookup.candidates.length > 0 && (
              <span className="text-[11px] text-slate-500">
                {rolLookup.total} {rolLookup.total === 1 ? 'predio' : 'predios'} en esa
                dirección
              </span>
            )}
          </div>
          {rolLookup.candidates.length > 0 && (
            <ul
              aria-label="Roles encontrados en el SII"
              className="mt-2 max-h-56 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200"
            >
              {rolLookup.candidates.map((candidate) => (
                <li key={candidate.rol}>
                  <button
                    type="button"
                    onClick={() => pickRol(candidate.rol)}
                    className="w-full px-3 py-2 text-left transition-colors hover:bg-slate-50"
                    title={`Usar el ROL ${candidate.rol}`}
                  >
                    <span className="block text-xs font-semibold text-slate-900">
                      {candidate.rol}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {candidate.address}
                      {candidate.destino ? ` · ${candidate.destino}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {rolLookup.error && (
            <p className="text-[11px] text-red-600 mt-1">{rolLookup.error}</p>
          )}
          {rolLookup.note && (
            <p className="text-[11px] text-slate-500 mt-1">{rolLookup.note}</p>
          )}
          {fieldErrors.rol ? (
            <p className="text-xs text-red-600 mt-1">{fieldErrors.rol}</p>
          ) : (
            <p className="text-[11px] text-slate-400 mt-1">
              Identificación del inmueble ante el SII. Solo se usa en el panel:
              no aparece en la ficha pública ni en el enlace compartido.
            </p>
          )}
          {!rolLookup.error && (!form.address.trim() || !form.city.trim()) ? (
            <p className="text-[11px] text-slate-400 mt-1">
              Para buscar el ROL se necesitan la dirección y la comuna (sección Ubicación).
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Ubicación ──────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-slate-900">Ubicación</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelBase} htmlFor="pub-address">
              Dirección *
            </label>
            <input
              id="pub-address"
              className={inputBase}
              value={form.address}
              onChange={(e) => {
                set('address')(e.target.value);
                // La lista de roles era de otra dirección: no se puede dejar
                // ahí para que alguien elija el predio equivocado.
                setRolLookup(EMPTY_ROL_SEARCH);
              }}
              placeholder="Av. Providencia 1234, depto 901"
              maxLength={300}
            />
            {fieldErrors.address && (
              <p className="text-xs text-red-600 mt-1">{fieldErrors.address}</p>
            )}
          </div>

          <div>
            <label className={labelBase} htmlFor="pub-region">
              Región
            </label>
            <select
              id="pub-region"
              className={inputBase}
              value={regionName}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, state: e.target.value, city: '' }));
                setRolLookup(EMPTY_ROL_SEARCH);
              }}
            >
              <option value="">Elige una región…</option>
              {CHILE_REGIONS.map((r) => (
                <option key={r.code} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelBase} htmlFor="pub-city">
              Comuna *
            </label>
            <select
              id="pub-city"
              className={inputBase}
              value={form.city}
              onChange={(e) => {
                set('city')(e.target.value);
                setRolLookup(EMPTY_ROL_SEARCH);
              }}
              disabled={communeOptions.length === 0}
            >
              <option value="">
                {communeOptions.length === 0 ? 'Elige primero la región' : 'Elige una comuna…'}
              </option>
              {communeOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {fieldErrors.city && (
              <p className="text-xs text-red-600 mt-1">{fieldErrors.city}</p>
            )}
          </div>

          <div className="sm:col-span-2 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="grow min-w-[180px]">
                <label className={labelBase} htmlFor="pub-lat">
                  Latitud *
                </label>
                <input
                  id="pub-lat"
                  className={inputBase}
                  value={form.lat}
                  onChange={(e) => set('lat')(e.target.value)}
                  placeholder="-33.4489"
                  inputMode="decimal"
                />
              </div>
              <div className="grow min-w-[180px]">
                <label className={labelBase} htmlFor="pub-lng">
                  Longitud *
                </label>
                <input
                  id="pub-lng"
                  className={inputBase}
                  value={form.lng}
                  onChange={(e) => set('lng')(e.target.value)}
                  placeholder="-70.6693"
                  inputMode="decimal"
                />
              </div>
              <button
                type="button"
                onClick={locate}
                disabled={geocoding}
                className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                <Navigation className="w-3.5 h-3.5" />
                {geocoding ? 'Ubicando…' : 'Ubicar por dirección'}
              </button>
            </div>
            {fieldErrors.lat ? (
              <p className="text-xs text-red-600 mt-1">{fieldErrors.lat}</p>
            ) : (
              geocodeNote && (
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {geocodeNote}
                </p>
              )
            )}
          </div>
        </div>
      </section>

      {/* ── Detalles ───────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-slate-900">Detalles</h2>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div>
            <label className={labelBase} htmlFor="pub-bedrooms">
              Dormitorios
            </label>
            <input
              id="pub-bedrooms"
              type="number"
              min={0}
              max={50}
              className={inputBase}
              value={form.bedrooms}
              onChange={(e) => set('bedrooms')(e.target.value)}
            />
          </div>
          <div>
            <label className={labelBase} htmlFor="pub-bathrooms">
              Baños
            </label>
            <input
              id="pub-bathrooms"
              type="number"
              min={0}
              max={50}
              step={0.5}
              className={inputBase}
              value={form.bathrooms}
              onChange={(e) => set('bathrooms')(e.target.value)}
            />
          </div>
          <div>
            <label className={labelBase} htmlFor="pub-area">
              Superficie (m²) *
            </label>
            <input
              id="pub-area"
              type="number"
              min={1}
              className={inputBase}
              value={form.area_sqm}
              onChange={(e) => set('area_sqm')(e.target.value)}
              placeholder="68"
            />
            {fieldErrors.area_sqm && (
              <p className="text-xs text-red-600 mt-1">{fieldErrors.area_sqm}</p>
            )}
          </div>
          <div>
            <label className={labelBase} htmlFor="pub-parking">
              Estacionamientos
            </label>
            <input
              id="pub-parking"
              type="number"
              min={0}
              max={50}
              className={inputBase}
              value={form.parking_spots}
              onChange={(e) => set('parking_spots')(e.target.value)}
            />
          </div>
          <div>
            <label className={labelBase} htmlFor="pub-year">
              Año de construcción
            </label>
            <input
              id="pub-year"
              inputMode="numeric"
              maxLength={4}
              className={inputBase}
              value={form.year_built}
              onChange={(e) => set('year_built')(e.target.value)}
              placeholder="2019"
            />
            {fieldErrors.year_built && (
              <p className="text-xs text-red-600 mt-1">{fieldErrors.year_built}</p>
            )}
          </div>
        </div>

        {/* Costos que la ficha publica junto al precio (migración 0022). Son
            opcionales: lo que se deje vacío no se guarda y la ficha no muestra
            esa línea, en vez de un «$0» que sería falso. */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-[11px] text-slate-400 mb-3">
            Costos de la ficha. Deja vacío lo que no corresponda.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelBase} htmlFor="pub-common-expenses">
                Gastos comunes (CLP/mes)
              </label>
              <input
                id="pub-common-expenses"
                type="number"
                min={0}
                step={1000}
                className={inputBase}
                value={form.common_expenses}
                onChange={(e) => set('common_expenses')(e.target.value)}
                placeholder="85000"
              />
              {fieldErrors.common_expenses && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.common_expenses}</p>
              )}
            </div>
            <div>
              <label className={labelBase} htmlFor="pub-property-taxes">
                Contribuciones (CLP/año)
              </label>
              <input
                id="pub-property-taxes"
                type="number"
                min={0}
                step={1000}
                className={inputBase}
                value={form.property_taxes}
                onChange={(e) => {
                  const value = e.target.value;
                  // Editar a mano invalida la procedencia: el número ya no es
                  // el que devolvió el SII.
                  setForm((prev) => ({
                    ...prev,
                    property_taxes: value,
                    property_taxes_source: '',
                    property_taxes_checked_at: '',
                  }));
                  setTaxesLookup({ loading: false, note: null, error: null });
                }}
                placeholder="240000"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={lookupTaxes}
                  disabled={taxesLookup.loading || saving || !form.rol.trim() || !form.city.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                  title="Consultar el monto emitido por el SII con el ROL de la ficha"
                >
                  <Search className="w-3 h-3" />
                  {taxesLookup.loading ? 'Consultando…' : 'Consultar SII'}
                </button>
                {form.property_taxes_source === 'sii' &&
                  checkedAtLabel(form.property_taxes_checked_at) && (
                    <span className="text-[11px] font-medium text-emerald-700">
                      Consultado el {checkedAtLabel(form.property_taxes_checked_at)}
                    </span>
                  )}
              </div>
              {fieldErrors.property_taxes && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.property_taxes}</p>
              )}
              {taxesLookup.note && (
                <p className="text-[11px] text-slate-500 mt-1">{taxesLookup.note}</p>
              )}
              {taxesLookup.error && (
                <p className="text-[11px] text-red-600 mt-1">{taxesLookup.error}</p>
              )}
              {!form.rol.trim() || !form.city.trim() ? (
                <p className="text-[11px] text-slate-400 mt-1">
                  Para consultar al SII se necesitan el ROL y la comuna.
                </p>
              ) : null}
            </div>
            <div>
              <label className={labelBase} htmlFor="pub-deposit">
                Garantía (CLP)
              </label>
              <input
                id="pub-deposit"
                type="number"
                min={0}
                step={1000}
                className={inputBase}
                value={form.deposit}
                onChange={(e) => set('deposit')(e.target.value)}
                placeholder="850000"
              />
              {fieldErrors.deposit && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.deposit}</p>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelBase} htmlFor="pub-zip">
              Código postal (opcional)
            </label>
            <input
              id="pub-zip"
              className={inputBase}
              value={form.zip_code}
              onChange={(e) => set('zip_code')(e.target.value)}
              maxLength={20}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelBase}>
              Características
              <span className="font-normal text-slate-400"> — Enter para agregar</span>
            </label>
            <div className="flex gap-2">
              <input
                className={inputBase}
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addFeature();
                  }
                }}
                placeholder="Ej: Balcón"
                maxLength={80}
              />
              <button
                type="button"
                onClick={addFeature}
                className="shrink-0 rounded-lg border border-slate-300 px-3 text-slate-600 hover:bg-slate-50"
                aria-label="Agregar característica"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {features.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {features.map((feature) => (
              <span
                key={feature}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
              >
                {feature}
                <button
                  type="button"
                  onClick={() => setFeatures((prev) => prev.filter((f) => f !== feature))}
                  className="text-slate-400 hover:text-red-600"
                  aria-label={`Quitar ${feature}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ── Fotos ──────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Fotos</h2>
          <span className="text-xs text-slate-400">{images.length}/30</span>
        </div>

        <div className="flex gap-2 flex-wrap">
          <input
            className={inputBase}
            value={newImage}
            onChange={(e) => setNewImage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addImage();
              }
            }}
            placeholder="https://… (URL de la foto)"
            maxLength={500}
          />
          <button
            type="button"
            onClick={addImage}
            className="shrink-0 flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
          >
            <ImagePlus className="w-4 h-4" />
            Agregar
          </button>
          <label
            className={`shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer ${
              uploading ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            <Upload className="w-4 h-4" />
            {uploading === 'photo' ? 'Subiendo…' : 'Subir del equipo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading !== null}
              onChange={(e) => {
                handleUpload('photo', e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {fieldErrors.image && <p className="text-xs text-red-600">{fieldErrors.image}</p>}
        {uploadError?.kind === 'photo' && (
          <p className="text-xs text-red-600">{uploadError.message}</p>
        )}

        {images.length > 0 ? (
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {images.map((url) => (
              <li key={url} className="group relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Foto de la publicación"
                  className="w-full h-24 object-cover"
                  loading="lazy"
                />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((i) => i !== url))}
                  className="absolute top-1 right-1 rounded-full bg-white/90 p-1 text-slate-600 shadow hover:text-red-600"
                  aria-label="Quitar foto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">
            Sin fotos todavía. La ficha y la landing compartirán igual, pero una
            publicación con foto se consulta mucho más.
          </p>
        )}
      </section>

      {/* ── Video ─── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Video</h2>
          <span className="text-xs text-slate-400">MP4, WebM o MOV · máx. 50 MB</span>
        </div>

        <div className="flex gap-2 flex-wrap">
          <input
            className={inputBase}
            value={form.video_url}
            onChange={(e) => set('video_url')(e.target.value)}
            placeholder="https://… o sube un archivo de tu equipo"
            maxLength={500}
          />
          <label
            className={`shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer ${
              uploading ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            <Upload className="w-4 h-4" />
            {uploading === 'video' ? 'Subiendo…' : 'Subir video'}
            <input
              type="file"
              accept="video/*"
              className="hidden"
              disabled={uploading !== null}
              onChange={(e) => {
                handleUpload('video', e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {form.video_url && (
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, video_url: '' }))}
              className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 hover:border-red-300 hover:text-red-600"
            >
              Quitar video
            </button>
          )}
        </div>
        {fieldErrors.video_url && (
          <p className="text-xs text-red-600">{fieldErrors.video_url}</p>
        )}
        {uploadError?.kind === 'video' && (
          <p className="text-xs text-red-600">{uploadError.message}</p>
        )}

        {form.video_url ? (
          <video
            src={form.video_url}
            controls
            preload="metadata"
            className="w-full max-h-64 rounded-lg bg-slate-900"
            aria-label="Vista previa del video"
          />
        ) : (
          <p className="text-xs text-slate-400">
            Sin video. Sube un archivo o pega una URL: se reproduce en la ficha y
            en la landing compartible, con audio apagado hasta que la persona lo
            active.
          </p>
        )}
      </section>

      {/* ── Contacto ───────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-slate-900">
          Contacto de la publicación
          <span className="block text-xs font-normal text-slate-400 mt-1">
            Si lo dejas vacío, se usan los datos de la corredora. Nunca se
            muestra el teléfono real en la landing compartible.
          </span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelBase} htmlFor="pub-agent-name">
              Nombre
            </label>
            <input
              id="pub-agent-name"
              className={inputBase}
              value={form.agent_name}
              onChange={(e) => set('agent_name')(e.target.value)}
              maxLength={120}
            />
          </div>
          <div>
            <label className={labelBase} htmlFor="pub-agent-email">
              Correo
            </label>
            <input
              id="pub-agent-email"
              type="email"
              className={inputBase}
              value={form.agent_email}
              onChange={(e) => set('agent_email')(e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <label className={labelBase} htmlFor="pub-agent-phone">
              Teléfono
            </label>
            <input
              id="pub-agent-phone"
              className={inputBase}
              value={form.agent_phone}
              onChange={(e) => set('agent_phone')(e.target.value)}
              placeholder="+56 9 1234 5678"
              maxLength={40}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 pb-8">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : initial ? 'Guardar cambios' : 'Publicar propiedad'}
        </button>
      </div>
    </form>
  );
}
