// Database schema for the household settlement tracker.
// Business rules behind these tables live in docs/settlement-rules.md — read that first.
//
// Money columns are numeric(12,2). Drizzle returns them as strings; convert with
// lib/money.ts (toCentavos) before doing any arithmetic. Never use floats for money.

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- Enums ----------

export const advanceCategory = pgEnum("advance_category", ["grocery", "food", "service", "misc"]);
// "closed" = month locked; any unpaid balance carries over to the next month.
export const periodStatus = pgEnum("period_status", ["open", "closed"]);
export const billSource = pgEnum("bill_source", ["manual", "email"]);
// Email-parsed bills land as "pending" and are ignored by settlement until confirmed.
export const billStatus = pgEnum("bill_status", ["confirmed", "pending"]);
export const billProvider = pgEnum("bill_provider", ["meralco", "water", "pldt"]);
// imported = filled a bill column (as pending) · unmatched = needs a look (reason says why) ·
// dismissed = ignored for good.
export const billEmailStatus = pgEnum("bill_email_status", ["imported", "unmatched", "dismissed"]);
// equal = split evenly; points = split by each member's points (Meralco);
// manual = amounts typed per member, and the bill total is their sum.
export const billSplitMode = pgEnum("bill_split_mode", ["equal", "points", "manual"]);
// helper = the Helper column: once its month has visits or early pay (helper_entries), its total
// and who paid it come from them (docs/features/helper.md). standard = every other bill.
export const billKind = pgEnum("bill_kind", ["standard", "helper"]);
// visit = a day's work (her daily pay, part of it maybe taken off her debt) · early_pay = money
// given before she works, which becomes her debt · opening = her debt carried over from the
// Google Sheet (already settled there, so it's in no bill).
export const helperEntryKind = pgEnum("helper_entry_kind", ["visit", "early_pay", "opening"]);
// admin = PA: can change everything. member = sees everything (except Manage) and logs their
// own advances in the default column (lib/permissions.ts). view_only = a login only: sees what a
// member sees, changes nothing, and is never in a month (no period_balances row), so shares in
// no cost.
export const memberRole = pgEnum("member_role", ["admin", "member", "view_only"]);
// confirmed = counts (PA recorded it, or confirmed a housemate's) · pending = a housemate's
// "I paid", waiting for PA · rejected = PA said no, with a reason. Only confirmed ones count.
export const paymentStatus = pgEnum("payment_status", ["confirmed", "pending", "rejected"]);
// A line on the Billers tab: text · link (http/https) · secret (a password, stored encrypted) ·
// heading (a sub-title such as "FAQs", label only).
export const billerFieldKind = pgEnum("biller_field_kind", ["text", "link", "secret", "heading"]);
// An email My House sent (docs/features/reminders.md): week / three_days / last_day = the
// month-end reminders to housemates · start_next = the admin's "couldn't start next month" ·
// payables = "Email everyone their bill" from Settle Up · ready_bill / ready_close = the admin's
// "ready to email the bill" / "ready to close" nudges · bills_in = a view-only login's "the bills
// are in" note, sent once with the first bill email · unpaid = the follow-up to a housemate whose
// emailed bill is still unpaid (its one row's sent_at moves forward with each follow-up) ·
// bill_due = the admin's "bills to pay" about a month's bills nearing their due date (same: one
// row per month, moving forward).
export const reminderKind = pgEnum("reminder_kind", [
  "week",
  "three_days",
  "last_day",
  "start_next",
  "payables",
  "ready_bill",
  "ready_close",
  "bills_in",
  "unpaid",
  "bill_due",
]);
// Where a member used My House from (lib/devices.ts — DEVICE_VIAS / DEVICE_PLATFORMS, kept equal
// by lib/devices.test.ts): app = the installed app, web = a browser tab; the device type is coarse.
export const deviceVia = pgEnum("device_via", ["app", "web"]);
export const devicePlatform = pgEnum("device_platform", ["iphone", "ipad", "android", "mac", "windows", "other"]);
// A line in the admin's cash drawer (docs/features/cash-drawer.md): cash_in = money put in (from
// the bank, or the starting cash) · spent = paid out for something not logged elsewhere in My
// House · lent = borrowed by someone · paid_back = what they returned.
export const cashDrawerKind = pgEnum("cash_drawer_kind", ["cash_in", "spent", "lent", "paid_back"]);

// ---------- Shared column helpers ----------

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------- Tables ----------

