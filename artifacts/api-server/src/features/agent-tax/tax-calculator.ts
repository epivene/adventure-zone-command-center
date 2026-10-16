import { TaxError } from "./model";
import type { EstimateSettings } from "./planning-model";

type Status = EstimateSettings["filingStatus"];
type Year = 2025 | 2026;
// Dollar thresholds from IRS 2025 tables / Rev. Proc. 2025-32, and ND 2025
// ND-1 / 2026 ND-1ES. Never extrapolate one year's rules into another year.
const rules: Record<Year, {
  socialSecurityCap: number; deduction: Record<Status,number>;
  federal: Record<Status,number[]>; nd: Record<Status,number[]>;
}> = {
  2025: {
    socialSecurityCap:176100,
    deduction:{single:15750,married_joint:31500,married_separate:15750,head_household:23625},
    federal:{
      single:[11925,48475,103350,197300,250525,626350],
      married_joint:[23850,96950,206700,394600,501050,751600],
      married_separate:[11925,48475,103350,197300,250525,375800],
      head_household:[17000,64850,103350,197300,250500,626350],
    },
    nd:{single:[48475,244825],married_joint:[80975,298075],married_separate:[40475,149025],head_household:[64950,271450]},
  },
  2026: {
    socialSecurityCap:184500,
    deduction:{single:16100,married_joint:32200,married_separate:16100,head_household:24150},
    federal:{
      single:[12400,50400,105700,201775,256225,640600],
      married_joint:[24800,100800,211400,403550,512450,768700],
      married_separate:[12400,50400,105700,201775,256225,384350],
      head_household:[17700,67450,105700,201750,256200,640600],
    },
    nd:{single:[49575,250400],married_joint:[82800,304850],married_separate:[41400,152425],head_household:[66400,277600]},
  },
};

export const taxSources = [
  {title:"IRS federal brackets (2025)",url:"https://www.irs.gov/filing/federal-income-tax-rates-and-brackets"},
  {title:"IRS 2026 brackets and standard deductions",url:"https://www.irs.gov/pub/irs-drop/rp-25-32.pdf"},
  {title:"IRS 2025/2026 standard deductions",url:"https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill"},
  {title:"IRS self-employment tax",url:"https://www.irs.gov/taxtopics/tc554"},
  {title:"Social Security annual wage bases",url:"https://www.ssa.gov/oact/cola/cbb.html"},
  {title:"North Dakota 2025 rates",url:"https://www.tax.nd.gov/individual-income-tax"},
  {title:"North Dakota 2026 estimated-tax worksheet and rates",url:"https://www.tax.nd.gov/sites/www/files/documents/forms/software-developer/individual-income-forms/28709-form-nd-1es-2026%20final.pdf"},
];
export const taxWarnings = [
  "Annual planning estimate, not a tax return, payment instruction, or guarantee. Uses 2025/2026 rules; unsupported years are not estimated.",
  "Assumes cash-basis records, full-year North Dakota residence and one self-employed person/business. Unpaid earnings are not received income.",
  "No automatic annualization. Enter expected remaining-year income/expenses and full-year household wages/withholding. Estimated tax payments mean payments already made.",
  "Recorded expenses reduce projected profit only for planning. Review deductibility and add back non-deductible expenses; do not record federal/ND income-tax payments as business expenses.",
  "Base standard deduction is used unless overridden. QBI and nonrefundable credits are only included when entered; zero may overestimate income tax. Dependent/age/blindness and other special deductions require an appropriate override.",
  "Does not calculate refundable credits (including EITC), investment/capital-gains taxes, AMT, other-state taxes/credits, spouse self-employment, special SE methods, safe-harbor payments, penalties or installment due amounts.",
];

/** Piecewise marginal tax; thresholds are dollars, amounts/results integer cents. */
export function bracketTax(cents:number, thresholds:number[], rates:number[]) {
  let tax = 0, lower = 0;
  const amount = Math.max(0,cents);
  for (let i=0;i<rates.length;i++) {
    const upper = i < thresholds.length ? thresholds[i]*100 : Infinity;
    tax += Math.max(0,Math.min(amount,upper)-lower)*rates[i];
    if (amount <= upper) break;
    lower = upper;
  }
  return Math.round(tax);
}

