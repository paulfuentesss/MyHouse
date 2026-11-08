// The admin's cash drawer (docs/features/cash-drawer.md). Pure functions, no DB access, so it's
// easy to test.
//
// - Its lines come from three places: the drawer's own entries (cash in, spent, lent, paid back),
//   and the Helper entries and advances the admin flagged as paid from it.
// - Cash on hand is everything in minus everything out. It may go below ₱0 (a cash in not logged
//   yet); the page points at where.
// - What someone owes the drawer is what they borrowed minus what they paid back, never below ₱0.
//   A payback to PA's bank or e-wallet clears the loan but adds no cash (it never reached the
//   drawer); refilling the drawer from there is a cash in.
// - None of it enters the split: it's the admin's own money.

import { ActionError } from "@/lib/errors";
import { fromCentavos, sumCentavos, toCentavos, type Centavos } from "@/lib/money";
import { isAdmin, type Viewer } from "@/lib/permissions";

export type DrawerKind = "cash_in" | "spent" | "lent" | "paid_back";
export type DrawerSource = "drawer" | "helper" | "advance";

export const DRAWER_KIND_LABELS: Record<DrawerKind, string> = {
  cash_in: "Cash in",
  spent: "Spent",
  lent: "Lent",
  paid_back: "Paid back",
};

export interface DrawerItem {
  source: DrawerSource;
  /** The row's id within its source. */
  id: number;
  onDate: string;
  /** When the row was saved (its `created_at`, ms since 1970): the order within a day. */
  loggedAt: number;
  /** + money into the drawer, − money out. */
  change: Centavos;
  /**
   * Lent / paid back only: who, as typed, and how much. The amount is the loan's own, since a
   * payback to PA's bank or e-wallet clears the loan without changing the drawer's cash.
   */
  loan?: { kind: "lent" | "paid_back"; person: string; amount: Centavos };
}

/**
 * Whether a Helper entry or an advance came from the cash drawer, from its "Paid from the cash
 * drawer" box. Only the admin sets it, and only on what he paid himself — it's his cash — with a
 * date, so the drawer can put it in order. undefined = a housemate's save: leave it as it is
 * (false on a new one).
 */
export function drawerFlagFor(
  ticked: boolean,
  payerId: number | null,
  onDate: string | null,
  viewer: Viewer,
): boolean | undefined {
  if (!isAdmin(viewer)) return undefined;
  if (!ticked) return false;
  if (payerId !== viewer.memberId) throw new ActionError("Only what you paid yourself can come from the cash drawer.");
  if (!onDate) throw new ActionError("Choose a date for anything paid from the cash drawer.");
  return true;
}

/**
 * A drawer entry as typed, ready to save: a name only on a loan, and required there; "paid to
 * your bank / e-wallet" only on a paid back.
 */
export function drawerEntryValues(input: {
  kind: DrawerKind;
  onDate: string;
  amount: Centavos;
  person: string;
  toAccount: boolean;
  note: string | null;
}) {
  const loan = input.kind === "lent" || input.kind === "paid_back";
  const person = input.person.trim();
  if (loan && !person) throw new ActionError(input.kind === "lent" ? "Enter who borrowed it." : "Enter who paid it back.");
  return {
    kind: input.kind,
    onDate: input.onDate,
    amount: fromCentavos(input.amount),
    person: loan ? person : null,
    toAccount: input.kind === "paid_back" && input.toAccount,
    note: input.note,
  };
}

/**
 * Money in for a cash in or a paid back, out for spent or lent. A paid back to PA's bank or
 * e-wallet (`toAccount`) never reached the drawer, so it changes nothing.
 */
export function drawerChange(kind: DrawerKind, amount: Centavos, toAccount = false): Centavos {
  if (kind === "paid_back" && toAccount) return 0;
  return kind === "cash_in" || kind === "paid_back" ? amount : -amount;
}