export const members = pgTable(
  "members",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull().unique(),
    sortOrder: integer("sort_order").notNull().default(0),
    // The member who pays the core bills upfront and collects from everyone (PA).
    isCollector: boolean("is_collector").notNull().default(false),
    // Members are deactivated, never deleted, so history stays intact.
    active: boolean("active").notNull().default(true),
    // Login (docs/features/auth.md). `email` is the invited address (lowercase); inviting
    // creates a Supabase Auth user and stores its id in `auth_user_id`, which every request
    // matches on. Both are null for someone who isn't invited. Never send these to the client.
    email: text("email").unique(),
    authUserId: uuid("auth_user_id").unique(),
    role: memberRole("role").notNull().default("member"),
    // Their emoji, shown in place of the colour dot (docs/features/manage.md → Emoji), or null
    // for the dot. One emoji, checked by parseEmoji (lib/members.ts); the check below is a backstop.
    emoji: text("emoji"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("members_single_collector").on(t.isCollector).where(sql`${t.isCollector}`),
    check("members_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check("members_emoji_length", sql`char_length(${t.emoji}) <= 32`),
  ],
).enableRLS();

export const billingPeriods = pgTable(
  "billing_periods",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: periodStatus("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("billing_periods_year_month").on(t.year, t.month),
    check("billing_periods_month_range", sql`${t.month} between 1 and 12`),
  ],
).enableRLS();

export const billItems = pgTable(
  "bill_items",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    periodId: integer("period_id")
      .notNull()
      .references(() => billingPeriods.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    totalAmount: money("total_amount").notNull(),
    // Who paid the provider. App code defaults this to the collector.
    paidById: integer("paid_by_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    splitMode: billSplitMode("split_mode").notNull().default("equal"),
    kind: billKind("kind").notNull().default("standard"),
    dueDate: date("due_date", { mode: "string" }),
    paidOn: date("paid_on", { mode: "string" }),
    source: billSource("source").notNull().default("manual"),
    status: billStatus("status").notNull().default("confirmed"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("bill_items_period_name").on(t.periodId, t.name),
    // At most one Helper column per month.
    uniqueIndex("bill_items_one_helper").on(t.periodId).where(sql`${t.kind} = 'helper'`),
    // ₱0 is allowed: a new month's copied bill columns start empty until the bill arrives.
    check("bill_items_total_nonneg", sql`${t.totalAmount} >= 0`),
  ],
).enableRLS();

export const billItemShares = pgTable(
  "bill_item_shares",
  {
    billItemId: integer("bill_item_id")
      .notNull()
      .references(() => billItems.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    // Points-mode bills only: this member's points (e.g. Meralco 2.5).
    points: numeric("points", { precision: 5, scale: 2 }),
    // Legacy per-member override flag; no longer used by the UI (use split_mode "manual").
    isOverride: boolean("is_override").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.billItemId, t.memberId] }),
    check("bill_item_shares_amount_nonneg", sql`${t.amount} >= 0`),
  ],
).enableRLS();

// A shared-advances column in the month's matrix, e.g. "Advances Shared" (everyone),
// "Advances Shared w/o PA" or "Ice Maker Adj.". Every advance is logged into one column;
// the column's total is the sum of its advances.
//   equal  → split equally among the members marked `included`
//   manual → each member's typed `amount` (may not add up exactly; the UI flags it)
export const sharedColumns = pgTable(
  "shared_columns",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    periodId: integer("period_id")
      .notNull()
      .references(() => billingPeriods.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Only "equal" and "manual" are used for shared columns.
    splitMode: billSplitMode("split_mode").notNull().default("equal"),
    // The month's everyday "Advances Shared" column (carried into new months).
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("shared_columns_period_name").on(t.periodId, t.name),
    uniqueIndex("shared_columns_one_default").on(t.periodId).where(sql`${t.isDefault}`),
  ],
).enableRLS();

export const sharedColumnMembers = pgTable(
  "shared_column_members",
  {
    columnId: integer("column_id")
      .notNull()
      .references(() => sharedColumns.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    // Equal mode: whether this member shares the column.
    included: boolean("included").notNull().default(true),
    // Manual mode: the amount typed for this member.
    amount: money("amount"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.columnId, t.memberId] }),
    check("shared_column_members_amount_nonneg", sql`${t.amount} >= 0`),
  ],
).enableRLS();

