/**
 * Informes de deudas de la CMF: subida, lectura y consulta.
 *
 * Es la mitad con red de `lib/kyb/debtReport.ts`. Tres reglas que no se
 * negocian:
 *
 * 1. **El enlace identifica al dueño.** El token del correo se hashea y se busca
 *    en la alta o en el registro de socio; el informe se guarda contra ese id.
 *    Nunca se acepta un id de dueño que venga del navegador.
 * 2. **El bucket es privado.** Son datos financieros: la descarga es una URL
 *    firmada de una hora, que se genera acá con `service_role`.
 * 3. **Se lee al subir.** El PDF se convierte a texto y se guarda el resultado
 *    con el archivo, para que la ficha muestre el total adeudado sin que nadie
 *    tenga que abrir el PDF.
 *
 * Sin `SUPABASE_SERVICE_ROLE_KEY` cae a una copia en memoria del proceso, igual
 * que el resto del flujo KYB: sirve para recorrer el trámite en desarrollo y
 * dice que no persistió en vez de fingir que guardó el archivo.
 */

import { findSolicitudByAnswerToken } from '@/lib/data/solicitudesStore';
import { SOLICITUD_REVIEW_KEYS } from '@/lib/data/solicitudEvaluation';
import { isServiceRoleConfigured } from '@/lib/supabase/admin';
import { normalizeRut } from '@/lib/utils/rut';
import {
  DEBT_REPORTS_BUCKET,
  analyzeDebtReportText,
  debtReportKindFor,
  debtReportPath,
  validateDebtReportFile,
  type DebtReportAnalysis,
  type DebtReportKind,
} from './debtReport';
import { findByTokenHash } from './store';
import { hashKybToken, isKybTokenShape } from './tokens';

export type DebtReportOwner = 'alta' | 'solicitud';

export interface DebtReportRecord {
  id: string;
  ownerKind: DebtReportOwner;
  ownerId: string;
  kind: DebtReportKind;
  fileName: string;
  sizeBytes: number;
  status: 'analyzed' | 'unreadable';
  analysis: DebtReportAnalysis;
  createdAt: string;
}

export interface DebtReportView extends DebtReportRecord {
  /** URL firmada para ver el PDF; `null` si no hay Storage configurado. */
  url: string | null;
}

export type SaveDebtReportResult =
  | { ok: true; document: DebtReportRecord }
  | { ok: false; status: number; error: string };

interface MemoryDocs {
  documents: DebtReportRecord[];
}

const memory = globalThis as typeof globalThis & { __rix7DebtReports?: MemoryDocs };

function memoryStore(): MemoryDocs {
  memory.__rix7DebtReports ??= { documents: [] };
  return memory.__rix7DebtReports;
}

async function serviceClient() {
  const { createServiceRoleClient } = await import('@/lib/supabase/admin');
  return createServiceRoleClient();
}

/**
 * A quién pertenece el token: la alta o el registro de socio.
 *
 * Los dos flujos comparten la etapa `Pendiente_Informacion` y cada uno guarda el
 * token a su manera. Se prueba primero la alta (tabla `kyb_applications`) y
 * después el registro (`solicitudes.payload`). El token tiene que ser de
 * respuestas y estar vigente: un enlace de propuesta o de plan no adjunta
 * documentos.
 */
async function ownerFromToken(
  token: string
): Promise<
  | {
      ok: true;
      ownerKind: DebtReportOwner;
      ownerId: string;
      kind: DebtReportKind;
      /** RUT del titular, para comprobar que el informe es suyo. */
      rut: string | null;
    }
  | { ok: false; status: number; error: string }
> {
  if (!isKybTokenShape(token)) {
    return { ok: false, status: 403, error: 'El enlace no es válido.' };
  }

  const hash = hashKybToken(token);

  const alta = await findByTokenHash(hash);
  if (alta.ok && alta.data) {
    const application = alta.data;
    if (application.status !== 'Pendiente_Informacion') {
      return { ok: false, status: 409, error: 'La solicitud ya no está esperando información.' };
    }
    if (application.tokenPurpose !== 'answers') {
      return { ok: false, status: 403, error: 'Este enlace no sirve para adjuntar el informe.' };
    }
    if (!application.tokenExpiresAt || Date.parse(application.tokenExpiresAt) <= Date.now()) {
      return { ok: false, status: 403, error: 'El enlace venció. Pide uno nuevo por correo.' };
    }
    return {
      ok: true,
      ownerKind: 'alta',
      ownerId: application.id,
      kind: debtReportKindFor(application.registrationKind),
      rut: application.rut,
    };
  }

  const solicitud = await findSolicitudByAnswerToken(hash);
  if (solicitud) {
    if (solicitud.status !== 'Pendiente_Informacion') {
      return { ok: false, status: 409, error: 'El registro ya no está esperando información.' };
    }
    const expiresAt = solicitud.payload[SOLICITUD_REVIEW_KEYS.tokenExpiresAt];
    if (typeof expiresAt === 'string' && Date.parse(expiresAt) < Date.now()) {
      return { ok: false, status: 403, error: 'El enlace venció. Pide uno nuevo por correo.' };
    }
    return {
      ok: true,
      ownerKind: 'solicitud',
      ownerId: solicitud.id,
      kind: debtReportKindFor(solicitud.kind),
      rut: typeof solicitud.payload.rut === 'string' ? solicitud.payload.rut : null,
    };
  }

  return { ok: false, status: 403, error: 'El enlace no es válido o ya expiró.' };
}

