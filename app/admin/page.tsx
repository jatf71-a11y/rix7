'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Building2, TrendingUp, ExternalLink } from 'lucide-react';
import { Partner } from '@/lib/data/partners';

export default function AdminDashboard() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  // Métricas reales del catálogo (antes eran números fijos desactualizados)
  const [catalogStats, setCatalogStats] = useState<{ total: number; categories: number } | null>(null);

  useEffect(() => {
    fetch('/api/admin/partners')
      .then((r) => r.json())
      .then((result) => {
        if (result.success) setPartners(result.data);
      })
      .finally(() => setLoading(false));

    fetch('/api/properties?limit=1')
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) return;
        const counts: Record<string, number> = result.categoryCounts || {};
        setCatalogStats({
          total: result.totalCatalog ?? result.total ?? 0,
          categories: Object.values(counts).filter((n) => n > 0).length,
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-slate-900">Panel de Administración</h1>
        <p className="text-sm text-slate-500 mt-1">Gestiona socios estratégicos y propiedades del portal Rix7</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-900">{loading ? '...' : partners.length}</p>
              <p className="text-xs font-medium text-slate-500">Socios Registrados</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-900">
                {catalogStats ? catalogStats.total.toLocaleString('es-CL') : '...'}
              </p>
              <p className="text-xs font-medium text-slate-500">Propiedades Totales</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-900">
                {catalogStats ? catalogStats.categories : '...'}
              </p>
              <p className="text-xs font-medium text-slate-500">Categorías con stock</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Partners Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Socios Estratégicos</h2>
            <Link
              href="/admin/empresas"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              Ver todos →
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {loading ? (
              <div className="p-5 text-center text-sm text-slate-400">Cargando...</div>
            ) : (
              partners.slice(0, 5).map((partner) => (
                <div key={partner.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                  {partner.logo.startsWith('/') || partner.logo.startsWith('http') ? (
                    <img
                      src={partner.logo}
                      alt={partner.name}
                      className="w-8 h-8 rounded-lg object-contain bg-slate-100"
                    />
                  ) : (
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: partner.color }}
                    >
                      {partner.name.charAt(0)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{partner.name}</p>
                    <p className="text-xs text-slate-500 truncate">{partner.description}</p>
                  </div>
                  {partner.website && (
                    <a
                      href={partner.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-blue-600"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Links Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Accesos Rápidos</h2>
          </div>
          <div className="p-5 space-y-3">
            <Link
              href="/admin/empresas"
              className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-blue-200 hover:bg-blue-50 transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                <Users className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Gestionar Empresas</p>
                <p className="text-xs text-slate-500">Agregar, editar o eliminar socios estratégicos</p>
              </div>
            </Link>

            <Link
              href="/admin/empresas?new=1"
              className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-emerald-200 hover:bg-emerald-50 transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                <Building2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Nuevo Socio</p>
                <p className="text-xs text-slate-500">Registrar una nueva empresa corredora</p>
              </div>
            </Link>

            <Link
              href="/"
              className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-slate-200 transition-colors">
                <ExternalLink className="w-4 h-4 text-slate-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Ver Portal Público</p>
                <p className="text-xs text-slate-500">Abrir el portal Rix7 como lo ven los usuarios</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
