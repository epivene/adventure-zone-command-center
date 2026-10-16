# Owner-only booking-agent planning API

Prefix: `/api/admin/agent-tax`. Use the existing authenticated `apiFetch`.
Keep personal records separate from shared business and crew finances.
Route `/settings/tax-receipts`: Records, Pay owed to me, Tax estimate.
All money is integer USD cents, max 1,000,000,000, nonnegative except ND adjustments.
Revision conflicts return 409. Preserve unsaved fields and explain the conflict.

## Pay owed to me

The user's default pay is **$600 per week**, with manual overrides.
Never accrue guessed weeks automatically. User explicitly adds earned weeks.
Weekly entry title defaults to "Weekly booking-agent pay", amount 60000.
Manual entries allow custom title/amount. Duplicate weekly earned dates return 409.

`GET /pay?page=1&limit=25`:

    {items:PayItem[],total,summary:{earnedCents,paidCents,remainingCents,overdueCents}}

PayItem:

    {id,title,kind:"weekly"|"manual",earnedDate:"YYYY-MM-DD",
     dueDate:string|null,amountCents,paidCents,remainingCents,notes:string|null,
     revision,createdAt,
     payments:[{id,title,amountCents,recordDate,paymentMethod}]}

Totals include ALL dates, independent of the Records tax-year filter.

- POST `/pay` body `{title,kind,earnedDate,dueDate,amountCents,notes}` -> 201 `{item}`
- PATCH `/pay/:id` same body plus `expectedRevision` -> `{item}`
- DELETE `/pay/:id` `{confirmation:"DELETE",expectedRevision}` -> `{ok:true}`
- GET `/pay/export` -> complete all-dates CSV
- POST `/pay/:id/payments` body:

      {amountCents,recordDate,paymentMethod,counterparty:null|string,notes:null|string,
       expectedRevision,paymentRequestId:crypto.randomUUID()}

  -> 201 `{item,recordId}`. Keep the same paymentRequestId on retries until success.
  Block double submission. Partial payments allowed; overpayment rejected.

Recording a payment creates exactly one received-income ledger entry. Tell users
not to enter it again as income. Unpaid earnings do NOT count as received income.
The existing TaxRecord gains `payItemId:string|null`.
Payment-linked income allows title/notes/booking/category/counterparty updates,
but amount/date/year/type/payment method cannot change. To correct payment
amount/date, delete its income entry with confirmation and record it again.
Deleting that income entry restores the pay balance automatically.
Pay entries with payments cannot be deleted; earned amount cannot drop below paid.

## Annual tax planning

GET `/estimate/:year`, **only 2025 and 2026 supported**:

    {settings:Settings|null,revision:number,
     recorded:{incomeCents,expenseCents,profitCents},estimate:Estimate|null,
     supportedYears:[2025,2026],sources:[{title,url}],warnings:string[]}

PUT `/estimate/:year` body `{expectedRevision:number,settings:Settings}` -> same response.
Start with settings null and no result: filing status and full-year ND residence
must be explicitly confirmed, never silently assume a status.
Explicit Save assumptions; no financial data in localStorage.

Settings:

    {filingStatus:"single"|"married_joint"|"married_separate"|"head_household",
     fullYearNdResident:true,
     additionalIncomeCents:number, additionalExpensesCents:number,
     nonDeductibleExpensesCents:number,
     wagesCents:number, ownSocialSecurityWagesCents:number, medicareWagesCents:number,
     otherIncomeCents:number, otherAdjustmentsCents:number,
     deductionOverrideCents:number|null, qbiDeductionCents:number,
     ndAdjustmentCents:number,
     federalCreditsCents:number, ndCreditsCents:number,
     federalWithholdingCents:number, ndWithholdingCents:number,
     federalPaymentsCents:number, ndPaymentsCents:number}

Money input explanations:
- additionalIncome/Expenses: expected REMAINDER of year, not annualized automatically
  and not unpaid earnings automatically.
- nonDeductibleExpenses: recorded expense amount that should NOT reduce profit;
  cannot exceed recorded expenses. Other recorded expenses are planning deductions
  only, user must review their eligibility.
- wages: annual W-2 box 1 household wages (joint includes spouse).
- ownSocialSecurityWages: owner's own annual box 3 wages, NOT spouse's.
- medicareWages: annual household box 5 wages (joint includes spouse).
- otherIncome: ordinary-rate income only, not capital gains/qualified dividends.
- otherAdjustments: other above-line deductions not already recorded as expenses.
- deductionOverride null uses year's base standard deduction; optional full override
  for itemized/dependent/age/blind or other applicable deduction.
- qbiDeduction: manually confirmed qualified business income deduction; default 0,
  app does NOT determine eligibility. Explain exclusion can overestimate income tax.
- ndAdjustment: signed addition/subtraction to federal taxable income.
- federal/ND credits: manually entered NONREFUNDABLE credits, default 0.
- withholding/payments: entered full-year withholding and estimated payments already
  made (payments not forecasts); never automatically inferred from receipt documents.
  These do not reduce business profit and must not be entered as expense deductions.

Estimate (all cents):

    {projectedProfitCents,netSelfEmploymentEarningsCents,selfEmploymentTaxCents,
     halfSelfEmploymentDeductionCents,additionalMedicareTaxCents,
     adjustedGrossIncomeCents,deductionCents,qbiDeductionCents,
     federalTaxableIncomeCents,federalIncomeTaxCents,ndTaxableIncomeCents,
     ndIncomeTaxCents,federalLiabilityCents,totalLiabilityCents,
     federalBalanceCents,ndBalanceCents,remainingToSetAsideCents}

Negative balances mean projected overpayment. RemainingToSetAside sums POSITIVE
IRS and ND balances separately (an ND overpayment cannot pay the IRS).
Show self-employment/federal/ND breakdown and after-payment remaining amount.
No SSN or account-number inputs.
Annual planning estimate, NOT a return or payment schedule. Assumes cash-basis,
full-year ND residence, only this one self-employed person/business. Other states,
spouse self-employment, AMT, investment taxes, refundable credits, penalty/safe-harbor
rules are not modeled. Sources and warnings come from API and must be visible.

## Existing frontend fixes

- Preserve actual server error on 503 (not always storage failure).
- Money parser max matches backend 1e9 cents.
- Open file-view blank tab synchronously before awaiting blob to avoid popup blocks;
  close on failure; don't persist blob URLs.
- Failed upload after saved entry must preserve the entry ID/revision; retry does
  NOT create another entry. Lock saved fields in partial-upload retry mode so
  changed fields cannot be silently discarded.
