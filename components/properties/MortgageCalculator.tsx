'use client';

import React, { useState, useMemo } from 'react';
import { calculateMortgage } from '@/lib/utils/mortgage';
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { Calculator } from 'lucide-react';

interface MortgageCalculatorProps {
  propertyPrice: number;
}

// Parámetros fijos del simulador (aún no editables desde la UI)
const PROPERTY_TAX_RATE = 0.4; // Contribuciones anuales estimadas (% del valor)
const ANNUAL_INSURANCE = 380000; // Seguro desgravamen + sismo anual (CLP)
const MONTHLY_HOA = 120000; // Gastos comunes promedio (CLP)

export function MortgageCalculator({ propertyPrice }: MortgageCalculatorProps) {
  const { format } = useCurrency();
  const [homePrice, setHomePrice] = useState(propertyPrice);
  const [downPaymentPercent, setDownPaymentPercent] = useState(20);
  const [loanTermYears, setLoanTermYears] = useState(25);
  const [interestRate, setInterestRate] = useState(4.65); // Tasa hipotecaria anual promedio

  // Calcular desglose en tiempo real
  const breakdown = useMemo(() => {
    return calculateMortgage({
      homePrice,
      downPaymentPercent,
      loanTermYears,
      interestRate,
      annualPropertyTaxRate: PROPERTY_TAX_RATE,
      annualHomeInsurance: ANNUAL_INSURANCE,
      monthlyHoa: MONTHLY_HOA,
    });
  }, [homePrice, downPaymentPercent, loanTermYears, interestRate]);

  // Porcentajes para la barra visual
  const principalPercent = (breakdown.principalAndInterest / breakdown.monthlyPayment) * 100 || 0;
  const taxPercent = (breakdown.monthlyPropertyTax / breakdown.monthlyPayment) * 100 || 0;
  const insurancePercent = (breakdown.monthlyInsurance / breakdown.monthlyPayment) * 100 || 0;
  const hoaPercent = (breakdown.monthlyHoa / breakdown.monthlyPayment) * 100 || 0;

  return (
    <div id="hipoteca" className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <Calculator className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900">Simulador de Crédito Hipotecario</h3>
          <p className="text-xs text-slate-500">
            Estima tu dividendo mensual y el costo total de financiamiento en Chile
          </p>
        </div>
      </div>

      {/* Visualización Destacada del Dividendo Mensual con Moneda Dinámica */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <span className="text-xs uppercase font-bold tracking-wider text-slate-400">
            Dividendo Mensual Estimado
          </span>
          <div className="text-4xl font-extrabold tracking-tight text-white mt-1">
            {format(breakdown.monthlyPayment, true)}
          </div>
        </div>

        {/* Barra Proporcional de Costos */}
        <div className="flex-1 max-w-md">
          <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden flex">
            <div
              style={{ width: `${principalPercent}%` }}
              className="bg-blue-500 transition-all duration-300"
              title="Capital e Intereses"
            />
            <div
              style={{ width: `${taxPercent}%` }}
              className="bg-emerald-400 transition-all duration-300"
              title="Contribuciones"
            />
            <div
              style={{ width: `${insurancePercent}%` }}
              className="bg-amber-400 transition-all duration-300"
              title="Seguros (Desgravamen/Sismo)"
            />
            <div
              style={{ width: `${hoaPercent}%` }}
              className="bg-purple-400 transition-all duration-300"
              title="Gastos Comunes"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>Dividendo Base: <strong>{format(breakdown.principalAndInterest)}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Contribuciones: <strong>{format(breakdown.monthlyPropertyTax)}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>Seguros: <strong>{format(breakdown.monthlyInsurance)}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <span>Gastos Comunes: <strong>{format(breakdown.monthlyHoa)}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Controles Interactivos con Sliders e Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Precio de la Propiedad */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Valor de la Propiedad
            </label>
            <span className="text-sm font-bold text-slate-900">
              {format(homePrice)}
            </span>
          </div>
          <input
            type="range"
            min={50000000}
            max={3000000000}
            step={5000000}
            value={homePrice}
            onChange={(e) => setHomePrice(Number(e.target.value))}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>

        {/* Pie / Entrada Inicial */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Pie Inicial ({downPaymentPercent}%)
            </label>
            <span className="text-sm font-bold text-slate-900">
              {format(breakdown.downPaymentAmount)}
            </span>
          </div>
          <input
            type="range"
            min={10}
            max={50}
            step={5}
            value={downPaymentPercent}
            onChange={(e) => setDownPaymentPercent(Number(e.target.value))}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>

        {/* Plazo del Crédito */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
            Plazo del Crédito
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[15, 20, 25].map((years) => (
              <button
                key={years}
                type="button"
                onClick={() => setLoanTermYears(years)}
                className={`py-2 text-xs font-bold rounded-xl border transition-all ${
                  loanTermYears === years
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {years} Años
              </button>
            ))}
          </div>
        </div>

        {/* Tasa de Interés Anual */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Tasa de Interés Anual
            </label>
            <span className="text-sm font-bold text-slate-900">
              {interestRate.toFixed(2)}%
            </span>
          </div>
          <input
            type="range"
            min={2.5}
            max={8.5}
            step={0.05}
            value={interestRate}
            onChange={(e) => setInterestRate(Number(e.target.value))}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>
      </div>

      {/* Resumen Financiero */}
      <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl">
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Monto Financiado</span>
          <div className="text-base font-bold text-slate-900">{format(breakdown.loanAmount)}</div>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Total Intereses Estimados</span>
          <div className="text-base font-bold text-slate-900">{format(breakdown.totalInterestPaid)}</div>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Costo Total del Crédito</span>
          <div className="text-base font-bold text-slate-900">{format(breakdown.totalCostOverTerm)}</div>
        </div>
      </div>
    </div>
  );
}
