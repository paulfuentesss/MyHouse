"use server";

// Server Actions for the month pages. Every change goes through here, which is where the
// rules are enforced: the caller must be signed in with the right role (run("admin" | "member",
// …), docs/features/auth.md), inputs are validated, closed months reject edits, and bill
// shares always add up to the bill total (docs/settlement-rules.md).
//
// Server Actions are public endpoints: anyone can call them with any arguments. Never skip
// run(), and never trust ids or payers sent from the page — check them here.

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, max, not, or, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import {
  advances,
  billEmails,
  billerFields,
  billers,
  billingPeriods,
  billItems,
  billItemShares,
  db,
  helperEntries,
  householdSettings,
  members,
  payments,
  periodBalances,
  receipts,
  sharedColumnMembers,
  sharedColumns,
} from "@/db";
import { getViewer, previewFor } from "@/lib/auth";
import { placeBill } from "@/lib/bill-import";
import { encryptSecret } from "@/lib/biller-secrets";
import { drawerEntryValues, drawerFlagFor } from "@/lib/cash-drawer";
import { addDrawerEntryIn, deleteDrawerEntryIn, updateDrawerEntryIn } from "@/lib/cash-drawer-data";
import { pointsFor, pointsOf, writeShares, type Tx } from "@/lib/bill-shares";
import { domainTakesMail } from "@/lib/email-domain";
import { ActionError, isUniqueViolation } from "@/lib/errors";
import { dateLabel, monthLabel, todayInManila } from "@/lib/format";
import { countsInBill, firstOverdrawn, helperBillTotal, ledgerCompare } from "@/lib/helper";
import { inviteMember, uninviteMember } from "@/lib/invites";
import {
  formatPHP,
  fromCentavos,
  parseMoneyInput,
  splitEqually,
  sumCentavos,
  toCentavos,
  type Centavos,
} from "@/lib/money";
import { parseEmoji, sharesCosts } from "@/lib/members";
import { monthAfter, monthHasEnded, reopenCheck } from "@/lib/month-lock";
import {
  canCancelPayment,
  canManageAdvance,
  canManageHelperEntry,
  canSetEmoji,
  canSubmitPayment,
  isAdmin,
  isViewOnly,
  type Viewer,
} from "@/lib/permissions";
import { computePeriod } from "@/lib/periods";
import { closeMonthIn, lockPeriodAndNeighbours } from "@/lib/month-close";
import { ensureDefaultColumn, startNextMonthIn } from "@/lib/month-start";
import { pushToAdmin, sendPush } from "@/lib/push";
import { paymentDecidedPush, paymentSentPush } from "@/lib/push-messages";
import { sendPayables } from "@/lib/reminder-send";
import {
  checkReceiptFile,
  cleanFileName,
  MAX_RECEIPTS_PER_ITEM,
  receiptObjectPath,
  receiptsLeft,
} from "@/lib/receipts";
import {
  computeBillShares,
  HOUSE_BUDGET,
  partyFromColumn,
  partyToColumn,
  SettlementError,
  splitOrder,
  type MemberId,
} from "@/lib/settlement";
import { authAdmin, receiptStorage } from "@/lib/supabase/admin-server";

export type ActionState = { ok: true; redirectTo?: string } | { ok: false; error: string } | null;

const id = z.coerce.number().int().positive();
// numeric(12,2) holds up to 9,999,999,999.99.
const MAX_CENTAVOS = 999_999_999_999;
const moneyField = (allowZero: boolean) =>
  z.string().transform((raw, ctx): Centavos => {
    const centavos = parseMoneyInput(raw);
    if (centavos === null || centavos < 0 || (!allowZero && centavos === 0)) {
      ctx.addIssue({
        code: "custom",
        message: allowZero ? "Enter an amount like 1,899.00 (0 is fine)" : "Enter an amount greater than 0, like 1,899.00",
      });
      return z.NEVER;
    }
    if (centavos > MAX_CENTAVOS) {
      ctx.addIssue({ code: "custom", message: "That amount is too large" });
      return z.NEVER;
    }
    return centavos;
  });
const optionalDate = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Choose a valid date")
  .transform((v) => v || null);
// A checkbox: sent as "on" when ticked, left out when not.
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on");
// Bills and shared columns pick Equal or Manual; Points is only Meralco's (set by the seed).
const userSplitMode = z.enum(["equal", "manual"]);

// ---------- Bills ----------

export async function updateBillTotal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("admin", z.object({ billId: id, total: moneyField(true) }), formData, async ({ billId, total }) => {
    await db.transaction(async (tx) => {
      const { bill, order } = await loadBill(tx, billId);
      if (bill.splitMode === "manual") {
        throw new ActionError(`${bill.name} is split manually — edit each person's share instead.`);
      }
      if (bill.kind === "helper") {
        // Taken in turn with the Helper tab, so a visit logged at the same moment can't be overwritten.
        await lockHelper(tx);
        if (await hasBillEntries(tx, bill.periodId)) {
          throw new ActionError(`${bill.name}'s total comes from the visits on the Helper tab.`);
        }
      }
      const points = pointsOf(bill.shares);
      const shares = computeBillShares(bill.splitMode, total, order, { points });
      await tx.update(billItems).set({ totalAmount: fromCentavos(total) }).where(eq(billItems.id, billId));
      await writeShares(tx, billId, shares, bill.splitMode === "points" ? points : null);
    });
  });
}

const pointsSchema = z.object({
  billId: id,
  memberId: id,
  points: z.coerce
    .number({ message: "Enter points like 1.5" })
    .min(0, "Points can't be negative")
    .max(999, "That's a lot of points")
    .transform((p) => Math.round(p * 100) / 100),
});

export async function updateBillPoints(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("admin", pointsSchema, formData, async ({ billId, memberId, points }) => {
    await db.transaction(async (tx) => {
      const { bill, order } = await loadBill(tx, billId);
      if (bill.splitMode !== "points") throw new ActionError(`${bill.name} isn't split by points.`);
      if (!order.includes(memberId)) throw new ActionError("That person isn't in this month.");
      const allPoints = pointsOf(bill.shares);
      allPoints.set(memberId, points);
      const shares = computeBillShares("points", toCentavos(bill.totalAmount), order, { points: allPoints });
      await writeShares(tx, billId, shares, allPoints);
    });
  });
}

export async function updateBillShare(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ billId: id, memberId: id, amount: moneyField(true) });
  return run("admin", schema, formData, async ({ billId, memberId, amount }) => {
    await db.transaction(async (tx) => {
      const { bill, order } = await loadBill(tx, billId);
      if (bill.splitMode !== "manual") throw new ActionError(`Switch ${bill.name} to Manual to edit shares.`);
      if (!order.includes(memberId)) throw new ActionError("That person isn't in this month.");
      const manual = new Map(bill.shares.map((s) => [s.memberId, toCentavos(s.amount)]));
      manual.set(memberId, amount);
      const shares = computeBillShares("manual", 0, order, { manual });
      // Manual mode: the bill total follows the shares.
      await tx
        .update(billItems)
        .set({ totalAmount: fromCentavos(sumCentavos(shares.values())) })
        .where(eq(billItems.id, billId));
      await writeShares(tx, billId, shares, null);
    });
  });
}

export async function updateBillDates(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ billId: id, field: z.enum(["dueDate", "paidOn"]), value: optionalDate });
  return run("admin", schema, formData, async ({ billId, field, value }) => {
    await db.transaction(async (tx) => {
      // Date paid can still be set once the month is closed: the biller is often paid after
      // (docs/settlement-rules.md → Closing). The Due date can't.
      if (field === "paidOn") await loadBillForDatePaid(tx, billId);
      else await loadBill(tx, billId);
      await tx.update(billItems).set({ [field]: value }).where(eq(billItems.id, billId));
    });
  });
}

/** The banner's "Paid today" (docs/features/reminders.md → Biller due dates). */
export async function markBillPaid(billId: number): Promise<ActionState> {
  return run("admin", z.object({ billId: id }), { billId }, async ({ billId }) => {
    await db.transaction(async (tx) => {
      await loadBillForDatePaid(tx, billId);
      await tx.update(billItems).set({ paidOn: todayInManila() }).where(eq(billItems.id, billId));
    });
  });
}

const addBillSchema = z.object({
  periodId: id,
  name: z.string().trim().min(1, "Enter a bill name").max(60),
  total: moneyField(true).optional(),
  paidById: id,
  splitMode: userSplitMode,
});

export async function addBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("admin", addBillSchema, formData, async ({ periodId, name, total, paidById, splitMode }) => {
    await db.transaction(async (tx) => {
      const { order } = await loadOpenPeriod(tx, periodId);
      if (!order.includes(paidById)) throw new ActionError("The payer isn't in this month.");
      // Manual bills start at ₱0 per person; the total becomes the sum of what's typed.
      const amount = splitMode === "manual" ? 0 : (total ?? 0);
      const [bill] = await tx
        .insert(billItems)
        .values({ periodId, name, totalAmount: fromCentavos(amount), paidById, splitMode })
        .returning({ id: billItems.id });
      await writeShares(tx, bill.id, computeBillShares(splitMode, amount, order), null);
    });
  });
}

export async function renameBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ billId: id, name: z.string().trim().min(1, "Enter a bill name").max(60) });
  return run("admin", schema, formData, async ({ billId, name }) => {
    await db.transaction(async (tx) => {
      await loadBill(tx, billId);
      await tx.update(billItems).set({ name }).where(eq(billItems.id, billId));
    });
  });
}

export async function deleteBill(billId: number): Promise<ActionState> {
  return run("admin", z.object({ billId: id }), { billId }, async ({ billId }) => {
    const files = await db.transaction(async (tx) => {
      const { bill } = await loadBill(tx, billId);
      if (bill.kind === "helper") {
        await lockHelper(tx);
        if (await hasBillEntries(tx, bill.periodId)) {
          throw new ActionError(
            `${bill.name} has visits or early pay logged this month — delete them on the Helper tab first.`,
          );
        }
      }
      // An email that filled this column goes back to the Bill inbox.
      await tx
        .update(billEmails)
        .set({ status: "unmatched", reason: "Its bill column was deleted.", billItemId: null })
        .where(eq(billEmails.billItemId, billId));
      const files = await receiptFilesOf(tx, eq(receipts.billItemId, billId));
      // bill_item_shares and receipts rows go with it (ON DELETE CASCADE).
      await tx.delete(billItems).where(eq(billItems.id, billId));
      return files;
    });
    await removeReceiptFilesQuietly(files);
  });
}

