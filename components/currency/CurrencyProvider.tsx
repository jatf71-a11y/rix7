'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Currency, formatPrice, DEFAULT_UF_RATE, DEFAULT_USD_RATE } from '@/lib/utils/formatters';

export interface ExchangeRates {
  uf: number;
  dolar: number;
  utm?: number;
  source?: string;
  date?: string;
}

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  rates: ExchangeRates;
  isLoadingRates: boolean;
  format: (amountInClp: number, isRent?: boolean) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>('CLP');
  const [rates, setRates] = useState<ExchangeRates>({
    uf: DEFAULT_UF_RATE,
    dolar: DEFAULT_USD_RATE,
    source: 'Banco Central de Chile',
  });
  const [isLoadingRates, setIsLoadingRates] = useState(true);

  // 1. Cargar preferencia local guardada
  useEffect(() => {
    const saved = localStorage.getItem('rix7_currency') as Currency;
    if (saved && (saved === 'CLP' || saved === 'UF' || saved === 'USD')) {
      setCurrencyState(saved);
    }
  }, []);

  // 2. Consultar el tipo de cambio oficial del Banco Central de Chile
  useEffect(() => {
    async function fetchOfficialRates() {
      try {
        const res = await fetch('/api/indicators');
        const data = await res.json();
        if (data.success && data.uf?.value && data.dolar?.value) {
          setRates({
            uf: data.uf.value,
            dolar: data.dolar.value,
            utm: data.utm?.value,
            source: data.source || 'Banco Central de Chile',
            date: data.date,
          });
        }
      } catch (err) {
        console.error('Error al cargar tipos de cambio oficiales:', err);
      } finally {
        setIsLoadingRates(false);
      }
    }

    fetchOfficialRates();
  }, []);

  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    localStorage.setItem('rix7_currency', c);
  };

  // Helper de formateo reactivo con tasas del Banco Central
  const format = (amountInClp: number, isRent: boolean = false) => {
    return formatPrice(amountInClp, currency, 'es-CL', isRent, rates.uf, rates.dolar);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, rates, isLoadingRates, format }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency debe usarse dentro de un CurrencyProvider');
  }
  return context;
}
