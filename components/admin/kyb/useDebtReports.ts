'use client';

import { useCallback, useEffect, useState } from 'react';

import type { DebtReportView } from '@/lib/kyb/documents';

export interface DebtReportsState {
  /** `null` mientras carga; `[]` cuando el dueño no tiene informes. */
  documents: DebtReportView[] | null;
  error: string | null;
}

/**
 * Informes de deudas de una ficha, cargados una sola vez.
 *
 * La ficha los usa en dos lugares —el resumen junto al puntaje y el detalle al
 * final—, así que el fetch vive acá y no en cada componente: dos pedidos en
 * paralelo generarían dos juegos de URLs firmadas para los mismos PDF.
 */
export function useDebtReports(
  ownerKind: 'alta' | 'solicitud',
  ownerId: string
): DebtReportsState {
  const [state, setState] = useState<DebtReportsState>({ documents: null, error: null });

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ owner_kind: ownerKind, owner_id: ownerId });
      const response = await fetch(`/api/admin/kyb/documents?${query.toString()}`);
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setState({
          documents: [],
          error: body?.error ?? 'No se pudo leer el informe de deudas.',
        });
        return;
      }
      setState({
        documents: Array.isArray(body.data?.documents) ? body.data.documents : [],
        error: null,
      });
    } catch {
      setState({ documents: [], error: 'Sin conexión con el servidor.' });
    }
  }, [ownerKind, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  return state;
}
