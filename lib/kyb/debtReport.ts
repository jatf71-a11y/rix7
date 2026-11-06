/**
 * Informe de deudas de la CMF: qué se pide y cómo se lee.
 *
 * En la etapa **Pendiente de información** no alcanza con preguntar: hay que
 * pedir el documento que respalda lo que se declara. El informe de deudas de la
 * CMF es el que dice si el postulante —persona o empresa— debe plata, cuánta y
 * a cuántos acreedores, y es la pieza que el equipo mira antes de aprobar.
 *
 * Qué documento corresponde no es una preferencia: una **persona natural** no
 * tiene informe de personas jurídicas, y una **empresa** no aparece en el de
 * personas naturales. Por eso el perfil del registro decide el documento, y el
 * texto de la pregunta lo nombra tal como lo emite la CMF:
 *
 * - Profesional independiente (sin empresa) → «Informe de Deudas de Personas
 *   Naturales».
 * - Corredora e inmobiliaria → «Informe de Deudas de Personas Jurídicas».
 *
 * El módulo es puro a propósito: la validación del archivo y la lectura del
 * texto se prueban sin red, sin Storage y sin base. La subida vive en
 * `lib/kyb/documents.ts`, que sí habla con Supabase.
 */

import type { KybQuestion } from './status';

/** Id estable de la pregunta del informe: la respuesta guarda el id del PDF. */
export const DEBT_REPORT_QUESTION_ID = 'debt_report';

export type DebtReportKind = 'natural' | 'juridica';

export interface DebtReportDocument {
  kind: DebtReportKind;
  /** Nombre exacto del documento que emite la CMF. */
  title: string;
  issuer: string;
  /** Para quién es, en una frase: se muestra en el formulario y el correo. */
  reason: string;
}

export const DEBT_REPORTS: Record<DebtReportKind, DebtReportDocument> = {
  natural: {
    kind: 'natural',
    title: 'Informe de Deudas de Personas Naturales',
    issuer: 'CMF',
    reason: 'Es el informe de deudas de la CMF de la persona que opera el perfil.',
  },
  juridica: {
    kind: 'juridica',
    title: 'Informe de Deudas de Personas Jurídicas',
    issuer: 'CMF',
    reason: 'Es el informe de deudas de la CMF de la empresa.',
  },
};

/**
 * Qué informe corresponde según el perfil del registro.
 *
 * Solo corredora e inmobiliaria son personas jurídicas en este flujo. Un
 * profesional independiente —y cualquier registro que no declare perfil— va por
 * el informe de personas naturales: pedirle el de una empresa que no tiene
 * dejaría el trámite detenido sin que pueda cumplirlo.
 */
export function debtReportKindFor(registrationKind: unknown): DebtReportKind {
  return registrationKind === 'corredora' || registrationKind === 'inmobiliaria'
    ? 'juridica'
    : 'natural';
}

export function debtReportTitle(kind: DebtReportKind): string {
  return DEBT_REPORTS[kind].title;
}

/** La pregunta que viaja en la ronda, el correo y el formulario. */
export function debtReportQuestion(kind: DebtReportKind): KybQuestion {
  const document = DEBT_REPORTS[kind];
  return {
    id: DEBT_REPORT_QUESTION_ID,
    kind: 'document',
    question:
      `Adjunta el «${document.title}» de la ${document.issuer} en PDF. ` +
      `Se descarga en el portal de la ${document.issuer} (Informe de Deudas) con tu ClaveÚnica; ` +
      'sube el más reciente, sin recortes ni capturas de pantalla.',
  };
}

/**
 * Agrega el informe a una ronda de preguntas.
 *
 * Es idempotente: si la ronda ya lo trae —por ejemplo, porque el motor la armó y
 * el equipo volvió a pedir información— no se duplica. Devolver una copia y no
 * mutar el arreglo deja al motor con su evaluación original intacta.
 */