export const advances = pgTable(
  "advances",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    periodId: integer("period_id")
      .notNull()
      .references(() => billingPeriods.id, { onDelete: "restrict" }),
    // The shared column this advance is split through.
    columnId: integer("column_id")
      .notNull()
      .references(() => sharedColumns.id, { onDelete: "restrict" }),
    payerId: integer("payer_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    category: advanceCategory("category").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    // Optional: some sheet entries were logged without a date.
    spentOn: date("spent_on", { mode: "string" }),
    // The admin paid it from the cash drawer (docs/features/cash-drawer.md). Only a record: the
    // split is the same either way.
    fromDrawer: boolean("from_drawer").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("advances_amount_positive", sql`${t.amount} > 0`),
    // The drawer orders its lines by date.
    check("advances_drawer_dated", sql`NOT ${t.fromDrawer} OR ${t.spentOn} IS NOT NULL`),
  ],
).enableRLS();

// The Helper's visits and early pay (docs/features/helper.md), replacing the sheet's two
// tables. Each row is money someone handed her, except `opening`. The month's Helper bill is
// what was handed over (visit amount − deduction, plus early pay), credited to each payer; her
// debt is early pay + opening − every deduction, across all months (lib/helper.ts).
export const helperEntries = pgTable(
  "helper_entries",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    // The month it counts in, which may not be the visit's date (a visit paid late).
    periodId: integer("period_id")
      .notNull()
      .references(() => billingPeriods.id, { onDelete: "restrict" }),
    kind: helperEntryKind("kind").notNull(),
    // Who handed her the money; null only for `opening`.
    payerId: integer("payer_id").references(() => members.id, { onDelete: "restrict" }),
    // Optional: some visits have no date.
    onDate: date("on_date", { mode: "string" }),
    // Her daily pay (visit), the early pay, or the carried-over debt (opening).
    amount: money("amount").notNull(),
    // Visits only: the part of her daily pay taken off her debt instead of handed over.
    deduction: money("deduction").notNull().default("0"),
    note: text("note"),
    // The admin handed it over from the cash drawer (docs/features/cash-drawer.md). Only a record.
    fromDrawer: boolean("from_drawer").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("helper_entries_amount_positive", sql`${t.amount} > 0`),
    check("helper_entries_opening_not_drawer", sql`${t.kind} <> 'opening' OR NOT ${t.fromDrawer}`),
    // The drawer orders its lines by date.
    check("helper_entries_drawer_dated", sql`NOT ${t.fromDrawer} OR ${t.onDate} IS NOT NULL`),
    check("helper_entries_deduction_range", sql`${t.deduction} >= 0 AND ${t.deduction} <= ${t.amount}`),
    check("helper_entries_deduction_visit_only", sql`${t.kind} = 'visit' OR ${t.deduction} = 0`),
    check("helper_entries_payer", sql`(${t.kind} = 'opening') = (${t.payerId} IS NULL)`),
    index("helper_entries_period_id").on(t.periodId),
  ],
).enableRLS();

