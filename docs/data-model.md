# Data model

The database tables at a glance. The definitions (columns, constraints, comments) are in
`db/schema.ts`; the rules behind them in [settlement-rules.md](settlement-rules.md). Money is
`numeric(12,2)` everywhere and comes back from Drizzle as a string — convert with `toCentavos`.

Every table has RLS enabled with no policies, which blocks Supabase's public Data API; the app
connects directly ([decisions.md](decisions.md)).

## Tables

| Table | One row is… | Used by |
|---|---|---|
| `members` | A household member. Deactivated, never deleted; at most one `is_collector`. Login: `email` (the invite, lowercase), `auth_user_id` (their Supabase login — what every request matches on), `role` (`admin` / `member` / `view_only`; a view-only login is never in `period_balances`). `emoji`: their emoji, shown in place of the colour dot, or NULL for the dot (one emoji, at most 32 characters) | [manage](features/manage.md), [login](features/auth.md) |
| `billing_periods` | A month (`year`, `month`), `open` or `closed` | [months](features/months.md) |
| `period_balances` | A member in a month: that month's membership, opening and closing balance | [months](features/months.md), [split table](features/split-table.md) |
| `bill_items` | A bill column in a month: total, payer, split mode, dates, `source` (manual / email), `status` (confirmed / pending), `kind` (`helper` marks the Helper column, at most one per month) | [split table](features/split-table.md), [manage](features/manage.md), [email bills](features/email-bills.md) |
| `bill_item_shares` | A member's share of a bill (and points, for Meralco) — materialized, always sums to the total | [split table](features/split-table.md) |
| `shared_columns` | A shared-advances column in a month (Auto equal or Manual; one default per month) | [advances](features/advances.md), [manage](features/manage.md) |
| `shared_column_members` | Who shares an Auto equal column, or a member's typed amount in a Manual one | [advances](features/advances.md), [manage](features/manage.md) |
| `advances` | A purchase a member paid for the household, in one shared column. `from_drawer`: the admin paid it from his cash drawer (a record only; checked to have a date) | [advances](features/advances.md), [cash drawer](features/cash-drawer.md) |
| `helper_entries` | Something handed to the Helper in a month: a `visit` (daily pay, part maybe taken off her debt), `early_pay`, or her `opening` debt from the sheet (no payer, in no bill). `from_drawer`: the admin handed it over from his cash drawer (a record only; checked to have a date, never on `opening`) | [helper](features/helper.md), [cash drawer](features/cash-drawer.md) |
| `cash_drawer_entries` | A line in the admin's cash drawer, not tied to a month and never part of the split: `kind` (`cash_in` / `spent` / `lent` / `paid_back`), `on_date`, `amount`, `person` (as typed; required exactly on `lent` / `paid_back`), `to_account` (a `paid_back` that went to the admin's bank or e-wallet: it clears the loan but adds no cash; checked to be only on `paid_back`), `note`. Helper entries and advances paid from the drawer aren't copied here (they're flagged `from_drawer`) | [cash drawer](features/cash-drawer.md) |
| `payments` | Money changing hands to settle up; `status` (confirmed / pending = a housemate's "I paid" waiting for PA / rejected, with `rejected_reason`). A NULL `from_member_id` / `to_member_id` is the [House Budget](settlement-rules.md#house-budget); a check keeps a member on at least one side | [settle up](features/settle-up.md) |
| `receipts` | A proof image (screenshot or photo) for exactly one bill or payment: its name in the private `receipts` Storage bucket, type, size, who uploaded it | [receipts](features/receipts.md) |
| `bill_emails` | A bill email received: parsed values, payment fee, status (imported / unmatched / dismissed), the bill it filled | [email bills](features/email-bills.md) |
| `billers` | A company the household pays (electricity, water, internet…): its name and place on the Billers tab. Not tied to a month | [billers](features/billers.md) |
| `biller_fields` | A line on a biller's card: `kind` (`text` / `link` / `secret` / `heading`), label, `value` — or, for a password, `secret_value`, only ever encrypted (checks keep a password out of `value`) — and `housemates_can_see` | [billers](features/billers.md) |
| `keep_alive` | One row: when the keep-alive job last wrote. Not used by the app | [operations](operations.md#supabase-free-plan-the-project-goes-to-sleep) |
| `household_settings` | One row of household-wide settings, made the first time one is set: `house_budget_emoji` (shown in place of the House Budget's icon, or null) | [manage](features/manage.md) |
| `backups` | A Download backup that finished: when, and who took it. Turns off the backup reminder | [months](features/months.md), [operations](operations.md#backups) |
| `member_devices` | When a member last used My House, per `via` (`app` = the installed app / `web` = a browser) and coarse `platform` (`iphone` / `ipad` / `android` / `mac` / `windows` / `other`): `first_seen_at`, `last_seen_at`. Unique per member + via + platform, so a handful of rows; written by `/api/seen` at most every 5 minutes per row; read only by the admin's Manage page. No user agents or IPs. Deleting a member deletes it | [manage](features/manage.md) |
| `push_subscriptions` | A device with notifications on: the push service's `endpoint` (unique) and the `p256dh` / `auth` keys that encrypt what's sent to it, the coarse `platform`, and `live` (saved on the live site — only those get the live site's pushes). Written by `/api/push` for the signed-in member's own device; read by `lib/push.ts` and, as a count, Manage. Deleting a member deletes it | [notifications](features/notifications.md) |
| `reminder_sends` | An email My House sent for a month: `kind` (`week` / `three_days` / `last_day` reminders; to the admin, `start_next` = the next month couldn't start and `ready_bill` / `ready_close` = the nudges; `payables` = the bill email; `bills_in` = a view-only login's "the bills are in" note; `unpaid` = the follow-up while a bill stays unpaid, one row whose `sent_at` moves forward each time; `bill_due` = the admin's bills to pay the billers as their due dates near, one row per month moving forward the same way), to which member, when. Unique per month + kind + member, so a reminder is never sent twice; written only by the live site. `seen_at` (`payables` / `bills_in` only): when that member opened a month page after the send, written by `/api/seen` for the caller's own rows; it counts only while it's after `sent_at`. Deleting the month or member deletes it | [reminders](features/reminders.md) |

## Migrations

In `drizzle/`, applied in order with `npm run db:migrate` ([operations.md](operations.md#changing-the-database-schema)).
Add a line here with every new one.

| Migration | What it did |
|---|---|
| `0000_init` | The first tables: members, months, bills and shares, advances, balances |
| `0001_split-modes-pools-dates` | Bill split modes and Meralco points, date paid, who each advance is shared with |
| `0002_shared-columns` | Shared columns and who shares them (replacing per-advance sharing); every advance belongs to a column |
| `0003_bill-emails` | `bill_emails` (the Bill Inbox) and its enums |
| `0004_bill-email-fees` | Payment fee and note on `bill_emails` |
| `0005_member-logins` | `email`, `auth_user_id` and `role` on `members` (the `member_role` enum); the collector becomes `admin` |
| `0006_keep-alive` | `keep_alive`, the one-row table the keep-alive job writes to |
| `0007_receipts` | `receipts` (proof for bills and payments); drops the never-used `receipt_path` columns on `bill_items` and `advances` |
| `0008_backups` | `backups`, one row per finished Download backup (for the reminder) |
| `0009_payment-status` | `status` (the `payment_status` enum, default `confirmed` so existing payments are unchanged) and `rejected_reason` on `payments`, with a check that only rejected ones have a reason |
| `0010_helper-entries` | `helper_entries` (the `helper_entry_kind` enum) and `kind` on `bill_items` (the `bill_kind` enum, one `helper` per month); existing columns named "Helper" become `helper` |
| `0011_billers` | `billers` and `biller_fields` (the `biller_field_kind` enum) for the Billers tab; adds tables only. Made in parallel with `0010` and renumbered after it; both were applied in this order |
| `0012_house-budget` | `payments.from_member_id` / `to_member_id` become nullable (NULL = the House Budget), with the `payments_has_member` check. Run **after** the code that reads NULL sides is deployed ([decisions.md](decisions.md), 2026-10-12) |
| `0013_view-only-role` | Adds `view_only` to the `member_role` enum ([auth.md](features/auth.md)). Additive; applied before the code that uses it shipped |
| `0014_reminder-sends` | The `reminder_kind` enum and the `reminder_sends` table ([reminders.md](features/reminders.md)). Additive; applied before the code that uses it shipped |
| `0015_ready-nudges` | Adds `ready_bill` and `ready_close` to `reminder_kind`. Additive; applied before the code that uses it shipped |
| `0016_member-devices` | The `device_via` and `device_platform` enums and the `member_devices` table ([manage.md](features/manage.md), who's using it). Additive; applied before the code that uses it shipped |
| `0017_member-photos` | A `member_photos` table and `members.photo_updated_at`, for sticker photos that were tried and dropped before shipping; `0018` removes both |
| `0018_member-emoji` | Drops `member_photos` and `members.photo_updated_at` (never used by shipped code; backed up first), adds `members.emoji` with the `members_emoji_length` check ([manage.md](features/manage.md), emoji) |
| `0019_house-budget-emoji` | The one-row `household_settings` table, with `house_budget_emoji` and its length check ([manage.md](features/manage.md), emoji). Additive; applied before the code that uses it shipped |
| `0020_view-only-bills-in` | Adds `bills_in` to the `reminder_kind` enum: a view-only login's "the bills are in" note ([reminders.md](features/reminders.md)). Additive; applied before the code that uses it shipped |
| `0021_unpaid-reminders` | Adds `unpaid` to the `reminder_kind` enum: the follow-up while an emailed bill stays unpaid ([reminders.md](features/reminders.md)). Additive; applied before the code that uses it shipped |
| `0022_push-subscriptions` | The `push_subscriptions` table ([notifications.md](features/notifications.md)). Additive; applied before the code that uses it shipped |
| `0023_bill-seen` | Adds `reminder_sends.seen_at` ([reminders.md](features/reminders.md), seen), hand-edited to fill it in once for bills already sent, from each member's latest `member_devices.last_seen_at` when that's after the send. Additive; applied before the code that uses it shipped |
| `0024_cash-drawer` | The `cash_drawer_kind` enum and the `cash_drawer_entries` table, plus `from_drawer` (default false) on `helper_entries` and `advances`, with checks that a flagged one has a date and the Helper's starting debt is never flagged ([cash-drawer.md](features/cash-drawer.md)). Additive; applied before the code that uses it shipped |
| `0025_bill-due` | Adds `bill_due` to the `reminder_kind` enum: the admin's bills to pay the billers ([reminders.md](features/reminders.md)). Additive; applied before the code that uses it shipped |
| `0026_drawer-paid-to` | Adds `cash_drawer_entries.to_account` (default false, so existing paybacks stay "into the drawer"), with a check that only a `paid_back` has it ([cash-drawer.md](features/cash-drawer.md)). Additive; applied before the code that uses it shipped |

The receipt files themselves live in Supabase Storage (the private `receipts` bucket), not in
the database; `receipts.storage_path` names one.

The logins themselves live in Supabase's `auth.users` (managed by Supabase, not by these
migrations); `members.auth_user_id` points at one.