/** One of the drawer's own entries (a `cash_drawer_entries` row) as a ledger item. */
export function drawerEntryItem(entry: {
  id: number;
  kind: DrawerKind;
  onDate: string;
  amount: string;
  person: string | null;
  toAccount: boolean;
  createdAt: Date;
}): DrawerItem {
  const amount = toCentavos(entry.amount);
  const item: DrawerItem = {
    source: "drawer",
    id: entry.id,
    onDate: entry.onDate,
    loggedAt: entry.createdAt.getTime(),
    change: drawerChange(entry.kind, amount, entry.toAccount),
  };
  if ((entry.kind === "lent" || entry.kind === "paid_back") && entry.person !== null) {
    item.loan = { kind: entry.kind, person: entry.person, amount };
  }
  return item;
}

const SOURCE_RANK: Record<DrawerSource, number> = { drawer: 0, helper: 1, advance: 2 };

/**
 * Ledger order: by date; on the same day money in comes before money out (so taking cash out
 * of the bank and paying from it that day never reads as below ₱0), then in the order they were
 * logged. Source and id only settle lines saved at the very same moment.
 */
export function drawerCompare(a: DrawerItem, b: DrawerItem): number {
  if (a.onDate !== b.onDate) return a.onDate < b.onDate ? -1 : 1;
  const aIn = a.change > 0;
  if (aIn !== b.change > 0) return aIn ? -1 : 1;
  return a.loggedAt - b.loggedAt || SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.id - b.id;
}

/** The items in ledger order (a sorted copy), each with the cash left after it. */
export function drawerLedger<T extends DrawerItem>(items: readonly T[]): (T & { leftAfter: Centavos })[] {
  let left = 0;
  return items.toSorted(drawerCompare).map((item) => {
    left += item.change;
    return { ...item, leftAfter: left };
  });
}

export function cashOnHand(items: readonly DrawerItem[]): Centavos {
  return sumCentavos(items.map((i) => i.change));
}

/** The first line after which the drawer would hold less than ₱0, if any (ledger order). */
export function firstBelowZero<T extends { leftAfter: Centavos }>(ledger: readonly T[]): T | null {
  return ledger.find((line) => line.leftAfter < 0) ?? null;
}

/** Months of lines the Ins & Outs list draws at first, and how many more each "Show older months" adds. */
export const FIRST_MONTHS = 2;
export const MORE_MONTHS = 3;

/**
 * How many of the newest months the list draws: as many as asked for (FIRST_MONTHS, then more
 * with each tap), but always far enough back to show the month it went below ₱0 in, which the
 * Cash on hand card names. `monthKeys` are "YYYY-MM", newest first; `belowMonth` likewise.
 */
export function shownMonthCount(monthKeys: readonly string[], belowMonth: string | null, asked: number): number {
  return Math.max(asked, belowMonth ? monthKeys.indexOf(belowMonth) + 1 : 0);
}

/** Names match whatever their spacing or capitals, so "Ben" and "ben " are one person. */
export function personKey(person: string): string {
  return person.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export interface Loan {
  /** As last typed (ledger order). */
  person: string;
  /** Borrowed minus paid back. Below ₱0 only if more was paid back than borrowed. */
  owes: Centavos;
}

/**
 * What each person who ever borrowed or paid back owes the drawer, by name. A payback counts
 * wherever it went (the drawer, or PA's bank or e-wallet).
 */
export function loansByPerson(items: readonly DrawerItem[]): Loan[] {
  const loans = new Map<string, Loan>();
  for (const item of items.toSorted(drawerCompare)) {
    if (!item.loan) continue;
    const key = personKey(item.loan.person);
    const loan = loans.get(key) ?? { person: "", owes: 0 };
    const owes = item.loan.kind === "lent" ? loan.owes + item.loan.amount : loan.owes - item.loan.amount;
    loans.set(key, { person: item.loan.person.trim(), owes });
  }
  return [...loans.values()].sort((a, b) => a.person.localeCompare(b.person));
}

/** Someone who'd have paid back more than they borrowed, if any (the drawer refuses that save). */
export function firstOverpaid(items: readonly DrawerItem[]): Loan | null {
  return loansByPerson(items).find((loan) => loan.owes < 0) ?? null;
}