// Real money changing hands to settle up (usually member → collector).
export const payments = pgTable(
  "payments",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    periodId: integer("period_id")
      .notNull()
      .references(() => billingPeriods.id, { onDelete: "restrict" }),
    // NULL = the House Budget, the collection account (HOUSE_BUDGET in lib/settlement.ts).
    fromMemberId: integer("from_member_id").references(() => members.id, { onDelete: "restrict" }),
    toMemberId: integer("to_member_id").references(() => members.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    note: text("note"),
    // A housemate's "I paid" starts pending; PA's own records are confirmed (docs/settlement-rules.md).
    status: paymentStatus("status").notNull().default("confirmed"),
    // Why PA rejected it, shown to the housemate.
    rejectedReason: text("rejected_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("payments_amount_positive", sql`${t.amount} > 0`),
    check("payments_distinct_members", sql`${t.fromMemberId} <> ${t.toMemberId}`),
    // At most one side is the House Budget.
    check("payments_has_member", sql`${t.fromMemberId} IS NOT NULL OR ${t.toMemberId} IS NOT NULL`),
    // A rejected payment always has its reason, and nothing else has one.
    check("payments_rejected_reason", sql`(${t.status} = 'rejected') = (${t.rejectedReason} IS NOT NULL)`),
  ],
).enableRLS();

// Every bill email received (docs/settlement-rules.md → "Email-imported bills"): the Bill
// inbox. Only a short snippet of the body is kept — the full email holds account numbers.
export const billEmails = pgTable(
  "bill_emails",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    // The Message-ID header: the same email arriving twice (webhook retries) is ignored.
    messageId: text("message_id").notNull().unique(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull(),
    snippet: text("snippet").notNull(),
    // Parsed values; null when the email couldn't be read.
    provider: billProvider("provider"),
    amount: money("amount"),
    // The payment fee added on import (BILL_PAYMENT_FEES at the time) and what it's for.
    fee: money("fee"),
    feeNote: text("fee_note"),
    dueDate: date("due_date", { mode: "string" }),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    // The month the bill belongs to.
    billYear: integer("bill_year"),
    billMonth: integer("bill_month"),
    status: billEmailStatus("status").notNull(),
    // Why it's unmatched, in words for the household.
    reason: text("reason"),
    // The bill column it filled (imported only).
    billItemId: integer("bill_item_id").references(() => billItems.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live email per provider per month: a reminder or re-forward of the same bill is
    // ignored, but after a Discard (dismissed) a corrected email can come in.
    uniqueIndex("bill_emails_one_per_month")
      .on(t.provider, t.billYear, t.billMonth)
      .where(sql`${t.status} <> 'dismissed'`),
  ],
).enableRLS();

// One row per member per period = that period's membership (equal splits use this list).
// opening_balance carries over from the previous month; closing_balance is snapshotted on close.
export const periodBalances = pgTable(
  "period_balances",
  {
    periodId: integer("period_id")
      .notNull()
      .references(() => billingPeriods.id, { onDelete: "restrict" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    openingBalance: money("opening_balance").notNull().default("0"),
    closingBalance: money("closing_balance"),
  },
  (t) => [primaryKey({ columns: [t.periodId, t.memberId] })],
).enableRLS();

// Proof attached to a bill or a payment (docs/features/receipts.md): a screenshot or photo in
// the private "receipts" Storage bucket. Never changes the math. Deleting the bill or payment
// deletes its rows (the app removes the files after the delete commits).
export const receipts = pgTable(
  "receipts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    // The object's name in the bucket: YYYY/MM/<uuid>.<ext> (lib/receipts.ts).
    storagePath: text("storage_path").notNull().unique(),
    // Checked from the file's first bytes on upload, not taken from the browser.
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    originalName: text("original_name"),
    // Exactly one of these is set (the check below).
    billItemId: integer("bill_item_id").references(() => billItems.id, { onDelete: "cascade" }),
    paymentId: integer("payment_id").references(() => payments.id, { onDelete: "cascade" }),
    uploadedById: integer("uploaded_by_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("receipts_one_owner", sql`num_nonnulls(${t.billItemId}, ${t.paymentId}) = 1`),
    check("receipts_size_positive", sql`${t.sizeBytes} > 0`),
    index("receipts_bill_item_id").on(t.billItemId),
    index("receipts_payment_id").on(t.paymentId),
  ],
).enableRLS();

// Written by the keep-alive job (.github/workflows/keep-alive.yml), never by the app: a real
// write, because a read alone didn't stop the free Supabase project from pausing. One row.
export const keepAlive = pgTable(
  "keep_alive",
  {
    id: integer("id").primaryKey().default(1),
    pingedAt: timestamp("pinged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("keep_alive_single_row", sql`${t.id} = 1`)],
).enableRLS();

// Household-wide settings, one row (docs/features/manage.md). Missing until first set, which
// reads as "nothing set". `house_budget_emoji`: shown in place of the House Budget's icon, or null
// for the icon; one emoji, checked by parseEmoji (lib/members.ts), the check below a backstop.
export const householdSettings = pgTable(
  "household_settings",
  {
    id: integer("id").primaryKey().default(1),
    houseBudgetEmoji: text("house_budget_emoji"),
  },
  (t) => [
    check("household_settings_single_row", sql`${t.id} = 1`),
    check("household_settings_house_budget_emoji_length", sql`char_length(${t.houseBudgetEmoji}) <= 32`),
  ],
).enableRLS();

// Who was emailed what for a month (docs/features/reminders.md). The daily job claims a row
// before sending, so a reminder never goes out twice; a failed send removes its claim, so the
// next day's run retries it. A payables row is rewritten on each resend, and tells the
// housemate's pages their bill is out. Written only by the live site (lib/email.ts), so a test
// on localhost — same database — never marks a real reminder as sent. Only a log: deleting a
// month or a member deletes their rows. `seen_at` (a payables / bills_in row only): when that
// member first opened a month page after it was sent, written by /api/seen for the caller's own
// rows; it counts only while it's after `sent_at` (lib/reminders.ts → seenAfter), so a resend
// shows "not seen yet" again.
export const reminderSends = pgTable(
  "reminder_sends",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    periodId: integer("period_id")
      .notNull()
      .references(() => billingPeriods.id, { onDelete: "cascade" }),
    kind: reminderKind("kind").notNull(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("reminder_sends_period_kind_member").on(t.periodId, t.kind, t.memberId),
    index("reminder_sends_member_id").on(t.memberId),
  ],
).enableRLS();

// When each member last used My House, per installed app / browser and device type
// (docs/features/manage.md → Who's using it). Written by app/api/seen/route.ts, at most every
// 5 minutes per row; read only by the admin's Manage page. One row per member × via × platform,
// so it stays a handful of rows. No user agents or IPs, only the two coarse values.
export const memberDevices = pgTable(
  "member_devices",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    via: deviceVia("via").notNull(),
    platform: devicePlatform("platform").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("member_devices_member_via_platform").on(t.memberId, t.via, t.platform)],
).enableRLS();

// Phones and browsers that turned notifications on (docs/features/notifications.md). One row per
// browser subscription — the push service's address for that device and the keys that encrypt
// what's sent to it. Written by app/api/push/route.ts for the signed-in member only; read only by
// lib/push.ts (and Manage, as a count). `live`: saved on the live site. One database, so a
// subscription made on localhost must never get the live site's pushes.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    platform: devicePlatform("platform").notNull(),
    live: boolean("live").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint").on(t.endpoint), index("push_subscriptions_member_id").on(t.memberId)],
).enableRLS();

// A Download backup that finished streaming (app/backup/route.ts). The month pages remind the
// admin to back up when a month was started or closed since the latest one (lib/backup-reminder.ts).
export const backups = pgTable("backups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  takenById: integer("taken_by_id")
    .notNull()
    .references(() => members.id, { onDelete: "restrict" }),
}).enableRLS();

// A company the household pays (docs/features/billers.md): Meralco, the water company, PLDT…
// Not tied to a month or a bill column — it's the reference card on the Billers tab.
export const billers = pgTable("billers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

// One line on a biller's card: an account number, a link, a password, a sub-title…
// A secret's value is only ever stored encrypted, in `secret_value` (lib/biller-secrets.ts);
// it never goes to the browser with the page — Reveal fetches it (app/biller-secrets/[id]).
export const billerFields = pgTable(
  "biller_fields",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    billerId: integer("biller_id")
      .notNull()
      .references(() => billers.id, { onDelete: "cascade" }),
    kind: billerFieldKind("kind").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    secretValue: text("secret_value"),
    // Off = admin-only (lib/permissions.ts → canSeeBillerField).
    housematesCanSee: boolean("housemates_can_see").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A password never sits in plain `value`; only a secret has an encrypted one.
    check("biller_fields_secret_not_plain", sql`${t.kind} <> 'secret' OR ${t.value} IS NULL`),
    check("biller_fields_only_secret_encrypted", sql`${t.kind} = 'secret' OR ${t.secretValue} IS NULL`),
    index("biller_fields_biller_id").on(t.billerId),
  ],
).enableRLS();

// The admin's cash drawer (docs/features/cash-drawer.md): cash he keeps at home to pay the Helper
// and house costs from, and that someone may borrow from. Not tied to a month, and never part of
// the split — it's his own money. Helper entries and advances paid from it are flagged
// (`from_drawer`) rather than copied here, so the drawer always matches them.
export const cashDrawerEntries = pgTable(
  "cash_drawer_entries",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    kind: cashDrawerKind("kind").notNull(),
    onDate: date("on_date", { mode: "string" }).notNull(),
    amount: money("amount").notNull(),
    // Who borrowed or paid back, as typed (they needn't be a member); lent / paid_back only.
    person: text("person"),
    // Paid back only: it went to PA's bank or e-wallet, not into the drawer, so it clears the
    // loan without adding cash. False on everything else.
    toAccount: boolean("to_account").notNull().default(false),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("cash_drawer_entries_amount_positive", sql`${t.amount} > 0`),
    check("cash_drawer_entries_person", sql`(${t.kind} IN ('lent', 'paid_back')) = (${t.person} IS NOT NULL)`),
    check("cash_drawer_entries_to_account", sql`NOT ${t.toAccount} OR ${t.kind} = 'paid_back'`),
  ],
).enableRLS();

// ---------- Relations (for typed db.query.* joins) ----------

export const membersRelations = relations(members, ({ many }) => ({
  advances: many(advances),
  billShares: many(billItemShares),
  periodBalances: many(periodBalances),
}));

export const billingPeriodsRelations = relations(billingPeriods, ({ many }) => ({
  billItems: many(billItems),
  sharedColumns: many(sharedColumns),
  advances: many(advances),
  payments: many(payments),
  balances: many(periodBalances),
  helperEntries: many(helperEntries),
}));

export const billItemsRelations = relations(billItems, ({ one, many }) => ({
  period: one(billingPeriods, { fields: [billItems.periodId], references: [billingPeriods.id] }),
  paidBy: one(members, { fields: [billItems.paidById], references: [members.id] }),
  shares: many(billItemShares),
  emails: many(billEmails),
  receipts: many(receipts),
}));

export const billItemSharesRelations = relations(billItemShares, ({ one }) => ({
  billItem: one(billItems, { fields: [billItemShares.billItemId], references: [billItems.id] }),
  member: one(members, { fields: [billItemShares.memberId], references: [members.id] }),
}));

export const sharedColumnsRelations = relations(sharedColumns, ({ one, many }) => ({
  period: one(billingPeriods, { fields: [sharedColumns.periodId], references: [billingPeriods.id] }),
  members: many(sharedColumnMembers),
  advances: many(advances),
}));

export const sharedColumnMembersRelations = relations(sharedColumnMembers, ({ one }) => ({
  column: one(sharedColumns, { fields: [sharedColumnMembers.columnId], references: [sharedColumns.id] }),
  member: one(members, { fields: [sharedColumnMembers.memberId], references: [members.id] }),
}));

export const advancesRelations = relations(advances, ({ one }) => ({
  period: one(billingPeriods, { fields: [advances.periodId], references: [billingPeriods.id] }),
  column: one(sharedColumns, { fields: [advances.columnId], references: [sharedColumns.id] }),
  payer: one(members, { fields: [advances.payerId], references: [members.id] }),
}));

export const helperEntriesRelations = relations(helperEntries, ({ one }) => ({
  period: one(billingPeriods, { fields: [helperEntries.periodId], references: [billingPeriods.id] }),
  payer: one(members, { fields: [helperEntries.payerId], references: [members.id] }),
}));

export const billEmailsRelations = relations(billEmails, ({ one }) => ({
  billItem: one(billItems, { fields: [billEmails.billItemId], references: [billItems.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  period: one(billingPeriods, { fields: [payments.periodId], references: [billingPeriods.id] }),
  from: one(members, { fields: [payments.fromMemberId], references: [members.id] }),
  to: one(members, { fields: [payments.toMemberId], references: [members.id] }),
  receipts: many(receipts),
}));

export const receiptsRelations = relations(receipts, ({ one }) => ({
  billItem: one(billItems, { fields: [receipts.billItemId], references: [billItems.id] }),
  payment: one(payments, { fields: [receipts.paymentId], references: [payments.id] }),
  uploadedBy: one(members, { fields: [receipts.uploadedById], references: [members.id] }),
}));

export const periodBalancesRelations = relations(periodBalances, ({ one }) => ({
  period: one(billingPeriods, { fields: [periodBalances.periodId], references: [billingPeriods.id] }),
  member: one(members, { fields: [periodBalances.memberId], references: [members.id] }),
}));

export const billersRelations = relations(billers, ({ many }) => ({
  fields: many(billerFields),
}));

export const billerFieldsRelations = relations(billerFields, ({ one }) => ({
  biller: one(billers, { fields: [billerFields.billerId], references: [billers.id] }),
}));

// ---------- Row types ----------

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type BillingPeriod = typeof billingPeriods.$inferSelect;
export type BillItem = typeof billItems.$inferSelect;
export type NewBillItem = typeof billItems.$inferInsert;
export type BillItemShare = typeof billItemShares.$inferSelect;
export type Advance = typeof advances.$inferSelect;
export type NewAdvance = typeof advances.$inferInsert;
export type SharedColumn = typeof sharedColumns.$inferSelect;
export type SharedColumnMember = typeof sharedColumnMembers.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type HelperEntry = typeof helperEntries.$inferSelect;
export type BillEmailRow = typeof billEmails.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type PeriodBalance = typeof periodBalances.$inferSelect;
export type Biller = typeof billers.$inferSelect;
export type BillerField = typeof billerFields.$inferSelect;
export type ReminderSend = typeof reminderSends.$inferSelect;
export type MemberDevice = typeof memberDevices.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
