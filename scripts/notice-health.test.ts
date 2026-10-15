/**
 * Tests del aviso de salud.
 *
 * Lo que hay que proteger acá es **cuándo se avisa y cuándo se calla**:
 *
 * - una huella que cambie sola (por el «→ arreglo» o por un dato de la corrida)
 *   llenaría el hilo de comentarios que dicen lo mismo, y un hilo así se aprende
 *   a ignorar — justo lo que este aviso viene a evitar;
 * - y un estado que se lea como «todo bien» cuando en realidad no se sabe
 *   **cerraría** un aviso legítimo. Por eso el caso desconocido se prueba como
 *   lo que es: una negativa a actuar, no un verde.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NOTICE_TITLE,
  commentBody,
  findNotice,
  fingerprintOf,
  issueBody,
  planNotice,
  readFailedState,
  readReports,
  recoveryComment,
} from './notice-health.mjs';

// Un informe rojo con la forma real que imprime `check-health.mjs`.
const RED_SALUD = [
  '',
  '== Sonda de salud · https://rix7.vercel.app/api/health ==',
  '',
  '  HTTP 503',
  '  ✗ Falta un subsistema crítico:',
  '      · Base de la cuenta dueña del proyecto: La base es del proyecto wcxpkfmevrbjrjlbayba. → Usá las credenciales del proyecto de la cuenta dueña.',
  '  · Opcionales sin configurar: monitoring',
  '',
  '::error::Salud de producción: Base de la cuenta dueña del proyecto: La base es del proyecto wcxpkfmevrbjrjlbayba. → Usá las credenciales del proyecto de la cuenta dueña y cortá con `npm run corte:supabase`.',
  '',
].join('\n');

// El mismo fallo, con el arreglo redactado distinto y otro estado de la build:
// es el mismo problema y no puede generar otro comentario.
const RED_SALUD_OTRA_REDACCION = RED_SALUD.replace(/→ Usá las credenciales.*$/gm, '→ Corré `npm run corte:supabase`.')
  .replace('  · Opcionales sin configurar: monitoring', '  · Opcionales sin configurar: monitoring, alerts_cron')
  .replace(
    '::error::Salud de producción: Base de la cuenta dueña del proyecto: La base es del proyecto wcxpkfmevrbjrjlbayba. → Usá las credenciales del proyecto de la cuenta dueña y cortá con `npm run corte:supabase`.',
    '::error::Salud de producción: Base de la cuenta dueña del proyecto: La base es del proyecto wcxpkfmevrbjrjlbayba. → Corré `npm run corte:supabase`.'
  );

const RED_ESQUEMA = [
  '  ✓ properties.rol',
  '  ✗ Aplicá 0014_socio_publicaciones.sql (crea properties.rol).',
  '',
  '::error::Esquema de la base: falta 0014_socio_publicaciones.sql',
  '',
].join('\n');

const GREEN = ['', '  ✓ Sin subsistemas críticos pendientes.', '', '  Todo lo que el portal necesita está configurado.', ''].join('\n');

describe('fingerprintOf', () => {
  it('el mismo problema da la misma huella aunque cambie la redacción del arreglo', () => {
    // La huella responde «¿es el mismo motivo?», no «¿dice lo mismo el texto?».
    expect(fingerprintOf([{ text: RED_SALUD }])).toBe(fingerprintOf([{ text: RED_SALUD_OTRA_REDACCION }]));
  });

  it('otro problema da otra huella', () => {
    expect(fingerprintOf([{ text: RED_SALUD }])).not.toBe(fingerprintOf([{ text: RED_ESQUEMA }]));
  });

  it('las dos sondas juntas dan una huella distinta que cada una sola', () => {
    const una = fingerprintOf([{ text: RED_ESQUEMA }]);
    const dos = fingerprintOf([{ text: RED_SALUD }, { text: RED_ESQUEMA }]);

    expect(dos).not.toBe(una);
  });

  it('un informe verde no tiene motivo y lo dice', () => {
    expect(fingerprintOf([{ text: GREEN }])).toBe('sin-motivo');
  });

  it('las notas que no son fallo (opcionales, identificador de la build) no entran', () => {
    // Si entraran, la huella cambiaría en cada commit y volvería a comentar.
    const conNota = `${RED_SALUD}\n  · Identificador de la build: el despliegue no publica identificador (RIX7_BUILD).\n`;

    expect(fingerprintOf([{ text: conNota }])).toBe(fingerprintOf([{ text: RED_SALUD }]));
  });

  it('sin informes devuelve sin-motivo en vez de romper', () => {
    expect(fingerprintOf([])).toBe('sin-motivo');
    expect(fingerprintOf([{ text: '' }])).toBe('sin-motivo');
  });
});

describe('planNotice', () => {
  const rojo = { failed: true, fingerprint: 'abc123abc123', existing: null };
  const abierto = { number: 7, fingerprint: 'abc123abc123' };

  it('rojo sin aviso abierto → abre', () => {
    expect(planNotice(rojo).action).toBe('open');
  });

  it('rojo por el mismo motivo → refresca, sin comentar', () => {
    expect(planNotice({ ...rojo, existing: abierto }).action).toBe('refresh');
  });

  it('rojo por otro motivo → comenta', () => {
    expect(planNotice({ ...rojo, existing: { ...abierto, fingerprint: 'otra-huella' } }).action).toBe('comment');
  });

  it('verde con aviso abierto → cierra', () => {
    expect(planNotice({ failed: false, fingerprint: 'sin-motivo', existing: abierto }).action).toBe('close');
  });

  it('verde sin aviso abierto → no hace nada', () => {
    expect(planNotice({ failed: false, fingerprint: 'sin-motivo', existing: null }).action).toBe('nothing');
  });

  it('un aviso abierto sin huella legible se trata como motivo distinto', () => {
    // Es lo más probable: lo abrió un humano o alguien pegó el cuerpo a mano.
    expect(planNotice({ ...rojo, existing: { number: 7, fingerprint: null } }).action).toBe('comment');
  });
});

describe('readFailedState', () => {
  it('sin ninguna variable no sabe: no supone que está todo bien', () => {
    expect(readFailedState({})).toEqual({ known: false, failed: false, who: [] });
  });

  it('las dos en false es un verde de verdad', () => {
    expect(readFailedState({ SALUD_FALLO: 'false', ESQUEMA_FALLO: 'false' })).toEqual({
      known: true,
      failed: false,
      who: [],
    });
  });

  it('una en true alcanza para que haya fallo, y dice cuál', () => {
    const state = readFailedState({ SALUD_FALLO: 'false', ESQUEMA_FALLO: 'true' });

    expect(state.failed).toBe(true);
    expect(state.who).toEqual(['el esquema de la base']);
  });

  it('las dos en true nombra las dos', () => {
    expect(readFailedState({ SALUD_FALLO: 'true', ESQUEMA_FALLO: 'true' }).who).toHaveLength(2);
  });

  it('un valor que no se entiende deja el estado en desconocido', () => {
    // Interpretarlo como «false» cerraría un aviso abierto por una variable mal escrita.
    expect(readFailedState({ SALUD_FALLO: 'quizás', ESQUEMA_FALLO: 'false' }).known).toBe(false);
  });
});

describe('findNotice', () => {
  const cuerpo = `algo\n\n<!-- huella:abc123abc123 -->\n`;

  it('encuentra el aviso por título exacto y lee su huella', () => {
    const issue = findNotice([{ number: 12, title: 'Salud de producción en rojo', body: cuerpo }]);

    expect(issue?.number).toBe(12);
    expect(issue?.fingerprint).toBe('abc123abc123');
  });

  it('no confunde un issue parecido escrito por una persona', () => {
    const issues = [{ number: 3, title: 'Salud de producción en rojo en el móvil', body: cuerpo }];

    expect(findNotice(issues)).toBeNull();
  });

  it('un aviso sin huella se devuelve con huella nula, no se descarta', () => {
    const issue = findNotice([{ number: 9, title: 'Salud de producción en rojo', body: 'lo abrí a mano' }]);

    expect(issue?.number).toBe(9);
    expect(issue?.fingerprint).toBeNull();
  });
});

describe('los cuerpos', () => {
  const now = '2026-10-15T14:00:00.000Z';
  const reports = [{ who: 'la sonda de /api/health', text: RED_SALUD }];

  it('el cuerpo dice qué falló, cuándo, por qué importa y trae el informe', () => {
    const body = issueBody({ who: ['la sonda de /api/health'], reports, fingerprint: 'abc123abc123', now });

    expect(body).toContain('la sonda de /api/health');
    expect(body).toContain(now);
    expect(body).toContain('wcxpkfmevrbjrjlbayba');
    expect(body).toContain('<!-- huella:abc123abc123 -->');
  });

  it('el cuerpo que escribe el aviso es el que después se puede leer', () => {
    // El ida y vuelta es el corazón del asunto: si el marcador no se pudiera
    // leer, cada corrida roja comentaría como si fuera un motivo nuevo.
    const body = issueBody({ who: ['la sonda de /api/health'], reports, fingerprint: 'abc123abc123', now });
    const issue = findNotice([{ number: 1, title: 'Salud de producción en rojo', body }]);

    expect(issue?.fingerprint).toBe('abc123abc123');
  });

  it('un informe largo se recorta diciéndolo', () => {
    const body = issueBody({
      who: ['la sonda de /api/health'],
      reports: [{ who: 'la sonda de /api/health', text: `✗ ${'x'.repeat(9000)}` }],
      fingerprint: 'abc123abc123',
      now,
    });

    expect(body).toContain('informe recortado');
    expect(body.length).toBeLessThan(9000);
  });

  it('sin informe no inventa uno', () => {
    const body = issueBody({ who: ['la sonda de /api/health'], reports: [], fingerprint: 'abc123abc123', now });

    expect(body).toContain('Sin informe');
  });

  it('el comentario de motivo nuevo nombra lo que falla ahora', () => {
    expect(commentBody({ who: ['el esquema de la base'], fingerprint: 'x1', now })).toContain('el esquema de la base');
  });

  it('el cierre dice cuándo volvió a estar verde', () => {
    expect(recoveryComment({ now })).toContain(now);
  });
});

describe('readReports', () => {
  it('lee lo que existe y no falla por lo que falta', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aviso-'));
    writeFileSync(path.join(dir, 'salud.txt'), RED_SALUD);

    const reports = readReports(dir);

    expect(reports).toHaveLength(1);
    expect(reports[0].who).toBe('la sonda de /api/health');
  });

  it('un informe vacío no cuenta como informe', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aviso-'));
    writeFileSync(path.join(dir, 'esquema.txt'), '\n');

    expect(readReports(dir)).toEqual([]);
  });
});

// El título se busca por igualdad exacta: cambiarlo deja huérfano al issue
// abierto y el aviso siguiente abre uno nuevo. Por eso está clavado acá.
describe('el título es contrato', () => {
  it('es el que se busca y el que se abre', () => {
    expect(NOTICE_TITLE).toBe('Salud de producción en rojo');
  });
});
