/**
 * El informe de deudas: qué documento pide cada perfil, qué archivos se aceptan
 * y qué se lee del texto del PDF.
 *
 * Lo que tiene que no romperse: la persona natural no recibe el informe de
 * empresas (no puede cumplirlo), la ronda no duplica el pedido, y un PDF sin
 * texto no se interpreta como «sin deuda».
 */

import { describe, expect, it } from 'vitest';

import {
  DEBT_REPORT_MAX_BYTES,
  DEBT_REPORT_QUESTION_ID,
  analyzeDebtReportText,
  debtReportAgeDays,
  debtReportKindFor,
  debtReportPath,
  debtReportQuestion,
  isDebtReportOutdated,
  isDebtReportQuestion,
  parseDebtReportIssuedAt,
  validateDebtReportFile,
  withDebtReport,
} from './debtReport';

/**
 * Texto del informe de deudas de la CMF, tal como sale del PDF y lo ve el
 * parser. Es el espécimen público del formato (datos ficticios): encabezado,
 * tablas por tipo de deuda, fila «Totales» y secciones de créditos disponibles.
 */
const REAL_CMF = `Página 1 de 2
Fecha de emisión: Santiago, lunes 21 de febrero de 2022 (20:16)
INFORME DE DEUDAS - Nro. 7126723
La Comisión para el Mercado Financiero (CMF) informa que el detalle de las deudas consignadas a nombre de: NOMBRE APELLIDOPATERNO APELLIDOMATERNO, Rut 1-9 en el Estado de Deudores del artículo 14 de la Ley General de Bancos es el siguiente:
1. Información de Deuda Directa
Deuda Directa Instituciones Financieras Vigente Mora 30-89 días Mora 90 días y más Totales
Institución Financiera 1 454.524 454.524
Institución Financiera 2 64.406.950 64.406.950
Institución Financiera 3 280.298 280.298
Totales 65.141.772 65.141.772
2. Información de Deuda Indirecta
Deuda Indirecta Instituciones Financieras Vigente Mora 30-89 días Mora 90 días y más Totales
No registra información para esta sección
Totales
3. Créditos Disponibles
3a. Líneas de Crédito Disponibles
Monto Disponible Instituciones Financieras Directa Indirecta
Institución Financiera 1 24.882.376
Institución Financiera 2 16.006.175
Institución Financiera 3 1.240.000
Institución Financiera 4 7.231.381
Totales 49.359.932`;

/**
 * El informe que la CMF emite hoy (Ley 21.680, «Conoce tu deuda»), con la
 * estructura de un informe real de noviembre de 2026: total, tabla de cinco
 * columnas por sección y fila «Total» al pie. El titular, el RUT y los montos son
 * ficticios; lo que se conserva es la forma del documento.
 *
 * Está escrito casi en una sola línea a propósito: así lo entrega el extractor
 * del PDF cuando el encabezado de la tabla y la primera fila quedan juntos.
 */