// ---------- Emailed bills (docs/settlement-rules.md → "Email-imported bills") ----------

/** A pending (emailed) bill starts counting. */
export async function confirmBill(billId: number): Promise<ActionState> {
  return run("admin", z.object({ billId: id }), { billId }, async ({ billId }) => {
    await db.transaction(async (tx) => {
      const { bill } = await loadBill(tx, billId);
      if (bill.status !== "pending") throw new ActionError(`${bill.name} is already confirmed.`);
      const shares = sumCentavos(bill.shares.map((s) => toCentavos(s.amount)));
      if (shares !== toCentavos(bill.totalAmount)) {
        throw new ActionError(`${bill.name}'s shares don't add up to its total. Re-enter the total, then confirm.`);
      }
      await tx.update(billItems).set({ status: "confirmed" }).where(eq(billItems.id, billId));
    });
  });
}

/** Undoes an emailed bill: the column goes back to ₱0 and the email is set aside for good. */
export async function discardEmailBill(billId: number): Promise<ActionState> {
  return run("admin", z.object({ billId: id }), { billId }, async ({ billId }) => {
    await db.transaction(async (tx) => {
      const { bill, order } = await loadBill(tx, billId);
      if (bill.status !== "pending") throw new ActionError(`${bill.name} is confirmed; change its amount instead.`);
      // Split mode and points stay; the shares are rewritten at ₱0 so they still add up.
      const points = bill.splitMode === "points" ? pointsFor(bill.shares, order) : null;
      const shares = computeBillShares(bill.splitMode, 0, order, { points: points ?? undefined });
      await tx
        .update(billItems)
        .set({ totalAmount: "0", dueDate: null, source: "manual", status: "confirmed" })
        .where(eq(billItems.id, billId));
      await writeShares(tx, billId, shares, points);
      await tx
        .update(billEmails)
        .set({ status: "dismissed", reason: "Discarded from the Split Table.", billItemId: null })
        .where(eq(billEmails.billItemId, billId));
    });
  });
}

/** Tries an inbox email again (e.g. after starting or reopening its month). */
export async function retryBillEmail(emailId: number): Promise<ActionState> {
  return run("admin", z.object({ emailId: id }), { emailId }, async ({ emailId }) => {
    const outcome = await db.transaction(async (tx) => {
      const email = await tx.query.billEmails.findFirst({ where: eq(billEmails.id, emailId) });
      if (!email || email.status !== "unmatched") throw new ActionError("That email is no longer in the inbox.");
      return placeBill(tx, email);
    });
    if (outcome.kind === "unmatched") {
      // The new reason is saved; refresh so the inbox shows it, and say it here too.
      revalidatePath("/", "layout");
      throw new ActionError(outcome.reason);
    }
  });
}

export async function dismissBillEmail(emailId: number): Promise<ActionState> {
  return run("admin", z.object({ emailId: id }), { emailId }, async ({ emailId }) => {
    const [email] = await db
      .update(billEmails)
      .set({ status: "dismissed" })
      .where(and(eq(billEmails.id, emailId), eq(billEmails.status, "unmatched")))
      .returning({ id: billEmails.id });
    if (!email) throw new ActionError("That email is no longer in the inbox.");
  });
}

// ---------- Advances ----------

const addAdvanceSchema = z.object({
  periodId: id,
  // 0 / missing = the month's default "Advances Shared" column.
  columnId: z.coerce.number().int().nonnegative().default(0),
  payerId: id,
  category: z.enum(["grocery", "food", "service", "misc"], { message: "Choose a category" }),
  description: z.string().trim().min(1, "Enter a description").max(120),
  amount: moneyField(false),
  spentOn: optionalDate,
  fromDrawer: checkbox,
});

// Members may add, edit and delete their own advances in the default column; PA, any advance
// (lib/permissions.ts → canManageAdvance). For a member the payer and column are forced here,
// whatever the form sent.

/** A member's advances are always theirs and always in the default column (0). */
function forMember<T extends { payerId: number; columnId: number }>(data: T, viewer: Viewer): T {
  return isAdmin(viewer) ? data : { ...data, payerId: viewer.memberId, columnId: 0 };
}

export async function addAdvance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("member", addAdvanceSchema, formData, async (input, viewer) => {
    const data = forMember(input, viewer);
    const fromDrawer = drawerFlagFor(data.fromDrawer, data.payerId, data.spentOn, viewer);
    await db.transaction(async (tx) => {
      const { order } = await loadOpenPeriod(tx, data.periodId, viewer);
      if (!order.includes(data.payerId)) {
        throw new ActionError(isAdmin(viewer) ? "The payer isn't in this month." : "You're not in this month.");
      }
      const columnId = await resolveColumn(tx, data.periodId, data.columnId, order);
      await tx.insert(advances).values({
        periodId: data.periodId,
        columnId,
        payerId: data.payerId,
        category: data.category,
        description: data.description,
        amount: fromCentavos(data.amount),
        spentOn: data.spentOn,
        fromDrawer: fromDrawer ?? false,
      });
    });
  });
}

// Editing keeps the advance in its month; changing the column is how it moves between columns.
const updateAdvanceSchema = addAdvanceSchema.omit({ periodId: true }).extend({ advanceId: id });

export async function updateAdvance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("member", updateAdvanceSchema, formData, async ({ advanceId, ...input }, viewer) => {
    const data = forMember(input, viewer);
    const fromDrawer = drawerFlagFor(data.fromDrawer, data.payerId, data.spentOn, viewer);
    await db.transaction(async (tx) => {
      const advance = await loadAdvanceFor(tx, advanceId, viewer, "That advance was deleted.");
      const { order } = await loadOpenPeriod(tx, advance.periodId, viewer);
      if (!order.includes(data.payerId)) throw new ActionError("The payer isn't in this month.");
      const columnId = await resolveColumn(tx, advance.periodId, data.columnId, order);
      const [updated] = await tx
        .update(advances)
        .set({
          columnId,
          payerId: data.payerId,
          category: data.category,
          description: data.description,
          amount: fromCentavos(data.amount),
          spentOn: data.spentOn,
          ...(fromDrawer === undefined ? {} : { fromDrawer }),
        })
        .where(and(eq(advances.id, advanceId), unchangedFor(viewer, advance)))
        .returning({ id: advances.id });
      if (!updated) throw new ActionError("That advance just changed. Refresh and try again.");
    });
  });
}

export async function deleteAdvance(advanceId: number): Promise<ActionState> {
  return run("member", z.object({ advanceId: id }), { advanceId }, async ({ advanceId }, viewer) => {
    await db.transaction(async (tx) => {
      const advance = await loadAdvanceFor(tx, advanceId, viewer, "That advance was already deleted.");
      await loadOpenPeriod(tx, advance.periodId, viewer);
      const [deleted] = await tx
        .delete(advances)
        .where(and(eq(advances.id, advanceId), unchangedFor(viewer, advance)))
        .returning({ id: advances.id });
      if (!deleted) throw new ActionError("That advance just changed. Refresh and try again.");
    });
  });
}

/** Loads an advance the viewer is allowed to change (with its column, to know if it's the default). */
async function loadAdvanceFor(tx: Tx, advanceId: number, viewer: Viewer, missing: string) {
  const advance = await tx.query.advances.findFirst({
    where: eq(advances.id, advanceId),
    with: { column: { columns: { isDefault: true } } },
  });
  if (!advance) throw new ActionError(missing);
  if (!canManageAdvance(viewer, { payerId: advance.payerId, inDefaultColumn: advance.column.isDefault })) {
    throw new ActionError("Only the admin can change this advance.");
  }
  return advance;
}

/**
 * For a member, the write only goes through if the advance is still theirs and still in the
 * column it was checked in — so PA moving it at the same moment can't be undone.
 */
function unchangedFor(viewer: Viewer, advance: { payerId: number; columnId: number }): SQL | undefined {
  if (isAdmin(viewer)) return undefined;
  return and(eq(advances.payerId, viewer.memberId), eq(advances.columnId, advance.columnId));
}

// ---------- The Helper (docs/features/helper.md) ----------

// Her visits and early pay. Members may add, edit and delete the ones they paid; PA, any — and
// only PA sets the debt carried over from the sheet (lib/permissions.ts → canManageHelperEntry).
// Every change rewrites the month's Helper column: its total is what was handed over, split
// equally (lib/helper.ts), and her debt across all months may never go below ₱0.

const helperEntryFields = z.object({
  // 0 / missing for the carried-over debt, which nobody paid.
  payerId: z.coerce.number().int().nonnegative().default(0),
  onDate: optionalDate,
  amount: moneyField(false),
  // Visits only; blank = nothing taken off.
  deduction: z
    .string()
    .default("")
    .transform((v) => v.trim() || "0")
    .pipe(moneyField(true)),
  note: z
    .string()
    .trim()
    .max(120, "Keep the note under 120 characters")
    .default("")
    .transform((v) => v || null),
  fromDrawer: checkbox,
});
const helperKind = z.enum(["visit", "early_pay", "opening"], { message: "Choose visit or early pay" });
type HelperKind = z.output<typeof helperKind>;

/** Validates an entry for its kind and, for a member, makes it theirs whatever the form sent. */
function helperEntryFor(input: z.output<typeof helperEntryFields>, kind: HelperKind, viewer: Viewer) {
  if (kind === "opening") {
    if (!isAdmin(viewer)) throw new ActionError("Only the admin can set her starting debt.");
    return { ...input, kind, payerId: null, deduction: 0, fromDrawer: false };
  }
  const payerId = isAdmin(viewer) ? input.payerId : viewer.memberId;
  if (payerId === 0) throw new ActionError("Choose who paid her.");
  const fromDrawer = drawerFlagFor(input.fromDrawer, payerId, input.onDate, viewer);
  if (kind === "early_pay") return { ...input, kind, payerId, deduction: 0, fromDrawer };
  if (input.deduction > input.amount) throw new ActionError("Taken off can't be more than her daily pay.");
  return { ...input, kind, payerId, fromDrawer };
}