export function withDebtReport(
  questions: readonly KybQuestion[],
  kind: DebtReportKind
): KybQuestion[] {
  if (questions.some((question) => question.id === DEBT_REPORT_QUESTION_ID)) {
    return [...questions];
  }
  // `SolicitudQuestion` tiene la misma forma que `KybQuestion`, así que el
  // resultado se puede usar en los dos caminos sin duplicar el tipo.
  return [...questions, debtReportQuestion(kind)];
}

/** ¿La pregunta es la del informe (y por lo tanto espera un PDF)? */
export function isDebtReportQuestion(question: { id: string; kind?: string }): boolean {
  return question.id === DEBT_REPORT_QUESTION_ID || question.kind === 'document';
}

/** Tope del PDF. Un informe de la CMF pesa cientos de KB; 10 MB es holgado. */
export const DEBT_REPORT_MAX_BYTES = 10 * 1024 * 1024;

export function validateDebtReportFile(file: {
  name?: unknown;
  type?: unknown;
  size?: unknown;
}): { ok: true } | { ok: false; error: string } {
  const name = typeof file.name === 'string' ? file.name : '';
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  const size = typeof file.size === 'number' ? file.size : 0;

  const isPdf = type === 'application/pdf' || /\.pdf$/i.test(name);
  if (!isPdf) return { ok: false, error: 'El informe tiene que ser un PDF.' };
  if (size <= 0) return { ok: false, error: 'El archivo está vacío.' };
  if (size > DEBT_REPORT_MAX_BYTES) {
    return { ok: false, error: 'El PDF no puede superar los 10 MB.' };
  }
  return { ok: true };
}

/** Bucket **privado**: son datos financieros, no se sirven por URL pública. */
export const DEBT_REPORTS_BUCKET = 'kyb-documents';

/**
 * Ruta del archivo en el bucket.
 *
 * El primer segmento es el tipo de dueño (`alta` o `solicitud`) y el segundo su
 * id: así el informe de una empresa no se puede pedir con el id de otra. El
 * nombre original no se usa —puede traer `../` o datos personales—, y el id
 * generado evita que dos subidas se pisen.
 */
export function debtReportPath(
  ownerKind: 'alta' | 'solicitud',
  ownerId: string,
  documentId: string
): string {
  // Sin puntos: un `..` en el id no puede volver a subir dentro del bucket.
  const safeOwner = ownerId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'sin-id';
  const safeId = documentId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'documento';
  return `${ownerKind}/${safeOwner}/${safeId}.pdf`;
}

/** Lo que se guarda como resultado de leer el informe. */
export interface DebtReportAnalysis {
  /** `false` cuando el PDF no tiene capa de texto (escaneado o foto). */
  read: boolean;
  /**
   * Fecha de emisión del informe, en `YYYY-MM-DD`, si el PDF la trae.
   *
   * Es lo que dice si el documento sirve para decidir: la CMF actualiza los datos
   * semanalmente, así que un informe de hace dos meses no describe la deuda de
   * hoy aunque se haya subido ayer.
   */
  issuedAt: string | null;
  rut: string | null;
  debtor: string | null;
  totalDebtClp: number | null;
  creditors: number | null;
  currentClp: number | null;
  overdueClp: number | null;
  writtenOffClp: number | null;
  /** Frase lista para mostrar en la ficha y en el correo. */
  summary: string;
  notes: string[];
}

function parseClp(raw: string | undefined): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** Primer monto de la línea: prioriza el que trae `$`. */
function firstAmount(line: string): number | null {
  const currency = line.match(/\$\s*([\d]{1,3}(?:[.,]\d{3})*|\d+)/);
  if (currency) return parseClp(currency[1]);

  const grouped = line.match(/([\d]{1,3}(?:\.[\d]{3})+)/);
  return grouped ? parseClp(grouped[1]) : null;
}

/** Busca un monto en las líneas que cumplen el patrón y no caen en la exclusión. */
function amountFor(lines: readonly string[], pattern: RegExp, exclude?: RegExp): number | null {
  for (const line of lines) {
    if (!pattern.test(line)) continue;
    if (exclude && exclude.test(line)) continue;
    const amount = firstAmount(line);
    if (amount !== null) return amount;
  }
  return null;
}

