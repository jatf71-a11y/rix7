'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '../auth/AuthProvider';
import { useRegistration } from '../auth/RegistrationProvider';
import { useFavorites } from '../auth/FavoritesProvider';
import { useCurrency } from '../currency/CurrencyProvider';
import { formatNumber } from '@/lib/utils/formatters';
import { LogOut, PlusCircle, Heart, Menu, X, Settings, Info } from 'lucide-react';

/** Prefijos de rutas sin barra de navegación (se lista, no se esconde después). */
const STANDALONE_PATHS = ['/compartir'];

function NavbarContent() {
  const { user, openAuthModal, signOut, isAdmin, isAdminDevBypass } = useAuth();
  // Identidad reconocida: sesión del portal o registro de este dispositivo.
  const { registration, isChecking, forget } = useRegistration();
  // Cuántos favoritos tiene: el contador del corazón se lee del mismo estado que
  // la ficha, así que no puede quedar desfasado.
  const { ids: favoriteIds } = useFavorites();
  const favoriteCount = favoriteIds.length;
  const { rates } = useCurrency();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const searchParams = useSearchParams();
  const currentOp = searchParams.get('operation');
  const isRent = currentOp === 'rent';
  const pathname = usePathname();

  // Páginas que se sirven como piezas sueltas del portal, no como parte de él.
  // `/compartir/[id]` es lo que las corredoras mandan por WhatsApp: quien la
  // recibe no llegó a navegar, así que el menú de secciones, el buscador y los
  // accesos de cuenta sobran y roban alto — pero la marca sí va, para que se
  // sepa de dónde viene el enlace.
  if (pathname && STANDALONE_PATHS.some((p) => pathname.startsWith(p))) {
    return null;
  }


  return (
    <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo Rix7 */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-white border border-slate-200/90 p-1 flex items-center justify-center shadow-md shadow-blue-500/10 group-hover:scale-105 transition-transform">
            <img
              src="/brand-logo.png"
              alt="Logo Rix7"
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <span className="text-2xl font-black tracking-tight text-slate-900">
              Rix<span className="text-blue-600">7</span>
            </span>
          </div>
        </Link>

        {/* Enlaces de Navegación Desktop con Estados Activos */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <Link
            href="/?operation=sale"
            className={`transition-colors font-bold ${
              !isRent ? 'text-blue-600 border-b-2 border-blue-600 pb-0.5' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Comprar
          </Link>
          <Link
            href="/?operation=rent"
            className={`transition-colors font-bold ${
              isRent ? 'text-blue-600 border-b-2 border-blue-600 pb-0.5' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Arrendar
          </Link>
          <Link href="/?operation=sale" className="text-slate-600 hover:text-slate-900 transition-colors">
            Publicar
          </Link>
          {/*
            Apunta a la calculadora de dividendo, que vive al final de una ficha
            **de venta** (`#hipoteca`; en una de arriendo no se renderiza). La
            propiedad tiene que existir en el catálogo: con `scl-premium-vitacura`
            —un id que ya no está— este ítem del menú llevaba a un 404.
          */}
          <Link href="/properties/scl-premium-lo-barnechea#hipoteca" className="text-slate-600 hover:text-slate-900 transition-colors">
            Créditos Hipotecarios
          </Link>
        </nav>

        {/* Selector de Moneda y Acciones de Usuario Desktop */}
        <div className="hidden md:flex items-center gap-3">
          {/* Favoritos: era un corazón que no hacía nada, ahora lleva a la lista.
              Se muestra siempre con cuenta, y sin cuenta solo cuando ya guardó
              alguno en este dispositivo (ahí la lista tiene algo que mostrarle). */}
          {(user || favoriteCount > 0) && (
            <Link
              href="/favoritos"
              className="relative p-2 text-slate-500 hover:text-red-500 hover:bg-slate-50 rounded-full transition-colors"
              title={
                favoriteCount > 0
                  ? `Mis favoritos (${favoriteCount})`
                  : 'Mis favoritos'
              }
            >
              <Heart className={`w-5 h-5 ${favoriteCount > 0 ? 'fill-current text-red-500' : ''}`} />
              {favoriteCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {favoriteCount > 99 ? '99+' : favoriteCount}
                </span>
              )}
            </Link>
          )}

          {user ? (
            <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                  {(registration?.name || user.email || '?').charAt(0).toUpperCase()}
                </div>
                <span
                  className="text-xs font-medium text-slate-700 max-w-[140px] truncate"
                  title={registration?.email || user.email || undefined}
                >
                  {registration?.name || user.email}
                </span>
                <button
                  onClick={() => signOut()}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors"
                  title="Cerrar Sesión"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={() => alert('Publicar propiedad en Rix7')}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Publicar</span>
              </button>
            </div>
          ) : registration ? (
            /* Identificado por el registro de este dispositivo (sin cuenta del
               portal): se lo saluda por su nombre y se le ofrece dar el paso a
               una cuenta, pero no se le ofrecen acciones que requieren sesión
               real (favoritos, publicar). */
            <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center">
                  {registration.name.charAt(0).toUpperCase()}
                </div>
                <span
                  className="text-xs font-medium text-slate-700 max-w-[140px] truncate"
                  title={`${registration.email} · identificado en este dispositivo`}
                >
                  {registration.name}
                </span>
                <button
                  onClick={forget}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors"
                  title="Olvidar este dispositivo"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={() => openAuthModal()}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Entrar</span>
              </button>
            </div>
          ) : isChecking ? (
            /* Verificación en curso: un bloque del mismo alto evita que las
               acciones salten cuando se resuelve la identidad. */
            <div className="h-9 w-44 rounded-lg bg-slate-100 animate-pulse" aria-hidden="true" />
          ) : (
            <div className="pl-2 border-l border-slate-200">
              {/* Una sola puerta de entrada: el enlace mágico registra y entra
                  en la misma acción, así que no hay dos botones que explicar. */}
              <button
                onClick={() => openAuthModal()}
                className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm shadow-blue-500/20 transition-all"
              >
                Entrar
              </button>
            </div>
          )}

          {/* Badge tipo de cambio (Banco Central de Chile) */}
          <div
            className="hidden lg:flex items-center gap-1 pl-3 border-l border-slate-200 text-sm font-semibold text-slate-700 whitespace-nowrap"
            title="Tipos de cambio oficiales del Banco Central de Chile"
          >
            <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span suppressHydrationWarning>
              UF <strong className="text-slate-900">${formatNumber(Math.round(rates.uf))}</strong>
              <span className="text-slate-300 mx-0.5">|</span>
              USD <strong className="text-slate-900">${formatNumber(Math.round(rates.dolar))}</strong>
            </span>
          </div>

          {/* Acceso al Panel Admin — al final de la línea de acciones, solo para administradores */}
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-1.5 pl-3 border-l border-slate-200 text-slate-500 hover:text-blue-600 transition-colors shrink-0"
              title={isAdminDevBypass ? 'Panel Admin (acceso de desarrollo)' : 'Panel Admin'}
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold">Admin</span>
            </Link>
          )}
        </div>

        {/* Botón Menú Móvil */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 text-slate-600 hover:text-slate-900 rounded-lg"
            aria-label="Abrir menú"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Menú Desplegable Móvil */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 space-y-3">
          <nav className="flex flex-col space-y-2 text-sm font-medium text-slate-700">
            <Link
              href="/?operation=sale"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`p-2 rounded-lg font-bold ${
                !isRent ? 'bg-blue-50 text-blue-600' : 'hover:bg-slate-50'
              }`}
            >
              Comprar
            </Link>
            <Link
              href="/?operation=rent"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`p-2 rounded-lg font-bold ${
                isRent ? 'bg-blue-50 text-blue-600' : 'hover:bg-slate-50'
              }`}
            >
              Arrendar
            </Link>
            <Link
              href="/?operation=sale"
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-2 rounded-lg hover:bg-slate-50"
            >
              Publicar
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 rounded-lg hover:bg-slate-50 flex items-center gap-2"
              >
                <Settings className="w-4 h-4 text-slate-400" />
                <span>Panel Admin</span>
              </Link>
            )}
          </nav>

          <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
            {user ? (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 px-2">
                  Sesión: {registration?.name || user.email}
                </div>
                <button
                  onClick={() => signOut()}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm text-red-600 bg-red-50 rounded-lg font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            ) : registration ? (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 px-2">
                  Hola, {registration.name} · identificado en este dispositivo
                </div>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openAuthModal();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm text-white bg-blue-600 rounded-lg font-semibold"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Entrar</span>
                </button>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    forget();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-500 bg-slate-100 rounded-lg font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Olvidar este dispositivo</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  openAuthModal();
                }}
                className="w-full py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg"
              >
                Entrar
              </button>
            )}

            {/* Badge tipo de cambio (Banco Central de Chile) */}
            <div
              className="flex items-center gap-1.5 pt-3 border-t border-slate-100 text-sm font-semibold text-slate-700"
              title="Tipos de cambio oficiales del Banco Central de Chile"
            >
              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span suppressHydrationWarning>
                UF <strong className="text-slate-900">${formatNumber(Math.round(rates.uf))}</strong>
                <span className="text-slate-300 mx-0.5">|</span>
                USD <strong className="text-slate-900">${formatNumber(Math.round(rates.dolar))}</strong>
              </span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export function Navbar() {
  return (
    <Suspense fallback={<div className="h-16 bg-white border-b border-slate-200" />}>
      <NavbarContent />
    </Suspense>
  );
}