export async function addHelperEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = helperEntryFields.extend({ periodId: id, kind: helperKind });
  return run("member", schema, formData, async ({ periodId, kind, ...input }, viewer) => {
    const data = helperEntryFor(input, kind, viewer);
    await db.transaction(async (tx) => {
      await lockHelper(tx);
      const { order } = await loadOpenPeriod(tx, periodId, viewer);
      if (data.payerId !== null && !order.includes(data.payerId)) {
        throw new ActionError(isAdmin(viewer) ? "The payer isn't in this month." : "You're not in this month.");
      }
      if (data.kind === "opening") {
        const [existing] = await tx
          .select({ id: helperEntries.id })
          .from(helperEntries)
          .where(eq(helperEntries.kind, "opening"))
          .limit(1);
        if (existing) throw new ActionError("Her starting debt is already set — edit it instead.");
      }
      await tx.insert(helperEntries).values({
        periodId,
        kind: data.kind,
        payerId: data.payerId,
        onDate: data.onDate,
        amount: fromCentavos(data.amount),
        deduction: fromCentavos(data.deduction),
        note: data.note,
        fromDrawer: data.fromDrawer ?? false,
      });
      await syncHelperBill(tx, periodId, order, data.kind);
    });
  });
}

// Editing keeps the entry in its month and its kind (visit, early pay or the starting debt).
export async function updateHelperEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = helperEntryFields.extend({ entryId: id });
  return run("member", schema, formData, async ({ entryId, ...input }, viewer) => {
    await db.transaction(async (tx) => {
      await lockHelper(tx);
      const entry = await loadHelperEntryFor(tx, entryId, viewer, "That entry was deleted.");
      const data = helperEntryFor(input, entry.kind, viewer);
      const { order } = await loadOpenPeriod(tx, entry.periodId, viewer);
      if (data.payerId !== null && !order.includes(data.payerId)) throw new ActionError("The payer isn't in this month.");
      await tx
        .update(helperEntries)
        .set({
          payerId: data.payerId,
          onDate: data.onDate,
          amount: fromCentavos(data.amount),
          deduction: fromCentavos(data.deduction),
          note: data.note,
          ...(data.fromDrawer === undefined ? {} : { fromDrawer: data.fromDrawer }),
        })
        .where(eq(helperEntries.id, entryId));
      await syncHelperBill(tx, entry.periodId, order, entry.kind);
    });
  });
}

export async function deleteHelperEntry(entryId: number): Promise<ActionState> {
  return run("member", z.object({ entryId: id }), { entryId }, async ({ entryId }, viewer) => {
    await db.transaction(async (tx) => {
      await lockHelper(tx);
      const entry = await loadHelperEntryFor(tx, entryId, viewer, "That entry was already deleted.");
      const { order } = await loadOpenPeriod(tx, entry.periodId, viewer);
      await tx.delete(helperEntries).where(eq(helperEntries.id, entryId));
      await syncHelperBill(tx, entry.periodId, order, entry.kind);
    });
  });
}

/**
 * One Helper change at a time, across every month: her debt spans them all, so two people
 * logging at once can't each pass the "not below ₱0" check, or leave a stale column total.
 * Taken before reading the entry, so a member's ownership check can't go stale either.
 */
async function lockHelper(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(${HELPER_LOCK_KEY})`);
}
// Any fixed number unique to this lock.
const HELPER_LOCK_KEY = 7_201_001;

/** Loads a Helper entry the viewer is allowed to change. */
async function loadHelperEntryFor(tx: Tx, entryId: number, viewer: Viewer, missing: string) {
  const entry = await tx.query.helperEntries.findFirst({ where: eq(helperEntries.id, entryId) });
  if (!entry) throw new ActionError(missing);
  if (!canManageHelperEntry(viewer, entry)) throw new ActionError("Only the admin can change this entry.");
  return entry;
}

/** Whether the month has visits or early pay, which make its Helper column (not her starting debt). */
async function hasBillEntries(tx: Tx, periodId: number): Promise<boolean> {
  const [entry] = await tx.select({ id: helperEntries.id }).from(helperEntries).where(helperBillEntriesIn(periodId)).limit(1);
  return Boolean(entry);
}
const helperBillEntriesIn = (periodId: number) =>
  and(eq(helperEntries.periodId, periodId), sql`${helperEntries.kind} <> 'opening'`);

/**
 * After a change: checks she never owes less than ₱0 at any point (in ledger order), then — unless
 * it was her starting debt, which is in no bill — sets the month's Helper column to what was
 * handed over and re-splits it equally, creating the column if the month has none yet.
 */
async function syncHelperBill(tx: Tx, periodId: number, order: MemberId[], changed: HelperKind) {
  const rows = await tx.query.helperEntries.findMany({ with: { period: { columns: { year: true, month: true } } } });
  const ledger = rows.toSorted(
    (a, b) => a.period.year - b.period.year || a.period.month - b.period.month || ledgerCompare(a, b),
  );
  const overdrawn = firstOverdrawn(ledger);
  if (overdrawn) {
    const when = overdrawn.entry.onDate ? `by ${dateLabel(overdrawn.entry.onDate)}` : "on an undated visit";
    throw new ActionError(
      `That takes off more than she owes: ${when}, ${formatPHP(-overdrawn.owes)} more was taken off than she'd been given. Check the dates, her early pay and the amounts taken off.`,
    );
  }
  if (changed === "opening") return;
  const monthEntries = rows.filter((e) => e.periodId === periodId && countsInBill(e));
  const total = helperBillTotal(monthEntries);

  let bill = await tx.query.billItems.findFirst({
    where: and(eq(billItems.periodId, periodId), eq(billItems.kind, "helper")),
  });
  if (!bill) {
    if (monthEntries.length === 0) return;
    const [taken] = await tx
      .select({ id: billItems.id })
      .from(billItems)
      .where(and(eq(billItems.periodId, periodId), eq(sql`lower(${billItems.name})`, HELPER_BILL_NAME.toLowerCase())))
      .limit(1);
    if (taken) throw new ActionError(`Another column is already named ${HELPER_BILL_NAME} — rename it in Manage first.`);
    // The payer only matters while no visits are logged; the collector, like any new bill.
    [bill] = await tx
      .insert(billItems)
      .values({ periodId, name: HELPER_BILL_NAME, kind: "helper", totalAmount: "0", paidById: order[0], splitMode: "equal" })
      .returning();
  }
  if (bill.splitMode !== "equal") {
    throw new ActionError(`${bill.name} isn't split equally, so visits can't be logged into it.`);
  }
  await tx.update(billItems).set({ totalAmount: fromCentavos(total) }).where(eq(billItems.id, bill.id));
  await writeShares(tx, bill.id, computeBillShares("equal", total, order), null);
}
const HELPER_BILL_NAME = "Helper";

/** A Helper column whose month has visits or early pay: its payers come from those, not `paid_by_id`. */
const helperBillDrivenByEntries = and(
  eq(billItems.kind, "helper"),
  sql`exists (select 1 from ${helperEntries} where ${helperEntries.periodId} = ${billItems.periodId} and ${helperEntries.kind} <> 'opening')`,
)!;

// ---------- Payments ----------

// Money actually changing hands to settle up (usually someone ↔ the House Budget).
// Either side may be the House Budget (stored as NULL), never both.
const party = z.literal(HOUSE_BUDGET).or(id);
const paymentSchema = z.object({
  fromMemberId: party,
  toMemberId: party,
  amount: moneyField(false),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it was paid"),
  note: z
    .string()
    .trim()
    .max(120, "Keep the note under 120 characters")
    .optional()
    .transform((v) => v || null),
});

type PaymentInput = z.output<typeof paymentSchema>;

function checkPaymentMembers(order: MemberId[], data: PaymentInput) {
  if (data.fromMemberId === data.toMemberId) {
    throw new ActionError(data.fromMemberId === HOUSE_BUDGET ? "Pick a person on one side." : "Pick two different people.");
  }
  const sides = [data.fromMemberId, data.toMemberId].filter((p) => p !== HOUSE_BUDGET);
  if (!sides.every((m) => order.includes(m))) {
    throw new ActionError(sides.length === 2 ? "Both people have to be in this month." : "That person has to be in this month.");
  }
}

/** A payment's columns as stored: a House Budget side is NULL. */
function paymentColumns(data: PaymentInput) {
  return {
    fromMemberId: partyToColumn(data.fromMemberId),
    toMemberId: partyToColumn(data.toMemberId),
    amount: fromCentavos(data.amount),
    paidOn: data.paidOn,
    note: data.note,
  };
}

export async function addPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("admin", paymentSchema.extend({ periodId: id }), formData, async ({ periodId, ...data }) => {
    await db.transaction(async (tx) => {
      const { order } = await loadOpenPeriod(tx, periodId);
      checkPaymentMembers(order, data);
      await tx.insert(payments).values({ periodId, ...paymentColumns(data) });
    });
  });
}

export async function updatePayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("admin", paymentSchema.extend({ paymentId: id }), formData, async ({ paymentId, ...data }) => {
    await db.transaction(async (tx) => {
      const payment = await tx.query.payments.findFirst({ where: eq(payments.id, paymentId) });
      if (!payment) throw new ActionError("That payment was deleted.");
      // A waiting one can be fixed before confirming (it stays waiting); a rejected one can't.
      if (payment.status === "rejected") throw new ActionError("A rejected payment can't be edited. Delete it instead.");
      // A housemate's "I paid" stays theirs, into the House Budget: only its amount, date or note
      // change. Compared as Parties: the stored House Budget side is NULL.
      if (
        payment.status === "pending" &&
        (data.fromMemberId !== partyFromColumn(payment.fromMemberId) ||
          data.toMemberId !== partyFromColumn(payment.toMemberId))
      ) {
        throw new ActionError("A waiting payment keeps who paid whom. Change the amount or date, or reject it.");
      }
      const { order } = await loadOpenPeriod(tx, payment.periodId);
      checkPaymentMembers(order, data);
      await tx.update(payments).set(paymentColumns(data)).where(eq(payments.id, paymentId));
    });
  });
}

export async function deletePayment(paymentId: number): Promise<ActionState> {
  return run("admin", z.object({ paymentId: id }), { paymentId }, ({ paymentId }, viewer) =>
    removePayment(paymentId, viewer),
  );
}

// ---------- A housemate's "I paid" (docs/features/settle-up.md) ----------

// A housemate sends their payment into the House Budget with the transfer's screenshot. It waits
// ("pending", not counted) until PA confirms or rejects it. The server sets who paid whom.

