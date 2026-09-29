'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  ExternalLink,
  Building2,
  Search,
  AlertCircle,
  CheckCircle,
  Rss,
  Copy,
  RefreshCw,
} from 'lucide-react';
import { Partner } from '@/lib/data/partners';
import { slugify } from '@/lib/utils/text';

const EMPTY_FORM: Omit<Partner, 'id'> = {
  slug: '',
  name: '',
  logo: '',
  description: '',
  website: '',
  color: '#3B82F6',
  contact: { phone: '', whatsapp: '', email: '' },
};

export default function AdminEmpresasPageWrapper() {
  return (
    <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-500">Cargando...</div>}>
      <AdminEmpresasPage />
    </React.Suspense>
  );
}

function AdminEmpresasPage() {
  const searchParams = useSearchParams();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  /**
   * Estado del feed XML por corredora (hallazgo #14). El token en claro solo
   * existe en esta pantalla justo después de activar o regenerar: la API no
   * vuelve a entregarlo jamás (en la base hay un hash).
   */
  const [feedState, setFeedState] = useState<Record<string, { feedEnabled: boolean; hasToken: boolean }>>({});
  const [feedBusy, setFeedBusy] = useState<string | null>(null);
  const [feedTokenShown, setFeedTokenShown] = useState<{ partnerId: string; token: string; feedUrl: string } | null>(null);
  /**
   * De dónde salió el listado y si los cambios se guardarán de verdad. El panel
   * tiene que decirlo: un alta que se pierde al reiniciar el servidor no puede
   * parecer un alta exitosa.
   */
  const [storage, setStorage] = useState<{
    persistent: boolean;
    emptyTable: boolean;
    source: string;
  } | null>(null);

  // Open form if ?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1') setShowForm(true);
  }, [searchParams]);

  const loadPartners = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/partners')
      .then((r) => r.json())
      .then((result) => {
        if (result.success) {
          setPartners(result.data);
          setStorage({
            persistent: result.persistent !== false,
            emptyTable: !!result.emptyTable,
            source: result.source ?? 'catalog',
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  /** Estado del feed de todas las corredoras (sin secretos). */
  const loadFeedStates = useCallback(() => {
    fetch('/api/admin/partners')
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) return;
        // El estado de feed viaja en cada partner (feedEnabled). hasToken lo
        // confirma la ruta de feed solo si hace falta; con feedEnabled=false
        // no hay nada que mostrar.
        const states: Record<string, { feedEnabled: boolean; hasToken: boolean }> = {};
        for (const partner of result.data as Array<Partner & { feedEnabled?: boolean }>) {
          states[partner.id] = { feedEnabled: !!partner.feedEnabled, hasToken: true };
        }
        setFeedState(states);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPartners();
    loadFeedStates();
  }, [loadPartners, loadFeedStates]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const filteredPartners = partners.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.slug.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
  );

  const openNewForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEditForm = (partner: Partner) => {
    setEditingId(partner.id);
    setForm({
      slug: partner.slug,
      name: partner.name,
      logo: partner.logo,
      description: partner.description,
      website: partner.website || '',
      color: partner.color,
      contact: partner.contact || { phone: '', whatsapp: '', email: '' },
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      showToast('error', 'Nombre y slug son obligatorios');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        // Update
        const res = await fetch('/api/admin/partners', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, ...form }),
        });
        const result = await res.json();
        if (result.success) {
          showToast(
            'success',
            result.persisted === false
              ? 'Actualizada solo en memoria (sin Supabase configurado)'
              : 'Empresa actualizada correctamente'
          );
          closeForm();
          loadPartners();
        } else {
          showToast('error', result.error || 'Error al actualizar');
        }
      } else {
        // Create
        const res = await fetch('/api/admin/partners', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const result = await res.json();
        if (result.success) {
          showToast(
            'success',
            result.persisted === false
              ? 'Creada solo en memoria (sin Supabase configurado)'
              : 'Empresa creada correctamente'
          );
          closeForm();
          loadPartners();
        } else {
          showToast('error', result.error || 'Error al crear');
        }
      }
    } catch {
      showToast('error', 'Error de conexión');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
  };

  /** Activa/desactiva el feed (y rota token si se pide). Muestra el token UNA vez. */
  const handleFeed = async (partner: Partner, enabled: boolean, rotate = false) => {
    setFeedBusy(partner.id);
    try {
      const res = await fetch('/api/admin/partners/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: partner.id, enabled, rotate }),
      });
      const result = await res.json();
      if (result.success) {
        setFeedState((prev) => ({
          ...prev,
          [partner.id]: { feedEnabled: !!result.feedEnabled, hasToken: !!result.feedEnabled },
        }));
        if (result.token && result.feedUrl) {
          setFeedTokenShown({ partnerId: partner.id, token: result.token, feedUrl: `${result.feedUrl}?token=${result.token}` });
        } else {
          showToast('success', enabled ? 'Feed activado' : 'Feed desactivado');
        }
        loadFeedStates();
      } else {
        showToast('error', result.error || 'No se pudo cambiar el feed');
      }
    } catch {
      showToast('error', 'Error de conexión');
    } finally {
      setFeedBusy(null);
    }
  };

  const confirmDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/partners?id=${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        showToast(
          'success',
          result.persisted === false
            ? 'Eliminada solo en memoria (sin Supabase configurado)'
            : 'Empresa eliminada'
        );
        loadPartners();
      } else {
        showToast('error', result.error || 'Error al eliminar');
      }
    } catch {
      showToast('error', 'Error de conexión');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-6xl">
      {/* Aviso de almacenamiento: sin Supabase, lo que se guarde acá no dura */}
      {storage && !storage.persistent && (
        <div className="flex items-start gap-2 px-4 py-3 mb-5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Modo de prueba: los cambios no se guardan</p>
            <p className="mt-0.5 text-amber-700">
              No hay un proyecto Supabase configurado, así que las altas y ediciones viven solo
              en memoria y se pierden al reiniciar el servidor. Se listan las corredoras del
              catálogo del código.
            </p>
          </div>
        </div>
      )}

      {storage?.emptyTable && (
        <div className="flex items-start gap-2 px-4 py-3 mb-5 rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">La tabla de corredoras está vacía</p>
            <p className="mt-0.5 text-blue-700">
              Supabase está configurado, pero todavía no tiene las corredoras. Se muestran las del
              catálogo hasta que ejecutes <code className="font-mono">supabase/seed.sql</code>.
            </p>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 right-6 z-50 animate-in slide-in-from-right">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            {toast.message}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Empresas / Socios</h1>
          <p className="text-sm text-slate-500 mt-1">
            {partners.length} empresas registradas en el portal
          </p>
        </div>
        <button
          onClick={openNewForm}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm shadow-blue-500/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Empresa</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar empresa por nombre, slug o descripción..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
        />
      </div>

      {/* Partners Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-slate-100" />
                <div className="flex-1">
                  <div className="h-4 bg-slate-100 rounded w-24 mb-2" />
                  <div className="h-3 bg-slate-50 rounded w-16" />
                </div>
              </div>
              <div className="h-3 bg-slate-50 rounded w-full mb-2" />
              <div className="h-3 bg-slate-50 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : filteredPartners.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">
            {search ? 'No se encontraron empresas con ese criterio' : 'No hay empresas registradas'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPartners.map((partner) => (
            <div
              key={partner.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all group"
            >
              {/* Logo + Name */}
              <div className="flex items-start gap-3 mb-3">
                {partner.logo ? (
                  <img
                    src={partner.logo}
                    alt={partner.name}
                    className="w-12 h-12 rounded-xl object-contain bg-slate-50 border border-slate-100"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-sm"
                    style={{ backgroundColor: partner.color }}
                  >
                    {partner.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 truncate">{partner.name}</h3>
                  <p className="text-xs text-slate-400 font-mono">/{partner.slug}</p>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-slate-600 mb-4 line-clamp-2">{partner.description}</p>

              {/* Feed XML para agregadores (hallazgo #14) */}
              {(() => {
                const feed = feedState[partner.id] ?? { feedEnabled: false, hasToken: false };
                return (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Rss className={`w-3.5 h-3.5 ${feed.feedEnabled ? 'text-emerald-600' : 'text-slate-400'}`} />
                        <span className="text-xs font-semibold text-slate-700">Feed XML</span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            feed.feedEnabled
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {feed.feedEnabled ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                      <button
                        onClick={() => handleFeed(partner, !feed.feedEnabled)}
                        disabled={feedBusy === partner.id}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                      >
                        {feedBusy === partner.id ? '…' : feed.feedEnabled ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                    {feed.feedEnabled && (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => handleFeed(partner, true, true)}
                          disabled={feedBusy === partner.id}
                          className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-amber-600 disabled:opacity-50"
                          title="Genera un token nuevo e invalida el anterior"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Regenerar token
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Color + Website */}
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                  style={{ backgroundColor: partner.color }}
                  title={partner.color}
                />
                {partner.website && (
                  <a
                    href={partner.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {new URL(partner.website).hostname}
                  </a>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                <button
                  onClick={() => openEditForm(partner)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Editar
                </button>

                {deletingId === partner.id ? (
                  <div className="flex items-center gap-1 ml-auto">
                    <button
                      onClick={() => confirmDelete(partner.id)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleDelete(partner.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-auto"
                  >
                    <Trash2 className="w-3 h-3" />
                    Eliminar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de token mostrado UNA vez (hallazgo #14): la base guarda solo
          el hash, así que si se cierra sin copiar hay que regenerar. */}
      {feedTokenShown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setFeedTokenShown(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Feed XML activado</h2>
              <button
                onClick={() => setFeedTokenShown(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  Esta es la <strong>única vez</strong> que se muestra el token: en la base solo
                  queda su hash. Si se pierde, usa «Regenerar token» y se emitirá uno nuevo.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1.5">
                  URL para registrar en el agregador (Trovit/Mitula)
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-800 break-all">
                    {feedTokenShown.feedUrl}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(feedTokenShown.feedUrl);
                      showToast('success', 'URL copiada');
                    }}
                    className="flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copiar
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(feedTokenShown.feedUrl);
                  setFeedTokenShown(null);
                  showToast('success', 'URL copiada');
                }}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Entendido, copié la URL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeForm} />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? 'Editar Empresa' : 'Nueva Empresa'}
              </h2>
              <button
                onClick={closeForm}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Nombre de la Empresa *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      name,
                      slug: prev.slug || slugify(name),
                    }));
                  }}
                  placeholder="Ej: Catedral Bienes Raíces SpA"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Slug */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Slug (URL) *
                </label>
                <div className="flex items-center">
                  <span className="text-xs text-slate-400 mr-1">/empresas/</span>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
                    placeholder="catedral"
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 font-mono placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Logo URL */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  URL del Logo
                </label>
                <input
                  type="text"
                  value={form.logo}
                  onChange={(e) => setForm((prev) => ({ ...prev, logo: e.target.value }))}
                  placeholder="/logos/mi-logo.png o https://..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {form.logo && (
                  <div className="mt-2 flex items-center gap-3">
                    <img
                      src={form.logo}
                      alt="Preview"
                      className="w-10 h-10 rounded-lg object-contain border border-slate-200 bg-slate-50"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="text-[10px] text-slate-400">Vista previa</span>
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Descripción
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Breve descripción de la empresa..."
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>

              {/* Website */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Sitio Web
                </label>
                <input
                  type="url"
                  value={form.website}
                  onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
                  placeholder="https://www.ejemplo.cl"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Datos de contacto: son los que habilitan los botones
                  Llamar / WhatsApp / Mail en la ficha de la propiedad. */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-700">
                  Datos de contacto
                  <span className="ml-2 font-normal text-[10px] text-slate-400">
                    Habilitan Llamar / WhatsApp / Mail en la ficha
                  </span>
                </p>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Teléfono de la corredora
                  </label>
                  <input
                    type="tel"
                    value={form.contact.phone}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, contact: { ...prev.contact, phone: e.target.value } }))
                    }
                    placeholder="+56 2 2000 0000"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    WhatsApp (móvil)
                  </label>
                  <input
                    type="tel"
                    value={form.contact.whatsapp}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, contact: { ...prev.contact, whatsapp: e.target.value } }))
                    }
                    placeholder="+56 9 0000 0000"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    Debe ser un móvil: WhatsApp no funciona con números fijos.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Correo de contacto
                  </label>
                  <input
                    type="email"
                    value={form.contact.email}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, contact: { ...prev.contact, email: e.target.value } }))
                    }
                    placeholder="contacto@corredora.cl"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Color de Marca
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))}
                    className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={form.color}
                    onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))}
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <button
                onClick={closeForm}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-lg shadow-sm shadow-blue-500/20 transition-all"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Crear Empresa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
