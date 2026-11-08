// The Cash Drawer's database side (docs/features/cash-drawer.md).
// - getCashDrawer loads the tab: the drawer's own entries plus the Helper entries and advances
//   flagged as paid from it, read live so the drawer always matches them. Admin only — the page
//   redirects anyone else, and this checks again.
// - The writes take the caller's transaction (the Server Actions check who's asking), and each
//   refuses a change that leaves someone having paid back more than they borrowed.

import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { advances, billingPeriods, cashDrawerEntries, db, helperEntries } from "@/db";
import { requireViewer } from "@/lib/auth";
import type { Tx } from "@/lib/bill-shares";
import {
  cashOnHand,
  drawerEntryItem,
  drawerLedger,
  firstBelowZero,
  firstOverpaid,
  loansByPerson,
  type DrawerItem,
  type DrawerKind,
  type drawerEntryValues,
  type Loan,
} from "@/lib/cash-drawer";
import { ActionError } from "@/lib/errors";
import { handedOver } from "@/lib/helper";
import { formatPHP, toCentavos, type Centavos } from "@/lib/money";
import { isAdmin } from "@/lib/permissions";

type DrawerEntryValues = ReturnType<typeof drawerEntryValues>;

/** One drawer change at a time, so two saves can't each pass the loans check. */
async function lockDrawer(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(${DRAWER_LOCK_KEY})`);
}
// Any fixed number unique to this lock (the Helper's is 7_201_001).
const DRAWER_LOCK_KEY = 7_201_002;

/** Refuses a change that leaves someone having paid back more than they borrowed. */
async function checkLoans(tx: Tx) {
  const rows = await tx
    .select({
      id: cashDrawerEntries.id,
      kind: cashDrawerEntries.kind,
      onDate: cashDrawerEntries.onDate,
      amount: cashDrawerEntries.amount,
      person: cashDrawerEntries.person,
      toAccount: cashDrawerEntries.toAccount,
      createdAt: cashDrawerEntries.createdAt,
    })
    .from(cashDrawerEntries)
    .where(inArray(cashDrawerEntries.kind, ["lent", "paid_back"]));
  const over = firstOverpaid(rows.map(drawerEntryItem));
  if (over) {
    throw new ActionError(`That would leave ${over.person} paying back ${formatPHP(-over.owes)} more than was borrowed.`);
  }
}

export async function addDrawerEntryIn(tx: Tx, values: DrawerEntryValues): Promise<void> {
  await lockDrawer(tx);
  await tx.insert(cashDrawerEntries).values(values);
  await checkLoans(tx);
}

export async function updateDrawerEntryIn(tx: Tx, entryId: number, values: DrawerEntryValues): Promise<void> {
  await lockDrawer(tx);
  const [updated] = await tx
    .update(cashDrawerEntries)
    .set(values)
    .where(eq(cashDrawerEntries.id, entryId))
    .returning({ id: cashDrawerEntries.id });
  if (!updated) throw new ActionError("That entry was deleted.");
  await checkLoans(tx);
}

export async function deleteDrawerEntryIn(tx: Tx, entryId: number): Promise<void> {
  await lockDrawer(tx);
  await tx.delete(cashDrawerEntries).where(eq(cashDrawerEntries.id, entryId));
  await checkLoans(tx);
}

/** The month a linked line belongs to, to link to its tab. */
interface InMonth {
  year: number;
  month: number;
}

type DrawerSourceItem = DrawerItem &
  (
    | {
        source: "drawer";
        kind: DrawerKind;
        amount: Centavos;
        person: string | null;
        /** A paid back to PA's bank or e-wallet: it cleared the loan but added no cash. */
        toAccount: boolean;
        note: string | null;
      }
    | ({ source: "helper"; helperKind: "visit" | "early_pay"; note: string | null } & InMonth)
    | ({ source: "advance"; description: string } & InMonth)
  );

export type DrawerLine = DrawerSourceItem & { leftAfter: Centavos };

export interface CashDrawerView {
  /** Ledger order (oldest first), each with the cash left after it. */
  lines: DrawerLine[];
  cashOnHand: Centavos;
  /** Who still owes the drawer something. */
  owing: Loan[];
  /** The first line that took the drawer below ₱0, if any. */
  belowZero: DrawerLine | null;
  /** Names typed before, for the Person field's suggestions. */
  people: string[];
}

export async function getCashDrawer(): Promise<CashDrawerView | null> {
  if (!isAdmin(await requireViewer())) return null;
  const [own, helper, advance] = await Promise.all([
    db.select().from(cashDrawerEntries),
    db
      .select({
        id: helperEntries.id,
        kind: helperEntries.kind,
        payerId: helperEntries.payerId,
        onDate: helperEntries.onDate,
        amount: helperEntries.amount,
        deduction: helperEntries.deduction,
        note: helperEntries.note,
        createdAt: helperEntries.createdAt,
        year: billingPeriods.year,
        month: billingPeriods.month,
      })
      .from(helperEntries)
      .innerJoin(billingPeriods, eq(helperEntries.periodId, billingPeriods.id))
      .where(eq(helperEntries.fromDrawer, true)),
    db
      .select({
        id: advances.id,
        description: advances.description,
        amount: advances.amount,
        spentOn: advances.spentOn,
        createdAt: advances.createdAt,
        year: billingPeriods.year,
        month: billingPeriods.month,
      })
      .from(advances)
      .innerJoin(billingPeriods, eq(advances.periodId, billingPeriods.id))
      .where(eq(advances.fromDrawer, true)),
  ]);

  const items: DrawerSourceItem[] = [
    ...own.map((e) => ({
      ...drawerEntryItem(e),
      source: "drawer" as const,
      kind: e.kind,
      amount: toCentavos(e.amount),
      person: e.person,
      toAccount: e.toAccount,
      note: e.note,
    })),
    ...helper
      // A visit whose whole pay was taken off her debt took nothing from the drawer.
      .filter((e) => e.kind !== "opening" && handedOver(e) > 0)
      .map((e) => ({
        source: "helper" as const,
        id: e.id,
        // A flagged entry always has a date (helper_entries_drawer_dated).
        onDate: e.onDate!,
        loggedAt: e.createdAt.getTime(),
        change: -handedOver(e),
        helperKind: e.kind as "visit" | "early_pay",
        note: e.note,
        year: e.year,
        month: e.month,
      })),
    ...advance.map((a) => ({
      source: "advance" as const,
      id: a.id,
      // A flagged advance always has a date (advances_drawer_dated).
      onDate: a.spentOn!,
      loggedAt: a.createdAt.getTime(),
      change: -toCentavos(a.amount),
      description: a.description,
      year: a.year,
      month: a.month,
    })),
  ];
  const lines = drawerLedger(items);
  const loans = loansByPerson(items);
  return {
    lines,
    cashOnHand: cashOnHand(items),
    owing: loans.filter((loan) => loan.owes > 0),
    belowZero: firstBelowZero(lines),
    // One spelling per person (the last typed), like the Owed card.
    people: loans.map((loan) => loan.person),
  };
}
