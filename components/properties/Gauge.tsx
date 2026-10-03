import React from 'react';

/**
 * Velocímetro de arco (semicírculo) dibujado a mano en SVG.
 *
 * El proyecto no tiene biblioteca de gráficos y este caso es una sola forma, así
 * que traer una sería sumar cientos de kB al bundle por un arco. El relleno se
 * logra con `pathLength` normalizado a 1 y `stroke-dasharray`, lo que evita
 * calcular la longitud real del arco y hace el valor legible de un vistazo.
 */

export type GaugeTone = 'emerald' | 'blue' | 'amber' | 'red' | 'slate';

// Las etiquetas son texto pequeño en negrita (<18,66px), así que necesitan
// 4,5:1 de contraste, no 3:1: los tonos `600` de Tailwind quedan por debajo
// (amber-600 ≈ 3,3:1). Se usa `700`, que sí pasa sobre blanco. El trazo del arco
// conserva el tono brillante: es un elemento gráfico, no texto.
const TONES: Record<GaugeTone, { stroke: string; text: string }> = {
  emerald: { stroke: '#10b981', text: 'text-emerald-700' },
  blue: { stroke: '#3b82f6', text: 'text-blue-700' },
  amber: { stroke: '#f59e0b', text: 'text-amber-700' },
  red: { stroke: '#ef4444', text: 'text-red-700' },
  slate: { stroke: '#94a3b8', text: 'text-slate-500' },
};

/** Semicírculo: de la izquierda (180°) a la derecha (0°), centro abajo. */
const ARC = 'M 22 100 A 78 78 0 0 1 178 100';

interface GaugeProps {
  /** Relleno del arco, entre 0 y 1. */
  value: number;
  /** Número grande del centro. */
  valueText: string;
  /** Etiqueta bajo el número (p. ej. «Bajo el mercado»). */
  label: string;
  /** Detalle pequeño al pie. */
  caption?: string;
  tone: GaugeTone;
  /** `true` dibuja el arco atenuado (sin datos). */
  muted?: boolean;
}

export function Gauge({ value, valueText, label, caption, tone, muted = false }: GaugeProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const color = muted ? TONES.slate.stroke : TONES[tone].stroke;
  const textClass = muted ? TONES.slate.text : TONES[tone].text;

  // Aguja: ángulo desde la izquierda. `value` 0 → 180°, `value` 1 → 0°.
  const theta = Math.PI * (1 - clamped);
  const needleX = 100 + 60 * Math.cos(theta);
  const needleY = 100 - 60 * Math.sin(theta);

  return (
    <div className="flex flex-col items-center text-center">
      <svg viewBox="0 0 200 116" className="w-full max-w-[210px]" role="img" aria-label={`${label}: ${valueText}`}>
        {/* Riel de fondo */}
        <path
          d={ARC}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="16"
          strokeLinecap="round"
          pathLength={1}
        />
        {/* Relleno según el valor */}
        <path
          d={ARC}
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={`${clamped} ${1 - clamped}`}
          className="transition-all duration-500"
        />
        {/* Aguja */}
        <line
          x1="100"
          y1="100"
          x2={needleX}
          y2={needleY}
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          className="transition-all duration-500"
        />
        <circle cx="100" cy="100" r="6" fill={color} />
        <text
          x="100"
          y="84"
          textAnchor="middle"
          fontSize="30"
          fontWeight="800"
          className="fill-slate-900"
        >
          {valueText}
        </text>
      </svg>

      <span className={`text-sm font-bold ${textClass}`}>{label}</span>
      {caption && <span className="text-[11px] text-slate-500 mt-0.5 leading-tight">{caption}</span>}
    </div>
  );
}