const REAL_2026 = `Informe de Deudas Se detallan tus deudas en el sistema financiero según la información entregada a CMF por las instituciones financieras. INFORME EMITIDO EL 06/11/2026 - INFORMACIÓN ACTUALIZADA AL 23/10/2026
NOMBRE APELLIDO APELLIDO
Rut:11.111.111-1
Deuda total y estado de pago $28.220.000
Corresponde a la suma de todas tus deudas con instituciones financieras. Considera aquellas en las que eres titular y también deudas adquiridas por un tercero en las que eres codeudor, fiador o avalista.
¿Cómo se compone esta deuda? Deuda Directa Corresponden a deudas que tienes como titular con las instituciones financieras. Institucion financiera Tipo de crédito Fecha de otorgamiento Total del crédito Vigente 30 a 59 días de atraso 60 a 89 días de atraso 90 o más días de atraso Banco Santander-Chile Comercial 07/09/2026 $20.000 $0 $20.000 $0 $0 Banco de Crédito e Inversiones Consumo 18/03/2024 $3.000.000 $0 $0 $0 $3.000.000 Banco Falabella Consumo 30/07/2024 $10.000.000 $0 $0 $0 $10.000.000 Banco Santander-Chile Consumo 19/11/2025 $200.000 $0 $0 $0 $200.000 Banco Falabella Consumo 21/10/2021 $2.000.000 $0 $0 $0 $2.000.000 Banco Santander-Chile Consumo 30/08/2023 $5.000.000 $0 $0 $0 $5.000.000 Banco de Crédito e Inversiones (3) Tarjeta de crédito 18/03/2024 $1.000.000 $0 $0 $0 $1.000.000 Promotora CMR Falabella S.A. (1) (3) Tarjeta de crédito 04/03/2020 $3.000.000 $0 $0 $0 $3.000.000 Banco de Crédito e Inversiones (3) Linea de Crédito 18/03/2024 $2.000.000 $2.000.000 $0 $0 $0 Total $26.220.000 $2.000.000 $20.000 $0 $21.200.000 Deuda Indirecta Corresponden a deudas adquiridas por un tercero donde eres codeudor, fiador o avalista. Institucion financiera Tipo de crédito Fecha de otorgamiento Total del crédito Vigente 30 a 59 días de atraso 60 a 89 días de atraso 90 o más días de atraso Forum S.A. (2) Comercial 31/03/2025 $5.000.000 $5.000.000 $0 $0 $0 Total $5.000.000 $5.000.000 $0 $0 $0 $7.000.000  $20.000  $0  $21.200.000   Vigente 30 a 59 días de atraso 60 a 89 días de atraso 90 o más días de atraso
En este informe se presentan las obligaciones reportables y su respectivo acreedor, individualizado por su razón social.
Créditos disponibles Líneas de crédito Corresponden a los montos no utilizados en la línea de crédito de la cuenta corriente, tarjeta de crédito u otras. Instituciones financieras Directos Indirectos No registra información para esta sección. Total $0 $0
(Nota 1) Corresponde a operaciones renegociadas. página 1/1`;

const JURIDICA = `INFORME DE DEUDAS DE PERSONAS JURÍDICAS
Nombre o razón social: COMERCIAL ANDES SPA
RUT: 76.543.210-8
Fecha de emisión: 02-11-2026

Deudas vigentes
Total deuda vigente $ 12.450.000
Número de acreedores 3

Deudas impagas
Total deuda impaga $ 1.200.000

Deudas castigadas
Total deuda castigada $ 0

Total deuda $ 13.650.000`;

describe('qué informe corresponde', () => {
  it('corredora e inmobiliaria van por personas jurídicas', () => {
    expect(debtReportKindFor('corredora')).toBe('juridica');
    expect(debtReportKindFor('inmobiliaria')).toBe('juridica');
  });

  it('un profesional independiente va por personas naturales', () => {
    expect(debtReportKindFor(null)).toBe('natural');
    expect(debtReportKindFor(undefined)).toBe('natural');
    expect(debtReportKindFor('agente')).toBe('natural');
    expect(debtReportKindFor('profesional')).toBe('natural');
  });

  it('la pregunta nombra el documento exacto de la CMF', () => {
    expect(debtReportQuestion('natural').question).toContain(
      'Informe de Deudas de Personas Naturales'
    );
    expect(debtReportQuestion('juridica').question).toContain(
      'Informe de Deudas de Personas Jurídicas'
    );
    expect(debtReportQuestion('juridica').kind).toBe('document');
  });
});

describe('la ronda de preguntas', () => {
  it('agrega el informe al final y lo marca como documento', () => {
    const questions = withDebtReport([{ id: 'domicilio', question: '¿Dónde opera?' }], 'juridica');

    expect(questions).toHaveLength(2);
    expect(questions[1].id).toBe(DEBT_REPORT_QUESTION_ID);
    expect(questions[1].kind).toBe('document');
    expect(isDebtReportQuestion(questions[1])).toBe(true);
  });

  it('no lo duplica si la ronda ya lo trae', () => {
    const once = withDebtReport([], 'natural');
    const twice = withDebtReport(once, 'natural');
    expect(twice).toHaveLength(1);
  });

  it('no toca el arreglo original', () => {
    const original = [{ id: 'rut', question: '¿Cuál es el RUT?' }];
    withDebtReport(original, 'natural');
    expect(original).toHaveLength(1);
  });
});

