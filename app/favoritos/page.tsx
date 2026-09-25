import type { Metadata } from 'next';
import { Heart } from 'lucide-react';
import { listFavoriteIds } from '@/lib/data/favoritesStore';
import { listCandidateProperties } from '@/lib/data/propertySource';
import { currentUserId } from '@/lib/supabase/currentUser';
import { PropertyGrid } from '@/components/properties/PropertyGrid';
import { SignInPrompt } from '@/components/auth/SignInPrompt';

/**
 * `/favoritos` — las propiedades que la persona guardó.
 *
 * Se renderiza en el servidor: el id de la sesión y la lista vienen de la base
 * antes de mandar el HTML, así no hay parpadeo ni una segunda vuelta al abrir.
 *
 * Solo hay favoritos de la cuenta: los del dispositivo no se pueden listar acá
 * (viven en el navegador), así que sin sesión se explica dónde están y se ofrece
 * entrar, que es lo que los hace viajar.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mis favoritos | Rix7',
  description: 'Las propiedades que guardaste en tu cuenta de Rix7.',
  robots: { index: false, follow: false },
};

export default async function FavoritesPage() {
  const userId = await currentUserId();

  if (!userId) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-red-50 text-red-500 mb-4">
            <Heart className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-black text-slate-900">Tus favoritos, en tu cuenta</h1>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            Los que guardaste en este navegador siguen ahí, en la ficha de cada propiedad. Entra
            con tu correo y los pasamos a tu cuenta: así los ves también desde el celular.
          </p>
          <SignInPrompt reason="Entra con tu correo para ver tus favoritos y tenerlos en todos tus dispositivos." />
        </div>
      </div>
    );
  }

  const ids = await listFavoriteIds(userId);

  if (ids.length === 0) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-slate-100 text-slate-400 mb-4">
            <Heart className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-black text-slate-900">Todavía no guardaste ninguna</h1>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            En la ficha de cualquier propiedad, el corazón de la barra superior la guarda acá.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 mt-5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Explorar propiedades
          </a>
        </div>
      </div>
    );
  }

  // Se resuelven contra la misma fuente que el buscador: una propiedad que ya no
  // está publicada simplemente no aparece, en vez de dejar un hueco.
  const { properties } = await listCandidateProperties();
  const byId = new Map(properties.map((property) => [property.id, property]));
  const favorites = ids.map((id) => byId.get(id)).filter((property) => property !== undefined);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-baseline gap-2 mb-4">
        <h1 className="text-xl font-black text-slate-900">Mis favoritos</h1>
        <span className="text-xs font-semibold text-slate-500">
          {favorites.length} {favorites.length === 1 ? 'propiedad' : 'propiedades'}
        </span>
      </div>

      {favorites.length === 0 ? (
        <p className="text-sm text-slate-500">
          Las propiedades que guardaste ya no están publicadas. Podés quitarlas desde el corazón de
          cada ficha.
        </p>
      ) : (
        <PropertyGrid properties={favorites} />
      )}
    </div>
  );
}
