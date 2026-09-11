'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../auth/AuthProvider';
import { useCurrency } from '../currency/CurrencyProvider';
import { formatNumber } from '@/lib/utils/formatters';
import { LogOut, PlusCircle, Heart, Menu, X, Settings, Info } from 'lucide-react';

function NavbarContent() {
  const { user, openAuthModal, signOut, isAdmin, isAdminDevBypass } = useAuth();
  const { rates } = useCurrency();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const searchParams = useSearchParams();
  const currentOp = searchParams.get('operation');
  const isRent = currentOp === 'rent';


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
            <span className="hidden sm:inline-block ml-2 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-blue-50 text-blue-700 rounded-md border border-blue-200">
              Chile GIS
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
          <Link href="/properties/scl-premium-vitacura#hipoteca" className="text-slate-600 hover:text-slate-900 transition-colors">
            Créditos Hipotecarios
          </Link>
        </nav>

        {/* Selector de Moneda y Acciones de Usuario Desktop */}
        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
              <button
                className="p-2 text-slate-500 hover:text-red-500 hover:bg-slate-50 rounded-full transition-colors"
                title="Favoritos"
              >
                <Heart className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                  {user.email?.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs font-medium text-slate-700 max-w-[120px] truncate">
                  {user.email}
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
          ) : (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <button
                onClick={() => openAuthModal('login')}
                className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 transition-colors"
              >
                Iniciar Sesión
              </button>
              <button
                onClick={() => openAuthModal('register')}
                className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm shadow-blue-500/20 transition-all"
              >
                Registrarse
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
                <div className="text-xs text-slate-500 px-2">Sesión: {user.email}</div>
                <button
                  onClick={() => signOut()}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm text-red-600 bg-red-50 rounded-lg font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openAuthModal('login');
                  }}
                  className="py-2 text-sm font-semibold border border-slate-200 rounded-lg text-slate-700"
                >
                  Entrar
                </button>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openAuthModal('register');
                  }}
                  className="py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg"
                >
                  Registro
                </button>
              </div>
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