const submitPaymentSchema = z.object({
  periodId: id,
  amount: moneyField(false),
  paidOn: paymentSchema.shape.paidOn,
  note: paymentSchema.shape.note,
  file: z.instanceof(File, { message: "Attach the screenshot of your transfer." }),
});

export async function submitPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("member", submitPaymentSchema, formData, async ({ periodId, file, ...data }, viewer) => {
    if (file.size === 0) throw new ActionError("Attach the screenshot of your transfer.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = checkReceiptFile(bytes);
    if (!checked.ok) throw new ActionError(checked.error);
    // Checked before uploading too, so a refused payment never uploads a file.
    const { period } = await db.transaction((tx) => loadPaymentTarget(tx, periodId, viewer));

    // Uploaded outside any transaction (like uploadReceipt), then saved with the payment.
    const path = receiptObjectPath(period.year, period.month, randomUUID(), checked.contentType);
    const { error } = await receiptStorage().upload(path, bytes, { contentType: checked.contentType, upsert: false });
    if (error) {
      console.error("Payment proof upload failed", error);
      throw new ActionError("Couldn't upload the screenshot. Please try again.");
    }
    try {
      await db.transaction(async (tx) => {
        // Locked and checked again: PA may have started the next month or closed this one meanwhile.
        await lockPeriod(tx, periodId);
        await loadPaymentTarget(tx, periodId, viewer);
        const [payment] = await tx
          .insert(payments)
          .values({
            periodId,
            fromMemberId: viewer.memberId,
            toMemberId: partyToColumn(HOUSE_BUDGET),
            amount: fromCentavos(data.amount),
            paidOn: data.paidOn,
            note: data.note,
            status: "pending",
          })
          .returning({ id: payments.id });
        await tx.insert(receipts).values({
          storagePath: path,
          contentType: checked.contentType,
          sizeBytes: bytes.length,
          originalName: cleanFileName(file.name),
          paymentId: payment.id,
          uploadedById: viewer.memberId,
        });
      });
    } catch (error) {
      await removeReceiptFilesQuietly([path]);
      throw error;
    }
    // After the response: a push never slows down or fails the save (lib/push.ts).
    if (!isAdmin(viewer)) {
      after(() => pushToAdmin(paymentSentPush({ name: viewer.name, year: period.year, month: period.month })));
    }
  });
}

/** A housemate cancels their own waiting or rejected payment (and its proof). */
export async function cancelPayment(paymentId: number): Promise<ActionState> {
  return run("member", z.object({ paymentId: id }), { paymentId }, ({ paymentId }, viewer) =>
    removePayment(paymentId, viewer),
  );
}

/** PA checked the bank: the waiting payment counts from now on. */
export async function confirmPayment(paymentId: number): Promise<ActionState> {
  return run("admin", z.object({ paymentId: id }), { paymentId }, async ({ paymentId }) => {
    // Returns nothing: run() would take a returned value for a page to go to.
    const decided = await decideWaitingPayment(paymentId, { status: "confirmed" });
    pushDecision(decided, "confirmed");
  });
}

/** PA didn't receive it: it stays in the list as rejected, with the reason, and never counts. */
export async function rejectPayment(paymentId: number, reason: string): Promise<ActionState> {
  const schema = z.object({
    paymentId: id,
    reason: z
      .string()
      .trim()
      .min(1, "Say why, so they know what to check.")
      .max(120, "Keep the reason under 120 characters"),
  });
  return run("admin", schema, { paymentId, reason }, async ({ paymentId, reason }) => {
    const decided = await decideWaitingPayment(paymentId, { status: "rejected", rejectedReason: reason });
    pushDecision(decided, "rejected");
  });
}

/** Tells the housemate PA confirmed or rejected their "I paid", after the response (lib/push.ts). */
function pushDecision(decided: Decided, status: "confirmed" | "rejected") {
  const { payer, year, month, collectorName } = decided;
  if (payer) after(() => sendPush([payer], paymentDecidedPush({ status, year, month, collectorName })));
}

/** The latest, open month and its collector, for a housemate's "I paid". */
async function loadPaymentTarget(tx: Tx, periodId: number, viewer: Viewer) {
  const { period, order } = await loadOpenPeriod(tx, periodId);
  const [latest] = await tx
    .select({ id: billingPeriods.id, year: billingPeriods.year, month: billingPeriods.month })
    .from(billingPeriods)
    .orderBy(desc(billingPeriods.year), desc(billingPeriods.month))
    .limit(1);
  if (latest && latest.id !== periodId) {
    throw new ActionError(`Send it in ${monthLabel(latest.year, latest.month)}, the latest month.`);
  }
  if (!order.includes(viewer.memberId)) throw new ActionError("You're not in this month.");
  // The collector checks the House Budget and confirms, so the month needs one.
  const collector = period.balances.find((b) => b.member.isCollector)?.member ?? null;
  if (!collector) throw new ActionError("This month has nobody to confirm payments.");
  if (!canSubmitPayment(viewer, collector.id)) {
    throw new ActionError("You confirm the payments — record it under Payments instead.");
  }
  return { period };
}

/** Who sent a payment PA just decided, and its month: for the push to them. */
interface Decided {
  payer: { id: number; name: string } | null;
  year: number;
  month: number;
  collectorName: string;
}

/**
 * Confirms or rejects a waiting payment. Only from "pending": if the housemate cancelled it or
 * PA already decided (in another tab), nothing changes and the page says so. Returns who sent it
 * and its month, for the push to them.
 */
async function decideWaitingPayment(
  paymentId: number,
  values: { status: "confirmed" } | { status: "rejected"; rejectedReason: string },
): Promise<Decided> {
  return db.transaction(async (tx) => {
    const payment = await tx.query.payments.findFirst({ where: eq(payments.id, paymentId) });
    if (!payment) throw new ActionError("That payment was cancelled.");
    const { period } = await loadOpenPeriod(tx, payment.periodId);
    const updated = await tx
      .update(payments)
      .set(values)
      .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
      .returning({ id: payments.id });
    if (updated.length === 0) throw new ActionError("That payment isn't waiting any more. Reload to see it.");
    const inMonth = period.balances.map((b) => b.member);
    const from = partyFromColumn(payment.fromMemberId);
    const payer = from === HOUSE_BUDGET ? undefined : inMonth.find((m) => m.id === from);
    return {
      payer: payer ? { id: payer.id, name: payer.name } : null,
      year: period.year,
      month: period.month,
      collectorName: inMonth.find((m) => m.isCollector)?.name ?? "The admin",
    };
  });
}

/**
 * Deletes a payment and its proofs: PA any; a housemate their own while it waits or was
 * rejected (lib/permissions.ts). The delete re-checks that, so a payment PA confirmed a moment
 * ago stays.
 */
async function removePayment(paymentId: number, viewer: Viewer) {
  const files = await db.transaction(async (tx) => {
    const payment = await tx.query.payments.findFirst({ where: eq(payments.id, paymentId) });
    if (!payment) throw new ActionError("That payment was already deleted.");
    if (!canCancelPayment(viewer, { status: payment.status, fromMemberId: partyFromColumn(payment.fromMemberId) })) {
      throw new ActionError(
        payment.status === "confirmed" && payment.fromMemberId === viewer.memberId
          ? "PA has confirmed it, so only PA can change it now."
          : "Only PA can delete this payment.",
      );
    }
    await loadOpenPeriod(tx, payment.periodId);
    const files = await receiptFilesOf(tx, eq(receipts.paymentId, paymentId));
    // Its receipts rows go with it (ON DELETE CASCADE).
    const deleted = await tx
      .delete(payments)
      .where(
        isAdmin(viewer)
          ? eq(payments.id, paymentId)
          : and(
              eq(payments.id, paymentId),
              eq(payments.fromMemberId, viewer.memberId),
              inArray(payments.status, ["pending", "rejected"]),
            ),
      )
      .returning({ id: payments.id });
    if (deleted.length === 0) throw new ActionError("That payment changed meanwhile. Reload to see it.");
    return files;
  });
  await removeReceiptFilesQuietly(files);
}

// ---------- Receipts (docs/features/receipts.md) ----------

// Proof attached to a bill or a payment. PA only for now; closed months are read-only, like
// everything else. Postgres and Storage can't share a transaction, so the file is uploaded
// first and removed again if saving its row fails — and removed after a delete commits.

const receiptOwner = z.object({ ownerType: z.enum(["bill", "payment"]), ownerId: id });
type ReceiptOwner = z.output<typeof receiptOwner>;

export async function uploadReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = receiptOwner.extend({ file: z.instanceof(File, { message: "Choose a file to attach." }) });
  return run("admin", schema, formData, async ({ file, ...owner }, viewer) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = checkReceiptFile(bytes);
    if (!checked.ok) throw new ActionError(checked.error);
    // Checked before uploading too, so a refused file never goes up.
    const { period } = await db.transaction(async (tx) => {
      const loaded = await loadReceiptOwner(tx, owner);
      await checkReceiptRoom(tx, owner, false);
      return loaded;
    });

    // Uploaded outside any transaction: one held open during an upload would hold its locks.
    const path = receiptObjectPath(period.year, period.month, randomUUID(), checked.contentType);
    const { error } = await receiptStorage().upload(path, bytes, { contentType: checked.contentType, upsert: false });
    if (error) {
      console.error("Receipt upload failed", error);
      throw new ActionError("Couldn't upload that file. Please try again.");
    }
    try {
      await db.transaction(async (tx) => {
        // Again: the bill, payment or month may have changed during the upload.
        await loadReceiptOwner(tx, owner);
        await checkReceiptRoom(tx, owner, true);
        await tx.insert(receipts).values({
          storagePath: path,
          contentType: checked.contentType,
          sizeBytes: bytes.length,
          originalName: cleanFileName(file.name),
          billItemId: owner.ownerType === "bill" ? owner.ownerId : null,
          paymentId: owner.ownerType === "payment" ? owner.ownerId : null,
          uploadedById: viewer.memberId,
        });
      });
    } catch (error) {
      await removeReceiptFilesQuietly([path]);
      throw error;
    }
  });
}

