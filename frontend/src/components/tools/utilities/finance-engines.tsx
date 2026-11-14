"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileCheck2, MessageCircle, PenLine, Plus, Printer, Trash2 } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CopyButton } from "../dev/parts";
import { SignatureMaker } from "../pdf/signature";
import { CHECKER } from "../image/task";
import type { EngineProps } from "./text-engines";

/* ========================================================================
 * CURRENCY & INDIAN NUMBERING HELPERS
 * ======================================================================== */

type CurrencyCode = "INR" | "USD" | "EUR" | "GBP";

const CURRENCIES: Record<CurrencyCode, { symbol: string; locale: string; label: string }> = {
  INR: { symbol: "₹", locale: "en-IN", label: "₹ INR" },
  USD: { symbol: "$", locale: "en-US", label: "$ USD" },
  EUR: { symbol: "€", locale: "en-IE", label: "€ EUR" },
  GBP: { symbol: "£", locale: "en-GB", label: "£ GBP" },
};

export function fmtMoney(val: number, cur: CurrencyCode = "INR", decimals = 0): string {
  const spec = CURRENCIES[cur];
  const safe = Number.isFinite(val) ? val : 0;
  return `${spec.symbol}${safe.toLocaleString(spec.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function fmtCompactInr(val: number, cur: CurrencyCode = "INR"): string {
  if (cur !== "INR") return fmtMoney(val, cur, 0);
  const abs = Math.abs(val);
  if (abs >= 1e7) return `${(val / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(val / 1e5).toFixed(2)} L`;
  return fmtMoney(val, "INR", 0);
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seven" + "ty", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rem = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rem ? twoDigits(rem) : ""].filter(Boolean).join(" ");
}

export function amountToIndianWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const convert = (n: number): string => {
    if (n === 0) return "Zero";
    const crore = Math.floor(n / 10_000_000);
    const lakh = Math.floor((n % 10_000_000) / 100_000);
    const thousand = Math.floor((n % 100_000) / 1000);
    const rest = n % 1000;
    return [
      crore ? `${convert(crore)} Crore` : "",
      lakh ? `${twoDigits(lakh)} Lakh` : "",
      thousand ? `${twoDigits(thousand)} Thousand` : "",
      rest ? threeDigits(rest) : "",
    ]
      .filter(Boolean)
      .join(" ");
  };
  const rPart = `Rupees ${convert(rupees)}`;
  return paise > 0 ? `${rPart} and ${twoDigits(paise)} Paise Only` : `${rPart} Only`;
}

/* ========================================================================
 * PURE MATH SOLVERS (Exported for testing)
 * ======================================================================== */

export function calcEmi(principal: number, annualRate: number, months: number, extraMonthly = 0) {
  const P = Math.max(0, principal);
  const n = Math.max(1, Math.round(months));
  const r = Math.max(0, annualRate) / 1200;
  const baseEmi = r === 0 ? P / n : (P * r * (1 + r) ** n) / ((1 + r) ** n - 1);

  let bal = P;
  let totalInterest = 0;
  let actualMonths = 0;
  const yearly: { year: number; principal: number; interest: number; balance: number }[] = [];
  let yP = 0;
  let yI = 0;

  while (bal > 0.5 && actualMonths < n + 600) {
    actualMonths++;
    const interest = bal * r;
    const pay = Math.min(bal + interest, baseEmi + Math.max(0, extraMonthly));
    const prin = pay - interest;
    bal = Math.max(0, bal - prin);
    totalInterest += interest;
    yP += prin;
    yI += interest;
    if (actualMonths % 12 === 0 || bal <= 0.5) {
      yearly.push({
        year: Math.ceil(actualMonths / 12),
        principal: yP,
        interest: yI,
        balance: bal,
      });
      yP = 0;
      yI = 0;
    }
  }

  const standardInterest = Math.max(0, baseEmi * n - P);
  return {
    emi: baseEmi,
    totalInterest,
    totalPayment: P + totalInterest,
    monthsSaved: Math.max(0, n - actualMonths),
    interestSaved: Math.max(0, standardInterest - totalInterest),
    actualMonths,
    yearly,
  };
}

export function calcSip(monthly: number, annualReturn: number, years: number, stepUpPct = 0, inflationPct = 0) {
  let sip = Math.max(0, monthly);
  const r = Math.max(0, annualReturn) / 1200;
  const step = Math.max(0, stepUpPct) / 100;
  const inf = Math.max(0, inflationPct) / 100;
  let corpus = 0;
  let invested = 0;
  const yearly: { year: number; invested: number; gain: number; total: number; realValue: number }[] = [];

  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      corpus = (corpus + sip) * (1 + r);
      invested += sip;
    }
    const realValue = corpus / (1 + inf) ** y;
    yearly.push({
      year: y,
      invested,
      gain: Math.max(0, corpus - invested),
      total: corpus,
      realValue,
    });
    sip = sip * (1 + step);
  }

  const final = yearly[yearly.length - 1] ?? { invested: 0, gain: 0, total: 0, realValue: 0 };
  return { ...final, yearly };
}

export function calcCompound(principal: number, monthlyAdd: number, annualRate: number, years: number, compoundsPerYear: number) {
  let bal = Math.max(0, principal);
  let totalContributed = bal;
  const rate = Math.max(0, annualRate) / 100;
  const stepPerMonthRate = (1 + rate / compoundsPerYear) ** (compoundsPerYear / 12) - 1;
  const yearly: { year: number; contributed: number; interest: number; balance: number }[] = [];

  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      bal = bal * (1 + stepPerMonthRate) + Math.max(0, monthlyAdd);
      totalContributed += Math.max(0, monthlyAdd);
    }
    yearly.push({
      year: y,
      contributed: totalContributed,
      interest: Math.max(0, bal - totalContributed),
      balance: bal,
    });
  }
  const final = yearly[yearly.length - 1] ?? { contributed: bal, interest: 0, balance: bal };
  return { ...final, yearly };
}

export function calcGst(amount: number, ratePct: number, inclusive: boolean, interState: boolean) {
  const safeAmt = Math.max(0, amount);
  const rate = Math.max(0, ratePct) / 100;
  const base = inclusive ? safeAmt / (1 + rate) : safeAmt;
  const gstTotal = inclusive ? safeAmt - base : safeAmt * rate;
  const gross = inclusive ? safeAmt : base + gstTotal;
  return {
    base,
    gstTotal,
    cgst: interState ? 0 : gstTotal / 2,
    sgst: interState ? 0 : gstTotal / 2,
    igst: interState ? gstTotal : 0,
    gross,
  };
}

export type ExpenseEntry = { id: string; title: string; amount: number; paidBy: string; splitAmong: string[] };

export function settleExpenses(people: string[], expenses: ExpenseEntry[]) {
  const paid = new Map<string, number>();
  const share = new Map<string, number>();
  for (const p of people) {
    paid.set(p, 0);
    share.set(p, 0);
  }
  let totalSpent = 0;
  for (const ex of expenses) {
    const validSplit = ex.splitAmong.filter((p) => people.includes(p));
    if (!people.includes(ex.paidBy) || validSplit.length === 0 || ex.amount <= 0) continue;
    totalSpent += ex.amount;
    paid.set(ex.paidBy, (paid.get(ex.paidBy) ?? 0) + ex.amount);
    const each = ex.amount / validSplit.length;
    for (const p of validSplit) share.set(p, (share.get(p) ?? 0) + each);
  }

  const balances = people.map((name) => {
    const p = paid.get(name) ?? 0;
    const s = share.get(name) ?? 0;
    return { name, paid: p, share: s, net: p - s };
  });

  const debtors = balances
    .filter((b) => b.net < -0.01)
    .map((b) => ({ name: b.name, amt: -b.net }))
    .sort((a, b) => b.amt - a.amt);
  const creditors = balances
    .filter((b) => b.net > 0.01)
    .map((b) => ({ name: b.name, amt: b.net }))
    .sort((a, b) => b.amt - a.amt);

  const transfers: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amt = Math.min(d.amt, c.amt);
    if (amt > 0.01) transfers.push({ from: d.name, to: c.name, amount: amt });
    d.amt -= amt;
    c.amt -= amt;
    if (d.amt < 0.01) i++;
    if (c.amt < 0.01) j++;
  }

  return { totalSpent, balances, transfers };
}

/* ========================================================================
 * 1. EMI, SIP & COMPOUND INTEREST CALCULATOR
 * ======================================================================== */

function NumField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="label-mono mb-1 block text-ink-3">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        step={step}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
        className="h-9 w-full rounded-[8px] border border-line bg-surface px-3 font-mono text-sm text-ink outline-none focus:border-ink"
      />
    </label>
  );
}

export function FinanceCalcEngine({ preset }: EngineProps) {
  const initTab = preset.mode === "sip" || preset.mode === "compound" ? preset.mode : "emi";
  const [tab, setTab] = useState<"emi" | "sip" | "compound">(initTab);
  const [cur, setCur] = useState<CurrencyCode>("INR");

  // EMI state
  const [loanAmt, setLoanAmt] = useState(2500000);
  const [loanRate, setLoanRate] = useState(8.75);
  const [loanYears, setLoanYears] = useState(20);
  const [extraEmi, setExtraEmi] = useState(0);

  // SIP state
  const [sipMonthly, setSipMonthly] = useState(15000);
  const [sipRate, setSipRate] = useState(12);
  const [sipYears, setSipYears] = useState(15);
  const [sipStepUp, setSipStepUp] = useState(10);
  const [sipInflation, setSipInflation] = useState(6);

  // Compound state
  const [compPrincipal, setCompPrincipal] = useState(500000);
  const [compMonthly, setCompMonthly] = useState(5000);
  const [compRate, setCompRate] = useState(9.5);
  const [compYears, setCompYears] = useState(10);
  const [compFreq, setCompFreq] = useState(4);

  const emiRes = useMemo(() => calcEmi(loanAmt, loanRate, loanYears * 12, extraEmi), [loanAmt, loanRate, loanYears, extraEmi]);
  const sipRes = useMemo(() => calcSip(sipMonthly, sipRate, sipYears, sipStepUp, sipInflation), [sipMonthly, sipRate, sipYears, sipStepUp, sipInflation]);
  const compRes = useMemo(() => calcCompound(compPrincipal, compMonthly, compRate, compYears, compFreq), [compPrincipal, compMonthly, compRate, compYears, compFreq]);

  const ratioSplit = useMemo(() => {
    if (tab === "emi") {
      const tot = Math.max(1, emiRes.totalPayment);
      return {
        aLabel: "Principal",
        aVal: loanAmt,
        aPct: Math.round((loanAmt / tot) * 100),
        bLabel: "Total interest",
        bVal: emiRes.totalInterest,
        bPct: 100 - Math.round((loanAmt / tot) * 100),
      };
    }
    if (tab === "sip") {
      const tot = Math.max(1, sipRes.total);
      return {
        aLabel: "Total invested",
        aVal: sipRes.invested,
        aPct: Math.round((sipRes.invested / tot) * 100),
        bLabel: "Estimated returns",
        bVal: sipRes.gain,
        bPct: 100 - Math.round((sipRes.invested / tot) * 100),
      };
    }
    const tot = Math.max(1, compRes.balance);
    return {
      aLabel: "Principal contributed",
      aVal: compRes.contributed,
      aPct: Math.round((compRes.contributed / tot) * 100),
      bLabel: "Compound interest",
      bVal: compRes.interest,
      bPct: 100 - Math.round((compRes.contributed / tot) * 100),
    };
  }, [tab, emiRes, loanAmt, sipRes, compRes]);

  const exportScheduleCsv = () => {
    let lines: string[] = [];
    if (tab === "emi") {
      lines = ["Year,Principal Paid,Interest Paid,Ending Balance", ...emiRes.yearly.map((y) => `${y.year},${y.principal.toFixed(2)},${y.interest.toFixed(2)},${y.balance.toFixed(2)}`)];
    } else if (tab === "sip") {
      lines = ["Year,Invested,Estimated Gain,Nominal Corpus,Inflation-Adjusted Value", ...sipRes.yearly.map((y) => `${y.year},${y.invested.toFixed(2)},${y.gain.toFixed(2)},${y.total.toFixed(2)},${y.realValue.toFixed(2)}`)];
    } else {
      lines = ["Year,Contributed,Interest Earned,Total Balance", ...compRes.yearly.map((y) => `${y.year},${y.contributed.toFixed(2)},${y.interest.toFixed(2)},${y.balance.toFixed(2)}`)];
    }
    saveBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), `${tab}-schedule.csv`);
  };

  return (
    <>
      <Panel>
        <Row label="Calculator">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips
              value={tab}
              onChange={setTab}
              options={[
                { value: "emi", label: "Loan EMI" },
                { value: "sip", label: "Mutual Fund SIP" },
                { value: "compound", label: "Compound interest" },
              ]}
            />
            <Chips
              value={cur}
              onChange={setCur}
              options={(Object.keys(CURRENCIES) as CurrencyCode[]).map((c) => ({ value: c, label: CURRENCIES[c].label }))}
            />
          </div>
        </Row>

        {tab === "emi" && (
          <>
            <Row label="Quick presets">
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "Home Loan ₹50L · 8.6%", amt: 5_000_000, rate: 8.6, yrs: 20 },
                  { label: "Car Loan ₹10L · 9.2%", amt: 1_000_000, rate: 9.2, yrs: 5 },
                  { label: "Personal ₹3L · 12.5%", amt: 300_000, rate: 12.5, yrs: 3 },
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => (setLoanAmt(p.amt), setLoanRate(p.rate), setLoanYears(p.yrs))}
                    className="h-8 rounded-[7px] border border-line bg-paper px-2.5 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Loan details">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumField label="Loan amount" value={loanAmt} onChange={setLoanAmt} step={10000} />
                <NumField label="Interest rate (% p.a.)" value={loanRate} onChange={setLoanRate} step={0.1} />
                <NumField label="Tenure (years)" value={loanYears} onChange={(v) => setLoanYears(Math.max(1, Math.min(40, v)))} />
                <NumField label="Extra prepayment / mo" value={extraEmi} onChange={setExtraEmi} step={1000} />
              </div>
              <div className="mt-3 grid gap-3 @xl:grid-cols-2">
                <Slider label="Rate" value={loanRate} min={4} max={24} step={0.25} onChange={setLoanRate} format={(v) => `${v}%`} />
                <Slider label="Tenure" value={loanYears} min={1} max={35} onChange={setLoanYears} format={(v) => `${v} yrs`} />
              </div>
            </Row>
          </>
        )}

        {tab === "sip" && (
          <Row label="SIP parameters">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <NumField label="Monthly SIP" value={sipMonthly} onChange={setSipMonthly} step={500} />
              <NumField label="Return (% p.a.)" value={sipRate} onChange={setSipRate} step={0.5} />
              <NumField label="Years" value={sipYears} onChange={(v) => setSipYears(Math.max(1, Math.min(50, v)))} />
              <NumField label="Annual step-up %" value={sipStepUp} onChange={(v) => setSipStepUp(Math.min(40, v))} />
              <NumField label="Inflation % (real val)" value={sipInflation} onChange={(v) => setSipInflation(Math.min(20, v))} step={0.5} />
            </div>
            <div className="mt-3 grid gap-3 @xl:grid-cols-3">
              <Slider label="Monthly SIP" value={Math.min(200000, sipMonthly)} min={500} max={200000} step={500} onChange={setSipMonthly} format={(v) => fmtMoney(v, cur)} />
              <Slider label="Expected return" value={sipRate} min={4} max={26} step={0.5} onChange={setSipRate} format={(v) => `${v}%`} />
              <Slider label="Years" value={sipYears} min={1} max={40} onChange={setSipYears} format={(v) => `${v} yrs`} />
            </div>
          </Row>
        )}

        {tab === "compound" && (
          <>
            <Row label="Inputs">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumField label="Initial principal" value={compPrincipal} onChange={setCompPrincipal} step={5000} />
                <NumField label="Monthly addition" value={compMonthly} onChange={setCompMonthly} step={1000} />
                <NumField label="Interest rate (% p.a.)" value={compRate} onChange={setCompRate} step={0.25} />
                <NumField label="Years" value={compYears} onChange={(v) => setCompYears(Math.max(1, Math.min(50, v)))} />
              </div>
            </Row>
            <Row label="Compounding">
              <Chips
                value={compFreq}
                onChange={setCompFreq}
                options={[
                  { value: 12, label: "Monthly" },
                  { value: 4, label: "Quarterly" },
                  { value: 2, label: "Half-yearly" },
                  { value: 1, label: "Yearly" },
                ]}
              />
            </Row>
          </>
        )}
      </Panel>

      {/* Hero Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {tab === "emi" ? (
          <>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Monthly EMI</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-accent tabular-nums">{fmtMoney(emiRes.emi, cur)}</p>
              <p className="mt-0.5 text-xs text-ink-3">{emiRes.actualMonths} monthly installments</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Total interest</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink tabular-nums">{fmtMoney(emiRes.totalInterest, cur)}</p>
              <p className="mt-0.5 text-xs text-ink-3">{fmtCompactInr(emiRes.totalInterest, cur)}</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Total payable</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink tabular-nums">{fmtMoney(emiRes.totalPayment, cur)}</p>
              <p className="mt-0.5 text-xs text-ink-3">{fmtCompactInr(emiRes.totalPayment, cur)}</p>
            </div>
          </>
        ) : tab === "sip" ? (
          <>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Future wealth corpus</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-accent tabular-nums">{fmtMoney(sipRes.total, cur)}</p>
              <p className="mt-0.5 text-xs text-ink-3">{fmtCompactInr(sipRes.total, cur)}</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Inflation-adjusted ({sipInflation}%)</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink tabular-nums">{fmtMoney(sipRes.realValue, cur)}</p>
              <p className="mt-0.5 text-xs text-ink-3">In today&apos;s purchasing power</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Total invested → Gain</p>
              <p className="mt-1 font-mono text-lg font-semibold text-ink tabular-nums">
                {fmtCompactInr(sipRes.invested, cur)} → +{fmtCompactInr(sipRes.gain, cur)}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">Step-up {sipStepUp}% every year</p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Maturity balance</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-accent tabular-nums">{fmtMoney(compRes.balance, cur)}</p>
              <p className="mt-0.5 text-xs text-ink-3">{fmtCompactInr(compRes.balance, cur)}</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Total contributed</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink tabular-nums">{fmtMoney(compRes.contributed, cur)}</p>
              <p className="mt-0.5 text-xs text-ink-3">{fmtCompactInr(compRes.contributed, cur)}</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Interest earned</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-success tabular-nums">{fmtMoney(compRes.interest, cur)}</p>
              <p className="mt-0.5 text-xs text-ink-3">{fmtCompactInr(compRes.interest, cur)}</p>
            </div>
          </>
        )}
      </div>

      {tab === "emi" && extraEmi > 0 && emiRes.interestSaved > 0 && (
        <Notice tone="info">
          Prepaying {fmtMoney(extraEmi, cur)}/month saves <strong>{fmtMoney(emiRes.interestSaved, cur)}</strong> in interest and finishes the loan{" "}
          <strong>{emiRes.monthsSaved} months earlier</strong>!
        </Notice>
      )}

      {/* Breakdown bar */}
      <div className="rounded-md border border-line bg-surface p-4">
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs">
          <span className="font-medium text-ink">
            {ratioSplit.aLabel}: {fmtMoney(ratioSplit.aVal, cur)} ({ratioSplit.aPct}%)
          </span>
          <span className="font-medium text-accent">
            {ratioSplit.bLabel}: {fmtMoney(ratioSplit.bVal, cur)} ({ratioSplit.bPct}%)
          </span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-paper-2">
          <div className="bg-ink transition-all" style={{ width: `${ratioSplit.aPct}%` }} />
          <div className="bg-accent transition-all" style={{ width: `${ratioSplit.bPct}%` }} />
        </div>
      </div>

      {/* Yearly Schedule Table */}
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line bg-paper px-3.5 py-2.5">
          <span className="label-mono text-ink-2">Year-by-year breakdown</span>
          <button
            type="button"
            onClick={exportScheduleCsv}
            className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-medium text-ink hover:border-ink-3"
          >
            <Download aria-hidden className="size-3.5" /> Export CSV
          </button>
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full border-collapse text-left font-mono text-[13px] tabular-nums">
            <thead className="sticky top-0 border-b border-line bg-paper text-[12px] text-ink-2">
              <tr>
                <th className="px-3.5 py-2">Year</th>
                <th className="px-3.5 py-2">{tab === "emi" ? "Principal" : "Invested"}</th>
                <th className="px-3.5 py-2">{tab === "emi" ? "Interest" : "Gain / Interest"}</th>
                <th className="px-3.5 py-2 text-right">{tab === "emi" ? "Balance" : "Total value"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {tab === "emi"
                ? emiRes.yearly.map((y) => (
                    <tr key={y.year} className="hover:bg-paper/40">
                      <td className="px-3.5 py-2 text-ink-3">Yr {y.year}</td>
                      <td className="px-3.5 py-2 text-ink">{fmtMoney(y.principal, cur)}</td>
                      <td className="px-3.5 py-2 text-accent">{fmtMoney(y.interest, cur)}</td>
                      <td className="px-3.5 py-2 text-right font-medium text-ink">{fmtMoney(y.balance, cur)}</td>
                    </tr>
                  ))
                : tab === "sip"
                  ? sipRes.yearly.map((y) => (
                      <tr key={y.year} className="hover:bg-paper/40">
                        <td className="px-3.5 py-2 text-ink-3">Yr {y.year}</td>
                        <td className="px-3.5 py-2 text-ink">{fmtMoney(y.invested, cur)}</td>
                        <td className="px-3.5 py-2 text-success">{fmtMoney(y.gain, cur)}</td>
                        <td className="px-3.5 py-2 text-right font-medium text-ink">{fmtMoney(y.total, cur)}</td>
                      </tr>
                    ))
                  : compRes.yearly.map((y) => (
                      <tr key={y.year} className="hover:bg-paper/40">
                        <td className="px-3.5 py-2 text-ink-3">Yr {y.year}</td>
                        <td className="px-3.5 py-2 text-ink">{fmtMoney(y.contributed, cur)}</td>
                        <td className="px-3.5 py-2 text-success">{fmtMoney(y.interest, cur)}</td>
                        <td className="px-3.5 py-2 text-right font-medium text-ink">{fmtMoney(y.balance, cur)}</td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ========================================================================
 * 2. INDIAN GST, DISCOUNT & PERCENTAGE CALCULATOR
 * ======================================================================== */

export function GstPercentEngine({ preset }: EngineProps) {
  const initMode = preset.mode === "discount" || preset.mode === "percent" ? preset.mode : "gst";
  const [mode, setMode] = useState<"gst" | "discount" | "percent">(initMode);

  // GST state
  const [gstAmt, setGstAmt] = useState(10000);
  const [gstRate, setGstRate] = useState(18);
  const [gstInclusive, setGstInclusive] = useState(false);
  const [interState, setInterState] = useState(false);

  // Discount state
  const [origPrice, setOrigPrice] = useState(2499);
  const [disc1, setDisc1] = useState(20);
  const [disc2, setDisc2] = useState(10);
  const [extraTax, setExtraTax] = useState(0);

  // Percentage 3-in-1 state
  const [p1a, setP1a] = useState(18);
  const [p1b, setP1b] = useState(2500);
  const [p2a, setP2a] = useState(450);
  const [p2b, setP2b] = useState(1800);
  const [p3a, setP3a] = useState(1200);
  const [p3b, setP3b] = useState(1560);

  const gstRes = useMemo(() => calcGst(gstAmt, gstRate, gstInclusive, interState), [gstAmt, gstRate, gstInclusive, interState]);

  const discRes = useMemo(() => {
    const afterFirst = origPrice * (1 - Math.max(0, disc1) / 100);
    const afterCoupon = afterFirst * (1 - Math.max(0, disc2) / 100);
    const totalSaved = Math.max(0, origPrice - afterCoupon);
    const effectivePct = origPrice > 0 ? (totalSaved / origPrice) * 100 : 0;
    const taxAmt = afterCoupon * (Math.max(0, extraTax) / 100);
    return { afterFirst, afterCoupon, totalSaved, effectivePct, finalWithTax: afterCoupon + taxAmt, taxAmt };
  }, [origPrice, disc1, disc2, extraTax]);

  const gstSummaryText = `Base: ${fmtMoney(gstRes.base, "INR", 2)} | GST (${gstRate}%): ${fmtMoney(gstRes.gstTotal, "INR", 2)} (${interState ? `IGST ${fmtMoney(gstRes.igst, "INR", 2)}` : `CGST ${fmtMoney(gstRes.cgst, "INR", 2)} + SGST ${fmtMoney(gstRes.sgst, "INR", 2)}`}) | Total: ${fmtMoney(gstRes.gross, "INR", 2)}`;

  return (
    <>
      <Panel>
        <Row label="Tool">
          <Chips
            value={mode}
            onChange={setMode}
            options={[
              { value: "gst", label: "Indian GST (CGST / SGST / IGST)" },
              { value: "discount", label: "Discount & Coupon" },
              { value: "percent", label: "Percentage 3-in-1" },
            ]}
          />
        </Row>
      </Panel>

      {mode === "gst" && (
        <>
          <Panel>
            <Row label="Amount & mode">
              <div className="grid gap-3 @xl:grid-cols-2 @xl:items-end">
                <NumField label="Amount (₹ INR)" value={gstAmt} onChange={setGstAmt} step={100} />
                <Chips
                  value={gstInclusive ? "incl" : "excl"}
                  onChange={(v) => setGstInclusive(v === "incl")}
                  options={[
                    { value: "excl", label: "Exclusive (+ Add GST)" },
                    { value: "incl", label: "Inclusive (- Extract GST)" },
                  ]}
                />
              </div>
            </Row>
            <Row label="GST slab">
              <div className="flex flex-wrap items-center gap-2">
                <Chips
                  value={gstRate}
                  onChange={setGstRate}
                  options={[
                    { value: 0, label: "0%" },
                    { value: 3, label: "3% Gold" },
                    { value: 5, label: "5%" },
                    { value: 12, label: "12%" },
                    { value: 18, label: "18% Std" },
                    { value: 28, label: "28%" },
                  ]}
                />
              </div>
            </Row>
            <Row label="Supply type">
              <Chips
                value={interState ? "inter" : "intra"}
                onChange={(v) => setInterState(v === "inter")}
                options={[
                  { value: "intra", label: "Intra-state (CGST + SGST)" },
                  { value: "inter", label: "Inter-state (IGST)" },
                ]}
              />
            </Row>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Taxable value</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink tabular-nums">{fmtMoney(gstRes.base, "INR", 2)}</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Total GST ({gstRate}%)</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-accent tabular-nums">{fmtMoney(gstRes.gstTotal, "INR", 2)}</p>
              <p className="mt-1 font-mono text-[12px] text-ink-3">
                {interState
                  ? `IGST: ${fmtMoney(gstRes.igst, "INR", 2)}`
                  : `CGST ${fmtMoney(gstRes.cgst, "INR", 2)} + SGST ${fmtMoney(gstRes.sgst, "INR", 2)}`}
              </p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Gross total</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink tabular-nums">{fmtMoney(gstRes.gross, "INR", 2)}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-4 py-3">
            <div className="text-sm text-ink-2">
              <span className="font-mono text-[12px] uppercase text-ink-3">In words: </span>
              <strong className="font-medium text-ink">{amountToIndianWords(gstRes.gross)}</strong>
            </div>
            <CopyButton text={gstSummaryText} label="Copy breakdown" />
          </div>
        </>
      )}

      {mode === "discount" && (
        <>
          <Panel>
            <Row label="Pricing">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumField label="Original MRP" value={origPrice} onChange={setOrigPrice} step={50} />
                <NumField label="Discount (%)" value={disc1} onChange={(v) => setDisc1(Math.min(100, v))} />
                <NumField label="Extra coupon (%)" value={disc2} onChange={(v) => setDisc2(Math.min(100, v))} />
                <NumField label="Add tax / GST (%)" value={extraTax} onChange={(v) => setExtraTax(Math.min(100, v))} />
              </div>
            </Row>
          </Panel>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Final payable</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-accent tabular-nums">{fmtMoney(discRes.finalWithTax, "INR", 2)}</p>
              {extraTax > 0 && <p className="mt-0.5 text-xs text-ink-3">Includes {fmtMoney(discRes.taxAmt, "INR", 2)} tax</p>}
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">You save</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-success tabular-nums">{fmtMoney(discRes.totalSaved, "INR", 2)}</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Effective discount</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink tabular-nums">{discRes.effectivePct.toFixed(1)}%</p>
            </div>
          </div>
        </>
      )}

      {mode === "percent" && (
        <div className="grid gap-3">
          <div className="rounded-md border border-line bg-surface p-4">
            <p className="label-mono mb-3 text-ink-3">1. Percentage of a number</p>
            <div className="grid gap-3 sm:grid-cols-[120px_auto_1fr_auto] sm:items-center">
              <NumField label="Percent %" value={p1a} onChange={setP1a} />
              <span className="text-sm text-ink-3 sm:mt-4">% of</span>
              <NumField label="Number" value={p1b} onChange={setP1b} />
              <div className="rounded-md bg-paper px-4 py-2 font-mono text-lg font-semibold text-ink sm:mt-4">
                = {((p1a / 100) * p1b).toLocaleString("en-IN", { maximumFractionDigits: 4 })}
              </div>
            </div>
          </div>
          <div className="rounded-md border border-line bg-surface p-4">
            <p className="label-mono mb-3 text-ink-3">2. What percentage is X of Y?</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
              <NumField label="Part (X)" value={p2a} onChange={setP2a} />
              <span className="text-sm text-ink-3 sm:mt-4">is what % of</span>
              <NumField label="Whole (Y)" value={p2b} onChange={setP2b} />
              <div className="rounded-md bg-paper px-4 py-2 font-mono text-lg font-semibold text-ink sm:mt-4">
                = {p2b === 0 ? "—" : `${((p2a / p2b) * 100).toFixed(2)}%`}
              </div>
            </div>
          </div>
          <div className="rounded-md border border-line bg-surface p-4">
            <p className="label-mono mb-3 text-ink-3">3. Percentage change (increase / decrease)</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
              <NumField label="From" value={p3a} onChange={setP3a} />
              <span className="text-sm text-ink-3 sm:mt-4">to</span>
              <NumField label="To" value={p3b} onChange={setP3b} />
              <div className="rounded-md bg-paper px-4 py-2 font-mono text-lg font-semibold text-ink sm:mt-4">
                {p3a === 0 ? "—" : `${p3b >= p3a ? "+" : ""}${(((p3b - p3a) / p3a) * 100).toFixed(2)}%`}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ========================================================================
 * 3. GROUP BILL SPLITTER & EXPENSE SETTLEMENT (WhatsApp Ready)
 * ======================================================================== */

export function BillSplitEngine({ preset }: EngineProps) {
  const [tab, setTab] = useState<"group" | "dinner">(() => (preset.mode === "dinner" ? "dinner" : "group"));
  const [cur, setCur] = useState<CurrencyCode>("INR");

  // Group trip state
  const [tripTitle, setTripTitle] = useState("Goa Weekend Trip");
  const [people, setPeople] = useState<string[]>(["Aarav", "Priya", "Rohan", "Diya"]);
  const [newPerson, setNewPerson] = useState("");
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([
    { id: "e1", title: "Villa stay (2 nights)", amount: 12000, paidBy: "Aarav", splitAmong: ["Aarav", "Priya", "Rohan", "Diya"] },
    { id: "e2", title: "Dinner & drinks", amount: 3600, paidBy: "Priya", splitAmong: ["Aarav", "Priya", "Rohan", "Diya"] },
    { id: "e3", title: "Scooter rentals", amount: 1800, paidBy: "Rohan", splitAmong: ["Priya", "Rohan", "Diya"] },
  ]);

  // Dinner quick-split state
  const [billAmt, setBillAmt] = useState(3240);
  const [taxPct, setTaxPct] = useState(5);
  const [tipPct, setTipPct] = useState(10);
  const [diners, setDiners] = useState(4);

  const settlement = useMemo(() => settleExpenses(people, expenses), [people, expenses]);

  const addPerson = () => {
    const clean = newPerson.trim();
    if (!clean || people.includes(clean)) return;
    setPeople((prev) => [...prev, clean]);
    setNewPerson("");
  };

  const whatsappSummary = useMemo(() => {
    if (tab === "dinner") {
      const tax = (billAmt * taxPct) / 100;
      const tip = (billAmt * tipPct) / 100;
      const total = billAmt + tax + tip;
      const each = total / Math.max(1, diners);
      return [
        `*Dinner Bill Split*`,
        `Subtotal: ${fmtMoney(billAmt, cur, 2)}`,
        tax > 0 ? `Tax (${taxPct}%): ${fmtMoney(tax, cur, 2)}` : "",
        tip > 0 ? `Tip (${tipPct}%): ${fmtMoney(tip, cur, 2)}` : "",
        `*Total: ${fmtMoney(total, cur, 2)}*`,
        `Split (${diners} people): *${fmtMoney(each, cur, 2)} per person*`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    return [
      `*${tripTitle.trim() || "Group Expense Split"}*`,
      `Total spent: ${fmtMoney(settlement.totalSpent, cur, 2)}`,
      "",
      "*Settlements:*",
      ...(settlement.transfers.length
        ? settlement.transfers.map((t) => `• ${t.from} pays ${t.to} ${fmtMoney(t.amount, cur, 0)}`)
        : ["All settled up!"]),
    ].join("\n");
  }, [tab, billAmt, taxPct, tipPct, diners, cur, tripTitle, settlement]);

  const dinnerCalc = useMemo(() => {
    const total = billAmt * (1 + taxPct / 100 + tipPct / 100);
    return { total, perPerson: total / Math.max(1, diners) };
  }, [billAmt, taxPct, tipPct, diners]);

  return (
    <>
      <Panel>
        <Row label="Mode">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips
              value={tab}
              onChange={setTab}
              options={[
                { value: "group", label: "Group Trip / Multi-expense" },
                { value: "dinner", label: "Quick Restaurant Split" },
              ]}
            />
            <Chips
              value={cur}
              onChange={setCur}
              options={(Object.keys(CURRENCIES) as CurrencyCode[]).map((c) => ({ value: c, label: CURRENCIES[c].label }))}
            />
          </div>
        </Row>
      </Panel>

      {tab === "group" ? (
        <>
          <Panel>
            <Row label="Group name">
              <TextField value={tripTitle} onChange={setTripTitle} label="Trip or group title" placeholder="Goa Weekend Trip" />
            </Row>
            <Row label="Members">
              <div className="flex flex-wrap items-center gap-1.5">
                {people.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium text-ink">
                    {p}
                    {people.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setPeople((prev) => prev.filter((x) => x !== p))}
                        aria-label={`Remove ${p}`}
                        className="text-ink-3 hover:text-danger"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addPerson();
                  }}
                  className="inline-flex items-center gap-1.5"
                >
                  <input
                    value={newPerson}
                    onChange={(e) => setNewPerson(e.target.value)}
                    placeholder="Add name…"
                    aria-label="New member name"
                    className="h-8 w-32 rounded-[7px] border border-line bg-surface px-2.5 text-xs text-ink outline-none focus:border-ink"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-8 items-center gap-1 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] text-ink hover:border-ink-3"
                  >
                    <Plus aria-hidden className="size-3.5" /> Add
                  </button>
                </form>
              </div>
            </Row>
          </Panel>

          {/* Expense list */}
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line bg-paper px-3.5 py-2.5">
              <span className="label-mono text-ink-2">Expenses ({expenses.length})</span>
              <button
                type="button"
                onClick={() =>
                  setExpenses((prev) => [
                    ...prev,
                    { id: `e${Date.now()}`, title: "Shared expense", amount: 500, paidBy: people[0], splitAmong: [...people] },
                  ])
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink/90"
              >
                <Plus aria-hidden className="size-3.5" /> Add expense
              </button>
            </div>
            <div className="divide-y divide-line/60">
              {expenses.map((ex, i) => (
                <div key={ex.id} className="space-y-2 p-3.5">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_120px_140px_auto] sm:items-center">
                    <input
                      value={ex.title}
                      aria-label={`Expense ${i + 1} description`}
                      onChange={(e) => setExpenses((prev) => prev.map((it) => (it.id === ex.id ? { ...it, title: e.target.value } : it)))}
                      className="h-9 rounded-[7px] border border-line bg-paper px-2.5 text-sm text-ink outline-none focus:border-ink"
                    />
                    <input
                      type="number"
                      value={ex.amount}
                      aria-label={`Expense ${i + 1} amount`}
                      onChange={(e) =>
                        setExpenses((prev) => prev.map((it) => (it.id === ex.id ? { ...it, amount: Math.max(0, Number(e.target.value) || 0) } : it)))
                      }
                      className="h-9 rounded-[7px] border border-line bg-surface px-2.5 font-mono text-sm text-ink outline-none focus:border-ink"
                    />
                    <select
                      value={ex.paidBy}
                      aria-label={`Paid by for ${ex.title}`}
                      onChange={(e) => setExpenses((prev) => prev.map((it) => (it.id === ex.id ? { ...it, paidBy: e.target.value } : it)))}
                      className="h-9 rounded-[7px] border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-ink"
                    >
                      {people.map((p) => (
                        <option key={p} value={p}>
                          Paid: {p}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setExpenses((prev) => prev.filter((it) => it.id !== ex.id))}
                      aria-label="Delete expense"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[7px] border border-line bg-surface text-ink-3 hover:border-danger/50 hover:text-danger"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-ink-3">Split between:</span>
                    {people.map((p) => {
                      const on = ex.splitAmong.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() =>
                            setExpenses((prev) =>
                              prev.map((it) => {
                                if (it.id !== ex.id) return it;
                                const next = on ? it.splitAmong.filter((x) => x !== p) : [...it.splitAmong, p];
                                return { ...it, splitAmong: next.length ? next : it.splitAmong };
                              }),
                            )
                          }
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-[12px] transition-colors",
                            on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-3",
                          )}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Settlement result & balances */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono mb-3 text-ink-3">Minimum-transfer settlement</p>
              {settlement.transfers.length === 0 ? (
                <p className="text-sm text-success">Everyone is squared up — ₹0 owed.</p>
              ) : (
                <ul className="space-y-2">
                  {settlement.transfers.map((t, idx) => (
                    <li key={idx} className="flex items-center justify-between rounded-sm border border-line bg-paper px-3 py-2 text-sm">
                      <span>
                        <strong>{t.from}</strong> → <strong>{t.to}</strong>
                      </span>
                      <span className="font-mono font-semibold text-accent">{fmtMoney(t.amount, cur, 0)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono mb-3 text-ink-3">Net member balances</p>
              <div className="space-y-2 text-sm">
                {settlement.balances.map((b) => (
                  <div key={b.name} className="flex items-center justify-between border-b border-line/50 pb-1.5 last:border-b-0">
                    <div>
                      <span className="font-medium text-ink">{b.name}</span>
                      <span className="ml-2 font-mono text-[12px] text-ink-3">paid {fmtMoney(b.paid, cur, 0)}</span>
                    </div>
                    <span className={cn("font-mono font-medium", b.net >= 0 ? "text-success" : "text-danger")}>
                      {b.net >= 0 ? `+${fmtMoney(b.net, cur, 0)}` : `-${fmtMoney(-b.net, cur, 0)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <Panel>
            <Row label="Bill details">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumField label="Subtotal" value={billAmt} onChange={setBillAmt} step={50} />
                <NumField label="Tax / GST (%)" value={taxPct} onChange={setTaxPct} step={1} />
                <NumField label="Tip (%)" value={tipPct} onChange={setTipPct} step={1} />
                <NumField label="People" value={diners} onChange={(v) => setDiners(Math.max(1, Math.min(100, v)))} />
              </div>
            </Row>
          </Panel>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Per person share</p>
              <p className="mt-1 font-mono text-3xl font-semibold text-accent tabular-nums">{fmtMoney(dinnerCalc.perPerson, cur, 2)}</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="label-mono text-ink-3">Total bill with tax & tip</p>
              <p className="mt-1 font-mono text-3xl font-semibold text-ink tabular-nums">{fmtMoney(dinnerCalc.total, cur, 2)}</p>
            </div>
          </div>
        </>
      )}

      {/* WhatsApp Share Card */}
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-3.5 py-2.5">
          <span className="label-mono text-ink-2">Shareable summary</span>
          <div className="flex items-center gap-2">
            <CopyButton text={whatsappSummary} label="Copy text" />
            <a
              href={`https://wa.me/?text=${encodeURIComponent(whatsappSummary)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink/90"
            >
              <MessageCircle aria-hidden className="size-3.5" /> Open in WhatsApp
            </a>
          </div>
        </div>
        <pre className="whitespace-pre-wrap px-3.5 py-3 font-mono text-[13px] text-ink">{whatsappSummary}</pre>
      </div>
    </>
  );
}

/* ========================================================================
 * 4. PRINTABLE GST INVOICE & TRANSPARENT SIGNATURE GENERATOR
 * ======================================================================== */

type InvoiceItem = { id: string; desc: string; qty: number; rate: number; gst: number };

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function InvoiceSignEngine({ preset }: EngineProps) {
  const [mode, setMode] = useState<"invoice" | "signature">(() => (preset.mode === "signature" ? "signature" : "invoice"));
  const [cur, setCur] = useState<CurrencyCode>("INR");

  // Signature state
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [sigBlob, setSigBlob] = useState<Blob | null>(null);
  const [signingOpen, setSigningOpen] = useState(preset.mode === "signature");
  const sigUrlRef = useRef<string | null>(null);

  // Invoice fields
  const [sellerName, setSellerName] = useState("Studio Colddsam Digital LLP");
  const [sellerGstin, setSellerGstin] = useState("29ABCDE1234F1Z5");
  const [sellerAddr, setSellerAddr] = useState("Indiranagar, Bengaluru 560038");
  const [clientName, setClientName] = useState("Northwind Systems Pvt. Ltd.");
  const [clientAddr, setClientAddr] = useState("Bandra West, Mumbai 400050");
  const [invNo, setInvNo] = useState("INV-2026-042");
  const [invDate, setInvDate] = useState("2026-11-14");
  const [interState, setInterState] = useState(true);
  const [discountPct, setDiscountPct] = useState(0);
  const [notes, setNotes] = useState("Payment via NEFT / UPI within 15 days. Thank you for your business.");
  const [items, setItems] = useState<InvoiceItem[]>([
    { id: "i1", desc: "UI/UX Architecture & Component System", qty: 1, rate: 25000, gst: 18 },
    { id: "i2", desc: "Performance Optimization Sprint", qty: 8, rate: 2000, gst: 18 },
  ]);

  useEffect(() => () => {
    if (sigUrlRef.current) URL.revokeObjectURL(sigUrlRef.current);
  }, []);

  const handleSignatureDone = async (res: { blob: Blob }) => {
    const nextUrl = URL.createObjectURL(res.blob);
    if (sigUrlRef.current) URL.revokeObjectURL(sigUrlRef.current);
    sigUrlRef.current = nextUrl;
    setSigBlob(res.blob);
    setSigUrl(nextUrl);
    setSigningOpen(false);
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let totalTax = 0;
    for (const it of items) {
      const lineSub = Math.max(0, it.qty) * Math.max(0, it.rate);
      const afterDisc = lineSub * (1 - Math.min(100, Math.max(0, discountPct)) / 100);
      subtotal += lineSub;
      totalTax += afterDisc * (Math.max(0, it.gst) / 100);
    }
    const discountAmt = subtotal * (Math.min(100, Math.max(0, discountPct)) / 100);
    const taxable = subtotal - discountAmt;
    return { subtotal, discountAmt, taxable, totalTax, grandTotal: taxable + totalTax };
  }, [items, discountPct]);

  const buildPrintableHtml = async (): Promise<string> => {
    let sigDataUrl = "";
    if (sigBlob) {
      sigDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(sigBlob);
      });
    }
    const rowsHtml = items
      .map((it, idx) => {
        const amt = it.qty * it.rate;
        return `<tr>
          <td>${idx + 1}</td>
          <td>${escHtml(it.desc)}</td>
          <td style="text-align:right">${it.qty}</td>
          <td style="text-align:right">${escHtml(fmtMoney(it.rate, cur, 2))}</td>
          <td style="text-align:right">${it.gst}%</td>
          <td style="text-align:right">${escHtml(fmtMoney(amt, cur, 2))}</td>
        </tr>`;
      })
      .join("");

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice ${escHtml(invNo)}</title>
<style>
  * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
  body { margin: 0; padding: 36px; color: #18181b; background: #fff; }
  .wrap { max-width: 780px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #18181b; padding-bottom: 18px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
  .muted { color: #52525b; font-size: 13px; line-height: 1.5; }
  .grid { display: flex; justify-content: space-between; gap: 24px; margin: 22px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th { background: #f4f4f5; text-align: left; padding: 10px 8px; border-bottom: 1px solid #d4d4d8; font-weight: 600; }
  td { padding: 10px 8px; border-bottom: 1px solid #e4e4e7; }
  .totals { width: 300px; margin-left: auto; margin-top: 20px; font-size: 13px; }
  .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
  .grand { border-top: 2px solid #18181b; font-weight: 700; font-size: 16px; padding-top: 8px !important; margin-top: 4px; }
  .foot { margin-top: 36px; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
  .sig { text-align: right; }
  .sig img { max-height: 64px; max-width: 180px; object-fit: contain; display: block; margin-left: auto; }
  @media print { body { padding: 12px; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div>
      <h1>INVOICE</h1>
      <div class="muted">#${escHtml(invNo)} · Date: ${escHtml(invDate)}</div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:700;font-size:16px">${escHtml(sellerName)}</div>
      ${sellerGstin ? `<div class="muted">GSTIN / Tax ID: ${escHtml(sellerGstin)}</div>` : ""}
      <div class="muted">${escHtml(sellerAddr)}</div>
    </div>
  </div>
  <div class="grid">
    <div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#71717a">Bill To</div>
      <div style="font-weight:600;margin-top:4px">${escHtml(clientName)}</div>
      <div class="muted">${escHtml(clientAddr)}</div>
    </div>
    ${cur === "INR" ? `<div class="muted">Supply: ${interState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}</div>` : ""}
  </div>
  <table>
    <thead><tr><th>#</th><th>Item & Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Tax %</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${escHtml(fmtMoney(totals.subtotal, cur, 2))}</span></div>
    ${totals.discountAmt > 0 ? `<div><span>Discount (${discountPct}%)</span><span>-${escHtml(fmtMoney(totals.discountAmt, cur, 2))}</span></div>` : ""}
    ${interState || cur !== "INR" ? `<div><span>Tax</span><span>${escHtml(fmtMoney(totals.totalTax, cur, 2))}</span></div>` : `<div><span>CGST</span><span>${escHtml(fmtMoney(totals.totalTax / 2, cur, 2))}</span></div><div><span>SGST</span><span>${escHtml(fmtMoney(totals.totalTax / 2, cur, 2))}</span></div>`}
    <div class="grand"><span>Total</span><span>${escHtml(fmtMoney(totals.grandTotal, cur, 2))}</span></div>
  </div>
  ${cur === "INR" ? `<p class="muted" style="margin-top:12px">Amount in words: <strong>${escHtml(amountToIndianWords(totals.grandTotal))}</strong></p>` : ""}
  <div class="foot">
    <div class="muted" style="max-width:440px"><strong>Notes:</strong> ${escHtml(notes)}</div>
    <div class="sig">
      ${sigDataUrl ? `<img src="${sigDataUrl}" alt="Authorised signature" />` : `<div style="height:48px"></div>`}
      <div style="border-top:1px solid #a1a1aa;padding-top:4px;font-size:12px;color:#52525b">Authorized Signatory</div>
    </div>
  </div>
</div>
</body>
</html>`;
  };

  const printInvoicePdf = async () => {
    const html = await buildPrintableHtml();
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => iframe.remove(), 2000);
      }, 200);
    }
  };

  return (
    <>
      <Panel>
        <Row label="Workspace">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips
              value={mode}
              onChange={setMode}
              options={[
                { value: "invoice", label: "Invoice & PDF generator" },
                { value: "signature", label: "Transparent signature studio" },
              ]}
            />
            {mode === "invoice" && (
              <Chips
                value={cur}
                onChange={setCur}
                options={(Object.keys(CURRENCIES) as CurrencyCode[]).map((c) => ({ value: c, label: CURRENCIES[c].label }))}
              />
            )}
          </div>
        </Row>
      </Panel>

      {mode === "signature" ? (
        <div className="space-y-4">
          <div className="rounded-md border border-line bg-surface p-4">
            <SignatureMaker
              kind="full"
              onDone={handleSignatureDone}
              onCancel={() => setMode("invoice")}
            />
          </div>
          {sigUrl && sigBlob && (
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-3.5 py-2.5">
                <span className="label-mono text-ink-2">Ready transparent PNG signature</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("invoice")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[12px] font-medium text-ink hover:border-ink-3"
                  >
                    <FileCheck2 aria-hidden className="size-3.5" /> Use in Invoice
                  </button>
                  <button
                    type="button"
                    onClick={() => saveBlob(sigBlob, "signature-transparent.png")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12px] font-medium text-white"
                  >
                    <Download aria-hidden className="size-3.5" /> Download PNG
                  </button>
                </div>
              </div>
              <div className={cn("grid min-h-32 place-items-center p-6", CHECKER)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sigUrl} alt="Transparent signature preview" className="max-h-24 object-contain" />
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <Panel>
            <Row label="Your business">
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField value={sellerName} onChange={setSellerName} label="Business name" />
                <TextField value={sellerGstin} onChange={setSellerGstin} label="GSTIN / Tax ID" mono />
                <TextField value={sellerAddr} onChange={setSellerAddr} label="Address" />
              </div>
            </Row>
            <Row label="Client & invoice">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <TextField value={clientName} onChange={setClientName} label="Bill to client" />
                <TextField value={clientAddr} onChange={setClientAddr} label="Client address" />
                <TextField value={invNo} onChange={setInvNo} label="Invoice number" mono />
                <TextField value={invDate} onChange={setInvDate} label="Invoice date" type="date" />
              </div>
            </Row>
            <Row label="Tax & discount">
              <div className="flex flex-wrap items-center gap-4">
                {cur === "INR" && <Toggle checked={!interState} onChange={(v) => setInterState(!v)} label="Split GST into CGST + SGST (intra-state)" />}
                <div className="w-56">
                  <Slider label="Invoice discount" value={discountPct} min={0} max={50} onChange={setDiscountPct} format={(v) => `${v}%`} />
                </div>
              </div>
            </Row>
          </Panel>

          {/* Line Items */}
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line bg-paper px-3.5 py-2.5">
              <span className="label-mono text-ink-2">Line items</span>
              <button
                type="button"
                onClick={() =>
                  setItems((prev) => [...prev, { id: `i${Date.now()}`, desc: "Consulting service", qty: 1, rate: 1000, gst: 18 }])
                }
                className="inline-flex h-8 items-center gap-1 rounded-[7px] bg-ink px-3 text-[12px] font-medium text-paper"
              >
                <Plus aria-hidden className="size-3.5" /> Add item
              </button>
            </div>
            <div className="divide-y divide-line/60">
              {items.map((it, idx) => (
                <div key={it.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,2fr)_80px_115px_85px_auto] sm:items-end">
                  <TextField
                    label={`Item ${idx + 1}`}
                    value={it.desc}
                    onChange={(desc) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, desc } : x)))}
                  />
                  <NumField label="Qty" value={it.qty} onChange={(qty) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, qty } : x)))} />
                  <NumField label="Rate" value={it.rate} onChange={(rate) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, rate } : x)))} step={100} />
                  <NumField label="Tax %" value={it.gst} onChange={(gst) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, gst } : x)))} />
                  <button
                    type="button"
                    disabled={items.length === 1}
                    onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
                    aria-label="Remove item"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[7px] border border-line bg-surface text-ink-3 hover:text-danger disabled:opacity-40"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <Panel>
            <Row label="Notes & signature">
              <div className="space-y-3">
                <TextField value={notes} onChange={setNotes} label="Payment terms / notes" />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSigningOpen((s) => !s)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3"
                  >
                    <PenLine aria-hidden className="size-4" /> {sigUrl ? "Replace signature" : "Draw / add signature"}
                  </button>
                  {sigBlob && (
                    <button
                      type="button"
                      onClick={() => saveBlob(sigBlob, "signature-transparent.png")}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-paper px-3 text-sm text-ink-2 hover:text-ink"
                    >
                      <Download aria-hidden className="size-4" /> Save signature PNG
                    </button>
                  )}
                </div>
                {signingOpen && (
                  <div className="rounded-md border border-line bg-paper p-3">
                    <SignatureMaker kind="full" onDone={handleSignatureDone} onCancel={() => setSigningOpen(false)} />
                  </div>
                )}
              </div>
            </Row>
          </Panel>

          {/* Clean A4 Paper Sheet Preview */}
          <div className="overflow-hidden rounded-md border border-line bg-surface p-5 sm:p-7">
            <div className="flex flex-wrap justify-between gap-4 border-b-2 border-ink pb-4">
              <div>
                <p className="text-xl font-bold tracking-tight text-ink">INVOICE</p>
                <p className="font-mono text-[12px] text-ink-3">
                  #{invNo} · {invDate}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-ink">{sellerName}</p>
                {sellerGstin && <p className="font-mono text-[12px] text-ink-3">GSTIN: {sellerGstin}</p>}
                <p className="text-xs text-ink-3">{sellerAddr}</p>
              </div>
            </div>
            <div className="my-4 flex flex-wrap justify-between gap-4 text-sm">
              <div>
                <p className="label-mono text-ink-3">Bill to</p>
                <p className="mt-1 font-medium text-ink">{clientName}</p>
                <p className="text-xs text-ink-3">{clientAddr}</p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <p className="text-xs text-ink-3">Subtotal: {fmtMoney(totals.subtotal, cur, 2)}</p>
                <p className="text-xs text-ink-3">Tax: {fmtMoney(totals.totalTax, cur, 2)}</p>
                <p className="mt-1 text-lg font-bold text-ink">Total: {fmtMoney(totals.grandTotal, cur, 2)}</p>
              </div>
            </div>
            {sigUrl && (
              <div className="mt-4 flex justify-end">
                <div className="text-right">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sigUrl} alt="Signature preview" className="ml-auto max-h-14 object-contain" />
                  <p className="mt-1 border-t border-line pt-1 font-mono text-[12px] text-ink-3">Authorized Signatory</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={async () => {
                const html = await buildPrintableHtml();
                saveBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${invNo || "invoice"}.html`);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3"
            >
              <Download aria-hidden className="size-4" /> Download HTML
            </button>
            <button
              type="button"
              onClick={() => void printInvoicePdf()}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-sm font-medium text-white hover:opacity-95"
            >
              <Printer aria-hidden className="size-4" /> Print / Save PDF
            </button>
          </div>
        </>
      )}
    </>
  );
}
