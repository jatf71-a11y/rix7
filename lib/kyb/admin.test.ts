import { describe, it, expect } from 'vitest';
import {
  canReevaluate,
  checkSummary,
  coverageLabel,
  evidenceHref,
  formatKybDateTime,
  KYB_CHECK_TONES,
  KYB_EVIDENCE_LABELS,
  scoreTone,
} from './admin';
import { KYB_STATUSES, type KybCheck, type KybEvidenceSource } from './status';

function check(status: KybCheck['status']): KybCheck {
  return { id: status, label: status, status, detail: '', weight: 10 };
}

describe('resumen de verificaciones', () => {
  it('cuenta cada resultado y el total', () => {
    expect(checkSummary([check('pass'), check('pass'), check('warn'), check('fail')])).toEqual({
      pass: 2,
      warn: 1,
      fail: 1,
      total: 4,
    });
  });

  it('sin verificaciones el total es cero, no seis', () => {
    expect(checkSummary([])).toEqual({ pass: 0, warn: 0, fail: 0, total: 0 });
  });

  it('cada estado tiene su etiqueta legible', () => {
    expect(KYB_CHECK_TONES.pass.label).toBe('OK');
    expect(KYB_CHECK_TONES.warn.label).toBe('Advertencia');
    expect(KYB_CHECK_TONES.fail.label).toBe('Falla');
  });
});

describe('puntaje', () => {
  it('distingue sin evaluar de un cero', () => {
    expect(scoreTone(null)).toContain('slate');
    expect(scoreTone(0)).toContain('red');
  });

  it('el umbral de aceptación es 75, igual que el motor', () => {
    expect(scoreTone(75)).toContain('emerald');
    expect(scoreTone(74)).toContain('amber');
    expect(scoreTone(49)).toContain('red');
  });
});

describe('re-evaluación', () => {
  it('solo se ofrece mientras el flujo admite una corrida', () => {
    const evaluables = ['Recibida', 'En_Evaluacion', 'Pendiente_Informacion'];
    for (const status of KYB_STATUSES) {
      expect(canReevaluate(status), status).toBe(evaluables.includes(status));
    }
  });

  it('una solicitud rechazada no vuelve al motor', () => {
    expect(canReevaluate('Rechazada')).toBe(false);
    expect(canReevaluate('En_Alta')).toBe(false);
  });
});

describe('fecha del panel', () => {
  it('se muestra en UTC para no depender del navegador', () => {
    expect(formatKybDateTime('2026-10-23T18:05:42.000Z')).toBe('2026-10-23 18:05 UTC');
  });

  it('una fecha inválida no rompe la ficha', () => {
    expect(formatKybDateTime('no-es-fecha')).toBe('—');
  });
});

describe('origen de una verificación', () => {
  it('todos los orígenes posibles tienen etiqueta', () => {
    const sources: KybEvidenceSource[] = ['declared', 'sii', 'search', 'simulated'];
    for (const source of sources) {
      expect(KYB_EVIDENCE_LABELS[source], source).toBeTruthy();
    }
  });

  it('la simulación no se lee como una comprobación externa', () => {
    expect(KYB_EVIDENCE_LABELS.simulated).toMatch(/no hay proveedor externo/);
    expect(KYB_EVIDENCE_LABELS.declared).not.toMatch(/proveedor/);
  });

  it('solo http(s) se convierte en enlace', () => {
    expect(evidenceHref('https://foros.cl/reclamo')).toBe('https://foros.cl/reclamo');
    expect(evidenceHref('http://foros.cl/reclamo')).toBe('http://foros.cl/reclamo');
    expect(evidenceHref('javascript:alert(1)')).toBeNull();
    expect(evidenceHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(evidenceHref('foros.cl/reclamo')).toBeNull();
  });
});

describe('cobertura declarada', () => {
  it('nacional no arrastra regiones', () => {
    expect(coverageLabel('nacional', [])).toBe('Nacional');
  });

  it('regional enumera las regiones', () => {
    expect(coverageLabel('regional', ['Valparaíso', 'Biobío'])).toBe('Valparaíso, Biobío');
  });

  it('regional sin regiones se dice, no se deja vacío', () => {
    expect(coverageLabel('regional', [])).toBe('Regional (sin regiones)');
  });

  it('un alta directa no tiene cobertura y no se inventa una', () => {
    expect(coverageLabel(null, [])).toBe('Sin dato');
  });
});