export async function deleteReceipt(receiptId: number): Promise<ActionState> {
  return run("admin", z.object({ receiptId: id }), { receiptId }, async ({ receiptId }) => {
    const path = await db.transaction(async (tx) => {
      const receipt = await tx.query.receipts.findFirst({ where: eq(receipts.id, receiptId) });
      if (!receipt) throw new ActionError("That receipt was already deleted.");
      await loadReceiptOwner(
        tx,
        receipt.billItemId !== null
          ? { ownerType: "bill", ownerId: receipt.billItemId }
          : { ownerType: "payment", ownerId: receipt.paymentId! },
      );
      await tx.delete(receipts).where(eq(receipts.id, receiptId));
      return receipt.storagePath;
    });
    await removeReceiptFilesQuietly([path]);
  });
}

/** The bill or payment a receipt belongs to, in an open month. */
async function loadReceiptOwner(tx: Tx, { ownerType, ownerId }: ReceiptOwner) {
  const owner =
    ownerType === "bill"
      ? await tx.query.billItems.findFirst({ where: eq(billItems.id, ownerId), columns: { periodId: true } })
      : await tx.query.payments.findFirst({ where: eq(payments.id, ownerId), columns: { periodId: true } });
  if (!owner) throw new ActionError(ownerType === "bill" ? "That bill no longer exists." : "That payment was deleted.");
  return loadOpenPeriod(tx, owner.periodId);
}

/**
 * Refuses a proof beyond MAX_RECEIPTS_PER_ITEM. With `lock`, the bill or payment row is locked
 * first, so two uploads at the same moment can't both slip in as the fifth.
 */
async function checkReceiptRoom(tx: Tx, { ownerType, ownerId }: ReceiptOwner, lock: boolean) {
  if (lock) {
    const table = ownerType === "bill" ? billItems : payments;
    await tx.select({ id: table.id }).from(table).where(eq(table.id, ownerId)).for("update");
  }
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(receipts)
    .where(ownerType === "bill" ? eq(receipts.billItemId, ownerId) : eq(receipts.paymentId, ownerId));
  if (receiptsLeft(count) === 0) {
    throw new ActionError(`That already has ${MAX_RECEIPTS_PER_ITEM} proofs, the most it can have. Delete one first.`);
  }
}

async function receiptFilesOf(tx: Tx, where: SQL): Promise<string[]> {
  const rows = await tx.select({ path: receipts.storagePath }).from(receipts).where(where);
  return rows.map((r) => r.path);
}

/**
 * Best effort, after the database change has committed: the rows are already gone, so a file
 * left behind is invisible to everyone and only takes up space.
 */
async function removeReceiptFilesQuietly(paths: string[]) {
  if (paths.length === 0) return;
  try {
    const { error } = await receiptStorage().remove(paths);
    if (error) console.error("Couldn't remove receipt files", paths, error);
  } catch (error) {
    console.error("Couldn't remove receipt files", paths, error);
  }
}

// ---------- Shared columns ----------

const addSharedColumnSchema = z.object({
  periodId: id,
  name: z.string().trim().min(1, "Enter a column name").max(60),
  splitMode: userSplitMode,
  sharedMode: z.enum(["all", "except"]).default("all"),
  excluded: z.array(id).default([]),
});

export async function addSharedColumn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const input = { ...Object.fromEntries(formData), excluded: formData.getAll("excluded") };
  return run("admin", addSharedColumnSchema, input, async ({ periodId, name, splitMode, sharedMode, excluded }) => {
    await db.transaction(async (tx) => {
      const { order } = await loadOpenPeriod(tx, periodId);
      const left = new Set(sharedMode === "except" ? excluded : []);
      if (splitMode === "equal" && order.every((m) => left.has(m))) {
        throw new ActionError("At least one person has to share the column.");
      }
      const [column] = await tx
        .insert(sharedColumns)
        .values({ periodId, name, splitMode })
        .returning({ id: sharedColumns.id });
      await tx.insert(sharedColumnMembers).values(
        order.map((memberId) => ({ columnId: column.id, memberId, included: !left.has(memberId) })),
      );
    });
  });
}

export async function setSharedColumnMode(columnId: number, mode: "equal" | "manual"): Promise<ActionState> {
  return run("admin", z.object({ columnId: id, mode: userSplitMode }), { columnId, mode }, async ({ columnId, mode }) => {
    await db.transaction(async (tx) => {
      const { column, order } = await loadColumn(tx, columnId);
      if (column.splitMode === mode) return;
      const total = sumCentavos(column.advances.map((a) => toCentavos(a.amount)));

      if (mode === "manual") {
        // Start from the current equal split so it adds up; then edit anyone's amount.
        const included = order.filter((m) => column.members.some((x) => x.memberId === m && x.included));
        const shares = total > 0 && included.length ? splitEqually(total, included) : new Map<MemberId, Centavos>();
        await upsertColumnMembers(
          tx,
          columnId,
          order.map((memberId) => ({ memberId, amount: fromCentavos(shares.get(memberId) ?? 0) })),
        );
      } else {
        // Back to equal: whoever had an amount shares it (everyone, if nobody did).
        const withAmount = new Set(
          column.members.filter((m) => m.amount !== null && toCentavos(m.amount) > 0).map((m) => m.memberId),
        );
        await upsertColumnMembers(
          tx,
          columnId,
          order.map((memberId) => ({
            memberId,
            amount: null,
            included: withAmount.size === 0 || withAmount.has(memberId),
          })),
        );
      }
      await tx.update(sharedColumns).set({ splitMode: mode }).where(eq(sharedColumns.id, columnId));
    });
  });
}

export async function updateSharedColumnMembers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const input = { columnId: formData.get("columnId"), included: formData.getAll("included") };
  const schema = z.object({ columnId: id, included: z.array(id).min(1, "At least one person has to share it.") });
  return run("admin", schema, input, async ({ columnId, included }) => {
    await db.transaction(async (tx) => {
      const { order } = await loadColumn(tx, columnId);
      const chosen = new Set(included);
      await upsertColumnMembers(
        tx,
        columnId,
        order.map((memberId) => ({ memberId, included: chosen.has(memberId) })),
      );
    });
  });
}

export async function updateSharedColumnAmount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ columnId: id, memberId: id, amount: moneyField(true) });
  return run("admin", schema, formData, async ({ columnId, memberId, amount }) => {
    await db.transaction(async (tx) => {
      const { column, order } = await loadColumn(tx, columnId);
      if (column.splitMode !== "manual") throw new ActionError(`Switch ${column.name} to Manual to type amounts.`);
      if (!order.includes(memberId)) throw new ActionError("That person isn't in this month.");
      await upsertColumnMembers(tx, columnId, [{ memberId, amount: fromCentavos(amount) }]);
    });
  });
}

export async function renameSharedColumn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ columnId: id, name: z.string().trim().min(1, "Enter a column name").max(60) });
  return run("admin", schema, formData, async ({ columnId, name }) => {
    await db.transaction(async (tx) => {
      await loadColumn(tx, columnId);
      await tx.update(sharedColumns).set({ name }).where(eq(sharedColumns.id, columnId));
    });
  });
}

export async function deleteSharedColumn(columnId: number): Promise<ActionState> {
  return run("admin", z.object({ columnId: id }), { columnId }, async ({ columnId }) => {
    await db.transaction(async (tx) => {
      const { column } = await loadColumn(tx, columnId);
      if (column.isDefault) throw new ActionError(`${column.name} is the main shared column and stays.`);
      if (column.advances.length > 0) {
        throw new ActionError(
          `${column.name} still has ${column.advances.length} advance(s). Move them to another column (edit the advance) or delete them first.`,
        );
      }
      // shared_column_members rows go with it (ON DELETE CASCADE).
      await tx.delete(sharedColumns).where(eq(sharedColumns.id, columnId));
    });
  });
}

// ---------- Members ----------

export async function addMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({
    name: z.string().trim().min(1, "Enter a name").max(40),
    // A checkbox: "on" when ticked, missing otherwise.
    viewOnly: z.literal("on").optional(),
  });
  return run("admin", schema, formData, async ({ name, viewOnly }) => {
    await db.transaction(async (tx) => {
      // The months first, then the member (always that order: openPeriods).
      const open = await openPeriods(tx);
      // Locked, so a second click (or tab) re-adding the same former member waits and then sees
      // them active. (Two adds of a brand-new name meet the unique name index instead.)
      const [existing] = await tx.select().from(members).where(eq(members.name, name)).for("update");
      let memberId: number;
      if (existing?.active) throw new ActionError(`${name} is already in the household.`);
      if (viewOnly && existing?.role === "admin") {
        throw new ActionError(`${name} was the admin. Add them again without View only.`);
      }
      const role = existing?.role === "admin" ? "admin" : viewOnly ? "view_only" : "member";
      if (existing) {
        if (role === "view_only") {
          // A view-only login is in no month, ever (docs/settlement-rules.md). Someone who was
          // part of a month stays on its list for good, and it can be reopened, so they can't
          // become one.
          const [past] = await tx
            .select({ periodId: periodBalances.periodId })
            .from(periodBalances)
            .where(eq(periodBalances.memberId, existing.id))
            .limit(1);
          if (past) {
            throw new ActionError(
              `${name} was part of past months, so can't be view only. Add them as a housemate, or as view only under another name.`,
            );
          }
        }
        // Someone who moved out and came back keeps their history.
        await tx.update(members).set({ active: true, role }).where(eq(members.id, existing.id));
        memberId = existing.id;
      } else {
        const [{ top }] = await tx.select({ top: max(members.sortOrder) }).from(members);
        const [row] = await tx
          .insert(members)
          .values({ name, sortOrder: (top ?? 0) + 1, role })
          .returning({ id: members.id });
        memberId = row.id;
      }
      // A view-only login joins no month, so shares in nothing (docs/settlement-rules.md).
      if (role === "view_only") return;
      for (const period of open) {
        await tx.insert(periodBalances).values({ periodId: period.id, memberId }).onConflictDoNothing();
        // Newcomers share the everyday column; manual columns get them at ₱0; situational
        // equal columns (e.g. "w/o PA") are left as they were.
        const columns = await tx.query.sharedColumns.findMany({ where: eq(sharedColumns.periodId, period.id) });
        for (const column of columns) {
          await tx
            .insert(sharedColumnMembers)
            .values({ columnId: column.id, memberId, included: column.isDefault || column.splitMode === "manual" })
            .onConflictDoNothing();
        }
        await resplitPeriodBills(tx, period.id);
      }
    });
  });
}

