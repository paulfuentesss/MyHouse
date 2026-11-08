// The Helper's visits and early pay (docs/features/helper.md; the rule is in
// docs/settlement-rules.md → "The Helper"). Pure functions, no DB access, so it's easy to test.
//
// - Whoever hands her money gets it back: each entry's handed-over amount counts as paid by its
//   payer (a bill paid, in Own Adv).
// - The month's Helper bill is everything handed over: daily pay minus what was taken off her
//   debt, plus early pay.
// - Her debt is early pay (and the debt carried over from the sheet) minus everything taken off,
//   across all months. It's only a record; it never enters the split by itself.

import { parseMoneyInput, sumCentavos, toCentavos, type Centavos } from "@/lib/money";

export type HelperEntryKind = "visit" | "early_pay" | "opening";

export interface HelperEntryInput {
  id: number;
  kind: HelperEntryKind;
  /** Null only for `opening`. */
  payerId: number | null;
  /** numeric(12,2) as a string: daily pay, early pay or the carried-over debt. */
  amount: string;
  /** Visits only: the part of her daily pay taken off her debt. */
  deduction: string;
}

/**
 * Whether the entry is part of a Helper bill. Her starting debt isn't (the sheet settled it), so a
 * month holding only that keeps its typed Helper total.
 */
export function countsInBill(entry: Pick<HelperEntryInput, "kind">): boolean {
  return entry.kind !== "opening";
}

// Within a month: her starting debt first, then by date (no date last); on the same day early pay
// comes before a visit, since what's taken off that day can come from it.
const KIND_RANK: Record<HelperEntryKind, number> = { opening: 0, early_pay: 1, visit: 2 };

/** Sorts one month's entries into ledger order (the order "She owes after" runs in). */
export function ledgerCompare(
  a: Pick<HelperEntryInput, "id" | "kind"> & { onDate: string | null },
  b: Pick<HelperEntryInput, "id" | "kind"> & { onDate: string | null },
): number {
  if ((a.kind === "opening") !== (b.kind === "opening")) return a.kind === "opening" ? -1 : 1;
  if (a.onDate !== b.onDate) {
    if (a.onDate === null) return 1;
    if (b.onDate === null) return -1;
    return a.onDate < b.onDate ? -1 : 1;
  }
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id - b.id;
}

/** What actually reached her from the payer's pocket. */
export function handedOver(entry: HelperEntryInput): Centavos {
  switch (entry.kind) {
    case "visit":
      return toCentavos(entry.amount) - toCentavos(entry.deduction);
    case "early_pay":
      return toCentavos(entry.amount);
    case "opening":
      return 0;
  }
}

/**
 * The "Log a visit" form's live line: what she'll get in cash, from the two amounts as typed
 * (daily pay, taken off; an empty Taken off is ₱0). Null while Daily pay is empty or either
 * isn't a valid amount. `cash` is negative when more is taken off than her pay (the form warns;
 * the server refuses it).
 */
export function visitCashHint(
  amountRaw: string,
  deductionRaw: string,
): { pay: Centavos; takenOff: Centavos; cash: Centavos } | null {
  const pay = parseMoneyInput(amountRaw);
  const takenOff = deductionRaw.trim() === "" ? 0 : parseMoneyInput(deductionRaw);
  if (pay === null || takenOff === null) return null;
  return { pay, takenOff, cash: pay - takenOff };
}

/** How the entry moves her debt: up for early pay and the opening debt, down for what's taken off. */
export function debtChange(entry: HelperEntryInput): Centavos {
  return entry.kind === "visit" ? -toCentavos(entry.deduction) : toCentavos(entry.amount);
}

/** Who paid the month's Helper bill, and how much (people who handed over ₱0 are left out). */
export function helperPaidBy(monthEntries: readonly HelperEntryInput[]): Map<number, Centavos> {
  const paid = new Map<number, Centavos>();
  for (const entry of monthEntries) {
    const amount = handedOver(entry);
    if (amount === 0 || entry.payerId === null) continue;
    paid.set(entry.payerId, (paid.get(entry.payerId) ?? 0) + amount);
  }
  return paid;
}

/** The month's Helper bill: everything handed over. Equals the sum of `helperPaidBy`. */
export function helperBillTotal(monthEntries: readonly HelperEntryInput[]): Centavos {
  return sumCentavos(monthEntries.map(handedOver));
}

export interface HelperMonthSummary {
  /** Her daily pay for the month's visits. */
  dailyPay: Centavos;
  earlyPay: Centavos;
  /** Taken off her debt instead of handed over. */
  takenOff: Centavos;
  /** dailyPay + earlyPay − takenOff: the month's Helper bill. */
  handedOver: Centavos;
}

export function helperMonthSummary(monthEntries: readonly HelperEntryInput[]): HelperMonthSummary {
  const visits = monthEntries.filter((e) => e.kind === "visit");
  const dailyPay = sumCentavos(visits.map((e) => toCentavos(e.amount)));
  const takenOff = sumCentavos(visits.map((e) => toCentavos(e.deduction)));
  const earlyPay = sumCentavos(monthEntries.filter((e) => e.kind === "early_pay").map((e) => toCentavos(e.amount)));
  return { dailyPay, earlyPay, takenOff, handedOver: dailyPay + earlyPay - takenOff };
}

/**
 * Her debt after each entry, like the sheet's "Remaining" column. Entries must come in ledger
 * order: month by month, each sorted with `ledgerCompare`.
 */
export function owesAfter(allEntries: readonly HelperEntryInput[]): Map<number, Centavos> {
  const after = new Map<number, Centavos>();
  let debt = 0;
  for (const entry of allEntries) {
    debt += debtChange(entry);
    after.set(entry.id, debt);
  }
  return after;
}

/** The first entry after which she'd owe less than ₱0 (more taken off than she'd been given), if any. */
export function firstOverdrawn<T extends HelperEntryInput>(allEntries: readonly T[]): { entry: T; owes: Centavos } | null {
  let debt = 0;
  for (const entry of allEntries) {
    debt += debtChange(entry);
    if (debt < 0) return { entry, owes: debt };
  }
  return null;
}
