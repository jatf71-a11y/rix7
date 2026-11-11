import { describe, expect, it } from 'vitest';

import { APPLICANT_STAGES, APPLICANT_STAGE_TOTAL, applicantStage } from './stages';
import type { KybStatus } from './status';

describe('applicantStage', () => {
  it('numera las siete etapas del trámite en su orden', () => {
    const expected: [KybStatus, number, string][] = [
      ['Recibida', 1, 'Recibida'],
      ['En_Evaluacion', 2, 'Evaluando'],
      ['Pendiente_Informacion', 3, 'Pendiente de información'],
      ['Aceptada', 4, 'Aceptada'],
      ['Calificado', 5, 'Calificado'],
      ['Propuesta_Comercial', 6, 'Propuesta comercial'],
      ['Alta', 7, 'Alta'],
    ];

    expect(APPLICANT_STAGE_TOTAL).toBe(7);
    expect(APPLICANT_STAGES).toHaveLength(7);

    for (const [status, step, label] of expected) {
      const mark = applicantStage(status);
      expect(mark?.step).toBe(step);
      expect(mark?.total).toBe(7);
      expect(mark?.label).toBe(label);
    }
  });

  it('la barra tiene siete casillas y marca el paso actual', () => {
    const mark = applicantStage('Pendiente_Informacion');

    expect(mark?.text).toContain('Etapa 3 de 7 · Pendiente de información');
    expect(mark?.text).toContain('■■■□□□□');
    // El HTML separa la parte recorrida de la pendiente con dos <span>: la barra
    // no aparece contigua y se revisan las dos mitades.
    expect(mark?.html).toContain('color:#dc2626">■■■</span>');
    expect(mark?.html).toContain('color:#cbd5e1">□□□□</span>');
    expect(mark?.html).toContain('Etapa 3 de 7 · Pendiente de información');
  });

  it('el primer paso está vacío hacia adelante y el último completo', () => {
    expect(applicantStage('Recibida')?.text).toContain('■□□□□□□');
    expect(applicantStage('Alta')?.text).toContain('■■■■■■■');
  });

  it('solo el pedido de información sale del azul de marca', () => {
    const blue: KybStatus[] = [
      'Recibida',
      'En_Evaluacion',
      'Aceptada',
      'Calificado',
      'Propuesta_Comercial',
      'Alta',
    ];

    for (const status of blue) expect(applicantStage(status)?.tone).toBe('brand');
    expect(applicantStage('Pendiente_Informacion')?.tone).toBe('attention');
  });

  it('la parte recorrida va en azul y solo el pedido de aclaración en rojo', () => {
    const evaluating = applicantStage('En_Evaluacion')?.html ?? '';
    expect(evaluating).toContain('color:#2563eb">■■</span>');
    expect(evaluating).not.toContain('#dc2626');

    const alta = applicantStage('Alta')?.html ?? '';
    expect(alta).toContain('color:#2563eb');
    expect(alta).not.toContain('□');
    expect(alta).not.toContain('#dc2626');

    const pending = applicantStage('Pendiente_Informacion')?.html ?? '';
    expect(pending).toContain('color:#dc2626">■■■</span>');
    expect(pending).not.toContain('#2563eb');
  });

  it('Operando y Rechazada no son etapas del trámite: no hay marcador', () => {
    expect(applicantStage('Operando')).toBeNull();
    expect(applicantStage('Rechazada')).toBeNull();
  });
});