export function calculateTax(year:number,s:EstimateSettings,recorded:{incomeCents:number;expenseCents:number}) {
  if (year !== 2025 && year !== 2026) throw new TaxError(400,"Tax estimates are supported only for 2025 and 2026.");
  if (s.nonDeductibleExpensesCents > recorded.expenseCents) throw new TaxError(400,"Non-deductible recorded expenses cannot exceed recorded expenses.");
  const r = rules[year];
  const projectedProfitCents = recorded.incomeCents-recorded.expenseCents+s.nonDeductibleExpensesCents+s.additionalIncomeCents-s.additionalExpensesCents;
  const netSelfEmploymentEarningsCents = Math.round(Math.max(0,projectedProfitCents)*0.9235);
  // Schedule SE threshold is on net earnings after the 92.35% adjustment.
  const taxableSe = netSelfEmploymentEarningsCents >= 40000 ? netSelfEmploymentEarningsCents : 0;
  const socialSecurity = Math.round(Math.min(taxableSe,Math.max(0,r.socialSecurityCap*100-s.ownSocialSecurityWagesCents))*0.124);
  const medicare = Math.round(taxableSe*0.029);
  const selfEmploymentTaxCents = socialSecurity+medicare;
  // Additional Medicare isn't part of the deductible half of Schedule SE tax.
  const threshold = (s.filingStatus === "married_joint" ? 250000 : s.filingStatus === "married_separate" ? 125000 : 200000)*100;
  const additionalMedicareTaxCents = Math.round(Math.max(0,s.medicareWagesCents+taxableSe-threshold)*0.009);
  const halfSelfEmploymentDeductionCents = Math.round(selfEmploymentTaxCents/2);
  const adjustedGrossIncomeCents = Math.max(0,projectedProfitCents+s.wagesCents+s.otherIncomeCents-halfSelfEmploymentDeductionCents-s.otherAdjustmentsCents);
  const deductionCents = s.deductionOverrideCents ?? r.deduction[s.filingStatus]*100;
  const beforeQbi = Math.max(0,adjustedGrossIncomeCents-deductionCents);
  const qbiDeductionCents = Math.min(beforeQbi,s.qbiDeductionCents);
  const federalTaxableIncomeCents = beforeQbi-qbiDeductionCents;
  const federalIncomeTaxCents = Math.max(0,bracketTax(federalTaxableIncomeCents,r.federal[s.filingStatus],[.10,.12,.22,.24,.32,.35,.37])-s.federalCreditsCents);
  const ndTaxableIncomeCents = Math.max(0,federalTaxableIncomeCents+s.ndAdjustmentCents);
  const ndIncomeTaxCents = Math.max(0,bracketTax(ndTaxableIncomeCents,r.nd[s.filingStatus],[0,.0195,.025])-s.ndCreditsCents);
  const federalLiabilityCents = federalIncomeTaxCents+selfEmploymentTaxCents+additionalMedicareTaxCents;
  const totalLiabilityCents = federalLiabilityCents+ndIncomeTaxCents;
  const federalBalanceCents = federalLiabilityCents-s.federalWithholdingCents-s.federalPaymentsCents;
  const ndBalanceCents = ndIncomeTaxCents-s.ndWithholdingCents-s.ndPaymentsCents;
  return {projectedProfitCents,netSelfEmploymentEarningsCents,selfEmploymentTaxCents,halfSelfEmploymentDeductionCents,
    additionalMedicareTaxCents,adjustedGrossIncomeCents,deductionCents,qbiDeductionCents,federalTaxableIncomeCents,
    federalIncomeTaxCents,ndTaxableIncomeCents,ndIncomeTaxCents,federalLiabilityCents,totalLiabilityCents,
    federalBalanceCents,ndBalanceCents,remainingToSetAsideCents:Math.max(0,federalBalanceCents)+Math.max(0,ndBalanceCents)};
}