export async function removeMember(memberId: number): Promise<ActionState> {
  return run("admin", z.object({ memberId: id }), { memberId }, async ({ memberId }) => {
    // Returns the login they had, deleted below once the removal has committed.
    const oldLogin = await db.transaction(async (tx) => {
      // The months first, then the Helper tab, then the member: the order everything else locks
      // in (openPeriods; a Helper change holds lockHelper while it writes rows naming members).
      const open = await openPeriods(tx);
      // In turn with the Helper tab, so a visit they log right now can't land after the check
      // below that keeps them in a month where they paid her.
      await lockHelper(tx);
      // Locked, so an invite saved at the same moment can't leave a stale login behind.
      const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
      if (!member || !member.active) throw new ActionError("That person was already removed.");
      if (member.isCollector) throw new ActionError(`${member.name} is the collector and can't be removed.`);
      const active = await tx.select({ id: members.id, role: members.role }).from(members).where(eq(members.active, true));
      const staying = active.filter((m) => m.id !== memberId && sharesCosts(m));
      if (sharesCosts(member) && staying.length === 0) {
        throw new ActionError("At least one person has to stay in the household.");
      }

      // Deactivated: left out of future months, history kept. Their login goes too, so
      // someone re-added later needs a fresh invite.
      await tx
        .update(members)
        .set({ active: false, email: null, authUserId: null })
        .where(eq(members.id, memberId));

      const collector = await tx.query.members.findFirst({
        where: and(eq(members.isCollector, true), eq(members.active, true)),
      });

      for (const period of open) {
        // Anyone with records in a month stays in that month so its numbers don't change.
        if (await hasRecordsIn(tx, period.id, memberId)) continue;
        // So does anyone who carried an unsettled balance into it, or that money would vanish.
        // (If the month can't be computed, keep them to be safe.)
        const computed = await computePeriod(tx, period.year, period.month);
        const row = computed?.result?.rows.find((r) => r.member.id === memberId);
        if (!computed?.result || (row && row.opening !== 0)) continue;
        const inPeriod = await tx.query.periodBalances.findFirst({
          where: and(eq(periodBalances.periodId, period.id), eq(periodBalances.memberId, memberId)),
        });
        if (!inPeriod) continue;
        // ₱0 bills they're down as paying (copied from last month by "Start next month")
        // aren't real payments, nor is a Helper column whose visits say who paid: hand them to
        // the collector so the member can leave the month.
        const zeroBillsPaid = await tx
          .select({ id: billItems.id })
          .from(billItems)
          .where(
            and(
              eq(billItems.periodId, period.id),
              eq(billItems.paidById, memberId),
              or(eq(billItems.totalAmount, "0"), helperBillDrivenByEntries),
            ),
          );
        if (zeroBillsPaid.length) {
          if (!collector) throw new ActionError(`${member.name} is down as paying a bill. Set a collector first.`);
          await tx
            .update(billItems)
            .set({ paidById: collector.id })
            .where(inArray(billItems.id, zeroBillsPaid.map((b) => b.id)));
        }
        const columns = await tx.query.sharedColumns.findMany({
          where: eq(sharedColumns.periodId, period.id),
          with: { members: true, advances: true },
        });
        for (const column of columns) {
          const othersIncluded = column.members.some((m) => m.memberId !== memberId && m.included);
          if (column.splitMode === "equal" && column.advances.length > 0 && !othersIncluded) {
            throw new ActionError(`"${column.name}" is only shared with ${member.name}. Change who shares it first.`);
          }
          await tx
            .delete(sharedColumnMembers)
            .where(and(eq(sharedColumnMembers.columnId, column.id), eq(sharedColumnMembers.memberId, memberId)));
        }
        const billIds = (
          await tx.select({ id: billItems.id }).from(billItems).where(eq(billItems.periodId, period.id))
        ).map((b) => b.id);
        if (billIds.length) {
          await tx
            .delete(billItemShares)
            .where(and(inArray(billItemShares.billItemId, billIds), eq(billItemShares.memberId, memberId)));
        }
        await tx
          .delete(periodBalances)
          .where(and(eq(periodBalances.periodId, period.id), eq(periodBalances.memberId, memberId)));
        await resplitPeriodBills(tx, period.id);
      }
      return member.authUserId;
    });
    // Best effort: they're already locked out (no member row matches the login any more).
    if (oldLogin) await deleteLoginQuietly(oldLogin);
  });
}

/**
 * Invites someone to log in (docs/features/auth.md), changes their login email, or — with an
 * empty email — un-invites them. PA's own login is changed with `npm run auth:invite`, so a
 * typo here can't lock him out.
 */
export async function updateMemberEmail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ memberId: id, email: z.string().trim().toLowerCase().max(254) });
  return run("admin", schema, formData, async ({ memberId, email }, viewer) => {
    if (memberId === viewer.memberId) {
      throw new ActionError("Change your own login with npm run auth:invite, so a typo can't lock you out.");
    }
    if (email === "") {
      await uninviteMember(db, authAdmin(), memberId);
    } else {
      if (!z.email().safeParse(email).success) throw new ActionError("Enter an email like name@example.com");
      if ((await domainTakesMail(email)) === "no") {
        throw new ActionError(`"${email.split("@")[1]}" can't receive email — check the part after the @.`);
      }
      await inviteMember(db, authAdmin(), memberId, email);
    }
  });
}

/**
 * Sets someone's emoji, shown in place of their colour dot (docs/features/manage.md → Emoji):
 * the admin anyone's (Manage), a housemate their own (the account menu). Empty clears it. Who
 * may is checked here against the real login (canSetEmoji), never trusted from the page.
 */
export async function updateMemberEmoji(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ memberId: id, emoji: z.string().max(64) });
  return run("member", schema, formData, async ({ memberId, emoji }, viewer) => {
    if (!canSetEmoji(viewer, memberId)) throw new ActionError("You can only change your own emoji.");
    const parsed = parseEmoji(emoji);
    if (!parsed.ok) throw new ActionError("Type a single emoji, or leave it empty for the dot.");
    const [updated] = await db
      .update(members)
      .set({ emoji: parsed.emoji })
      .where(eq(members.id, memberId))
      .returning({ id: members.id });
    if (!updated) throw new ActionError("That person isn't in the household.");
  });
}

/**
 * Sets the House Budget's emoji, shown in place of its icon (docs/features/manage.md → Emoji).
 * Admin only: it's PA's account. Empty clears it. The settings row is made the first time.
 */
export async function updateHouseBudgetEmoji(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ emoji: z.string().max(64) });
  return run("admin", schema, formData, async ({ emoji }) => {
    const parsed = parseEmoji(emoji);
    if (!parsed.ok) throw new ActionError("Type a single emoji, or leave it empty for the bank icon.");
    await db
      .insert(householdSettings)
      .values({ id: 1, houseBudgetEmoji: parsed.emoji })
      .onConflictDoUpdate({ target: householdSettings.id, set: { houseBudgetEmoji: parsed.emoji } });
  });
}

async function deleteLoginQuietly(authUserId: string) {
  try {
    const { error } = await authAdmin().deleteUser(authUserId);
    if (error) console.error("Couldn't delete a removed member's login", error);
  } catch (error) {
    console.error("Couldn't delete a removed member's login", error);
  }
}

// ---------- Months ----------

/** "Start <next month>". The daily job also starts it by itself on the 1st (lib/month-start.ts). */
export async function startNextMonth(): Promise<ActionState> {
  return run("admin", z.object({}), {}, async () => {
    const { year, month } = await db.transaction((tx) => startNextMonthIn(tx));
    return `/periods/${year}/${month}`;
  });
}

/**
 * Locks a month: saves everyone's Final as their closing balance and, when the next month
 * exists, as its opening balance. Unpaid amounts carry over (docs/settlement-rules.md).
 */
export async function closeMonth(periodId: number): Promise<ActionState> {
  return run("admin", z.object({ periodId: id }), { periodId }, async ({ periodId }) => {
    // lib/month-close.ts, so the database tests can run it (lib/month-close.test.ts).
    await db.transaction((tx) => closeMonthIn(tx, periodId));
  });
}

/**
 * Emails each housemate their own bill for the month — what they owe or get back — with a link
 * to Settle Up (docs/features/reminders.md). Once the bills are in and checked; a resend is fine.
 */
export async function emailPayables(periodId: number): Promise<ActionState> {
  return run("admin", z.object({ periodId: id }), { periodId }, ({ periodId }) => sendPayables(periodId));
}

/** Unlocks a month. The next month goes back to live carry-over on its own. */
export async function reopenMonth(periodId: number): Promise<ActionState> {
  return run("admin", z.object({ periodId: id }), { periodId }, async ({ periodId }) => {
    await db.transaction(async (tx) => {
      // Locked first, like closing: never halfway through a close, and the month after can't be
      // closed meanwhile.
      await lockPeriodAndNeighbours(tx, periodId);
      const all = await tx.query.billingPeriods.findMany({
        orderBy: [asc(billingPeriods.year), asc(billingPeriods.month)],
      });
      const index = all.findIndex((p) => p.id === periodId);
      if (index === -1) throw new ActionError("That month no longer exists.");
      const check = reopenCheck(all[index], all[index + 1] ?? null);
      if (!check.ok) throw new ActionError(check.reason!);
      await tx.update(billingPeriods).set({ status: "open", closedAt: null }).where(eq(billingPeriods.id, periodId));
      await tx.update(periodBalances).set({ closingBalance: null }).where(eq(periodBalances.periodId, periodId));
    });
  });
}

// ---------- Billers (docs/features/billers.md) ----------
// Not tied to a month: the same cards show on every month's Billers tab. Passwords are
// encrypted before anything reaches the database, so they never appear in a query or its errors.

const billerName = z.string().trim().min(1, "Enter a biller name").max(60, "Keep the name under 60 characters");
const billerFieldLabel = z.string().trim().min(1, "Enter a label").max(60, "Keep the label under 60 characters");
const MAX_FIELD_VALUE = 500;
const MAX_SECRET = 200;
const billerFieldValue = z.string().trim().max(MAX_FIELD_VALUE, `Keep it under ${MAX_FIELD_VALUE} characters`);
// Not trimmed: a space can be part of a password.
const billerSecret = z.string().max(MAX_SECRET, `Keep the password under ${MAX_SECRET} characters`);
const moveDirection = z.enum(["up", "down"]);