describe('el archivo', () => {
  it('acepta un PDF dentro del tope', () => {
    expect(validateDebtReportFile({ name: 'informe.pdf', type: 'application/pdf', size: 1024 })).toEqual({
      ok: true,
    });
    // Algunos navegadores no informan el tipo: el nombre alcanza.
    expect(validateDebtReportFile({ name: 'INFORME.PDF', type: '', size: 2048 }).ok).toBe(true);
  });

  it('rechaza lo que no es PDF, lo vacío y lo que pesa de más', () => {
    expect(validateDebtReportFile({ name: 'foto.jpg', type: 'image/jpeg', size: 1024 }).ok).toBe(false);
    expect(validateDebtReportFile({ name: 'informe.pdf', type: 'application/pdf', size: 0 }).ok).toBe(false);
    expect(
      validateDebtReportFile({
        name: 'informe.pdf',
        type: 'application/pdf',
        size: DEBT_REPORT_MAX_BYTES + 1,
      }).ok
    ).toBe(false);
  });

  it('la ruta no usa el nombre original ni deja escapar del bucket', () => {
    expect(debtReportPath('alta', '../../etc', 'doc-1')).toBe('alta/etc/doc-1.pdf');
    expect(debtReportPath('solicitud', 'sol_1', 'doc 2')).toBe('solicitud/sol_1/doc2.pdf');
  });
});

const analysis_issuedAt = (text: string) => analyzeDebtReportText(text).issuedAt;

