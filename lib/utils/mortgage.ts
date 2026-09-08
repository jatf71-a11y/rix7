import { MortgageBreakdown, MortgageInputs } from '../types/property';

/**
 * Calcula la amortización de un préstamo hipotecario (Sistema Francés - Cuota Fija)
 * Fórmula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
 * Donde:
 * M = Cuota mensual de capital e intereses
 * P = Principal del préstamo (Precio - Enganche)
 * r = Tasa de interés mensual (Tasa Anual / 12 / 100)
 * n = Número total de pagos mensuales (Años * 12)
 */
export function calculateMortgage(inputs: MortgageInputs): MortgageBreakdown {
  const {
    homePrice,
    downPaymentPercent,
    loanTermYears,
    interestRate,
    annualPropertyTaxRate = 0.6, // % anual estimado de IBI / Impuesto predial
    annualHomeInsurance = 480, // Seguro de hogar anual promedio
    monthlyHoa = 0, // Gastos de comunidad mensuales
  } = inputs;

  const downPaymentAmount = (homePrice * downPaymentPercent) / 100;
  const loanAmount = Math.max(0, homePrice - downPaymentAmount);

  const numberOfPayments = loanTermYears * 12;
  const monthlyInterestRate = interestRate / 100 / 12;

  let principalAndInterest = 0;

  if (loanAmount > 0) {
    if (monthlyInterestRate > 0) {
      principalAndInterest =
        (loanAmount *
          (monthlyInterestRate * Math.pow(1 + monthlyInterestRate, numberOfPayments))) /
        (Math.pow(1 + monthlyInterestRate, numberOfPayments) - 1);
    } else {
      principalAndInterest = loanAmount / numberOfPayments;
    }
  }

  const monthlyPropertyTax = (homePrice * (annualPropertyTaxRate / 100)) / 12;
  const monthlyInsurance = annualHomeInsurance / 12;
  const monthlyPayment = principalAndInterest + monthlyPropertyTax + monthlyInsurance + monthlyHoa;

  const totalCostOverTerm = principalAndInterest * numberOfPayments;
  const totalInterestPaid = Math.max(0, totalCostOverTerm - loanAmount);

  return {
    monthlyPayment: Math.round(monthlyPayment),
    principalAndInterest: Math.round(principalAndInterest),
    monthlyPropertyTax: Math.round(monthlyPropertyTax),
    monthlyInsurance: Math.round(monthlyInsurance),
    monthlyHoa: Math.round(monthlyHoa),
    downPaymentAmount: Math.round(downPaymentAmount),
    loanAmount: Math.round(loanAmount),
    totalInterestPaid: Math.round(totalInterestPaid),
    totalCostOverTerm: Math.round(totalCostOverTerm),
  };
}