export async function addBiller(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("admin", z.object({ name: billerName }), formData, async ({ name }) => {
    const [{ top }] = await db.select({ top: max(billers.sortOrder) }).from(billers);
    await uniqueBillerName(() => db.insert(billers).values({ name, sortOrder: (top ?? 0) + 1 }));
  });
}

export async function renameBiller(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ billerId: id, name: billerName });
  return run("admin", schema, formData, async ({ billerId, name }) => {
    const rows = await uniqueBillerName(() =>
      db.update(billers).set({ name }).where(eq(billers.id, billerId)).returning({ id: billers.id }),
    );
    if (rows.length === 0) throw new ActionError("That biller was deleted.");
  });
}

export async function deleteBiller(billerId: number): Promise<ActionState> {
  return run("admin", z.object({ billerId: id }), { billerId }, async ({ billerId }) => {
    // Its lines go with it (ON DELETE CASCADE).
    await db.delete(billers).where(eq(billers.id, billerId));
  });
}

export async function moveBiller(billerId: number, direction: "up" | "down"): Promise<ActionState> {
  const schema = z.object({ billerId: id, direction: moveDirection });
  return run("admin", schema, { billerId, direction }, async ({ billerId, direction }) => {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: billers.id })
        .from(billers)
        .orderBy(asc(billers.sortOrder), asc(billers.id))
        .for("update");
      for (const [i, rowId] of swapped(rows, billerId, direction).entries()) {
        await tx.update(billers).set({ sortOrder: i }).where(eq(billers.id, rowId));
      }
    });
  });
}

export async function addBillerField(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({
    billerId: id,
    kind: z.enum(["text", "link", "secret", "heading"], { message: "Choose what kind of line it is" }),
    label: billerFieldLabel,
    // Trimmed and checked below, by kind: a password keeps its spaces.
    value: z.string().max(MAX_FIELD_VALUE, `Keep it under ${MAX_FIELD_VALUE} characters`).optional().default(""),
    // A checkbox: sent as "on" when ticked, left out when not.
    housematesCanSee: z
      .string()
      .optional()
      .transform((v) => v === "on"),
  });
  return run("admin", schema, formData, async ({ billerId, kind, label, value, housematesCanSee }) => {
    const values =
      kind === "secret"
        ? { value: null, secretValue: sealedSecret(value) }
        : { value: plainFieldValue(kind, value), secretValue: null };
    await db.transaction(async (tx) => {
      const [biller] = await tx.select({ id: billers.id }).from(billers).where(eq(billers.id, billerId)).for("update");
      if (!biller) throw new ActionError("That biller was deleted.");
      const [{ top }] = await tx
        .select({ top: max(billerFields.sortOrder) })
        .from(billerFields)
        .where(eq(billerFields.billerId, billerId));
      await tx.insert(billerFields).values({ billerId, kind, label, housematesCanSee, sortOrder: (top ?? 0) + 1, ...values });
    });
  });
}

export async function updateBillerFieldLabel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ fieldId: id, label: billerFieldLabel });
  return run("admin", schema, formData, async ({ fieldId, label }) => {
    const rows = await db
      .update(billerFields)
      .set({ label })
      .where(eq(billerFields.id, fieldId))
      .returning({ id: billerFields.id });
    if (rows.length === 0) throw new ActionError("That line was deleted.");
  });
}

/** Text and links. A password goes through setBillerSecret; a heading has no value. */
export async function updateBillerFieldValue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ fieldId: id, value: billerFieldValue });
  return run("admin", schema, formData, async ({ fieldId, value }) => {
    const field = await loadBillerField(fieldId);
    if (field.kind === "secret") throw new ActionError("Use Change password for a password.");
    if (field.kind === "heading") throw new ActionError("A heading has only its label.");
    await db.update(billerFields).set({ value: plainFieldValue(field.kind, value) }).where(eq(billerFields.id, fieldId));
  });
}

/** Saves a new password (an empty one clears it). Never shown back: the form always starts empty. */
export async function setBillerSecret(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ fieldId: id, secret: billerSecret });
  return run("admin", schema, formData, async ({ fieldId, secret }) => {
    const field = await loadBillerField(fieldId);
    if (field.kind !== "secret") throw new ActionError("That line isn't a password.");
    await db.update(billerFields).set({ secretValue: sealedSecret(secret) }).where(eq(billerFields.id, fieldId));
  });
}

export async function setBillerFieldVisibility(fieldId: number, housematesCanSee: boolean): Promise<ActionState> {
  const schema = z.object({ fieldId: id, housematesCanSee: z.boolean() });
  return run("admin", schema, { fieldId, housematesCanSee }, async ({ fieldId, housematesCanSee }) => {
    await loadBillerField(fieldId);
    await db.update(billerFields).set({ housematesCanSee }).where(eq(billerFields.id, fieldId));
  });
}

export async function moveBillerField(fieldId: number, direction: "up" | "down"): Promise<ActionState> {
  const schema = z.object({ fieldId: id, direction: moveDirection });
  return run("admin", schema, { fieldId, direction }, async ({ fieldId, direction }) => {
    await db.transaction(async (tx) => {
      const { billerId } = await loadBillerField(fieldId, tx);
      const rows = await tx
        .select({ id: billerFields.id })
        .from(billerFields)
        .where(eq(billerFields.billerId, billerId))
        .orderBy(asc(billerFields.sortOrder), asc(billerFields.id))
        .for("update");
      for (const [i, rowId] of swapped(rows, fieldId, direction).entries()) {
        await tx.update(billerFields).set({ sortOrder: i }).where(eq(billerFields.id, rowId));
      }
    });
  });
}

export async function deleteBillerField(fieldId: number): Promise<ActionState> {
  return run("admin", z.object({ fieldId: id }), { fieldId }, async ({ fieldId }) => {
    await db.delete(billerFields).where(eq(billerFields.id, fieldId));
  });
}

// ---------- Cash drawer (docs/features/cash-drawer.md) ----------
// The admin's own cash: not tied to a month and never part of the split. Its own entries live
// here; Helper entries and advances paid from it are flagged on themselves (drawerFlagFor).
// Every change checks nobody has paid back more than they borrowed.

const drawerEntryFields = z.object({
  kind: z.enum(["cash_in", "spent", "lent", "paid_back"], { message: "Choose what kind of entry it is" }),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  amount: moneyField(false),
  person: z.string().max(60, "Keep the name under 60 characters").default(""),
  // Paid back only (the form sends it only then): to PA's bank / e-wallet, or into the drawer.
  paidTo: z
    .enum(["account", "drawer"], { message: "Choose where it was paid" })
    .default("drawer")
    .transform((v) => v === "account"),
  note: z
    .string()
    .trim()
    .max(120, "Keep the note under 120 characters")
    .default("")
    .transform((v) => v || null),
});

export async function addDrawerEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("admin", drawerEntryFields, formData, async ({ paidTo, ...input }) => {
    const values = drawerEntryValues({ ...input, toAccount: paidTo });
    await db.transaction((tx) => addDrawerEntryIn(tx, values));
  });
}

export async function updateDrawerEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run("admin", drawerEntryFields.extend({ entryId: id }), formData, async ({ entryId, paidTo, ...input }) => {
    const values = drawerEntryValues({ ...input, toAccount: paidTo });
    await db.transaction((tx) => updateDrawerEntryIn(tx, entryId, values));
  });
}

export async function deleteDrawerEntry(entryId: number): Promise<ActionState> {
  return run("admin", z.object({ entryId: id }), { entryId }, async ({ entryId }) => {
    await db.transaction((tx) => deleteDrawerEntryIn(tx, entryId));
  });
}

// ---------- Helpers ----------

async function loadBillerField(fieldId: number, executor: Tx | typeof db = db) {
  const [field] = await executor
    .select({ kind: billerFields.kind, billerId: billerFields.billerId })
    .from(billerFields)
    .where(eq(billerFields.id, fieldId));
  if (!field) throw new ActionError("That line was deleted.");
  return field;
}

/** A biller name that's taken gets its own message (run()'s is about month columns). */
async function uniqueBillerName<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ActionError("There's already a biller with that name.");
    throw error;
  }
}

/** A text or link line's value as stored: null when empty; a link must be http(s) (no javascript: links). */
function plainFieldValue(kind: "text" | "link" | "heading", raw: string): string | null {
  const value = raw.trim();
  if (kind === "heading" || value === "") return null;
  if (value.length > MAX_FIELD_VALUE) throw new ActionError(`Keep it under ${MAX_FIELD_VALUE} characters.`);
  if (kind === "link") {
    let url: URL | null = null;
    try {
      url = new URL(value);
    } catch {}
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      throw new ActionError("Enter a full link starting with https:// (or http://).");
    }
  }
  return value;
}

/** Checked by hand, not with zod's parse: a zod error carries the input, and run() logs errors. */
function sealedSecret(secret: string): string | null {
  if (secret.length > MAX_SECRET) throw new ActionError(`Keep the password under ${MAX_SECRET} characters.`);
  if (secret === "") return null;
  try {
    return encryptSecret(secret);
  } catch (error) {
    // The key is missing or malformed: say so, rather than "Something went wrong".
    throw new ActionError(error instanceof Error ? error.message : "Passwords aren't set up.");
  }
}

