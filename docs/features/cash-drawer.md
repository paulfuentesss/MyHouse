# Cash Drawer

## Status
✅ Working. Replaces PA's paper notebook for the cash he keeps at home.

## What it does
PA takes cash out of the bank and keeps it in a drawer. He pays the Helper and house costs
from it, and sometimes someone borrows from it. The Cash Drawer tab keeps that notebook.

- **Only PA sees it.** It's in the sidebar's Household group, hidden from housemates. The page
  redirects anyone else, and also redirects while PA previews as a housemate. It's the same in
  every month, because cash carries over from one month to the next.
- **It's never part of the split.** The drawer is PA's own money. A Helper visit or advance he
  paid from it still counts as paid by him, exactly as before. Nothing in
  [settlement-rules.md](../settlement-rules.md) changes.
- **Cash on hand:** everything put in, minus everything paid out or lent. It can go below ₱0
  (for example, when a Cash in hasn't been logged yet). The card then says on which day it went
  below ₱0, and the amount turns red.
- **Owed to the drawer:** what each person borrowed minus what they paid back. Names match
  regardless of capitals or extra spaces, and the last spelling typed is the one shown.
- **Ins & Outs:** every line, newest first, under a heading for each month, with In, Out and
  what was left after each line. On the same day, money in comes before money out, so taking
  cash from the bank and paying from it that day never shows as below ₱0; otherwise a day's
  lines follow the order they were logged in.
  - Only the two newest months with lines show at first; **Show older months** adds three more
    each tap. If the drawer went below ₱0 in an older month, the list reaches back to it.
    Hiding months only changes what's drawn: Cash on hand, Owed and the below-₱0 hint count
    every line.
  - On a phone each line is two rows (what and amount, then date, what was left and buttons),
    and a long note wraps rather than widening the list.
- **Add entry:** pick the kind, then fill in date, amount, a note, and the person for a loan.
  The Person field suggests names typed before.
  - **Cash in:** money put in, either from the bank or what's already in the drawer when you
    start.
  - **Spent:** paid out for something not logged in My House.
  - **Lent / Paid back:** someone borrowed, or returned what they borrowed.

  The drawer's own lines can be edited and deleted. A save that would leave someone having paid
  back more than they borrowed is refused. That covers a Paid back that's too big, shrinking or
  deleting a Lent that was already paid back, and moving a Paid back to another name.
- **Paid from the cash drawer:** a checkbox on the Helper visit, early pay and advance dialogs.
  Only PA sees it.
  - When ticked, the entry shows in the drawer by itself, as a Helper or Advance line linking to
    its month's tab. Its amount comes from the entry: for a Helper visit, what was handed over,
    so a visit whose pay was all taken off her debt doesn't show. Edit or delete it there and the
    drawer follows.
  - A small **Drawer** pill marks those entries on the Helper and Advances tabs (PA only).
  - It's for PA's own payments only, and needs a date. Otherwise the save is refused with a
    message.
  - Months that have been closed can't be edited, so their entries can't be ticked. For older
    payments, log a Spent instead.

## How it's built
- Route: `app/periods/[year]/[month]/drawer/page.tsx` (it ignores the month, like Billers), with
  `loading.tsx` reusing the Helper tab's skeleton. UI: `components/cash-drawer.tsx`. Dialogs:
  `AddDrawerEntryDialog` / `EditDrawerEntryDialog` and the `DrawerCheckbox` in
  `components/entry-dialogs.tsx`.
- Sidebar: `TABS` in `components/period-nav.tsx`. The tab has `adminOnly`, as Manage does.
  `MonthStatsSlot` hides the month's totals on this page.
- Pure logic: `lib/cash-drawer.ts`, tested in `lib/cash-drawer.test.ts`:
  - `drawerLedger` (order and what's left after each line), `cashOnHand`, `loansByPerson`,
    `firstOverpaid`, `firstBelowZero`
  - `shownMonthCount` (how many months the Ins & Outs list draws)
  - `drawerFlagFor` (the checkbox rule) and `drawerEntryValues` (validating a typed entry)
- Database side: `lib/cash-drawer-data.ts`, tested on PGlite in `lib/cash-drawer-data.test.ts`.
  - `getCashDrawer` reads the drawer's entries plus the flagged Helper entries and advances, and
    only works for the admin.
  - `addDrawerEntryIn` / `updateDrawerEntryIn` / `deleteDrawerEntryIn` take the caller's
    transaction. Each takes one advisory lock, so two saves can't both pass the loans check,
    then checks loans after writing.
- Actions in `app/periods/[year]/[month]/actions.ts`:
  - `addDrawerEntry`, `updateDrawerEntry` and `deleteDrawerEntry` run as `run("admin", …)`.
  - `addHelperEntry` / `updateHelperEntry` and `addAdvance` / `updateAdvance` read the
    `fromDrawer` box through `drawerFlagFor`. A housemate's save never changes it.
  - Tested through the real actions in `lib/drawer-flag-actions.test.ts`.
- Page data: `lib/periods.ts` sends `fromDrawer` on advances and Helper entries only to the
  admin. Housemates' pages always get `false`.
- Tables: `cash_drawer_entries` (the `cash_drawer_kind` enum), plus `from_drawer` on
  `helper_entries` and `advances`. Migration `0024_cash-drawer`
  ([data-model.md](../data-model.md)).
- Why it's built this way: [decisions.md](../decisions.md), 2026-10-26.

## Rules
Not part of the split, so none in [settlement-rules.md](../settlement-rules.md).

## Open items
None.

## Built in
`feat/cash-drawer`.