describe('la lectura del informe', () => {
  it('extrae total, acreedores, impagas y castigadas sin confundir el total vigente', () => {
    const analysis = analyzeDebtReportText(JURIDICA);

    expect(analysis.read).toBe(true);
    expect(analysis.totalDebtClp).toBe(13_650_000);
    expect(analysis.currentClp).toBe(12_450_000);
    expect(analysis.overdueClp).toBe(1_200_000);
    expect(analysis.writtenOffClp).toBe(0);
    expect(analysis.creditors).toBe(3);
    expect(analysis.rut).toBe('76.543.210-8');
    expect(analysis.debtor).toContain('COMERCIAL ANDES SPA');
    expect(analysis.summary).toContain('13.650.000');
  });

  it('suma las partes cuando el informe no trae un total explícito', () => {
    const analysis = analyzeDebtReportText(`INFORME DE DEUDAS
Deudas vigentes $ 8.000.000
Deudas impagas $ 2.000.000
Deudas castigadas $ 0
Acreedores 2`);

    expect(analysis.read).toBe(true);
    expect(analysis.totalDebtClp).toBe(10_000_000);
    expect(analysis.creditors).toBe(2);
  });

  it('lee el informe que la CMF emite hoy: total, vigente y tramos de mora', () => {
    const analysis = analyzeDebtReportText(REAL_2026);

    expect(analysis.read).toBe(true);
    // «Deuda total y estado de pago» es la suma de todo, no la primera columna
    // de la tabla (que es el monto otorgado de los créditos).
    expect(analysis.totalDebtClp).toBe(28_220_000);
    expect(analysis.currentClp).toBe(7_000_000);
    expect(analysis.overdueClp).toBe(21_220_000);
    // Nueve filas en la tabla directa y una en la indirecta.
    expect(analysis.creditors).toBe(10);
    expect(analysis.rut).toBe('11.111.111-1');
    expect(analysis.debtor).toBe('NOMBRE APELLIDO APELLIDO');
    expect(analysis.summary).toContain('28.220.000');
    // Los créditos disponibles vacíos no aportan deuda.
    expect(analysis.notes).toEqual([]);
  });

  it('lee el informe real de la CMF: tablas por sección y fila de totales', () => {
    // Texto tal como lo extrae el lector del PDF que emite la CMF (espécimen
    // público del formato, con instituciones ficticias). El informe no dice
    // «impaga» en ningún lado: la mora es lo que excede lo vigente, y los
    // créditos disponibles son otra sección que no es deuda.
    const analysis = analyzeDebtReportText(REAL_CMF);

    expect(analysis.read).toBe(true);
    expect(analysis.totalDebtClp).toBe(65_141_772);
    expect(analysis.currentClp).toBe(65_141_772);
    expect(analysis.overdueClp).toBe(0);
    // Tres instituciones en la tabla directa; la sección inductiva está vacía.
    expect(analysis.creditors).toBe(3);
    expect(analysis.rut).toBe('1-9');
    expect(analysis.debtor).toBe('NOMBRE APELLIDOPATERNO APELLIDOMATERNO');
    // Los $49.359.932 de «Créditos disponibles» no son deuda.
    expect(analysis.totalDebtClp).not.toBe(114_501_704);
    expect(analysis.summary).toContain('65.141.772');
  });

  it('la mora de la tabla es la deuda impaga, no una columna más del total', () => {
    const analysis = analyzeDebtReportText(`INFORME DE DEUDAS - Nro. 7126723
1. Información de Deuda Directa
Deuda Directa Instituciones Financieras Vigente Mora 30-89 días Mora 90 días y más Totales
Banco Uno 10.000.000 500.000 250.000 10.750.000
Banco Dos 1.000.000 1.000.000
Totales 10.000.000 500.000 250.000 10.750.000
2. Información de Deuda Indirecta
No registra información para esta sección
Totales`);

    expect(analysis.read).toBe(true);
    expect(analysis.totalDebtClp).toBe(10_750_000);
    expect(analysis.currentClp).toBe(10_000_000);
    expect(analysis.overdueClp).toBe(750_000);
    expect(analysis.creditors).toBe(2);
  });

  it('lee la fecha de emisión de los dos modelos de informe', () => {
    expect(analysis_issuedAt(REAL_2026)).toBe('2026-11-06');
    // Modelo anterior: fecha larga después del «Fecha de emisión».
    expect(
      parseDebtReportIssuedAt('Fecha de emisión: Santiago, lunes 21 de febrero de 2022 (20:16)')
    ).toBe('2022-02-21');
    expect(parseDebtReportIssuedAt('Fecha de emisión: 02-11-2026')).toBe('2026-11-02');
    // No se toma la fecha de actualización de datos, que es otra.
    expect(analysis_issuedAt(REAL_2026)).not.toBe('2026-10-23');
  });

  it('sin fecha de emisión no inventa una y no avisa', () => {
    expect(parseDebtReportIssuedAt('INFORME DE DEUDAS sin fecha')).toBeNull();
    expect(parseDebtReportIssuedAt('Fecha de emisión: 45/13/2026')).toBeNull();
    expect(debtReportAgeDays(null)).toBeNull();
    expect(isDebtReportOutdated(null)).toBe(false);
  });

  it('avisa cuando el informe tiene más de 30 días', () => {
    const now = new Date('2026-11-06T12:00:00Z');

    expect(debtReportAgeDays('2026-11-06', now)).toBe(0);
    expect(isDebtReportOutdated('2026-11-06', now)).toBe(false);
    // A los 30 días todavía sirve; al día siguiente, no.
    expect(isDebtReportOutdated('2026-10-07', now)).toBe(false);
    expect(debtReportAgeDays('2026-10-06', now)).toBe(31);
    expect(isDebtReportOutdated('2026-10-06', now)).toBe(true);
    // Una fecha futura es un dato mal leído, no un informe vencido.
    expect(isDebtReportOutdated('2026-12-01', now)).toBe(false);
  });

  it('un PDF sin texto no se lee como «sin deuda»', () => {
    const analysis = analyzeDebtReportText('   ');

    expect(analysis.read).toBe(false);
    expect(analysis.totalDebtClp).toBeNull();
    expect(analysis.summary).toMatch(/no tiene texto legible/i);
  });

  it('si hay texto pero no se reconocen montos, lo dice', () => {
    const analysis = analyzeDebtReportText(
      'INFORME DE DEUDAS. Documento emitido por la CMF. Este informe no registra deudas informadas por las instituciones.'
    );

    expect(analysis.read).toBe(true);
    expect(analysis.totalDebtClp).toBeNull();
    expect(analysis.notes.some((note) => /revisa el pdf/i.test(note))).toBe(true);
  });
});