/** The ids in their new order, with `id` swapped with its neighbour (unchanged at either end). */
function swapped(rows: { id: number }[], id: number, direction: "up" | "down"): number[] {
  const ids = rows.map((r) => r.id);
  const from = ids.indexOf(id);
  if (from === -1) throw new ActionError("That was deleted.");
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return ids;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

/**
 * Locks a month's row until the transaction ends (closing, reopening, starting and "I paid" take
 * turns, and wait for any change still being saved in it: loadOpenPeriod).
 */
async function lockPeriod(tx: Tx, periodId: number) {
  await tx.select({ id: billingPeriods.id }).from(billingPeriods).where(eq(billingPeriods.id, periodId)).for("update");
}

/**
 * The month, if it's open. Pass the viewer from a housemate's action (their advances and Helper
 * entries): once the month's last day has passed, only the admin can change it
 * (docs/settlement-rules.md → "Closing and reopening"). "I paid" doesn't pass it — settling up
 * happens after the month ends.
 * Takes a shared lock on the month first, held until the change is saved: changes still save side
 * by side, but closing the month (lockPeriodAndNeighbours) waits for them, and they for it, so nothing
 * lands in a month after its Finals were saved. A change may also wait a moment while the admin's
 * page checks whether the next month can start (startBlockReason).
 */
async function loadOpenPeriod(tx: Tx, periodId: number, housemate?: Viewer) {
  await tx.select({ id: billingPeriods.id }).from(billingPeriods).where(eq(billingPeriods.id, periodId)).for("share");
  const period = await tx.query.billingPeriods.findFirst({
    where: eq(billingPeriods.id, periodId),
    with: { balances: { with: { member: true } } },
  });
  if (!period) throw new ActionError("That month no longer exists.");
  if (period.status !== "open") throw new ActionError("This month is closed, so it can't be changed.");
  if (housemate && !isAdmin(housemate) && monthHasEnded(period.year, period.month, todayInManila())) {
    const next = monthAfter(period.year, period.month);
    throw new ActionError(
      `${monthLabel(period.year, period.month)} has ended, so only the admin can change it now. Log anything new in ${monthLabel(next.year, next.month)}.`,
    );
  }
  // Leftover centavos go to the collector first (see splitOrder).
  return { period, order: splitOrder(period.balances.map((b) => b.member)) };
}

async function loadBill(tx: Tx, billId: number) {
  const bill = await tx.query.billItems.findFirst({ where: eq(billItems.id, billId), with: { shares: true } });
  if (!bill) throw new ActionError("That bill no longer exists.");
  const { period, order } = await loadOpenPeriod(tx, bill.periodId);
  return { bill, period, order };
}

/**
 * For a bill's Date paid only, which a closed month allows: it's a note of when the biller was
 * paid, not part of the numbers closing locks. The month is locked like loadOpenPeriod does, so
 * a delete waits.
 */
async function loadBillForDatePaid(tx: Tx, billId: number) {
  const bill = await tx.query.billItems.findFirst({ where: eq(billItems.id, billId) });
  if (!bill) throw new ActionError("That bill no longer exists.");
  await tx.select({ id: billingPeriods.id }).from(billingPeriods).where(eq(billingPeriods.id, bill.periodId)).for("share");
}

async function loadColumn(tx: Tx, columnId: number) {
  const column = await tx.query.sharedColumns.findFirst({
    where: eq(sharedColumns.id, columnId),
    with: { members: true, advances: true },
  });
  if (!column) throw new ActionError("That column no longer exists.");
  const { period, order } = await loadOpenPeriod(tx, column.periodId);
  return { column, period, order };
}

/**
 * Sets fields for several members of a column in one statement (insert, or update if the row
 * exists). Every row must carry the same fields; only those fields are updated.
 */
async function upsertColumnMembers(
  tx: Tx,
  columnId: number,
  rows: { memberId: MemberId; included?: boolean; amount?: string | null }[],
) {
  if (rows.length === 0) return;
  const set: { included?: SQL; amount?: SQL } = {};
  if ("included" in rows[0]) set.included = sql.raw(`excluded.${sharedColumnMembers.included.name}`);
  if ("amount" in rows[0]) set.amount = sql.raw(`excluded.${sharedColumnMembers.amount.name}`);
  await tx
    .insert(sharedColumnMembers)
    .values(rows.map((row) => ({ columnId, ...row })))
    .onConflictDoUpdate({ target: [sharedColumnMembers.columnId, sharedColumnMembers.memberId], set });
}

/** The column an advance goes into: one from this month, or 0 = the default column (created if missing). */
async function resolveColumn(tx: Tx, periodId: number, columnId: number, order: MemberId[]): Promise<number> {
  if (!columnId) return ensureDefaultColumn(tx, periodId, order);
  const column = await tx.query.sharedColumns.findFirst({ where: eq(sharedColumns.id, columnId) });
  if (!column || column.periodId !== periodId) throw new ActionError("Choose a column from this month.");
  return columnId;
}

async function periodOrder(tx: Tx, periodId: number): Promise<MemberId[]> {
  const balances = await tx.query.periodBalances.findMany({
    where: eq(periodBalances.periodId, periodId),
    with: { member: true },
  });
  return splitOrder(balances.map((b) => b.member));
}

/**
 * The open months, for adding or removing someone in each. Each gets a shared lock, like
 * loadOpenPeriod, so closing waits for the change (and a month closed meanwhile is left out);
 * oldest first, the same order closing locks in. Call it before locking the member's row:
 * starting a month and "I paid" lock a month and then refer to members, so the other order
 * could leave each waiting for the other.
 */
async function openPeriods(tx: Tx) {
  const locked = await tx
    .select({ id: billingPeriods.id })
    .from(billingPeriods)
    .where(eq(billingPeriods.status, "open"))
    .orderBy(asc(billingPeriods.year), asc(billingPeriods.month))
    .for("share");
  if (locked.length === 0) return [];
  // Only the months locked above: one started in between isn't held, so it's left out.
  return tx.query.billingPeriods.findMany({
    where: inArray(
      billingPeriods.id,
      locked.map((p) => p.id),
    ),
    orderBy: [asc(billingPeriods.year), asc(billingPeriods.month)],
  });
}

/** Re-splits every bill in a month after its members change. */
async function resplitPeriodBills(tx: Tx, periodId: number) {
  const order = await periodOrder(tx, periodId);
  const bills = await tx.query.billItems.findMany({ where: eq(billItems.periodId, periodId), with: { shares: true } });
  for (const bill of bills) {
    if (bill.splitMode === "manual") {
      // Keep everyone's amounts; newcomers start at ₱0 and the total stays the sum.
      const manual = new Map(bill.shares.map((s) => [s.memberId, toCentavos(s.amount)]));
      const shares = computeBillShares("manual", 0, order, { manual });
      await tx
        .update(billItems)
        .set({ totalAmount: fromCentavos(sumCentavos(shares.values())) })
        .where(eq(billItems.id, bill.id));
      await writeShares(tx, bill.id, shares, null);
      continue;
    }
    const points = pointsFor(bill.shares, order);
    const shares = computeBillShares(bill.splitMode, toCentavos(bill.totalAmount), order, { points });
    await writeShares(tx, bill.id, shares, bill.splitMode === "points" ? points : null);
  }
}

/** Whether a member has anything recorded in a month (then they can't leave it). */
async function hasRecordsIn(tx: Tx, periodId: number, memberId: number): Promise<boolean> {
  const [advance] = await tx
    .select({ id: advances.id })
    .from(advances)
    .where(and(eq(advances.periodId, periodId), eq(advances.payerId, memberId)))
    .limit(1);
  const [payment] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(eq(payments.periodId, periodId), or(eq(payments.fromMemberId, memberId), eq(payments.toMemberId, memberId))),
    )
    .limit(1);
  // ₱0 bills don't count: they're copied month to month before anyone has paid. Nor does a Helper
  // column with visits logged: whoever paid her counts (helperEntry below), not its payer.
  const [paidBill] = await tx
    .select({ id: billItems.id })
    .from(billItems)
    .where(
      and(
        eq(billItems.periodId, periodId),
        eq(billItems.paidById, memberId),
        gt(billItems.totalAmount, "0"),
        not(helperBillDrivenByEntries),
      ),
    )
    .limit(1);
  // Removing a typed share from a Manual bill would change that bill's total.
  const [manualBillShare] = await tx
    .select({ id: billItemShares.billItemId })
    .from(billItemShares)
    .innerJoin(billItems, eq(billItems.id, billItemShares.billItemId))
    .where(
      and(
        eq(billItems.periodId, periodId),
        eq(billItems.splitMode, "manual"),
        eq(billItemShares.memberId, memberId),
        gt(billItemShares.amount, "0"),
      ),
    )
    .limit(1);
  const [manualAmount] = await tx
    .select({ id: sharedColumnMembers.columnId })
    .from(sharedColumnMembers)
    .innerJoin(sharedColumns, eq(sharedColumns.id, sharedColumnMembers.columnId))
    .where(
      and(
        eq(sharedColumns.periodId, periodId),
        eq(sharedColumns.splitMode, "manual"),
        eq(sharedColumnMembers.memberId, memberId),
        gt(sharedColumnMembers.amount, "0"),
      ),
    )
    .limit(1);
  // A visit or early pay they handed the Helper counts as a bill they paid.
  const [helperEntry] = await tx
    .select({ id: helperEntries.id })
    .from(helperEntries)
    .where(and(eq(helperEntries.periodId, periodId), eq(helperEntries.payerId, memberId)))
    .limit(1);
  return Boolean(advance || payment || paidBill || manualBillShare || manualAmount || helperEntry);
}

/**
 * Checks who's calling, validates input, runs the change, refreshes the pages, and turns
 * errors into messages. `access` is required: "admin" for PA-only changes, "member" for the
 * few any housemate may make (the action then checks ownership itself). A view-only login
 * passes neither.
 */
async function run<S extends z.ZodType>(
  access: "admin" | "member",
  schema: S,
  input: FormData | Record<string, unknown>,
  fn: (data: z.output<S>, viewer: Viewer) => Promise<string | void>,
): Promise<ActionState> {
  // First, and outside the try/catch below, so redirect() isn't swallowed. Strangers get no
  // validation messages either.
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (access === "admin" && !isAdmin(viewer)) return { ok: false, error: "Only the admin can change this." };
  if (isViewOnly(viewer)) return { ok: false, error: "Your login is view-only, so it can't change anything." };
  // "Preview as a housemate" only changes what's shown; saving anything would act as the admin.
  // The preview may have started in another tab, which this one doesn't show yet.
  const preview = await previewFor(viewer);
  if (preview) {
    return {
      ok: false,
      error: `Preview as ${preview.name} is on (maybe in another tab). Exit preview, or reload this page, to make changes.`,
    };
  }

  const parsed = schema.safeParse(input instanceof FormData ? Object.fromEntries(input) : input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  let redirectTo: string | undefined;
  try {
    redirectTo = (await fn(parsed.data, viewer)) || undefined;
  } catch (error) {
    if (error instanceof ActionError || error instanceof SettlementError) {
      return { ok: false, error: error.message };
    }
    if (isUniqueViolation(error)) return { ok: false, error: "That name is already used this month." };
    console.error(error);
    return { ok: false, error: "Something went wrong saving that. Please try again." };
  }

  revalidatePath("/", "layout");
  return { ok: true, redirectTo };
}
