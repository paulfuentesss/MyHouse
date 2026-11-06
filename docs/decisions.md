# Decisions

Choices that shaped My House, and why. Add one whenever a choice has a "why" worth
remembering — including those made in an approved Claude plan (plans are kept outside the
repo). Newest at the bottom. Money rules themselves live in [settlement-rules.md](settlement-rules.md).

Format: `## YYYY-MM-DD — Title`, then **Decision** and **Why** (and **Instead of** only when
there was a real alternative).

## 2026-09-27 — Money in integer centavos
**Decision:** all money math is done in whole centavos (`lib/money.ts`); the database stores
`numeric(12,2)`, which Drizzle returns as strings.
**Why:** floats can't represent ₱0.01 exactly, and splits must always add up to the total.

## 2026-09-27 — The full ledger
**Decision:** everyone's Month Final is their share of everything minus what they paid, bills
paid included, the collector like everyone else; the Finals sum to ₱0.00.
**Why:** it's how the household sheet works, and a sum of ₱0.00 is a built-in check.

## 2026-09-27 — The collector absorbs leftover centavos
**Decision:** equal splits hand leftover centavos out collector-first (`splitOrder`).
**Why:** leftovers never land on someone who didn't choose to collect.

## 2026-09-27 — No public deploy until login
**Decision:** the app runs locally only until login exists.
**Why:** anyone with the URL would see the household's finances.
*Superseded 2026-09-28: login exists; going online follows the checklist in
[TODO.md](TODO.md#going-online).*

## 2026-09-27 — Schema changes: generate + migrate, never push
**Decision:** `db:generate` writes versioned SQL, which is read before `db:migrate` applies it.
**Instead of:** `drizzle-kit push`, which changes the database directly with no record or review.
**Why:** every change is reviewable and repeatable, and destructive SQL gets caught.

## 2026-09-27 — RLS on every table, no policies
**Decision:** every table has row-level security enabled with no policies.
**Why:** it blocks Supabase's public Data API; the app connects to Postgres directly and isn't affected.

## 2026-09-28 — Forms submit with `onSubmit` + `startTransition`
**Decision:** inline inputs and dialogs submit through `onSubmit` + `startTransition`.
**Instead of:** `<form action={…}>`.
**Why:** React resets a form after every action, even a failed one, which wiped what was typed.

## 2026-09-28 — Keep-alive via GitHub Actions
**Decision:** a scheduled workflow reads one table twice a week.
**Why:** free Supabase projects pause after 7 idle days, and the app is mostly used around month-end.

## 2026-09-28 — Repo and folder renamed to `home-finance-tracker`
**Decision:** GitHub repo `paulfuentesss/home-finance-tracker` (the old `MyHouse` URL still
redirects), local folder `~/Documents/GitHub/home-finance-tracker`.

## 2026-09-28 — Bills go in the month the provider names
**Decision:** an emailed bill goes into the month named in the email ("Meralco bill for August
2026"); if none is named, the month holding the middle of the billing period.
**Instead of:** the month it arrives, or the billing period's midpoint alone (PLDT has no period).
**Why:** it matches how the household sheet already assigns bills, so switching to email import
double-counts nothing.

## 2026-09-28 — Emailed bills are pending until confirmed, and never overwrite
**Decision:** an emailed bill fills the month's existing ₱0 column as pending; anything that
doesn't fit goes to the Bill Inbox; a pending bill blocks closing its month.
**Why:** parsing can be wrong and amounts can differ from what was paid, so a person checks
each one; a pending bill left in a closed month could never be confirmed.

## 2026-09-28 — Payment fees are added, shared, and kept as a setting
**Decision:** the fixed fee of the usual way of paying each bill is added on import
(`BILL_PAYMENT_FEES`), shared by everyone, noted on the column, and stored per email.
**Instead of:** editing the amount by hand each month, or reading payment-confirmation emails.
**Why:** the sheet already shares the fees; they only change when the way of paying changes;
storing them per email keeps old months stable.

## 2026-09-28 — The repo stays public; household specifics stay out of it
**Decision:** the repo stays public. Docs are generic; household specifics go in a git-ignored
`.private/NOTES.md`. What's already public (the August fixture) stays as it is.
**Instead of:** making the repo private.

## 2026-09-28 — The app is "My House"; the code is `home-finance-tracker`
**Decision:** what the household sees (header, browser tab, pages, later the home-screen icon)
is **"My House"**, spelled that way everywhere. Internal names — repo, folder, `package.json`,
backup files — are `home-finance-tracker`.
**Instead of:** "MyHouse" (was used alongside "My House"), "My House App", or renaming the app
to match the repo.
**Why:** internal names describe the code; the app name should be short and friendly and fit a
phone header and an icon label (iPhone cuts those at about 12 characters). "App" adds nothing
inside the app itself.

## 2026-09-28 — Docs organized by topic, one home each
**Decision:** README is the short front page, CLAUDE.md is Claude's index, and `docs/` holds
one file per topic: features (the only status list), TODO, decisions, rules, data model,
testing, setup, commands, operations.
**Why:** as the project grows nothing gets forgotten, and nothing is written in two places
that can drift apart.

## 2026-09-28 — Login with Supabase Auth: Google or an emailed code
**Decision:** everyone signs in through Supabase Auth, with Google or a 6-digit code sent to
their email ([features/auth.md](features/auth.md)).
**Why:** Supabase is already the database, so there's no new service or cost. A code covers a
member without a Google account, with no password to forget.
**Instead of:** email + password (a reset flow, forgotten passwords), or one shared household
login (no way to tell who did what, or to remove one person).

## 2026-09-28 — Invite-only: sign-ups off, the login made at invite
**Decision:** Supabase sign-ups are off. Inviting a member creates their Supabase login (with
the server-only secret key) and stores its id on the member; every request matches on that
id, never on the email in the token.
**Why:** with sign-ups on, anyone could use the public Supabase API to make the app email
codes to any address through its Gmail. Matching on the id means changing a login's email
can't make it someone else.

## 2026-09-28 — Codes, not magic links
**Decision:** the sign-in email carries a 6-digit code to type in.
**Why:** a link opened from a phone's mail app often lands in a different browser than the
one that asked for it, and the sign-in fails there.

## 2026-09-28 — Two roles: PA edits, housemates log their own advances
**Decision:** the admin (PA) can change everything. Members see everything except Manage, and
can add, edit and delete only advances they paid, only in the month's default column, only
in an open month.
**Why:** PA is the collector and keeps the books; letting housemates log their own receipts
saves him typing, and keeping them to the default column means they can't unbalance a
Manual or situational column.

## 2026-09-28 — A separate Gmail sends the codes (partly replaced 2026-10-09)
**Decision:** the email codes go out through the app's own Gmail (Supabase custom SMTP), not
PA's.
**Why:** a Gmail App Password opens the whole mailbox, and PA's holds the providers' bill
emails.

## 2026-10-08 — Keep-alive writes and calls the API, not just a read
**Decision:** the keep-alive job stamps a one-row `keep_alive` table and calls Supabase's API
over HTTPS with the publishable key, twice a week.
**Why:** the project paused in early October although the job had read a table on 1 and
5 October — about 7–10 days after the last real use, as if the reads didn't count. Supabase
doesn't document what counts as activity, so the job now does both kinds of thing real use
does.
**Instead of:** a paid plan (no pausing) — overkill for a household app while restoring loses
no data.

## 2026-10-08 — CI checks, and subagents that review rather than build
**Decision:** a GitHub Actions workflow runs typecheck, lint and tests on every PR. Two Claude
Code subagents (`.claude/agents/`) review before a PR: `money-reviewer` checks money and schema
changes against `settlement-rules.md`; `docs-keeper` checks the docs were updated and nothing
private slipped in. Both are read-only; the main session makes every edit.
**Why:** the checks used to run only when someone remembered. A reviewer that starts fresh
doesn't share the blind spots of whoever wrote the change, which matters most for the money
math and for privacy in a public repo.
**Instead of:** subagents building features in parallel — the codebase is small and tightly
connected, so they'd edit the same files and spend most of their time re-learning the project.
Truly separate features can run as separate sessions in their own git worktrees.

## 2026-10-08 — One worktree per session, and a startup check
**Decision:** each parallel Claude session works in its own git worktree. A SessionStart hook
(`.claude/hooks/checkout-status.sh`) shows every session the folder's branch, uncommitted
changes, worktrees and open PRs before it starts.
**Why:** two sessions shared one folder; one switched branches mid-task and the other's commit
landed on the wrong branch. Git can't tell whether another session is open, but the traces one
leaves (a feature branch, uncommitted files) can be shown up front.
**Instead of:** blocking `git switch` with a hook — the report plus the CLAUDE.md rule covers
it without getting in the way of normal branch work.
**Superseded 2026-10-11, back 2026-10-13:** sessions shared one folder for two days (below);
now each has its own worktree again, and a hook blocks every `git switch` except
`git switch main`. The startup check stays.

## 2026-10-08 — Receipts: a private bucket, opened through the app
**Decision:** receipt files go in a private Supabase Storage bucket that only the server
reaches (secret key). Pages link to `/receipts/<id>`, which checks the login and redirects to
a link to the file that works for one minute.
**Why:** payment screenshots carry names and account numbers. With no Storage policies, nothing
but the app can read them, and the app's own login rules decide who sees what. A link in the
page that expired would break in a tab left open; the redirect is always fresh.
**Instead of:** a public bucket (anyone with the link), or Storage policies for `authenticated`
users (any Supabase login, not just household members).

## 2026-10-08 — Receipts: shrink images in the browser, check the type on the server
**Decision:** images are redrawn as JPEG in the browser before upload (width capped, height
not); the server accepts only JPEG, PNG and WebP images, judged by the file's first bytes.
**Why:** phone screenshots are 1–3 MB and the free plan has 1 GB; redrawing also drops photo
location data. Capping only the width keeps long screenshots readable. The type the browser
reports can be faked, so the server reads the file itself; the bucket refuses other types too.
**Instead of:** PDFs as well (e.g. e-bills) — dropped to keep it simple: a phone screenshot is
enough proof, and browsers can't reliably show a PDF inside the viewer.

## 2026-10-08 — Receipts: own table, a few per bill or payment; closed months locked
**Decision:** a `receipts` table where each row belongs to exactly one bill or payment
(replacing the unused `receipt_path` columns), with a small cap per bill or payment
(`MAX_RECEIPTS_PER_ITEM`). Proofs follow the month lock: attach or delete
only while the month is open.
**Why:** a bill can need more than one screenshot (e.g. a split payment), and payments are the
"Payment Proofs" the tab is named after. The cap stops a mis-tap from attaching a whole camera
roll, which matters once housemates upload too. Following the lock keeps one rule for everything
in a month.

## 2026-10-09 — Kept out of search engines; icons as static files
**Decision:** every page says `noindex, nofollow` (root metadata) and `app/robots.txt` disallows
everything. The app icons are plain files in `app/` (`icon.svg`, `favicon.ico`,
`apple-icon.png`), not generated by code; `robots.txt` is skipped by the proxy's matcher.
**Why:** it's a private household app, so nothing in it should show up in search. The proxy
sends signed-out requests to `/login` unless the path is skipped; image extensions already are,
so static icons load on the login page, while a generated icon (served at `/apple-icon?…`, no
extension) would be redirected. `robots.txt` has to be readable signed out for crawlers to obey it.

## 2026-10-09 — Text contrast, with the amber buttons as the one exception
**Decision:** grey text is at least zinc-500 and green "to receive" amounts are emerald-700. The
filled buttons stay amber-600 with white text.
**Why:** WCAG AA asks 4.5:1 for normal-size text; zinc-400 (2.6:1) and emerald-600 (3.7:1) fell
short. White on amber-600 is 3.2:1, also short, but it's the app's look and PA prefers it — a
known exception, not an oversight. Icons and borders only need 3:1, which amber-600 meets.
**Instead of:** amber-700 buttons with white text (5:1), or near-black text on amber-600 (5.5:1) —
both tried; PA preferred the original.

## 2026-10-09 — One household Gmail: codes out, bills in
**Decision:** the My House Gmail, a new account replacing the first sender Gmail, both sends
the sign-in codes and receives the Meralco, Manila Water and PLDT bills (and would send
reminders, if those get built).
**Why:** the bills stop depending on PA's personal inbox, and the household has one account
to hand over. The 2026-09-28 worry was the App Password in Supabase opening PA's personal
mailbox; this one holds only household bills. Payment apps stay on PA's accounts (they're
tied to his card and bank), so their receipts still go to him.

## 2026-10-10 — Hosting on Vercel's free plan, a vercel.app address
**Decision:** the app runs on Vercel (Hobby), deploying every merge to `main`, at a free
`*.vercel.app` address. Its environment variables are Production only; preview builds are off
and the functions run in the database's region, both set in `vercel.json` rather than the
dashboard (versioned and reviewed like code). No Vercel–Supabase integration.
**Why:** Vercel builds Next.js with no configuration, and Hobby is meant for personal,
non-commercial use, which a household app is. An own domain isn't needed to launch; it can
come with Resend. Production-only variables mean a branch build can never
reach the real database, so preview builds would only fail. Running next to the database
avoids a trans-Pacific round trip per query. The integration would add its own variables over
ours for a Supabase project that's already wired up.
**Instead of:** `myhouse.vercel.app`, which was taken; the address is in `.private/NOTES.md`.

## 2026-10-10 — Only `main` deploys, by branch name
**Decision:** `vercel.json` turns deployments on for `main` only (`git.deploymentEnabled`).
**Why:** branch builds have no environment variables, so they'd only fail. Matching the branch
name is Vercel's own switch for this and depends on nothing at build time.
**Instead of:** an `ignoreCommand` of `[ "$VERCEL_ENV" != production ]` — tried first, and it
skipped the production deploy as well (the variable evidently isn't `production` at that step).

## 2026-10-10 — The app says "the admin", not "PA"
**Decision:** household-facing text names the role — "Ask the admin…", "Only the admin can
change this." — never PA by name. "PA" still appears where it's a member's name in the data
(e.g. the "Advances Shared w/o PA" example).
**Why:** PA prefers it, and the text stays right if someone else ever becomes the admin.

## 2026-10-10 — "Preview as a housemate": display only, changes refused
**Decision:** PA can preview the month tabs as a housemate from the account menu. The choice is
a plain browser cookie (`lib/preview.ts`, `lib/preview-browser.ts`); the server honours it
only when the real signed-in member is the admin, and only for what's *shown*: access checks
keep using the real viewer, and `run()` refuses every change while a preview is on (save
buttons are off too).
**Why:** PA needs to check what housemates see without a second login; the test `+` alias stops
working once real addresses are invited. Refusing changes keeps a click in preview from quietly
saving real data as PA (an advance "for" the housemate is something PA is allowed to log). A
cookie rather than a Server Action because it grants nothing — a member who sets it gets
nothing — and it leaves the Server Action list (and its guard test) unchanged.
**Instead of:** "sign in as" impersonation (real member permissions, but a riskier feature for
an admin-only convenience), or a client-only switch (the server-rendered parts — banners,
Manage — wouldn't follow).

## 2026-10-10 — Finished worktrees are removed by one command
**Decision:** `npm run worktrees:clean` (`scripts/worktrees-clean.sh`) removes a worktree and its
branch only when its PR is merged at the folder's current commit, it has no uncommitted changes,
and no process has it as its working folder. The startup check runs the same rules in a
read-only `--check` mode and says how many are finished. Paul runs it; sessions only suggest it.
**Why:** with a session per worktree, finished folders pile up (four at once by the time this was
added), and deleting them in Finder leaves git's records behind. Checking the merged PR's commit,
not "is the branch merged into main", works with GitHub's merge commits and catches work
committed after the merge. The running-process check keeps it from pulling a folder out from
under an open VS Code window, dev server or another session.
**Changed 2026-10-13:** Claude runs it itself now, and it stops a finished worktree's own dev
server first (below).

## 2026-10-10 — Develop against a local Supabase, not a second cloud project
*Superseded 2026-10-11: one database plus backups, no test database (below).*
**Decision:** for development and testing, run Supabase on the laptop (the Supabase CLI, in
Docker) rather than creating a second free cloud project.
**Why:** today `localhost` and the live site share one database, so testing touches the
household's real numbers. A local stack is free, unlimited and never pauses. The free plan
allows only two active cloud projects (as of 2026-10), so a test project would use up the last slot that
other apps might need.

## 2026-10-11 — "How it works" answers use made-up examples, not a real month's numbers
**Decision:** the FAQ answers on `/how-it-works` explain each rule in general terms with
made-up round numbers (₱1,000.02 split 5 ways, and so on), instead of one month's figures or
figures pulled from the latest month. Only the Meralco points table and its worked example
show live numbers.
**Why:** August's figures made the page read as if it were about one month, and the repo is
public, so real amounts and names don't belong in the code. Pulling in live numbers would
make the examples change every month and could stop showing a case at all (e.g. a month whose
bills split evenly has no leftover centavos to explain).

## 2026-10-11 — Test data is made up; the test-data scripts are local-only
**Decision:** the August 2026 fixture and its sample bill emails are fictional (Ana, Ben, Cara,
Dan, PA; invented amounts and purchases), with the same edge cases as before. Their expected
values were worked out from the rules by a separate calculator, which first reproduced the old
real-data expectations exactly. `db:seed:august` and the sample `bills:import` run only against
a database on this machine; `db:seed` now adds only PA. Follows up 2026-09-28.
**Why:** the repo stays public, and the fixture showed the housemates' first names, a month's
real amounts and shop names that hint at the neighbourhood. Now that the app is live, loading
test data into the shared database would also overwrite real data.
**Instead of:** making the repo private, or rewriting git history — the old values stay in past
commits; a history rewrite would break every PR and worktree and still leave GitHub's PR copies.

## 2026-10-11 — One database plus backups, no test database
**Decision:** no local or second Supabase. Development, scripts and the live site share the one
database; `npm run db:backup` runs after closing each month and before every migration, and
the copies are kept off the laptop. The local-only guard on the test-data scripts stays.
**Why:** one developer, a small household app, and migrations so far have all been additive.
A local stack (Docker, a second `.env`, keeping two databases' schemas in step) costs more
upkeep than it saves. The automated tests already run on made-up data without a database.
**Instead of:** a local Supabase (2026-10-10), or a second free cloud project.
**Trade-off:** trying things on `localhost` touches real data — test with removable entries and
avoid hard-to-undo actions ([operations.md](operations.md#one-database-localhost-is-live-data));
the sample bill emails can't be imported, since they're test data.

## 2026-10-11 — Download backup: the app writes a data-only .sql, zipped with the receipts
**Decision:** Manage → Download backup returns one zip: a `.sql` of every row, generated by
Postgres itself (`row_to_json` → `INSERT … json_populate_record`, `lib/backup.ts`), plus every
receipt picture. It holds rows only: the tables come from `drizzle/` at the commit written in
the file's header. The tables to back up are read from the catalog, all in one REPEATABLE READ
snapshot, and the zip is streamed one picture at a time. `npm run storage:restore` puts the
pictures back.
**Why:** the free plan has no backups, and backing up from the laptop needs the laptop. The site
runs on Vercel, where there's no `pg_dump`, and a server can't save files onto the laptop, so
the browser downloads it. Postgres does the quoting, so amounts stay exact numerics. Reading
tables from the catalog means a new table can't be silently left out, and the snapshot means a
save mid-backup can't break the restore. Streaming keeps memory to one picture. PGlite tests
restore real migrations and sample rows, and a full restore of the live data was checked once
by hand. Each INSERT names its columns, so restoring into a different schema fails with nothing
written instead of quietly leaving a renamed column empty.
The button is a plain `<a>`: not `<Link>`, which would prefetch the zip, and without `download`,
so an expired login or an error shows as a page instead of being saved as a "backup". `/backup`
checks the login and the admin itself, like every Route Handler, and `actions-guard.test.ts`
checks that it does.

## 2026-10-11 — Bills reach the app through a script in the household Gmail
**Decision:** a Google Apps Script in the My House Gmail sends the billers' emails to
`/api/bill-email` every hour. Bills still going to PA's personal Gmail are forwarded there by a
Gmail filter. The route checks a shared secret, then Gmail's DKIM verdict for the biller's
domain, read from the topmost `Authentication-Results` header only.
**Why:** it's free, needs no new account or domain, and has no size limit (PLDT attaches its
bill as a PDF). Gmail has already verified the sender, so the app can use that result; the
topmost header is the one Gmail's own server adds on arrival, which a sender can't forge. One
script, in one mailbox: no script reads the personal Gmail. Duplicates were already handled
(unique Message-ID, one bill per provider and month), so a bill in both inboxes counts once.
**Instead of:** an inbound-email service (CloudMailin's free plan caps each email at 512 KB;
Postmark charges for inbound), or a second copy of the script in the personal Gmail — the
fallback if forwarded bills fail the DKIM check. (They did; ARC sealed by Google is used instead:
2026-10-30.)

## 2026-10-11 — The backup reminder is tracked in the database
**Decision:** each finished Download backup adds a row to `backups`. The month pages show the
admin a banner while a month was started or closed after the latest row. The zip's file times
are written on Manila's clock.
**Why:** a reminder that remembers backups goes away by itself and works on any device. A
cookie would nag on the laptop after a backup from the phone, and a one-time prompt after Start
next month is easy to dismiss and forget. The row is written only once the whole zip has
streamed, so a failed download leaves the reminder up. Zip times have no timezone and Vercel runs
in UTC, so without the shift a 3 PM backup showed as 7 AM.

## 2026-10-11 — The app connects through the session pooler, not the transaction pooler
**Decision:** `DATABASE_URL` is Supabase's session pooler (port 5432), the same one the scripts
use, instead of the transaction pooler (port 6543).
**Why:** the transaction pooler stops answering when postgres.js sends a query while another is
still running on the same connection. postgres.js does that ("pipelining") for any query
without parameters, and the month page hung for over a minute and then errored. Adding the
backup reminder's query was enough to trigger it, so any future query could have done the same
on the live site. In tests (3 runs, each with 12 queries at once plus a transaction) the
transaction pooler hung every time and the session pooler never did. Turning pipelining off
(`max_pipeline: 0`) stopped the hang but broke transactions, and prepared statements didn't
help.
**Trade-off:** in session mode each connection holds a database connection while it's open.
The app uses one per server instance (3 ran the pool out: "Pages load the history once…", 2026-10-18) and closes
them after 20 s idle; the free plan's pool (about 15) is far more than a household needs.

## 2026-10-11 — Worktrees link `.env.local` instead of copying it
**Decision:** a new worktree gets `.env.local` as a symlink to the main folder's
([commands.md](commands.md#working-in-parallel)); since 2026-10-13 `npm run worktree:new` makes
the link, and one for `.private` too.
**Why:** a copy is frozen at the moment the worktree is made. When the main folder's
`DATABASE_URL` moved to the session pooler (above), a worktree made earlier that day kept the
transaction pooler, so its local server hung on the month page while the live site was fine.
With one real file, a settings change reaches every worktree.
**Trade-off:** the link breaks if the main folder moves or is deleted, which would orphan the
worktrees anyway.

## 2026-10-11 — Housemates send "I paid"; PA confirms
**Decision:** a housemate sends their own payment with the transfer's screenshot; it waits
(`payments.status = 'pending'`, not counted) until PA confirms it, or rejects it with a reason
(kept, never counted). Choices made with PA:
- The screenshot is **required** — it's what PA checks against the bank.
- A rejected payment **stays visible with the reason**, so the housemate knows what to fix.
- PA finds out **in the app** (a "Waiting for you" section and a count on the Settle Up tab) —
  no email to set up or maintain.
- It goes to **the collector only**, in **the latest month**; the server sets both people.
  (Since 2026-10-12 it goes into the House Budget instead; see that entry.)
- **One screenshot per "I paid"** — a Server Action carries one file (`bodySizeLimit`); PA can
  attach more.
- A payment's screenshot is seen only by **PA and the people in it** (a bank screenshot can
  show someone's bank and balance); bill proofs stay visible to everyone.
- **Closing a month, and starting the next one, wait for waiting payments.** In a closed month
  one could never be decided; and the next month's carry-over counts only confirmed payments,
  so it would show the housemate the full amount again, away from the "waiting" note.

**Why:** PA still checks the bank before anything counts, as before, but no longer types every
payment; the housemate gets a record that they paid. It reuses the pending-bill pattern
(skipped by `computeMonth`, blocking `closeCheck`) and the receipts upload.
**Instead of:** housemates' payments counting straight away (nothing to check against), or a
separate table for submissions (a status on `payments` keeps one list and one delete path).

## 2026-10-11 — The month refreshes when you come back to the app, not live
**Decision:** a month page redraws from the server when the app's tab or window comes back
after 30+ seconds away (`useRefreshOnReturn`); no polling, no live updates.
**Why:** moving between tabs keeps the month's header as it was, so a housemate's "I paid" (the
count on Settle Up) or advance only showed after a reload — found while testing "I paid". Coming
back to the app is exactly when PA would look; one refresh then is cheap, keeps typed text and
open dialogs, and needs no server changes.
**Instead of:** polling every few seconds (constant database reads on a free plan), or live
updates (Supabase Realtime: more moving parts for a household app).

## 2026-10-11 — An invite checks the email's domain, and lets it through when unsure
**Decision:** before inviting, `updateMemberEmail` asks DNS whether the part after the @ can
receive mail (`domainTakesMail` in `lib/email-domain.ts`). It refuses only on a definite "no"
(the domain doesn't exist, or has no mail server and no address); a slow or failing lookup
returns "unknown" and the invite goes ahead.
**Why:** inviting sends no email, so a typo in the domain (found with a housemate's address
saved with an extra word after the @) only showed when their sign-in code never came. A DNS
hiccup must never stop PA from inviting someone.
**Instead of:** sending a welcome email on invite (a second email to set up and keep working),
or a list of known providers (blocks anyone on a domain not on it).

## 2026-10-11 — Parallel sessions share one folder and one local site
**Decision:** parallel Claude sessions all work in the main folder, on one shared branch, seen on
one dev server at `localhost:3000`; one PR at the end ships everything. `npm run dev` refuses to
start a second server (`scripts/dev-guard.sh` as `predev`). Worktrees stay for work that needs
its own PR. Replaces "one worktree per session" (2026-10-08); the startup check stays.
**Why:** a worktree per session meant a dev server per folder (3000, 3001, 3002…), and it was
hard to tell which address showed which change. Paul raises one PR per batch anyway, so the
separate branches bought nothing. The 2026-10-08 accident (a session switched branches under
another) is covered by the rule that sessions never switch branches, except off a finished one.
Guards so sessions can't destroy each other's work: Claude's edit tool already refuses to save
over unread changes; a hook blocks git commands that discard changes or switch branches
(`git-guard.sh`); another tells a session when a different session edited the same file in the
last hour (`edit-overlap.sh`, a log inside `.git`). It asked Paul at first; he turned that off
the same day, because the prompts interrupted work and the edit tool already prevents lost
changes.
**Instead of:** one dev server pointed at whichever worktree is current (swapping folders under
a running server), or keeping worktrees and just stopping old servers by hand (the pile-up
comes back with every new session).
**Superseded 2026-10-13:** back to a worktree, dev server and PR per session (below).

## 2026-10-12 — The Helper: whoever hands her money gets it back; her early pay is a debt record
**Decision:** each visit and early pay is a line on a Helper tab (`helper_entries`). The month's
Helper bill is **everything handed to her** (daily pay − what was taken off her debt + early
pay), split equally; each person is credited what they handed over. Her debt (early pay − taken
off) is kept across months, like the sheet's Remaining. Choices made with PA:
- Early pay is **house money**: the giver gets it back the month they give it, not as it's
  worked off. So a month where she borrows more than she works off costs more than her daily
  pay, and later months cost less; over time the house pays exactly her pay.
- **One Helper column**, not a second "early pay" column: in a month where she only works off
  debt, that column would be negative, and bills can't be.
- Housemates log what they paid (like their advances); PA sets the debt carried over from the
  sheet, which counts in no bill (the sheet already settled it).
- A month with no entries keeps a typed Helper total, so the old months don't change.
- The Helper column is marked with `bill_items.kind`, not found by its name, so renaming it
  breaks nothing.

**Why:** the Helper has no fixed day or pay, whoever is home pays her, and the sheet tracked her
early pay by hand; one Helper total with one payer couldn't say who paid what. Crediting what
left each person's pocket keeps the full ledger at ₱0 with no matching up of early pay and
deductions.
**Instead of:** the bill = her daily pay with each deduction credited to whoever gave the early
pay (exact too, but the giver waits weeks to be paid back and the app must match each deduction
to an early pay), or two columns (pay, and early pay − deductions, which can go negative).

## 2026-10-12 — Biller passwords are encrypted by the app and revealed one at a time
**Decision:** the Billers tab ([features/billers.md](features/billers.md)) keeps the billers'
logins and the Wi-Fi details too. A password is encrypted (AES-256-GCM) before it's saved, with
a key (`BILLER_SECRET_KEY`) that lives only in `.env.local` and Vercel; the page never carries
one — Reveal fetches it from `/biller-secrets/<id>`, which checks the login and that it's
shared with the viewer. Every line, passwords included, is shared with housemates unless PA
switches it to admin only.
**Why:** PA wanted the sheet's details, logins included, in one place the household can look
them up. Encrypting means the database, its backups and anyone with database access see only
locked text; fetching on Reveal keeps passwords out of the page's HTML and the browser's cache.
The cost: losing the key loses the passwords, so a copy of it is kept in a password manager.
**Instead of:** plain text hidden from housemates (readable by anyone with the database or a
backup), or no passwords on the site and a shared password manager only (safest, but a second
place to look, and PA wanted it in My House).

## 2026-10-12 — The House Budget is a side of a payment, not a member
**Decision:** housemates pay into the **House Budget** (the collection account, a savings
account PA looks after) and PA pays out of it — to whoever is owed, then the rest to himself
([settlement-rules.md → House Budget](settlement-rules.md#house-budget)). It's one side of a
payment (a NULL `from_member_id` / `to_member_id`), never a member. What it holds is worked out
from the payments, not stored. It may go negative. Money left in it at month close carries
over. Bills stay paid from PA's own account, so they're still his advance.
**Why:** before, a payment "to the collector" counted as PA's money the moment it landed, while
the cash actually sat in the savings account, part of it owed to someone else. Now PA's Final
moves only when money is paid out to him, so the app matches the bank. As a payment side it
takes no shares, needs no login and can't be split into anything; a member row would have needed
exceptions everywhere members are listed. Deriving its balance needs no new column and nothing
to snapshot: closed months' payments can't change. Allowing a negative balance lets PA pay
someone before the money arrives, which happens.
**Migration order:** `0012_house-budget` runs **after** the deploy, not before as usual (the
code already deployed is old, and there's no test database). Until it runs, a House Budget
payment fails on NOT NULL instead of reaching code that can't read a NULL side; the old receipt
route took a NULL side to mean "not a payment" and would have shown the screenshot to everyone.
The route now decides from `receipts.payment_id` (`canOpenReceipt`).
**Instead of:** the savings account as a member (exceptions in every split, list and login
check), a stored opening balance per month (one more number to snapshot and keep in step), or
leaving payments to the collector and only showing an "in savings" note (PA's Final would still
move before the money is his).

## 2026-10-12 — Finished branches are cleaned by a script the startup check points to
**Decision:** `npm run branches:clean` removes local branches whose PR is merged (and that have
nothing committed after the merge), fast-forwards local `main` and prunes `origin/*` names. The
startup check counts what's left and flags a folder sitting on `main`; Claude runs the cleanup
when it's flagged. A new branch still starts per batch of work, not per task.
**Why:** merged branches and a stale `main` piled up with nothing tidying them. Deleting only
branches already in `main` loses nothing, so Claude can run it without asking, unlike
`worktrees:clean`, which deletes folders. A branch per task would have one session switching the
shared folder under the others.
**Instead of:** a Claude agent (it only runs when called; the startup hook already runs every
session), or deleting inside the startup hook (it stays read-only, so it never surprises a
session mid-work).
**Changed 2026-10-13:** a branch per task now, each in its own worktree (below).

## 2026-10-12 — A sidebar instead of a row of tabs
**Decision:** the month pages' sections live in a dark sidebar, grouped "This month" and
"Household", with the month switcher at its top and the account menu at its bottom. Below
desktop width the same sidebar slides in from a ☰ in a slim top bar. The two totals moved into
the page header beside the section's name, which is now the page's visible title.
**Why:** seven sections no longer fit in one row: on desktop the tabs scrolled sideways, and on
phones each got a sliver of the width. A sidebar has room for more sections later. The drawer
gives every section a full-size row on a phone, and the totals stay on screen there without
opening anything. With the title naming the page, the Billers and Receipts intro cards dropped
their own copy of it.
**Instead of:** a phone bottom bar with four sections and "More" (the other three a tap further
away), or the totals in a card at the bottom of the sidebar (hidden on phones until the menu
opens).

## 2026-10-12 — View-only logins: a role that's never in a month
**Decision:** a third role, `view_only`, for family who should see the house's numbers
without being part of them. A view-only member can sign in and sees what a housemate sees,
Billers lines included. They are never given a `period_balances` row: "Add member" skips the
open months for them, and "Start next month" leaves them out. `run()` refuses every change from
them, and the role is set only when they're added. Anyone who was ever part of a month can't
be re-added as view only. They stay on that month's list for good, and an open month (or a
closed one, reopened) would then hold a view-only login half in: on the Split Table with a
Final they can't settle with "I paid". Checking only open months missed the reopened case and an
unpaid Final in the latest closed month, so the rule is "never in any month".
**Why:** a month's membership already decides everything about the money. Every split, Final,
settle-up list and dropdown reads it, so leaving someone off it keeps them out of the numbers
with no change to `lib/settlement.ts`. The server refusal comes first, so a missed button in
the UI can't turn into a change.
**Instead of:** a "shares costs" flag on a member who is still in each month (they'd sit on
the Split Table at ₱0, and every split and settle-up list would have to skip them), or giving
them an ordinary member login (they could log advances and send "I paid").

## 2026-10-12 — Installable app, nothing stored on the phone
**Decision:** My House is installable ([install-app.md](features/install-app.md)): a web app
manifest, PNG icons, a service worker and our own **Install** card. The service worker caches
nothing; its only job is a "No connection" screen when a page load fails. The manifest, worker
and icons are public (in the proxy's skip list). The icons are drawn by a route from
`app/icon.svg` at build time, not committed as image files.
**Why:** housemates use it on their phones; opening it from the home screen, full-screen, beats
finding a browser tab. Chrome only offers to install when the service worker has a real fetch
handler (it ignores empty ones), so the offline screen is a real reason for one that stores no
data. Caching pages would put the household's finances on each phone and needs clearing on
sign-out, so offline viewing waits ([TODO.md](TODO.md)). Our own card because iPhones and the
Messenger/Facebook browsers never show an install prompt: there the card explains what to tap.
"Not now" asks again the next day (30 days was too long for getting the household onto it), and
"Install app" in the account menu brings it back any time. Whether someone installed it is
tracked only in their browser (Chrome knows by itself; iPhones get "I've added it"), not in the
database: no migration for a nudge, and Safari couldn't report it anyway. Browsers fetch the manifest without cookies, so it can't sit behind the login. Drawing the icons
keeps one source for the house and no binary files to regenerate.
**Instead of:** a PWA library (next-pwa / Serwist — built for caching, which this doesn't want
yet), a service worker with no fetch handler (Android would never show the Install button), or
relying on the browser's own prompt alone (nothing at all on iPhone).

## 2026-10-12 — A month locks for housemates once it ends
**Decision:** after a month's last day (Manila), housemates can't add, edit or delete their
advances or Helper entries in it; the admin can until he closes it. "I paid" isn't affected.
**Why:** the reminders tell housemates the month closes at its end, and that should be true:
the admin works out the bills from a month that has stopped moving. Locking only housemates
keeps a late fix possible. Payments come after the month ends (that's when the bills arrive),
so they stay open.
**Instead of:** keeping the manual Close as the only lock (the reminders' "log by the 31st"
would have meant nothing until the admin closed it, often days later).

## 2026-10-12 — Reminders: the household Gmail's SMTP, run by Vercel's cron
**Decision:** emails are sent with nodemailer over the My House Gmail's SMTP, with an app
password of their own; Vercel's daily cron (`vercel.json`) runs `/api/reminders` each
morning, Manila time. Each email is claimed in `reminder_sends` before it's sent, and the job sends the
latest reminder the month has reached, so a missed day is caught up. Only the live site emails
housemates and records sends; localhost redirects every email to `EMAIL_TEST_TO`.
**Why:** the Gmail already sends the sign-in codes, so no new service or own domain (Resend can
only email others from a verified domain). A second app password means revoking one never
breaks the other. Vercel's cron runs with the app and its env vars; GitHub Actions' schedules
switch off after 60 days without commits. Claiming first stops a cron delivered twice from
double-sending. The safety switch is needed because localhost and the live site share one
database: a test would otherwise email the real housemates, or mark a real reminder as sent.
**Instead of:** Resend (needs a domain), a Google Apps Script timer in the Gmail (the month
data is in the app, so it would need an API of its own), GitHub Actions.

## 2026-10-12 — What a housemate still owes, after their bill email
**Decision:** worked out on each page load from the bill's month: its Final, less the
housemate's waiting "I paid"s and what they paid into the House Budget in later months
(`payablesIn`). Nothing about the amount is stored; `reminder_sends` only says the email went.
**Why:** "I paid" goes in the latest month, and by the time bills go out the next month has
usually started, so the bill's month's Final alone never drops when they pay. Working it out
fresh means the banner goes as soon as the admin confirms a payment, and a resent bill or an
edited month can't leave a stale amount behind.
**Instead of:** storing the emailed amount and counting payments made after it (breaks when a
payment waiting at send time is confirmed later), or the latest month's Final (mixes in the
new month's own spending).

## 2026-10-12 — The next month starts by itself; email and close stay the admin's, with nudges
**Decision:** the daily job starts the next month the morning after the latest one ends, with
the same code as the Start button (`lib/month-start.ts`); when it can't, the admin is emailed
why, once, and it retries daily. Emailing everyone their bill and closing a month stay buttons,
but the admin gets a banner and one email when each is ready (every bill in; then everyone
settled and closing allowed).
**Why:** starting needs no judgment — it follows fixed rules and already refuses itself when it
shouldn't run — and with the month lock, housemates need the new month on the 1st. Emailing the
bill tells people what to pay, and closing freezes the numbers for good: both are worth a look
first, so the app only says when it's time. Off the live site starting is a dry run, since
localhost shares the database.
**Instead of:** a "start November" reminder every month (a chore with no decision in it), or
sending bills and closing automatically (no chance to catch a wrong amount).

## 2026-10-12 — The admin sees who's using My House, app or web
**Decision:** each signed-in page reports "installed app or browser" and a coarse device type
to `/api/seen`; Manage shows PA each housemate's **Last seen** and an **app installed** badge
([manage.md](features/manage.md)). One row per member × app/web × device type
(`member_devices`), updated at most every 5 minutes. No note to housemates (PA's choice).
**Why:** PA wants to know who has installed the app and who still uses it. Supabase only knows
the last *sign-in*, which can be weeks old because sessions renew quietly. Only the browser can
tell the installed app from a tab, and an iPad from a Mac, so the page reports both; the server
can't. A row per device instead of a visit log keeps the table tiny and says what's needed (when,
from where), not a history of everyone's comings and goings. Coarse device types, no user agents
or IPs: enough to read "App on iPhone", nothing more about anyone's phone.
**Instead of:** Supabase's last sign-in (stale), a log row per visit (grows forever, more than
needed), or tracking per Server Action (misses people who only look; view-only logins never call one).

## 2026-10-13 — The "How it works" FAQ is grouped and written for housemates
**Decision:** the FAQ is four groups (Paying and settling up, How the costs are split, Emails
and the app, Less common), each its own accordion, with jump links under "Your part each
month". Overlapping questions were merged (18 → 14), a question on installing the app was added,
and admin-only detail (Bill Inbox, Discard, reopening, the order months close in, recording a
payment directly) was taken out. Any change to what housemates see or do checks its question
(CLAUDE.md; docs-keeper flags it).
**Why:** one flat list of 18 questions was too much to scan, and the readers are the
housemates: the admin has the feature docs. The questions the Split Table links to (`#equal`,
`#points`, `#shared-advances`, `#month-final`) kept their ids.
**Instead of:** tabs or a separate admin section — tabs hide the rest of the page from a quick
scroll, and the admin's detail already has a home in `docs/features/`.

## 2026-10-13 — The Split Table's header is pale amber, and Final is its highlight
**Decision:** the header row went from a solid amber-300 bar to amber-100 with dark amber text,
and the Final column's tint went up a step (`headCell`, `finalCol` in
`components/split-table.tsx`).
**Why:** the bright bar was the loudest thing on the page, louder than the greeting and the stat
cards, where amber is otherwise a light accent (pale tiles, thin borders, amber text). It
pulled the eye to column labels read once, and drowned out the Final column, the answer most
people look for. The pale head still reads as the sheet's yellow header.
**Instead of:** keeping the sheet's bright yellow, or a plain grey head (loses the link to the sheet).

## 2026-10-13 — Swipe in from the edge for the phone menu, detected rather than a swipe strip
**Decision:** on phones a swipe right that starts near the left edge (`EDGE_PX` in
`lib/edge-swipe.ts`) opens the menu, picked up by passive touch listeners on the page; the menu
then slides in. Dragging it back left closes it, following the finger (Base UI's `Drawer`, in
`components/ui/sheet.tsx`).
**Why:** Android's own Back gesture owns about the first 30 px of the edge, so the swipe has to
be able to start further in. Base UI's `Drawer.SwipeArea` is a strip that catches every touch on
it: one wide enough to reach would stop taps on the first column of the page. Passive listeners
block nothing; swipes that scroll a wide table back, select text in a box, or start in a dialog
are left alone.
**Instead of:** Base UI's swipe strip (the menu would follow the finger while opening too, at the
cost of those taps).

## 2026-10-13 — No pull-to-refresh inside the installed app
**Decision:** `overscroll-behavior-y: none` on the page inside the installed app only
(`app/globals.css`); a browser tab keeps pull-to-refresh.
**Why:** a stray pull while scrolling up reloads the page and wipes what was typed. It isn't
needed for fresh data or new versions: saves redraw the page, tab switches load fresh, coming
back after a while redraws the month, and after a deploy the next navigation reloads the whole
page ([install-app](features/install-app.md)).

## 2026-10-13 — One worktree, dev server and PR per session
**Decision:** every Claude session works on one task in its own worktree, branched fresh from
`origin/main` (`npm run worktree:new`), and raises its own PR. Raising it includes merging
`origin/main` first, then checking GitHub's merge state and fixing conflicts. The main folder
stays on `main`. `npm run dev` gives a worktree the first free port from 3001 and puts its name
in the tab title (`[name] My House`); the session gives Paul the link. The guard hook now
allows only `git switch main`. `edit-overlap.sh` warns across worktrees (same file = a likely
PR conflict). Claude runs `worktrees:clean` itself, which stops a finished worktree's dev server
first. Replaces "parallel sessions share one folder" (2026-10-11).
**Why:** in practice each session works on a different feature. In one shared folder they
stepped on each other, and one PR mixed unrelated work. Separate folders make overwriting each
other impossible rather than guarded against, and each feature ships when it's ready. The old
complaint about worktrees, not knowing which address showed which change, is answered by the
link each session gives and the tab label. Merging `main` (not rebasing) avoids force-pushes on
open PRs. Removing a merged, unchanged worktree loses nothing, so it no longer waits for Paul.
**Instead of:** worktrees inside the repo (`.claude/worktrees/`, Claude Code's default — the
main folder's TypeScript, ESLint and Vitest would pick up their files), Vercel preview links
instead of local sites (login redirects and the one live database not set up for them), or
`backups/` linked into worktrees (it holds real data; backups run from the main folder).

## 2026-10-13 — An emoji per person instead of photos
**Decision:** each person's colour dot can become an emoji (`members.emoji`), typed or pasted on
Manage by the admin for anyone, or by a housemate for themselves from the account menu
(`updateMemberEmoji`, `canSetEmoji`). One emoji only (`parseEmoji`); empty brings the dot back.
**Why:** it makes the app personal while staying clean. Sticker-style photos were built first
(migration `0017`) and felt busy at the size they're drawn; the household's photos were small and
blurry too. An emoji stores no faces at all, so the public repo and the backups hold nothing
sensitive. There are no files, no route and nothing to cache, and letting housemates choose their
own is a small, safe permission. `0018` dropped the photo table (nothing shipped used it; backed
up first).
**Instead of:** sticker photos in the database behind the login (tried; busier, and faces to
look after), or a fixed emoji picker (typing any emoji is simpler and gives every choice).

## 2026-10-13 — The House Budget's emoji lives in a one-row settings table
**Decision:** the House Budget gets an emoji too, set by the admin on Manage and kept in
`household_settings.house_budget_emoji`, a one-row table (like `keep_alive`). Empty keeps its bank icon.
**Why:** the House Budget isn't a member (it's the NULL payment side), so it has no row to put an
emoji on. A household-wide settings row makes it editable in the app, is backed up like every
table, and gives later household-wide settings a home. Admin only: it's PA's account.
**Instead of:** a constant in `lib/household-config.ts` (a code change and a deploy each time), or
a fake member row for the House Budget (it would join months and the money math).

## 2026-10-13 — View-only logins hear once when the bills are in
**Decision:** with Settle Up's "Email everyone their bill", each active view-only login with an
email gets a short, warm "October's bills are in!" note and a link to the month's Split Table.
It goes once per month (a resend doesn't repeat it), has no amounts, and is recorded as its own
`reminder_sends` kind, `bills_in` (migration `0020`).
**Why:** view-only logins are family who like to keep an eye on the house, with nothing to do.
The bill email is when a month's numbers are checked and final, so that's the moment worth
telling them, and once is enough. There are no amounts because they can see everything in the
app, and an email can be forwarded. A separate kind keeps the `payables` rows meaning only "a
housemate was sent their bill", which drives "Last sent", the housemates' "✓ sent", the admin's
nudge and their banner.
**Instead of:** a note each time a bill lands (many emails, with numbers still pending), a
separate button (one more thing to remember), or reusing the `payables` kind.

## 2026-10-13 — No proof card for the Helper
**Decision:** the Receipts tab leaves out the Helper bill's card, unless it already has a proof.
**Why:** her bill isn't one payment with one screenshot. It's every visit and early pay, handed
over by whoever was home, and the Helper Visits tab already records each one with its payer. Her card
could only ever say "No proof attached yet".

## 2026-10-13 — Settle Up's Compact view is a cookie on the phone
**Decision:** Who still owes gets a Compact / Normal toggle on phones, remembered by a cookie
(`COMPACT_COOKIE`) that the browser writes and the Settle Up page reads. Each phone keeps its own
choice; wider screens ignore it. The amber "holds ₱… so far" note under House Budget payouts went
too: the box above the list already says what the House Budget holds.
**Why:** it's a display choice for a small screen, so per device is the right scope. The server
reading it means a compact phone is compact from the first paint, with no jump. It holds only
"1", no household data, so it fits "nothing stored on the phone" (Installable app, above).
**Instead of:** `localStorage` like the Install card (the page would draw Normal first, then jump,
on every load), or a member setting in the database (a migration and backup coverage for a layout
preference, and one choice for both phone and laptop).

## 2026-10-13 — Unpaid bills get a reminder after a few days, then weekly, until paid
*Updated 2026-10-26: every 4 days, not weekly (below).*
**Decision:** a housemate with part of their emailed bill still unpaid is emailed a reminder a few
days after the bill email, then weekly (`UNPAID_REMINDER_DAYS`), by the daily job
([reminders](features/reminders.md)). It's counted from their latest bill email, so sending it again
starts the count again. Closing the month doesn't stop it; emailing the next month's bill moves it
on to that one. The admin gets no copy; Settle Up's bill-email box shows when each was reminded.
**Why:** after the bill email, only the in-app banner kept reminding, and only when they opened the
app. A first nudge soon, then a slower one, reminds without nagging daily. Closing a month doesn't
settle anyone (unpaid amounts carry over), so stopping there would let a debt go quiet; the next
bill already includes what's carried over, so following it means one amount in one email. The
admin can already see who's paid on Settle Up, so a copy would only fill his inbox.
**Instead of:** a single follow-up (easy to miss, then nothing), or every few days (too naggy over
a long wait).

## 2026-10-13 — The split table's name column narrows once scrolled, on phones
**Decision:** on phones, scrolling the split table sideways folds the first column down to the
emojis and short labels ("OCT", "Due", "Paid"), and scrolling back to the start brings them back.
It's pure CSS on the scroller's existing `data-scrolled-left`, animating a `max-width` measured
from each label (`Squeeze` in `components/split-table.tsx`), and the scroller turns off scroll
anchoring.
**Why:** the names only matter until you start reading across; folded, the column takes about
a third of the room, so more bill columns fit on a phone. The width is measured because names can
be up to 40 characters: a fixed cap would cut long ones or make the animation lag. Without scroll
anchoring off, the browser could pull the scroll back to the start as the column narrows, which
widens it again, back and forth. Wider screens have the room, so they keep the full column.
**Instead of:** the `grid-template-columns: 0fr → 1fr` trick (the table could squeeze names even
when not scrolled) or a narrower column all the time (names are what you look for first).

## 2026-10-13 — Housemates' emails sound happy too
**Decision:** the month-end reminders, the bill email and the still-unpaid reminder use the same
warm tone as the view-only note: an emoji in the subject, "Hi Ben! 👋", an upbeat line and
"Thanks for keeping the house running! 🏠" before the sign-off. The still-unpaid one is a
"friendly reminder". The amounts, the To do and the link are word-for-word what they were. The
admin's emails stay plain.
**Why:** it's a household, not a billing office. A cheerful email reads as a nudge from home
rather than a demand, and makes paying feel like chipping in. Keeping the money lines exact
means the tone never blurs what to pay or how. The admin's emails are to-do notes to himself.
**Instead of:** keeping only the view-only note warm (family got a nicer email than the people
who actually pay), or HTML emails with colours (plain text reads the same in every mail app).

## 2026-10-13 — Cards fade in with plain CSS, not view transitions
**Decision:** when a tab's cards replace its loading placeholder, they fade up 6px one after
another (~350 ms each, 60 ms apart): a CSS animation on the children of `PageEnter`
(`components/page-enter.tsx`, `.page-enter` in `app/globals.css`). Reduced motion keeps the fade
and drops the movement.
**Why:** a CSS animation runs when an element first appears, which is exactly when the cards
arrive, and not after a save (React updates the same elements). It behaves the same in every
browser. Over ~400 ms starts to feel like waiting on screens used many times a day.
**Instead of:** React's `<ViewTransition>` (snapshots the whole page, blocks taps while it runs
unless turned off, behaves differently in Safari), or a `template.tsx` (it wraps the loading
placeholder too, so it would animate the placeholder and the cards would still pop in).

## 2026-10-13 — Switching months keeps the page; each tab has its own placeholder
**Decision:** no `loading.tsx` above the month layout. A month switch keeps the current month on
screen until the new one is ready, with a spinner on the arrow or month tapped (`useLinkStatus`).
Each tab has its own `loading.tsx` shaped like it; the Split Table moved into a `(split)` route
group to get one.
**Why:** the old `app/periods/loading.tsx` sat above the layout, so it replaced the sidebar
(the menu just tapped) with grey bars. A single placeholder under the layout covered every tab,
so it couldn't know which one was coming, and two-column tabs jumped when they loaded.
**Instead of:** loading the sidebar's data outside the month layout (a big rework). Cost: opening
the app cold shows the browser's own loading until the month is ready, rather than a grey frame.
(The installed app now covers that wait with a launch screen: 2026-10-16.)

## 2026-10-13 — Phones: 16px inputs and bigger buttons on touch screens
**Decision:** inputs use 16px text below the `md` breakpoint (`max-md:text-base` in
`InlineInput`), and buttons get bigger sizes under `pointer-coarse:` (touch screens) in
`components/ui/button.tsx`.
**Why:** iPhone zooms the page into any input under 16px when it's tapped. The compact buttons
(24–36px) are fine with a mouse but small for a finger; `pointer-coarse` makes them bigger on
phones and iPads only, so desktop keeps its density.
**Instead of:** `maximum-scale=1` in the viewport (stops the zoom, but also blocks pinch-zoom on
Android), or bigger buttons everywhere (wastes room on desktop).

## 2026-10-15 — The Advances Log's column filter lives in the URL
**Decision:** a shared column's total on the Split Table links to `advances?column=<id>`, and
the log reads its column filter from the URL (`useSearchParams`), writing it back with the
native `history.replaceState`. Search, payer and category stay ordinary component state.
**Why:** the column filter is the one that other pages link into. Next keeps the log mounted
when only the query changes, so state seeded once from the URL went stale: the sidebar's
Advances link would leave the log filtered. With the URL as the only source, the address bar,
a refresh and every link agree. `replaceState` updates `useSearchParams` without fetching the
page again.
**Instead of:** `router.replace` (fetches the whole month again on every change), or putting
every filter in the URL (more to keep in step, for filters nothing links to).

## 2026-10-15 — "This month" is the newest month that exists
**Decision:** the "Back to <month>" link under the month picker (`BackToLatest` in
`components/period-nav.tsx`), like the house icon and `/`, goes to the newest month in the
database, not the calendar month.
**Why:** the next month starts the morning after the latest one ends, so for a few hours
around the 1st the calendar month doesn't exist yet. The newest month always does.

## 2026-10-15 — "Last paid" is in the greeting, for your own payments only
**Decision:** while a housemate still has some left to pay, the greeting adds "Last paid Aug. 12
· 2 months ago": their latest confirmed payment from any month, to anyone (`lastPaidOf`).
Months are whole months (Sept. 30 → Oct. 1 is 0, so it shows just the date). With no payment on
record there's no line.
**Why:** a gentle nudge works best where only that person sees it, so nobody is shown as behind
in front of the others. Payments to someone other than the House Budget still count, because the
rules allow them. Payments from the Google Sheet days aren't in the app, so "never paid" could be
wrong.
**Instead of:** a "last paid" note under each name in Who owes what or in the table (everyone
sees everyone's), or counting months since the debt began (someone paying part of every month
would still look behind).

## 2026-10-16 — Spending Trends: stacked bars, insights worked out by the app
**Decision:** a Trends tab ([features/trends.md](features/trends.md)) shows the last 1, 3 or 6
months as stacked bars (a block per bill column and per advance category), a Where it went
table and insights, all worked out by `lib/trends.ts`. Choices made with PA:
- **Stacked bars**, drawn with shadcn's chart component on Recharts (the first chart library in
  the app). One picture answers both "is it going up?" and "what's driving it?".
- **Everyone sees it**: helping the household spend wiser is everyone's business, and housemates
  already see every amount it's made from.
- **Insights by fixed rules**, not an AI summary: free, instant, nothing sent to another service,
  and testable.
- **Complete months only** feed the totals and insights: closed, or ended with every bill in (the
  Helper's ₱0 aside). Others are drawn faded. **1 month** on a month still coming in steps back
  to the newest complete one (and says so), since that's the view people tap first and the
  current month alone would be nearly empty.
- **1, 3 and 6 months** for now; 12 waits until there's about a year of months
  ([TODO.md](TODO.md) → Ideas).
- **Bills are matched across months by column name**; a series keeps its colour by its place over
  the whole loaded history, not the range.

**Why:** bills arrive after their month ends, so the newest month nearly always looks cheap:
comparing it would say spending fell when it hadn't. Closing alone wasn't enough, since it's
done by hand and can lag weeks. There's no bill template table, and new months copy columns by
name, so the name is the one key that carries over (a rename starts a new series). Colours by
rank would repaint the same bill when the range changes.
**Instead of:** a line chart (tangled with many series, weak for one month), a donut (hides the
change month to month), an AI-written summary (an API key, a cost per view, household data sent
out), or comparing every month including the open one.

## 2026-10-16 — Trends on a phone: a panel instead of the tooltip, a toggle instead of a column
**Decision:** below `sm`, tapping a bar shows its amounts in a panel under the chart (starting on
the newest complete month) instead of the floating tooltip, and Where it went shows one amount
column with a **Total | Per month** toggle in the card's corner. Desktop keeps the tooltip and
both columns. The panel follows Recharts' own tooltip state (`useActiveTooltipLabel`).
**Why:** on a phone the tooltip covered nearly the whole chart, the bar tapped included, and two
amount columns pushed the table past the card. Recharts runs `onClick` before it has caught up
with a tap, so reading the bar from it could show the one tapped before.
**Instead of:** a smaller tooltip with just the total (still covers bars, loses the breakdown),
nothing on a tap (no way to see one month's amounts on a phone), or a table that scrolls
sideways.

## 2026-10-16 — Trends switches range in the browser, all three sent at once
**Decision:** the Trends page works out 1, 3 and 6 months in one go (`getAllTrends`) and the
page (`components/trends.tsx`, now a Client Component) shows the one in `?range=`, read with
`useSearchParams` and written with `history.replaceState`, like the Advances Log's column filter.
**Why:** picking a range used to reload the page (skeleton, then fade-in), so it felt slow and the
highlight couldn't slide. Every range already needed the same 12 loaded months and the math is
pure and quick, so sending all three costs one query and a little data. replaceState keeps the
URL (refresh and links work) without a history entry per tap, so Back leaves the tab.
**Instead of:** `router.push` inside a transition (keeps the old page up, but still waits on the
server each time), or three server-rendered copies swapped by a small client wrapper (three times
the page sent, and the chart rebuilt on every switch).

## 2026-10-16 — The installed app opens on a static launch screen
**Decision:** the manifest's `start_url` is `/open` (`app/open/page.tsx`), a static page with no
data or login (the proxy skips it) showing the house, the name and a sweeping line. It moves on
to `/` with `router.replace`, so it stays up until the month is ready.
**Why:** the phone's own start-up screen (Android: the install icon drawn big; iPhone: blank
white) stayed up for the whole cold open — login check, latest month, redirect, the whole month.
A static page arrives at once and ends that screen; an in-app navigation keeps it on screen, still
animating, until the month replaces it. It covers the cold-open cost of having no `loading.tsx`
above the month layout (2026-10-13) without one.
**Instead of:** shrinking the install icons (the wait stays, and the home-screen icon shrinks
too), start-up images (Android has none for web apps; iPhone needs one per screen size and shows
a still picture), or streaming the month layout (a big rework). Cost: iPhones that added the app
before keep opening `/` until they re-add it.

## 2026-10-16 — Push notifications: Web Push, alongside email, only when something's due
*Updated 2026-10-26: every housemate email now pushes, the early month-end reminders too (below).*
**Decision:** the installed app (and browsers) can get push notifications, sent with the
`web-push` library and our own VAPID keys (`lib/push.ts`), opt-in per device. They go out
**alongside** the emails, never instead, and only where something is due soon: the last-day
reminder, the bill, still unpaid, "I paid" confirmed or rejected; for the admin, a housemate's
"I paid", a bill email, the nudges (`PUSHES` in `lib/push-messages.ts`). No amounts, and no
rejection reason, in any push. A reminder's push goes out only after its email has. Subscriptions
record whether they were saved on the live site, and only those get its pushes.
**Why:** Paul asked whether the PWA could notify phones: it can — Android always, iPhones from the
home-screen app — and two moments had no email at all (a housemate's "I paid" for the admin, the
admin's answer for the housemate). Pushing every email too would buzz twice for the same thing,
so the early month-end reminders and the view-only note stay email-only (about 3–4 pushes a month
for a housemate who pays on time). Emails stay because a push can be turned off, blocked or
missed, and they carry the amounts. The lock screen is public, so amounts stay in the app and
email. Pushing after the email keeps the "sent once" claim untouched: a failed email gives its
claim back and is retried the next day, so a push sent before it would be sent twice. One
database: without `live`, a subscription made on localhost would get the live site's pushes.
**Instead of:** Firebase Cloud Messaging or OneSignal (another account and SDK, and a third party
holding the household's device list, for what the browsers' own push services do for free), or
replacing the reminder emails with pushes for people who turn them on (a push that doesn't arrive
can't be noticed, and the emails hold the amounts).

## 2026-10-17 — No connection: saves wait and go through by themselves
**Decision:** with no connection, a save or a move to another month waits and runs once the
connection is back, using Next's `experimental.useOffline`; a **No connection** strip
(`components/offline-banner.tsx`) shows meanwhile ([offline.md](features/offline.md)).
**Why:** before, a save with no connection threw into `app/error.tsx`: the whole page became
"Something went wrong" (with a hint about Supabase being paused, the wrong lead), and what was
typed was lost. Housemates use My House on phone data that comes and goes; waiting means nothing
is retyped, and it's one setting plus a strip rather than changes to every form. Accepted risks:
the setting is experimental (the kill switch is turning it off); a save waits only while the page
stays open (the strip says to keep it open); and if the connection drops after the server saved
but before the answer arrived, the save is sent again — rare, and the extra entry can be deleted.
**Instead of:** failing at once with "No connection — not saved" next to each form (every save
call wrapped in a helper, and the housemate has to remember to retry), or a queue that saves
while the app is closed (needs storage on the phone and conflict handling; part of offline
viewing in [TODO.md](TODO.md)).

## 2026-10-18 — Pages load the history once (and stay at 1 connection per instance)
**Decision:** a page loads the whole history (`loadPeriods` in `lib/periods.ts`) once, shared
through React's `cache()` by the month view, the bill banner and the admin's nudge. The month
layout asks for those notices together with the month view rather than after it, and the Manage
page runs its queries together. ~~On the live site each server instance keeps up to 3 database
connections~~ — **reverted the same day: 1 everywhere** (`db/index.ts`). With 3, a burst of
deploys (six Dependabot merges in 20 minutes) ran the session pooler out ("EMAXCONNSESSION: max
clients reached … pool_size: 15"): Vercel runs several instances per deployment, and old
deployments' instances still held theirs while new ones started, so pages failed to load for a
few minutes. One connection still runs a page's queries side by side (postgres.js pipelines
them); the gain that mattered was loading the history once.
**Why:** a month page loaded the whole history 2–5 times (once per notice, twice for an older
month), in 5–6 steps one after another, and it grows every month. React's `cache()` only remembers
while a page is drawn, so a Server Action or the daily job still reads afresh, and a transaction
never uses it. (The 3 connections were for requests served at once on one instance; not worth
running the shared pool dry — see above. Raising it needs Supabase's pool size raised first.)
**Instead of:** Next's `cacheComponents` / `'use cache'` (keeps data across requests, but needs
tags refreshed by every action: more work for less extra gain at this size), or loading only the
months a page needs (carry-over needs every earlier month anyway).

## 2026-10-18 — Changes take a shared lock on their month, so closing waits for them
**Decision:** every way of writing into a month takes `FOR SHARE` on the month's row before
checking it's open: the month actions' changes (`loadOpenPeriod`: advances, Helper visits, bills,
columns, payments, receipts), adding or removing someone (`openPeriods`, each open month) and a
bill email (`fillColumn` in `lib/bill-import.ts`). Closing (`closeMonthIn` in `lib/month-close.ts`)
and `reopenMonth` take `FOR UPDATE` first on the month and the months either side
(`lockPeriodAndNeighbours`). All guard-tested.
**Why:** closing locked the month, but changes only read its status. Something saved in the same
moment as a close could pass the "is it open?" check, then be written after the close saved
everyone's Finals: an advance missing from what carries over, a pending bill stuck in a closed
month, or someone removed so the next month's opening balances no longer sum to ₱0.00. A shared
lock lets changes save side by side, but a close waits for them and they wait for it. The
neighbours: closing checks the month before is closed and writes the month after's openings, and
reopening checks the month after is open, so closing one month and reopening the one before in
two tabs could otherwise both go through. No deadlock: only close and reopen write a month's row;
every `FOR UPDATE` on a month comes first in its transaction (nothing upgrades a shared lock);
months are always locked oldest first; and months, then the Helper lock, come before members'
rows (adding or removing someone calls `openPeriods`, and removing `lockHelper`, before locking the
member, since starting a month, "I paid" and Helper changes hold those and then refer to
members). Cost: a change waits a moment while the admin's page checks whether the next month can
start (`startBlockReason`).
**Instead of:** `FOR UPDATE` in every change (housemates saving at once would queue for no
reason), or the serializable isolation level (every action would need to retry on conflicts).

## 2026-10-18 — A toast after a dialog saves; the rest of the UI audit
**Decision:** a dialog that saves closes with a short toast ("Advance logged") from Sonner
(`components/ui/sonner.tsx`, `<Toaster />` in `app/layout.tsx`), set per dialog through
`useDialogForm`'s `saved`. Top centre, so it never covers the install or notifications prompts at
the bottom. "Save & add another" keeps its own "Logged …" line instead. Error text is
`role="alert"` everywhere, InlineInput's save is announced from a `role="status"` region, reduced
motion keeps the pop-ups' fade but drops their zoom and slide (`app/globals.css`), empty lists use
one `EmptyState`, and the Split Table's smallest text and scroll arrow are bigger or darker. The
sidebar's grey group labels stay as they were (zinc-500, kept by choice: Paul preferred the
original look to the lighter, higher-contrast one). Cards: every card's title is 16px
(`text-base font-semibold`, as "Who owes what" already was) and every card has 20px inside
(`p-5`, phones too: Settle Up's and "Who owes what" were 16px there), Paul's pick.
**Why:** a dialog that just closes leaves you wondering whether it saved, and screen readers
announced neither a save nor an error. Sonner is shadcn's toast: its live region is built in and it
stacks and dismisses itself. Inline inputs' focus ring is amber-600, the first amber with 3:1
against white (2026-10-09, text contrast). They use `focus-visible` like the tabs, though a text
field counts as visibly focused however it's reached, so a tap shows the ring too, which typing needs.
**Instead of:** a home-made toast (the same live region and timing to write and look after), or
a "Saved" line inside the dialog (it closes straight away).

## 2026-10-18 — The daily job pings a health check, so a failure reaches the admin
**Decision:** after each run, `/api/reminders` pings a free healthchecks.io check
(`HEALTHCHECK_URL`), or its `/fail` address when an email couldn't be sent or the run threw. The
service emails the admin on a failure, or when no ping arrives by the deadline. Only the live site
pings; the ping is a plain GET with nothing in it.
**Why:** the job starts each month and sends every reminder, and nothing said when it broke: it
answered 200 with failures listed in a response nobody reads, and a crash (Supabase paused, a bug)
was a 500 in Vercel's logs. The only sign was a "sent" line on Settle Up that stopped moving. A
"no ping" alert also catches the job not running at all, which no error inside it can. It comes
from outside the household Gmail, since Gmail is one of the things that can break it. Nothing
personal leaves: the run's outcome lists names, so the ping carries none of it.
**Instead of:** emailing the admin from the job itself (it can't when Gmail or the database is
what failed, and can't notice a run that never happened), Sentry (catches errors, not a missing
run; kept as an idea in TODO.md), or a Vercel log drain or alert (paid plans).

## 2026-10-18 — Dependabot PRs, a build in CI, and Next's notes through `@AGENTS.md`
**Decision:** Dependabot opens grouped update PRs weekly (`.github/dependabot.yml`; how to handle
them: operations.md → Dependencies). CI runs `npm run build` after the tests, with placeholder
settings. `CLAUDE.md` ends with `@AGENTS.md` instead of a copy of Next's agent-rules block.
**Why:** Next.js, React and nodemailer are pinned to exact versions, so security fixes only
arrived when someone remembered to bump them; grouping keeps it to a few PRs a week, and major
updates come alone because they may need code changes. A page that only fails when built showed
up first as a failed Vercel deploy after merging; the build needs no secrets because every page
needs a login, so nothing is fetched at build time (the database client connects lazily), which
keeps the public repo's CI secret-free. Next 16.4's `next dev` writes its notes to `AGENTS.md`
only and stopped updating `CLAUDE.md`; Claude Code reads `CLAUDE.md`, and an `@` import there
pulls `AGENTS.md` in, so the notes stay Next's own and current.
**Instead of:** Renovate (more setup, same result here), real secrets in CI (the Actions logs of
a public repo), or copying Next's block into `CLAUDE.md` by hand (goes stale with each version).

## 2026-10-18 — Database tests run the real code on PGlite, through a mocked `@/db`
**Decision:** closing a month, starting the next, bill-email import and the daily job are tested
against PGlite (Postgres inside the test, with the real migrations) by swapping what `@/db`
exports with `vi.mock` (`lib/test-db.ts`, [testing.md → Database tests](testing.md#database-tests)).
Closing moved out of the Server Action into `lib/month-close.ts` (`closeMonthIn(tx, …)`, like
`startNextMonthIn`), so a test can call it with its own transaction; the action keeps the login
check. The August loader moved from `scripts/seed-august.mts` into
`lib/__fixtures__/load-august.ts`, shared by the seed and the tests.
**Why:** these four write to the one live database, and a bug there (wrong carry-over, a bill
stuck pending, a reminder sent twice) would land in real data. The pure tests cover the rules
around them, but not the queries, locks and unique indexes. PGlite needs no secrets and nothing
to install, so CI runs them too.
**Instead of:** a test database (there's none by choice: one database), or passing the database
into every function (`lib/reminder-send.ts` and friends read `db` directly; a mock swaps it
without changing them). PGlite has one connection, so races (two crons at once) stay
guard-tested rather than run.

## 2026-10-21 — "Seen" on the bill-email box means "opened a month page since"
**Decision:** the bill-email box on Settle Up shows "· seen Nov. 1" once a housemate (or view-only
login) has opened a My House month page after their bill email, or "· not seen yet"
([reminders.md](features/reminders.md)). The month page reports it from the browser once it's on
screen (`BillSeen` → `/api/seen`), with the time the server drew it (`drawnAt`); only emails sent
before that count. Bills already sent when this shipped were filled in from each member's latest
`member_devices` visit, so their date is the latest visit, not the first. Housemates aren't told
on screen, like Last seen (PA's choice, 2026-10-12).
**Why:** PA wants to know whether the bill reached them. Every month page shows "Your bill is
ready: ₱X to pay" while they owe, and a login is needed, so a month page opened after the send
means they've seen it. Reporting from the browser counts only a page actually shown; `drawnAt`
leaves out a page from before the send (an old tab coming back, back/forward).
**Instead of:** email open tracking (a hidden image: Apple Mail "opens" everything itself, others
block images, and it's spying on housemates); writing it while the server draws the page (a link
prefetch draws it without anyone seeing it); the every-page Last seen ping (an old tab coming back
into view may show a page from before the bill); flagging bounced emails (they land in the
household Gmail; not worth it for a handful of fixed addresses).

## 2026-10-21 — The Advances tab's totals tie out
**Decision:** the Advances Report adds up the log two ways: the "Advances Shared Report" became
"Advances by Category" with Bills as a row (bills paid count as advances, as in Own Adv), and
Out-of-Pocket by Person got a Total; both equal the log's total. Each person's group in the log
shows their total. Bill rows keep the "Bills" category pill, but their Column cell reads
"Own column" in plain text, and the bills filter is the Category one (the Column filter lists
only advance columns).
**Why:** so housemates can see everything adds up without doing the math. Bill rows said
"Bills" twice, and a bill isn't in an advance column: each has its own on the Split Table.
The advances-only figure isn't lost: it's the header's "Shared advances", and with "Total core
bills" beside it they make the same total.
**Instead of:** a shared-advances-only card with "+ Bills paid / = Out-of-pocket" lines under it
(tried first: it explained the gap, but treated bills as something other than an advance).

## 2026-10-21 — Trends: a row opens to what's in it; Where it went comes first
**Decision:** tapping a row in Where it went opens its items under it
([features/trends.md](features/trends.md)): the purchases for an advance category, a bill's
months, what Other folded. They come from the counted (complete) months only, so they add up to
the row's Total. Where it went now comes before Insights, with each row's share drawn as a thin
bar. Smaller fixes from the same review with PA: "Per month" became "Monthly avg"; the month
still coming in is explained under the headline instead of under the chart; on a phone the bars
other than the panel's month dim, and a line under the chart says the bars can be tapped
(hovered on a computer); the per-person insight is to the peso; and Recharts 3's focusable bar
layer (`recharts-zIndex-layer_*`) gets no outline, which had drawn an amber box on every click.
A month still coming in can be *looked at* but still isn't counted: an open row lists its items
after the counted ones, as "so far · not counted yet" (`BreakdownRow.soFar`), only under rows the
table already has (no ₱0 rows). On the phone's top bar the month switcher no longer keeps an empty
arrow's place on the newest month, so what shows is centred (the sidebar card still keeps it).
**Why:** "where does our money go" is the page's question, and the table answers it best: it's
already the chart's text version, a row is easy to tap on a phone, and the totals stay in view
while a row is open. Items over the counted months only keep the list and the Total in
agreement; "so far" answers "what did we buy this month?" without letting a half-filled month
into the totals. Descriptions are what the biggest-purchases insight and the Advances tab already
show everyone who can open the month.
**Instead of:** opening the breakdown from the chart (a thin slice of a bar is too small to tap on
a phone, and a computer's hover box can't be clicked into), or in a dialog (it covers the page and
hides the totals being explained).

## 2026-10-22 — The money review follows the money, not a file list
**Decision:** `money-reviewer` runs whenever the schema or any file doing money math changes (it
uses `toCentavos`, `fromCentavos`, `sumCentavos` or `Centavos`), and it reads new files too, not
only the diff. Outside `lib/settlement.ts`, code may add up, average and show money but never
split it into shares. The month-to-month carry-over and "what's still owed" (`computePeriod`,
`payablesIn`), including a bill paid in a later month, have their own tests
(`lib/periods.test.ts`).
**Instead of:** a fixed list (`settlement.ts`, `money.ts`, the schema, fixtures, how-it-works).
**Why:** money math had spread to periods, Helper, Trends, advances, reminders and Settle Up,
and a change to any of them went without a money review. The carry-over decides what the bill
emails and the "you still owe" banner say, but was only tested on the way to something else.

## 2026-10-22 — A test reviewer before every PR
**Decision:** a third read-only review agent, `test-keeper`, runs before every PR. It checks
changed behaviour has a test that checks it, expected values are worked out by hand, and each
important new test can fail, naming one way to break the code for the main session to try. The
rule lives in `docs/testing.md` → When a change needs a test.
**Instead of:** a CI rule failing when `lib/` changes without a test file changing, which
would flag every rename and refactor until it was ignored. And not folded into `docs-keeper`:
each reviewer keeps one job.
**Why:** CI catches a broken test, never a missing one, so changed behaviour with no test went
green. The carry-over was untested until a reviewer went looking, and breaking the code on
purpose is what showed the new tests worked.

## 2026-10-26 — Every housemate email also pushes
**Decision:** the week-before and few-days-before month-end reminders push too, so every email a
housemate gets also comes as a push (`PUSHES` in `lib/push-messages.ts`); only the view-only note
stays email-only, since view-only logins get no pushes. The three month-end pushes share a tag,
so each replaces the one before on the phone. This replaces "only when something's due soon"
from the 2026-10-16 push decision.
**Why:** Paul worried housemates miss emails. An inbox is easy to skip; a buzz on the lock screen
isn't. It's about 5–6 pushes a month for someone who pays on time, still few, and the shared tag
keeps them from piling up.
**Instead of:** keeping the early reminders email-only (the ones most likely to be missed, since
nothing is urgent yet).

## 2026-10-26 — The still-unpaid follow-up repeats every 4 days, not weekly
**Decision:** `UNPAID_REMINDER_DAYS` goes from 3-then-7 to 3-then-4: a reminder 3 days after the
bill email, then every 4 days until it's paid or "I paid" covers it. Updates the 2026-10-13
decision.
**Why:** a week between nudges let a bill sit. With a push on each one now, every 4 days (twice a
week) is noticed without nagging, and each push replaces the last on the phone.
**Instead of:** weekly (too slow once it's a push), or every day or two (nagging).

## 2026-10-26 — The cash drawer is the admin's own, flagged rather than copied, outside the split
**Decision:** a Cash Drawer tab, admin only and the same in every month, replaces PA's notebook
for the cash he keeps at home ([cash-drawer.md](features/cash-drawer.md)).
- **Its own lines:** a `cash_drawer_entries` table holds cash in, spent, lent and paid back.
- **Linked lines:** Helper entries and advances paid from the drawer aren't copied into it.
  They carry a `from_drawer` flag, and the drawer reads them live.
- **Only the admin sets the flag,** only on his own payments, and only with a date. A
  housemate's save never changes it.
- **Borrowers are typed names,** not members.
- **The drawer may go below ₱0,** and shows where. But nobody may pay back more than they
  borrowed: every drawer save checks that, under its own lock.

**Instead of:**
- copying a drawer row when a Helper entry or advance is saved, and keeping it in step on every
  edit and delete;
- a "paid by the drawer" party in the split (it's PA's money, so the split must not change);
- a per-month tab (cash carries over);
- borrowers picked from the members list (someone who borrows needn't be a housemate).

**Why:** the flag can't fall out of step: editing or deleting the Helper entry or advance is the
drawer's edit. Keeping the drawer out of the split means none of the money rules, Finals or bill
emails change. Blocking a Helper save over the drawer's balance would get in the way of the
household's real records for the sake of PA's private one, so the drawer only warns.

## 2026-10-27 — Biller due dates: Date paid is the signal, and stays editable once closed
**Decision:** the admin is reminded about a bill while it has a Due date and no Date paid
([reminders.md](features/reminders.md) → Biller due dates):
- **On the screen:** a banner on every month page, with a Paid today button.
- **By email and push:** a morning email and push 3 days before the due date, on the day and the
  day after.
- **Housemates and view-only logins see a calm "coming up" note** on the month pages: bills due
  today or later, no overdue ones, no buttons, no email or push. They don't pay billers, so it's
  for information only. Hiding overdue bills means a late tap on Paid today never worries anyone.
- **Date paid stays editable on a closed month** (admin only; [Closing](settlement-rules.md#closing-and-reopening-a-month)).
  The Due date and everything else stay locked. The How it works page still says a closed month
  is "locked for everyone": for housemates it is, and that page leaves out admin-only detail.
- **One `reminder_sends` row per month (`bill_due`), moving forward** like the unpaid follow-up,
  so one email covers that month's bills.
- **Bill inbox emails** with a due date are on the banner only. They already push when they get
  stuck.

**Why:**
- The two date columns already existed, and the bill emails fill in the Due date, but nothing
  read them.
- Before this, every past month's dated bills had a Date paid, so "no Date paid" reliably means
  "not paid yet".
- A month's bills fall due after it ends, often after it's closed. With a full lock, a bill paid
  after closing could never be marked, and its banner would nag forever. Date paid is a note,
  not part of any number closing freezes.
- A per-bill row would need a new column on a table keyed by month + kind + member.
- A bill that arrives already inside the 3-day window misses its "3 days before" step. It still
  gets its "bill came in" push, then its due-day step.

**Instead of:**
- A banner only: Paul wants to be told on days he doesn't open the app.
- Keeping closed months fully locked, with a "reopen to mark it paid" step.
- Reminding until paid with no cap: a step more than a week old is never dug up.

## 2026-10-30 — Bill emails: DMARC, and ARC sealed by Google
**Decision:** `/api/bill-email` accepts a bill when Gmail's topmost `Authentication-Results`
shows any of: a DKIM pass signed by the biller's domain (as before), a DMARC pass for the
biller's domain, or — for a bill forwarded from PA's personal Gmail — `arc=pass` whose summary
says DMARC passed for the biller, under an ARC set sealed by `google.com`. The script now sends
the `ARC-Seal` headers too. The header is read strictly: anything a sender's own address could
use to plant a result (a `;`, `(`, quote or backslash inside a comment or quoted string) makes
the whole header count as unverified.
**Why:** Meralco's first real bill was refused. Meralco sends through Salesforce Marketing
Cloud, so its only DKIM signature is Salesforce's; it proves itself with SPF on its own bounce
domain, which Gmail reports as a DMARC pass. Forwarding then breaks SPF, so in the My House
Gmail only the ARC summary still carries that verdict. `arc=pass` means Gmail checked every
seal, so requiring the summarised set to be sealed by google.com means the DMARC pass is
Google's own verdict from the first inbox; a forged email with its own ARC set on top is
summarised at that set, which Google didn't seal. Reading the header strictly closes a gap the
old comment-stripping had: a quoted `MAIL FROM` could close Gmail's comment early and plant a
`dkim=pass`.
**Still possible, as before:** someone forwarding their own real bill from the same biller to the
My House Gmail. It only becomes a Pending bill, which PA confirms.
**Instead of:** a second copy of the script in the personal Gmail (the fallback in the
2026-10-11 entry — it would read the personal Gmail, and Meralco would still need DMARC), or
trusting Salesforce's signing domain for Meralco (any Salesforce customer can sign with it).

## 2026-10-30 — A hand-typed bill gets a fee reminder, not the fee added
**Decision:** the payment fee is added only to emailed bills. A column with a fee shows the admin
an "Include ₱… fee ⓘ" reminder under the amount until an email fills it; what PA types is the
total. "Include", not "+": the app can't tell whether a typed amount has the fee in it already.
**Why:** PA typed Water in from the email and the fee was left out. A typed amount stays exactly
what was typed, the same everywhere else in the Split Table, and the bill can be typed with the
fee already in it (or paid a different way, with no fee).
**Instead of:** adding the fee on save, which would change a typed number behind PA's back and
double the fee whenever he typed the total with it already in.

## 2026-11-06 — Cash drawer: a day's lines in the order they were logged; older months on request
**Decision:** within a day, the drawer orders lines by when they were saved (`created_at`), after
the existing rule that money in comes first. Source and id only settle lines saved at the same
moment. The list draws the two newest months with lines and a "Show older months" button.
**Why:** sorting by source put every advance above every Helper visit above every drawer entry on
the same day, whatever order PA logged them in, unlike his notebook. Money in still goes first so
a cash in logged after that day's spending never shows the drawer below ₱0. The list only grows;
older months are rarely looked at, and all lines still load because Cash on hand, Owed and the
below-₱0 hint need every one.
**Instead of:** a time field on each entry (one more thing to type, for an order `created_at`
already records), or paging on the server (the rows are few, and the totals need them all anyway).
