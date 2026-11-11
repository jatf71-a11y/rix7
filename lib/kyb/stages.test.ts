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
    // El HTML separa la parte hecha de la pendiente con dos <span>, así que la
    // barra no aparece contigua: se revisan las dos mitades y el texto.
    expect(mark?.html).toContain('■■■</span>');
    expect(mark?.html).toContain('□□□□</span>');
    expect(mark?.html).toContain('Etapa 3 de 7 · Pendiente de información');
  });

  it('el primer paso está vacío hacia adelante y el último completo', () => {
    expect(applicantStage('Recibida')?.text).toContain('■□□□□□□');
    expect(applicantStage('Alta')?.text).toContain('■■■■■■■');
  });

  it('cada etapa trae su luz de semáforo', () => {
    expect(applicantStage('Aceptada')?.tone).toBe('ok');
    expect(applicantStage('Calificado')?.tone).toBe('ok');
    expect(applicantStage('Alta')?.tone).toBe('ok');

    expect(applicantStage('Propuesta_Comercial')?.tone).toBe('ok');
    expect(applicantStage('Recibida')?.tone).toBe('waiting');
    expect(applicantStage('En_Evaluacion')?.tone).toBe('waiting');

    expect(applicantStage('Pendiente_Informacion')?.tone).toBe('blocked');
  });

  it('el marcador pinta la parte recorrida con la luz de la etapa', () => {
    expect(applicantStage('Alta')?.complete).toBe(true);
    expect(applicantStage('Alta')?.html).toContain('color:#15803d');
    expect(applicantStage('En_Evaluacion')?.html).toContain('color:#b45309');
    expect(applicantStage('Pendiente_Informacion')?.html).toContain('color:#b91c1c');
    expect(applicantStage('Recibida')?.html).not.toContain('#2563eb');
  });

  it('Operando y Rechazada no son etapas del trámite: no hay marcador', () => {
    expect(applicantStage('Operando')).toBeNull();
    expect(applicantStage('Rechazada')).toBeNull();
  });
});