function lineFor(lines: readonly string[], pattern: RegExp): string | null {
  const found = lines.find((line) => pattern.test(line));
  return found ?? null;
}

function clp(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}

const NOT_A_REPORT = 'El PDF no tiene texto legible: parece una captura o un escaneo.';

/**
 * Cuánto vale un informe para decidir.
 *
 * La CMF actualiza los datos semanalmente (con un desfase de entre 10 y 20
 * días), así que a los 30 días el documento ya puede describir una deuda que no
 * es la de hoy. El aviso no invalida el informe: pide uno actualizado.
 */
export const DEBT_REPORT_MAX_AGE_DAYS = 30;

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function isoDate(day: number, month: number, year: number): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Busca una fecha `dd/mm/aaaa` o `dd-mm-aaaa` en el fragmento. */
function numericDate(fragment: string): string | null {
  const match = fragment.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return null;
  return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Busca una fecha larga («21 de febrero de 2022»). */
function longDate(fragment: string): string | null {
  const match = fragment.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
  if (month === 0) return null;
  return isoDate(Number(match[1]), month, Number(match[3]));
}

/**
 * Fecha de emisión del informe.
 *
 * Los dos modelos la escriben distinto: el actual, «INFORME EMITIDO EL
 * 06/11/2026»; el anterior, «Fecha de emisión: Santiago, lunes 21 de febrero de
 * 2022 (20:16)». Se toma la de emisión y **no** la de actualización de datos: la
 * segunda puede ser más antigua y no es la que dice cuándo se generó el PDF.
 */
export function parseDebtReportIssuedAt(text: string): string | null {
  const source = text ?? '';

  const emitted = source.match(/informe\s+emitido\s+el\s+([^\n]{0,40})/i);
  if (emitted) {
    const date = numericDate(emitted[1]) ?? longDate(emitted[1]);
    if (date) return date;
  }

  const labelled = source.match(/fecha\s+de\s+emisi[oó]n[^\n]{0,80}/i);
  if (labelled) {
    const date = numericDate(labelled[0]) ?? longDate(labelled[0]);
    if (date) return date;
  }

  return null;
}

/**
 * Días desde la emisión del informe, o `null` si no hay fecha legible.
 *
 * Una fecha futura devuelve `null`: es un reloj raro o un documento mal leído, y
 * avisar «tiene -3 días» sería peor que no avisar.
 */
export function debtReportAgeDays(
  issuedAt: string | null,
  now: Date = new Date()
): number | null {
  if (!issuedAt) return null;
  const issued = Date.parse(`${issuedAt}T00:00:00Z`);
  if (!Number.isFinite(issued)) return null;

  const days = Math.floor((now.getTime() - issued) / 86_400_000);
  return days >= 0 ? days : null;
}

/** ¿El informe ya es viejo para decidir con él? Sin fecha no se avisa. */
export function isDebtReportOutdated(
  issuedAt: string | null,
  now: Date = new Date()
): boolean {
  const days = debtReportAgeDays(issuedAt, now);
  return days !== null && days > DEBT_REPORT_MAX_AGE_DAYS;
}

/**
 * Secciones de deuda del informe de la CMF.
 *
 * El documento no trae un total único: trae una tabla por tipo de deuda
 * (directa, indirecta, castigada) y, dentro de cada una, una fila «Totales».
 * Leerlo bien es leer esa fila, no buscar la palabra «total» en cualquier lado.
 */
type DebtSection = 'directa' | 'indirecta' | 'castigada';

interface DebtSectionSummary {
  /** Primera columna de la fila de totales: la deuda vigente. */
  vigente: number | null;
  /** Última columna: el total de la sección. */
  total: number | null;
  /** Filas de instituciones con monto, que son los acreedores. */
  creditors: number;
}

/** Minúsculas y sin acentos: los rótulos de la CMF llegan de las dos formas. */
function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Todos los montos de una línea, en el orden en que aparecen. */
function amountsIn(line: string): number[] {
  const matches = line.match(/\$\s*\d[\d.,]*|\b\d{1,3}(?:\.\d{3})+\b|\b\d{6,}\b/g) ?? [];
  return matches.map((raw) => parseClp(raw)).filter((value): value is number => value !== null);
}

/**
 * Qué sección abre una línea, si abre alguna.
 *
 * Castigadas exige título de sección («N. … Deudas Castigadas» o
 * «Información de Deudas Castigadas»): en los modelos resumidos la frase
 * «Deudas castigadas» es un rótulo del dato, no una tabla, y tomarla como
 * sección dejaría el total del informe en cero.
 */
function sectionOfLine(normalized: string): DebtSection | null {
  if (/informacion de deuda directa/.test(normalized)) return 'directa';
  if (/informacion de deuda indirecta/.test(normalized)) return 'indirecta';
  if (
    /deudas? castigadas?/.test(normalized) &&
    (/^\d+[a-z]?\.\s/.test(normalized) || /informacion de/.test(normalized))
  ) {
    return 'castigada';
  }
  return null;
}

interface CmfReportSummary {
  total: number | null;
  current: number | null;
  overdue: number | null;
  creditors: number | null;
}

/**
 * El informe que la CMF emite hoy («Conoce tu deuda», Ley 21.680) no usa tablas
 * numeradas como el anterior. Trae:
 *
 * - una línea «Deuda total y estado de pago $X», que es el total de verdad;
 * - una tabla por sección con las columnas «Total del crédito | Vigente | 30 a
 *   59 días de atraso | 60 a 89 días de atraso | 90 o más días de atraso»;
 * - una fila «Total» al pie de cada tabla, con esas mismas cinco columnas.
 *
 * La primera columna **no** es deuda pendiente: es el monto otorgado de los
 * créditos. Y la última no es un total: es el tramo de mora de 90 días o más. Por
 * eso la fila se lee por posición y no por «el primer y el último número».
 *
 * El texto se recorre entero, no línea por línea: el extractor del PDF junta el
 * encabezado de la tabla con la primera fila, así que depender de los saltos de
 * línea dejaría el informe sin leer justo en el modelo que está en producción.
 */
function readCmfReport(text: string): CmfReportSummary | null {
  const totalMatch = text.match(
    /deuda total(?: y estado de pago)?\s*:?\s*\$\s*([\d.,]+)/i
  );
  const totalFromLabel = totalMatch ? parseClp(totalMatch[1]) : null;

  // Filas «Total» con las cinco columnas de la tabla de deuda. `Array.from` y no
  // `for…of`: el `target` del proyecto es es5 y un iterador de `matchAll` no
  // compila sin `downlevelIteration`.
  const totalRows: number[][] = [];
  for (const match of Array.from(
    // `totals?` y no `totales?`: lo segundo sería «totale» + «s» y no
    // encontraría la fila «Total» del informe.
    text.matchAll(/\btotals?\b((?:\s*\$\s*[\d.,]+){3,})/gi)
  )) {
    // Se toman las cinco primeras columnas y no todas las que sigan: después de
    // la última fila de totales el PDF pone la leyenda de tramos ($vigente
    // $30-59 $60-89 $90+), que está separada solo por espacios y si no se
    // cortaría terminaría mezclada con la fila.
    const amounts = amountsIn(match[1]).slice(0, 5);
    if (amounts.length === 5) totalRows.push(amounts);
  }

  if (totalFromLabel === null && totalRows.length === 0) return null;

  // Cada fila de institución trae cinco montos seguidos; las de total también.
  // La diferencia entre unas y otras es la cantidad de acreedores.
  const amountRuns = Array.from(text.matchAll(/(?:\$\s*[\d.,]+\s*){5}/g));
  const creditors =
    totalRows.length > 0 ? Math.max(0, amountRuns.length - totalRows.length) : null;

  const current = totalRows.length
    ? totalRows.reduce((acc, amounts) => acc + amounts[1], 0)
    : null;
  const overdue = totalRows.length
    ? totalRows.reduce((acc, amounts) => acc + amounts[2] + amounts[3] + amounts[4], 0)
    : null;

  return {
    total:
      totalFromLabel ??
      (current !== null && overdue !== null ? current + overdue : null),
    current,
    overdue,
    creditors,
  };
}

/**
 * Lee las tablas de deuda del informe de la CMF.
 *
 * El PDF real trae, por sección, un encabezado de columnas («Vigente | Mora
 * 30-89 días | Mora 90 días y más | Totales»), una fila por institución y una
 * fila «Totales». La primera columna es la deuda vigente y la última el total,
 * así que la deuda con mora es la diferencia: en el documento no hay una palabra
 * «impaga» que buscar.
 *
 * «Créditos disponibles» es otra sección y **no** es deuda: por eso sólo se
 * miran las secciones de deuda y se corta en el siguiente título numerado.
 */
function readDebtSections(lines: readonly string[]) {
  const found: Partial<Record<DebtSection, DebtSectionSummary>> = {};
  let current: DebtSection | null = null;

  for (const line of lines) {
    const normalized = normalizeForMatch(line);

    const heading = sectionOfLine(normalized);
    if (heading) {
      current = heading;
      if (!found[current]) found[current] = { vigente: null, total: null, creditors: 0 };
      continue;
    }

    // Un título numerado que no es de deuda («3. Créditos disponibles») cierra
    // la sección: lo que venga después no suma al endeudamiento.
    if (/^\d+[a-z]?\.\s/.test(normalized)) {
      current = null;
      continue;
    }

    if (!current) continue;

    let summary = found[current];
    if (!summary) {
      summary = { vigente: null, total: null, creditors: 0 };
      found[current] = summary;
    }

    const amounts = amountsIn(line);

    if (/^(totales?|total)\b/.test(normalized)) {
      if (amounts.length > 0) {
        summary.total = amounts[amounts.length - 1];
        // Con una sola columna el total es todo lo que hay; con varias, la
        // primera es lo vigente y el resto es mora.
        summary.vigente = amounts.length > 1 ? amounts[0] : summary.total;
      }
      continue;
    }

    // Encabezado de columnas o aviso de sección vacía: no es un acreedor.
    if (/vigente|mora|instituciones financieras|no registra/.test(normalized)) continue;

    if (amounts.length > 0) summary.creditors += 1;
  }

  return found;
}

/**
 * Lee el texto de un informe de deudas y devuelve los datos que importan.
 *
 * La CMF emite el informe en PDF con texto, así que se lee tal cual. Los
 * rótulos cambian de una versión a otra, por eso el parseo busca la etiqueta en
 * la línea y toma el monto de ahí, en vez de depender de posiciones fijas. Si no
 * hay texto —una foto del informe— el resultado lo dice (`read: false`) en vez de
 * inventar ceros, que en una evaluación de riesgo es peor que no tener el dato.
 */
export function analyzeDebtReportText(text: string): DebtReportAnalysis {
  const clean = (text ?? '').replace(/\r/g, '').trim();
  const lines = clean
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (clean.length < 40) {
    return {
      read: false,
      issuedAt: null,
      rut: null,
      debtor: null,
      totalDebtClp: null,
      creditors: null,
      currentClp: null,
      overdueClp: null,
      writtenOffClp: null,
      summary: NOT_A_REPORT,
      notes: [NOT_A_REPORT],
    };
  }

  const issuedAt = parseDebtReportIssuedAt(clean);

  // El RUT de la CMF aparece como «Rut 1-9» (sin puntos) en el texto del
  // informe; el formateado con puntos también se acepta.
  const rut =
    clean.match(/\brut\b[^\d]{0,15}(\d{1,2}(?:\.?\d{3}){0,2}-[\dkK])/i)?.[1] ??
    clean.match(/\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/)?.[0] ??
    null;

  // «…consignadas a nombre de: NOMBRE…, Rut 1-9»: el nombre termina en la coma.
  // En el modelo actual no hay rótulo: el nombre va en mayúsculas antes del RUT.
  const debtorLine =
    clean.match(
      /(?:nombre|raz[oó]n social|deudor)\s*(?:o\s*raz[oó]n social)?\s*(?:de\s*)?[:\-]\s*([^,\n]{2,90})/i
    ) ?? clean.match(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{5,}?)\s+Rut\s*:?\s*\d/i);
  const debtor = debtorLine ? debtorLine[1].trim().replace(/\s{2,}/g, ' ') : null;

  // Primero el informe actual (tablas de cinco columnas), después el anterior
  // (secciones numeradas) y al final los rótulos de los modelos resumidos.
  const cmf = readCmfReport(clean);
  const sections = readDebtSections(lines);
  const present = Object.values(sections);

  const structuralTotal = present.reduce<number | null>((acc, section) => {
    if (section.total === null) return acc;
    return (acc ?? 0) + section.total;
  }, null);

  const structuralCurrent = present.reduce<number | null>((acc, section) => {
    const value = section.vigente ?? section.total;
    if (value === null) return acc;
    return (acc ?? 0) + value;
  }, null);

  const structuralCreditors = present.reduce((acc, section) => acc + section.creditors, 0);

  // La CMF no rotula «impaga»: la deuda con mora es lo que excede lo vigente.
  const structuralOverdue =
    structuralTotal !== null && structuralCurrent !== null && structuralTotal >= structuralCurrent
      ? structuralTotal - structuralCurrent
      : null;

  const writtenOffClp = sections.castigada?.total ?? amountFor(lines, /castigad/i);
  const overdueClp =
    cmf?.overdue ?? structuralOverdue ?? amountFor(lines, /impag|con mora|mora\s*\d/i);
  const currentClp =
    cmf?.current ??
    structuralCurrent ??
    amountFor(lines, /deuda[s]?\s*vigente|vigente/i, /impag|castigad/i);

  // El total se busca al final: la línea «Total deuda vigente» también empieza
  // con «total», y tomarla como total general sumaría dos veces lo mismo.
  const totalDebtClp =
    cmf?.total ??
    structuralTotal ??
    amountFor(lines, /total/i, /vigente|impag|castigad|acreedor|informe/i) ??
    (currentClp !== null || overdueClp !== null || writtenOffClp !== null
      ? (currentClp ?? 0) + (overdueClp ?? 0) + (writtenOffClp ?? 0)
      : null);

  // Con secciones, los acreedores son las filas de instituciones; sin ellas, se
  // lee el rótulo «Número de acreedores» de los modelos resumidos.
  const creditorsLine = present.length > 0 ? undefined : lineFor(lines, /acreedor|institucion/i);
  const creditors =
    cmf?.creditors ??
    (present.length > 0
      ? structuralCreditors
      : creditorsLine
        ? Number(creditorsLine.match(/(\d{1,3})\s*(?:acreedor|institucion)/i)?.[1] ??
            creditorsLine.match(/(?:acreedor(?:es)?|instituciones?)[^\d]{0,20}(\d{1,3})/i)?.[1] ??
            '') || null
        : null);

  const notes: string[] = [];
  if (totalDebtClp === null) notes.push('No se encontró el total adeudado en el texto del informe.');
  if (creditors === null) notes.push('No se encontró cuántos acreedores informa.');
  if (totalDebtClp === null && overdueClp === null) {
    notes.push('Puede ser otro modelo de informe: revisa el PDF a mano.');
  }

  const parts: string[] = [];
  if (totalDebtClp !== null) parts.push(`total ${clp(totalDebtClp)}`);
  if (creditors !== null) parts.push(`${creditors} acreedor${creditors === 1 ? '' : 'es'}`);
  if (overdueClp !== null && overdueClp > 0) parts.push(`impagas ${clp(overdueClp)}`);
  if (writtenOffClp !== null && writtenOffClp > 0) parts.push(`castigadas ${clp(writtenOffClp)}`);

  return {
    read: true,
    issuedAt,
    rut,
    debtor,
    totalDebtClp,
    creditors,
    currentClp,
    overdueClp,
    writtenOffClp,
    summary:
      parts.length > 0
        ? `Informe leído: ${parts.join(' · ')}.`
        : 'Informe leído, pero sin montos reconocibles: revísalo a mano.',
    notes,
  };
}
