# Testing

## Automated tests

`npm test` runs every `*.test.ts` with Vitest in a few seconds. Most tests never touch a
database or React: the money math and rules are pure code in `lib/`. The exceptions are all
still offline: `invites.test.ts` runs `lib/invites.ts` against a fake database and a fake
Supabase, `actions-guard.test.ts` reads the source files, and the [database tests](#database-tests)
(`backup`, `month-close`, `month-start`, `periods`, `bill-import`, `reminder-send`,
`seen-route`, `cash-drawer-data`, `drawer-flag-actions`) run a real Postgres in memory (PGlite),
never the live database.

**CI:** GitHub Actions runs `npm run typecheck`, `npm run lint`, `npm test` and a production
build (`npm run build`, with placeholder settings) on every pull request and every push to main
(`.github/workflows/checks.yml`); a failure shows as a red ✗ on the PR. It needs no secrets
because no test touches the live database or any other service and the build fetches nothing —
keep it that way.

| Test file | Covers |
|---|---|
| `lib/money.test.ts` | Centavo conversion, parsing typed amounts, equal and weighted splits |
| `lib/settlement.test.ts` | The made-up August 2026 worked example; bill shares; Month Final rules; shared columns; split order; suggested payments; waiting and rejected payments not counted |
| `lib/month-lock.test.ts` | Closing / reopening rules, pending bills and waiting payments blocking a close, starting the next month waiting for them, balances that would vanish; when a month has ended (Manila date, year's end), when the bill can be emailed |
| `lib/advances-log.test.ts` | Advances Log grouping, split labels and the column filter (`?column=`) |
| `lib/bill-email/parse.test.ts` | Reading the August sample bill emails; refusing other senders; bill month; dates |
| `lib/bill-email/intake.test.ts` | What `/api/bill-email` accepts from the Gmail script: Gmail's verdict that the biller sent it — DKIM, DMARC, or a forwarded bill's ARC sealed by Google (lookalikes, other domains, other sealers, headers not from Gmail refused), a sender's address planting a result in the header, the body's shape |
| `lib/bill-email/fees.test.ts` | The payment fee setting turns the sample emails into the fixture's bills, and which Split Table column reminds a hand-typed bill of its fee |
| `lib/local-database.test.ts` | Test-data scripts recognise only a database on this machine as local |
| `lib/permissions.test.ts` | Who may change which advance; who may log in an ended month (`canLogIn`); who may send / cancel a payment and see its proof; `safeNext` blocking open redirects after sign-in |
| `lib/actions-guard.test.ts` | Every Server Action goes through `run("admin" \| "member", …)`; only the advance, Helper and "I paid" actions (`submitPayment`, `cancelPayment`) are open to members, and the advance and Helper ones refuse an ended month; `/receipts/[id]` checks `canSeePaymentProof` before signing a link; no unknown Route Handlers; `/receipts/[id]` and `/backup` check the login first, and `/backup` the admin; `/api/reminders` checks `CRON_SECRET` first; every cash drawer change takes the drawer's lock first; the secret key, `CRON_SECRET` and the Gmail app password are each read in one place, and the admin client stays out of the browser |
| `lib/reminders.test.ts` | Reminder days (31/30/28-day months, a missed day caught up); what's still owed after a bill email (waiting and later payments, rejected ones, capped by the latest Final); the admin's nudges; the housemate banner; a "seen" from before a resend not counting; the bills to pay (which bills and inbox emails, housemates' "coming up" without overdue ones, the morning email's steps, a missed day caught up, old steps never dug up, the wording) |
| `lib/reminder-emails.test.ts` | The wording of every email: reminders, the bill (carry-over, waiting I paid, money back, nobody settled emailed), "couldn't start", the nudges |
| `lib/bearer-secret.test.ts` | The shared-secret check for `/api/bill-email` and `/api/reminders`: right, wrong, missing, or no secret set |
| `lib/devices.test.ts` | Who's using it (Manage): telling devices apart, accepting only known values from `/api/seen` (and a `drawnAt` only if it's a time), "last seen" labels on Manila's calendar |
| `lib/receipts.test.ts` | Which receipt files are accepted (real type from the first bytes, size limit), their names in the bucket, resizing long screenshots |
| `lib/backup.test.ts` | Download backup: the real migrations in PGlite (Postgres inside the test), made-up rows in every table (a new table without sample rows fails the test) backed up and restored exactly, every Storage bucket the code uses covered (a new one fails until it's added to the backup), id counters moved on, a restore into a non-empty database changing nothing; the zip holding the `.sql` and every picture byte for byte, dated on Manila's clock (meaningful under UTC, as in CI), recorded only when complete |
| `lib/month-close.test.ts` | Closing the made-up August (PGlite): everyone's Final saved as their closing balance (the worked example's, ₱0.02 over from the Ice Maker), the month locked; refused, writing nothing, while a bill is pending, an "I paid" waits or the month before is open; the Finals becoming the next month's openings; refused when someone left out of the next month still has a balance |
| `lib/month-start.test.ts` | Starting September from August (PGlite): every bill column copied at ₱0 with its split, payer and points (all-zero points → 1 each), only Advances Shared, no view-only login; opening on ₱0 after an open month and on the closing balances after a closed one; refused while an "I paid" waits or someone who moved out has a balance; a dry run writing nothing |
| `lib/periods.test.ts` | Carry-over between months (PGlite): a month opening with the open month before's Finals (after its payments), worked out live; the stored openings once the month before is closed; what's still carried over after a partial payment (waiting and rejected "I paid"s not counted), never below ₱0 for someone who's owed; last month's bill paid in a later month (or paid back by the House Budget), and capped by what they owe overall now |
| `lib/bill-import.test.ts` | Bill emails into pending bills (PGlite): Meralco by points and Water equally with their fees, worked out by hand; the same email or a second one for the same bill doing nothing; never overwriting an amount; staying in the inbox with the reason (month not started, closed, no column, split by hand) and importing on Retry; an unreadable email kept with its snippet |
| `lib/reminder-send.test.ts` | The daily job (PGlite, emails and pushes caught): each month-end reminder once, not to the collector or someone without an email; a failed one retried the next run; pushes only after the email; nothing recorded off the live site; the next month started (or only checked off the live site), the admin told once when it can't; unpaid follow-ups on their days, the old time put back when one fails, none once paid; the admin's bills to pay on each step (one email per month, none once marked paid, the old time put back when one fails) |
| `lib/bill-due-actions.test.ts` | A bill's Date paid through the real Server Actions (PGlite; login, refreshes and redirects stubbed): "Paid today" sets today in Manila, works on a closed month, admin only; on a closed month Date paid can be set and cleared but the Due date can't, and the closing balances don't change |
| `lib/seen-route.test.ts` | `/api/seen` marking bill emails seen (PGlite): only the caller's own bill and "bills are in" emails, only those sent before the page was drawn, none from the every-page ping, the first look kept and a resend marked again, nothing without a login |
| `lib/helper.test.ts` | The Helper: what's handed over, who paid and the month's bill, the month's totals, her debt after each entry and where it first goes below ₱0, ledger order; the "Log a visit" form's cash line (typed amounts, empty Taken off, more taken off than her pay, amounts the server refuses) |
| `lib/cash-drawer.test.ts` | The Cash Drawer's ledger: the order (money in before money out on a day, then the order they were logged), how many months the list draws, what's left after each line, cash on hand, where it first went below ₱0, what each person owes (names matched regardless of capitals or spaces), paying back too much; the "Paid from the cash drawer" rule (admin, own payment, a date; a housemate's save leaves it); a typed entry's person only on a loan |
| `lib/cash-drawer-data.test.ts` | The Cash Drawer's database side (PGlite): saving, editing and deleting its own entries; refused, writing nothing, when someone would have paid back more than they borrowed (too big, a loan shrunk or deleted, moved to another name); the tab reading flagged Helper entries (what was handed over) and advances into one ledger with links to their months, a day's lines in the order each table's rows were saved, and only for the admin; the checks on dates, the starting debt and loans' names |
| `lib/drawer-flag-actions.test.ts` | "Paid from the cash drawer" through the real Server Actions (PGlite; login, refreshes and redirects stubbed): the admin ticking and unticking it on a Helper visit, early pay and an advance he paid; refused on someone else's payment or without a date, saving nothing; never set by a housemate, and a housemate's edit leaving it alone; a plain visit saved as before; the split (Finals, Helper bill) identical flagged or not; the month pages carrying it for the admin, never for a housemate |
| `lib/backup-reminder.test.ts` | When the backup reminder shows: a month started or closed after the last backup, none yet, a month reclosed |
| `lib/invites.test.ts` | Inviting / un-inviting: the order of the database and Supabase calls, rolling back a new login, never reusing a leftover one |
| `lib/email-domain.test.ts` | Whether an invited email's domain takes mail, with a fake DNS: a missing domain, a null MX, an address-only domain, a timeout. Only a definite "no" blocks the invite |

Money or rule changes: update the expectations in `lib/settlement.test.ts` (and the worked
example in `docs/settlement-rules.md`). Work the new values out by hand from the rules — never
copy them from the app's output, or the test only checks the app against itself.

## When a change needs a test

Part of every change, in the same PR. The **test-keeper** agent (`.claude/agents/test-keeper.md`)
checks it before every PR. Old tests still passing proves nothing about new behaviour.

- **Logic in `lib/`** (money, who may do what, dates, what a page, email or push says): a new or
  changed expectation in that file's `*.test.ts`. Logic that's hard to test inside a component
  moves to `lib/` first.
- **Database writes** (closing or starting a month, bill imports, the daily job, a route that
  saves something): a [database test](#database-tests) on PGlite.
- **Guard lists:** a new Server Action or Route Handler goes in `lib/actions-guard.test.ts`, and
  a new table or Storage bucket in `lib/backup.test.ts`. Both fail until it's added.
- **No test needed:** layout and styling, wording-only changes in components, loading that
  passes values through, renames. Paul checks pages in the browser. Say so in the PR's test
  plan.

A good test:
- has expected values worked out by hand from the rules or the feature's page;
- uses only the made-up August people and amounts, and never reaches the live database or
  another service;
- **can fail**: break the code it checks once on purpose, see the test go red, then put the
  code back.

## Database tests

The riskiest writes (closing a month, starting the next, a bill email, the daily job) and the
month-to-month carry-over run against a real Postgres: PGlite, Postgres inside the test process, with every migration in
`drizzle/` applied. Nothing can reach the live database, and CI needs no secrets.

- **`lib/test-db.ts`**: `testDatabase()` is the test file's one database (migrated once, the slow
  part); `resetDb(pg)` empties every table between tests. Money comes back as exact text, as
  from the live driver (`"1000.50"`). Nested `with:` reads come back through JSON on both
  drivers (`"0"`, `"1000.5"`), so compare those with `toCentavos`.
- **`@/db` is swapped** in each test file, so the code under test reads and writes PGlite:
  `vi.mock("@/db", async () => (await import("./test-db")).dbModule())`, plus
  `vi.mock("server-only", …)` (it throws outside Next) and stubs for what a file pulls in but
  doesn't use (`@/lib/auth`; for the daily job `@/lib/email`, `@/lib/push`, `next/server`).
- **Data:** `loadAugust(tx)` (`lib/__fixtures__/load-august.ts`) writes the made-up August, the
  same loader `npm run db:seed:august` uses. Each test then changes just what it's about.
- **Clocks:** the daily job's tests fake JavaScript's `Date` (`vi.useFakeTimers({ toFake:
  ["Date"] })`) and run it on a Manila date; rows that need a time get it written explicitly.
- **What they can't show:** two things at the same instant (Vercel calling the cron twice, two
  starts racing). PGlite has one connection, so everything runs one after the other; the locks
  and unique indexes that handle races are guard-tested (`actions-guard.test.ts`) instead.
- A new code path worth one: move the work into `lib/` taking the transaction (`tx`), as
  `closeMonthIn` and `startNextMonthIn` do, with the action only checking who's asking.
- **Server Actions themselves** can run too, when what's being tested is the action's own
  handling of the form (`lib/drawer-flag-actions.test.ts`): stub `@/lib/auth` (`getViewer`,
  `previewFor`), `next/cache`, `next/navigation` and `next/server`, then call the action with a
  `FormData`. Fake `Date` to a day inside the month if a housemate's save is part of the test
  (an ended month refuses them).

## Fixtures (test data)

All test data is **made up**: the repo is public, so real names and amounts never go in it
(the household's real data is only in the database).

| Fixture | What it is | Used by |
|---|---|---|
| `lib/__fixtures__/august-2026.ts` | A made-up August 2026 (Ana, Ben, Cara, Dan, PA): members, bills, points, advances, rounded-per-share Month Finals. Keeps the edge cases: a points tie decided by split order, leftover centavos, a column without PA, a Manual column ₱0.02 over | `settlement.test.ts`, the database tests, `npm run db:seed:august` |
| `lib/__fixtures__/load-august.ts` | `loadAugust(tx)`: writes that August into a database (members if missing, the month, bills and shares, columns, advances) | the database tests, `npm run db:seed:august` |
| `lib/bill-email/__fixtures__/august-2026-emails.ts` | Bill emails for those bills in the providers' real formats, amounts made up | `parse.test.ts`, `bill-import.test.ts`, `npm run bills:import` |

**Adding an email fixture:** copy the plain-text body, then replace account and contract
numbers, names, phone numbers, invoice numbers, tracking links and amounts before saving —
this repo is public ([operations.md → Privacy & security](operations.md#privacy--security)).

## Test data in the database

My House has no test database by choice ([decisions.md](decisions.md)), so this only applies
if a local one is ever set up. `npm run db:seed:august` loads the made-up August (adding its members), and
`npm run bills:import -- meralco water pldt` imports the sample emails. Both run **only
against a local database** and refuse the live one (`lib/local-database.ts`), which holds the
household's real data:

```bash
npm run db:seed:august -- --replace   # reset the local August (and its bill emails)
```

## Trying things by hand

The dev loop: make the change → `npm run typecheck && npm run lint && npm test` → check the
pages in the browser with `npm run dev` running. Every page needs a login, so `curl` only
confirms the redirect to `/login`; the pages themselves are checked signed in, in the
browser. There's no dev bypass.

**Login, start to finish** (after [setup.md](setup.md) step 5). No real housemates needed: Gmail
ignores anything after a `+`, so `<your gmail>+house1@gmail.com`, `+house2`, … all land in
PA's inbox but are separate logins. Type your own address — not a placeholder like
`yourname+…`, whose codes would go to a stranger. Sign in as the housemate in a private window,
so PA stays signed in in the main one.
1. Signed out, open any page: you land on `/login`.
2. **Continue with Google** as PA: everything works as before, and the header shows PA.
3. Manage → Manage Housemates: type a test email for a housemate. On the login page, **Get a
   code by email** with it; the code arrives from the My House Gmail. Signed in as them:
   no Manage tab, no edit controls except their own advances in Advances Shared and the
   Helper visits and early pay they paid.
   A wrong code shows an error; an email that isn't invited gets the same "on its way"
   message, and nothing is sent.
4. As that housemate, run `updateBillTotal` from the browser console (or any PA-only action):
   "Only the admin can change this.", and nothing changes.
5. Change their email in Manage. In Supabase → Authentication → Users the **old** login is
   gone and the new one is there — the one check a fake can't make (`invites.test.ts`).
6. Clear their email while they're signed in: their next click goes to `/login`.
7. A Google account that isn't invited: "not invited", no loop. The My House Gmail works once no
   member uses it. It must be a test user on the Google consent screen, or Google blocks it
   before the app is reached ("Access blocked") and the app's check isn't tested.

**"I paid", start to finish** — needs a real housemate login (a `+house1` alias, docs above),
since Preview can't save. PA in the main window, the housemate in a private one; on live data,
so delete the test payments afterwards:
1. Housemate: Settle Up → **I paid** on their row → ₱1, a screenshot → Send. It shows as
   Waiting for PA; their Final hasn't moved. No screenshot → refused.
2. PA: the Settle Up tab shows a count and **Waiting for you**; closing the month and "Start
   next month" are both refused while it waits. On the housemate's row: "₱1.00 sent, waiting".
3. PA: **Reject** with a reason → the housemate sees "Rejected: …", the amount struck through,
   and can **Cancel** it.
4. Housemate: send it again → PA **Confirm** → both Finals move, the Split Table's Payments
   column shows it; the housemate can no longer cancel it.
5. A second housemate login (another `+` alias on another member, removed afterwards) sees
   the payment but not its screenshot; opening `/receipts/<id>` directly → "Receipt not found".
6. "I paid" isn't offered in an older month or a closed one.

**Receipts, start to finish** (after `npm run storage:setup`):
1. As PA, Receipts tab → a bill → **Attach proof** → a phone screenshot. It shows on the card;
   in Supabase → Storage → `receipts` the file is a few hundred KB, under `YYYY/MM/`.
2. Attach a second screenshot to the same bill: a small thumbnail below. Tap one: the viewer
   opens; **Open original** opens it in a new tab. Keep attaching: at the limit
   (`MAX_RECEIPTS_PER_ITEM`) Attach turns into a note, and picking more files than are left
   attaches none.
3. Record a payment on Settle Up; attach its proof in the Payments section.
4. Try a file that isn't an image (a PDF, or a `.txt` renamed `.png`): refused with a message.
5. Delete a proof from the viewer; then delete a bill or payment that has proof. Its files are
   gone from the bucket.
6. As a housemate: proofs are visible, no Attach or Delete. Signed out, `/receipts/<id>` goes
   to `/login`.
7. Close the month: Attach and Delete disappear; reopen it.

**Email-imported bills, start to finish.** This needs a local database, since the sample
emails are test data and the scripts refuse the live one — and My House has none by choice
([decisions.md](decisions.md)). It's kept for if one is ever set up; until then the import is
covered by `parse.test.ts`, `intake.test.ts` and real bills arriving through the Gmail script.
1. `npm run db:seed:august -- --replace`, then `npm run bills:import -- meralco water pldt` —
   all three go to the Bill Inbox (August already has its bills).
2. Split Table: set Meralco's amount to `0` (Enter). Manage → Bill Inbox → Meralco → **Retry**.
3. Meralco is now **Pending** with the fee note. Try **Confirm**, **Discard**, closing the month
   (blocked), or deleting the column (the email returns to the inbox).
4. Each test uses the email up; repeat from step 1.
