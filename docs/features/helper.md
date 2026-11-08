# Helper

## Status
✅ Working.

## What it does
Replaces the Google Sheet's two Helper tables: her daily pay per visit, and her early pay
("Advanced Pay / Deducted / Remaining").

- **Helper tab:** this month's visits and early pay in one list (date, amount, taken off,
  handed over, who paid her, note, what she owes after each). Above it, two totals: on wider
  screens two cards side by side, each with its full explanation in view; on phones one compact
  card of two rows with a short caption and an ⓘ for the breakdown (so it doesn't repeat the
  header's two chips just above):
  - **She owes:** her debt now, across all months.
  - **This month's Helper bill** ("Helper bill" on phones): what was handed to her this month
    ([the rule](../settlement-rules.md#the-helper)).
- **Log a visit:** date (optional: some have none, and a visit can be logged late, in another
  month), her daily pay, how much was taken off her debt (₱0 if none), and who paid her.
  Daily pay is her full pay, before anything is taken off. As the two amounts are typed, a line
  under them shows the cash she gets ("She gets ₱… in cash (pay − taken off)",
  `visitCashHint` in `lib/helper.ts`), or a warning when more is taken off than her pay, so typing
  the cash handed over as Daily pay stands out before saving.
- **Give early pay:** date, amount, and who gave it.
- **Set starting debt** (PA, once — a link under "She owes" until it's set): the sheet's
  Remaining when the household moved over. It's added to her debt only, not split, because the
  sheet already settled it.
- **Who can log what** ([auth.md](auth.md)): PA logs, edits and deletes anything. Everyone else
  logs the visits and early pay they paid themselves, and can edit or delete only those.
- **The Split Table's Helper column** fills in by itself once the month has an entry. It's
  read-only there and links to this tab. Each person's part shows in their Own Adv (−) and as a
  "Bills" row in the Advances Log.
- A month with no visits or early pay keeps a Helper total typed into the Split Table, paid by
  its one payer, the way it worked before this tab (her starting debt doesn't change that). The
  first visit or early pay replaces that typed total, and the tab warns PA about it.
- The list runs in ledger order: her starting debt first, then by date (no date last), early
  pay before a visit on the same day.
- **Total row** under the list, once the month has a visit or early pay. On wider screens it
  shows Amount (daily pay + early pay), Taken off and Handed over. On phones it's one line,
  "Total handed over". It uses the same numbers as the Helper bill card (`helperMonthSummary`),
  so her starting debt isn't in it. On phones each row's amount is likewise what was handed
  over (like desktop's bold column), with the pay and anything taken off in the line under it,
  so the rows add up to the total. Her starting debt's amount is greyed out.
- **Paid from the cash drawer** (PA only): a checkbox on a visit or early pay he paid himself.
  It puts the entry in his [Cash Drawer](cash-drawer.md) and marks it with a Drawer pill here.
  It changes nothing in the split.

## How it's built
- Route: `app/periods/[year]/[month]/helper/page.tsx`. UI: `components/helper-log.tsx`, plus
  `AddHelperEntryDialog` / `EditHelperEntryDialog` in `components/entry-dialogs.tsx`
  (`useDialogForm`, with a toast once saved).
- Pure math: `lib/helper.ts` (`countsInBill`, `handedOver`, `helperPaidBy`, `helperBillTotal`,
  `helperMonthSummary`, `ledgerCompare`, `owesAfter`, `firstOverdrawn`), tested in
  `lib/helper.test.ts`.
- Settlement: the Helper bill passes `paidBy` (several payers) to `computeMonth`
  (`lib/settlement.ts`). `lib/periods.ts` builds it from the month's entries, but only when
  there are some.
- Actions in `app/periods/[year]/[month]/actions.ts`:
  - `addHelperEntry`, `updateHelperEntry` and `deleteHelperEntry` run as `run("member", …)`.
    For a member the payer is forced to themselves, and `canManageHelperEntry`
    (`lib/permissions.ts`) is checked against the stored entry.
  - Each change takes one advisory lock (her debt spans every month; typing or deleting the
    Helper column takes it too) and refuses one that makes her owe less than ₱0 at any point
    in the ledger. Her starting debt can be set only once.
  - `syncHelperBill` then sets the month's Helper column to what was handed over and re-splits
    it equally. If the month has no Helper column, it creates one.
- Tables: `helper_entries`, plus `bill_items.kind = 'helper'` to mark the Helper column (at most
  one per month). Migration `0010_helper-entries` marked the existing columns named "Helper".
- Guards on the Helper column: while the month has entries, `updateBillTotal` and `deleteBill`
  refuse it. "Start next month" copies the column as a Helper column at ₱0.

## Rules
[The Helper](../settlement-rules.md#the-helper)

## Open items
None.

## Built in
`feat/helper-visits`.