/** Texto del PDF. Un PDF escaneado no lanza: devuelve vacío y se avisa. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText } = await import('unpdf');
    const result = await extractText(bytes, { mergePages: true });
    return Array.isArray(result.text) ? result.text.join('\n') : result.text;
  } catch {
    return '';
  }
}

/**
 * Guarda el informe del enlace y lo lee.
 *
 * Devuelve el documento con su análisis. El estado `unreadable` no es un error
 * del trámite: el archivo quedó guardado y el equipo puede abrirlo; lo que no se
 * pudo fue extraer los montos.
 */
export async function saveDebtReport({
  token,
  file,
}: {
  token: unknown;
  file: unknown;
}): Promise<SaveDebtReportResult> {
  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, status: 403, error: 'El enlace no es válido.' };
  }

  const owner = await ownerFromToken(token);
  if (!owner.ok) return owner;

  if (!(file instanceof File)) {
    return { ok: false, status: 400, error: 'Falta el archivo del informe.' };
  }

  const valid = validateDebtReportFile({ name: file.name, type: file.type, size: file.size });
  if (!valid.ok) return { ok: false, status: 400, error: valid.error };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const analysis = analyzeDebtReportText(await pdfText(bytes));

  // El informe tiene que ser del titular: si el RUT del PDF no es el de la
  // solicitud, el documento no acredita nada y no se guarda. Sin texto legible
  // tampoco hay cómo comprobarlo, y aceptarlo sería justamente lo que permite
  // subir cualquier archivo.
  if (!analysis.read) {
    return {
      ok: false,
      status: 400,
      error:
        'El PDF no tiene texto legible (parece una foto o un escaneo). Sube el original que descargaste del portal de la CMF.',
    };
  }

  const expectedRut = owner.rut ? normalizeRut(owner.rut) : null;
  const reportedRut = analysis.rut ? normalizeRut(analysis.rut) : null;

  if (!reportedRut) {
    return {
      ok: false,
      status: 400,
      error:
        'No pudimos leer el RUT del informe. Sube el PDF original de la CMF, completo y sin recortes.',
    };
  }

  if (expectedRut && reportedRut !== expectedRut) {
    return {
      ok: false,
      status: 400,
      error: `El informe está a nombre del RUT ${reportedRut}, no del RUT ${expectedRut} de esta solicitud. Sube el informe del titular.`,
    };
  }

  const record: DebtReportRecord = {
    id: crypto.randomUUID(),
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    kind: owner.kind,
    fileName: file.name.slice(0, 180) || 'informe.pdf',
    sizeBytes: file.size,
    status: analysis.read ? 'analyzed' : 'unreadable',
    analysis,
    createdAt: new Date().toISOString(),
  };

  if (!isServiceRoleConfigured()) {
    memoryStore().documents.unshift(record);
    return { ok: true, document: record };
  }

  const supabase = await serviceClient();
  const path = debtReportPath(owner.ownerKind, owner.ownerId, record.id);

  const { error: uploadError } = await supabase.storage
    .from(DEBT_REPORTS_BUCKET)
    .upload(path, bytes, { contentType: 'application/pdf', upsert: false, cacheControl: '0' });

  if (uploadError) {
    return { ok: false, status: 500, error: `No se pudo guardar el informe: ${uploadError.message}` };
  }

  const { error } = await supabase.from('kyb_documents').insert({
    id: record.id,
    owner_kind: record.ownerKind,
    owner_id: record.ownerId,
    kind: record.kind,
    file_name: record.fileName,
    storage_path: path,
    content_type: 'application/pdf',
    size_bytes: record.sizeBytes,
    status: record.status,
    analysis: record.analysis,
    created_at: record.createdAt,
  });

  if (error) {
    // El archivo sin fila no lo puede ver nadie: se borra para no dejar basura
    // con datos financieros en el bucket.
    await supabase.storage.from(DEBT_REPORTS_BUCKET).remove([path]);
    return { ok: false, status: 500, error: `No se pudo registrar el informe: ${error.message}` };
  }

  return { ok: true, document: record };
}

interface DebtReportRow {
  id: string;
  owner_kind: string;
  owner_id: string;
  kind: string;
  file_name: string;
  storage_path: string;
  size_bytes: number;
  status: string;
  analysis: DebtReportAnalysis | null;
  created_at: string;
}

