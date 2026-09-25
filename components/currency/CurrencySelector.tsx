'use client';

import React from 'react';
import { useCurrency } from './CurrencyProvider';
import { Currency, formatNumber } from '@/lib/utils/formatters';

interface CurrencySelectorProps {
  className?: string;
  size?: 'sm' | 'md';
}

export function CurrencySelector({ className = '', size = 'sm' }: CurrencySelectorProps) {
  const { currency, setCurrency, rates } = useCurrency();

  const options: { id: Currency; symbol: string; label: string }[] = [
    { id: 'CLP', symbol: '$', label: 'Pesos Chilenos (CLP)' },
    { id: 'UF', symbol: 'UF', label: `Unidad de Fomento (UF = $${formatNumber(Math.round(rates.uf))}) - Banco Central de Chile` },
    { id: 'USD', symbol: 'US$', label: `Dólar Observado (USD = $${formatNumber(Math.round(rates.dolar))}) - Banco Central de Chile` },
  ];

  const paddingClass = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs sm:text-sm';

  return (
    <div className="flex items-center gap-2">
      <div className={`inline-flex rounded-xl bg-slate-100 p-0.5 border border-slate-200 shadow-inner ${className}`}>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setCurrency(opt.id)}
            title={opt.label}
            className={`flex items-center gap-1 font-extrabold rounded-lg transition-all ${paddingClass} ${
              currency === opt.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <span>{opt.symbol}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