function rowToRecord(row: DebtReportRow): DebtReportRecord {
  return {
    id: row.id,
    ownerKind: row.owner_kind === 'solicitud' ? 'solicitud' : 'alta',
    ownerId: row.owner_id,
    kind: row.kind === 'juridica' ? 'juridica' : 'natural',
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    status: row.status === 'analyzed' ? 'analyzed' : 'unreadable',
    analysis:
      row.analysis ?? {
        read: false,
        issuedAt: null,
        rut: null,
        debtor: null,
        totalDebtClp: null,
        creditors: null,
        currentClp: null,
        overdueClp: null,
        writtenOffClp: null,
        summary: 'Sin análisis guardado.',
        notes: [],
      },
    createdAt: row.created_at,
  };
}

/** Informes de un dueño, del más nuevo al más viejo, con URL firmada. */
export async function listDebtReports(
  ownerKind: DebtReportOwner,
  ownerId: string
): Promise<DebtReportView[]> {
  if (!isServiceRoleConfigured()) {
    return memoryStore()
      .documents.filter(
        (document) => document.ownerKind === ownerKind && document.ownerId === ownerId
      )
      .map((document) => ({ ...document, url: null }));
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_documents')
      .select(
        'id, owner_kind, owner_id, kind, file_name, storage_path, size_bytes, status, analysis, created_at'
      )
      .eq('owner_kind', ownerKind)
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error || !data) return [];

    const rows = data as unknown as (DebtReportRow & { storage_path: string })[];
    const views: DebtReportView[] = [];

    for (const row of rows) {
      const { data: signed } = await supabase.storage
        .from(DEBT_REPORTS_BUCKET)
        .createSignedUrl(row.storage_path, 60 * 60);
      views.push({ ...rowToRecord(row), url: signed?.signedUrl ?? null });
    }

    return views;
  } catch {
    return [];
  }
}

/**
 * Análisis guardado de un informe, para incorporarlo a la evaluación.
 *
 * Se busca por id **y por dueño**: el id viaja como respuesta de la ronda, y
 * sin el filtro del dueño una respuesta armada a mano podría hacer que la
 * evaluación lea el informe de otra empresa.
 */
export async function findDebtReportAnalysis(
  ownerKind: DebtReportOwner,
  ownerId: string,
  documentId: string
): Promise<DebtReportAnalysis | null> {
  if (!documentId.trim()) return null;

  if (!isServiceRoleConfigured()) {
    const found = memoryStore().documents.find(
      (document) =>
        document.id === documentId &&
        document.ownerKind === ownerKind &&
        document.ownerId === ownerId
    );
    return found?.analysis ?? null;
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_documents')
      .select('analysis')
      .eq('id', documentId)
      .eq('owner_kind', ownerKind)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error || !data) return null;
    return (data as { analysis: DebtReportAnalysis | null }).analysis ?? null;
  } catch {
    return null;
  }
}

/**
 * El último informe analizado del dueño.
 *
 * Sirve para **reevaluar** desde el panel sin la ronda de respuestas: el id del
 * documento solo viaja en la respuesta, y sin este respaldo la re-evaluación
 * perdería el análisis y el puntaje de deuda. Si no hay ninguno, no hay nada
 * que evaluar y el motor sigue con las verificaciones que tenga.
 */
export async function findLatestDebtReportAnalysis(
  ownerKind: DebtReportOwner,
  ownerId: string
): Promise<DebtReportAnalysis | null> {
  if (!isServiceRoleConfigured()) {
    const found = memoryStore()
      .documents.filter(
        (document) => document.ownerKind === ownerKind && document.ownerId === ownerId
      )
      .at(-1);
    return found?.analysis ?? null;
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_documents')
      .select('analysis')
      .eq('owner_kind', ownerKind)
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return (data as { analysis: DebtReportAnalysis | null }).analysis ?? null;
  } catch {
    return null;
  }
}

/**
 * ¿El id de esta respuesta es un informe subido por este dueño?
 *
 * Es lo que impide que una ronda se cierre escribiendo cualquier cosa en la
 * pregunta del documento: la respuesta tiene que apuntar a un PDF que existe y
 * que se subió con el token de **esta** solicitud.
 */
export async function isDebtReportFromOwner(
  ownerKind: DebtReportOwner,
  ownerId: string,
  documentId: string
): Promise<boolean> {
  if (!documentId.trim()) return false;

  if (!isServiceRoleConfigured()) {
    return memoryStore().documents.some(
      (document) =>
        document.id === documentId &&
        document.ownerKind === ownerKind &&
        document.ownerId === ownerId
    );
  }

  try {
    const supabase = await serviceClient();
    const { data, error } = await supabase
      .from('kyb_documents')
      .select('id')
      .eq('id', documentId)
      .eq('owner_kind', ownerKind)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}
