import { ArrowLeft, BellRing, CalendarCheck, CalendarClock, CalendarPlus, CircleHelp, Lock, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AppShell } from "@/components/app-sidebar";
import { FaqAccordion } from "@/components/faq-accordion";
import { MemberMark } from "@/components/member-mark";
import { sidebarProps } from "@/components/period-header";
import { getPreview, getPreviewChoices, requireViewer } from "@/lib/auth";
import { monthLabel } from "@/lib/format";
import { paymentFee } from "@/lib/bill-email/fees";
import {
  BILL_EMAIL_COLUMNS,
  HOUSE_BUDGET_LABEL,
  MERALCO_POINT_ITEMS,
  MERALCO_POINTS_AS_OF,
} from "@/lib/household-config";
import { formatPHP } from "@/lib/money";
import { getLatestPointsBills, getPeriodView } from "@/lib/periods";
import { REMINDER_DAYS, UNPAID_REMINDER_DAYS } from "@/lib/reminders";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "How it works" };

// "Your part each month": a housemate's two jobs, and the emails that remind them
// (docs/features/reminders.md). The days come from REMINDER_DAYS and UNPAID_REMINDER_DAYS, the same
// settings the daily job uses.
const YOUR_PART = [
  {
    title: "Log your expenses by the last day",
    body: "Anything you paid for the house — groceries, a service — goes in Advances, and Helper visits you paid in Helper Visits. After the month's last day it locks: you can't add to it or change it anymore. Anything new goes in the next month, which starts by itself on the 1st.",
  },
  {
    title: "Pay when your bill is ready",
    body: `Once the bills are in, the admin emails you your share, and it shows at the top of the month's pages until it's paid. Send it to the ${HOUSE_BUDGET_LABEL}, then tap I paid in Settle Up with the screenshot of your transfer. Still unpaid after ${UNPAID_REMINDER_DAYS.first} days? A reminder email comes, then one every ${UNPAID_REMINDER_DAYS.then} days until you've paid or tapped I paid. Amount looks wrong? Message the admin before paying.`,
  },
];

const TIMELINE = [
  { when: `${REMINDER_DAYS.week} days left`, what: "Log what you've paid", icon: CalendarClock },
  { when: `${REMINDER_DAYS.three_days} days left`, what: "It locks soon", icon: CalendarClock },
  { when: "Last day", what: "Log anything left today", icon: CalendarCheck },
  { when: "Month locks", what: "Only the admin can change it", icon: Lock },
  { when: "The 1st", what: "New month starts: log new things there", icon: CalendarPlus },
  { when: "Bill ready", what: "Pay in Settle Up", icon: ReceiptText, highlight: true },
  { when: `${UNPAID_REMINDER_DAYS.first} days later`, what: `Still unpaid? A reminder, then every ${UNPAID_REMINDER_DAYS.then} days`, icon: BellRing },
];

// The jump links under "Your part each month": the question groups, and the points table.
const JUMP_LINKS = [
  { href: "#paying", label: "Paying" },
  { href: "#splitting", label: "Splitting" },
  { href: "#points-table", label: "Meralco points" },
  { href: "#the-app", label: "Emails & the app" },
  { href: "#less-common", label: "Less common" },
];

// A plain-language guide for the household. Keep it in sync with docs/settlement-rules.md, and with
// what housemates see and do in the app (CLAUDE.md → Keeping docs up to date). Housemates read it:
// admin-only detail lives in docs/features/, not here.
export default async function HowItWorksPage() {
  await connection();
  const real = await requireViewer();
  const [{ period, examplePeriod, bills, members }, preview, previewChoices] = await Promise.all([
    getLatestPointsBills(),
    getPreview(),
    getPreviewChoices(),
  ]);
  // Already loaded by getLatestPointsBills (getPeriodView is cached per request).
  const view = period ? await getPeriodView(period.year, period.month) : null;
  const back = period ? `/periods/${period.year}/${period.month}` : "/";
  // The points example uses the latest month with a Meralco amount (getLatestPointsBills).
  const hasAmounts = bills.some((b) => b.total > 0);
  const exampleNote =
    bills.length === 0
      ? null
      : !hasAmounts
        ? "Shares appear once a Meralco bill is in."
        : period && examplePeriod && examplePeriod.id !== period.id
          ? `${monthLabel(period.year, period.month)}'s bill isn't in yet, so the shares are from ${monthLabel(examplePeriod.year, examplePeriod.month)}.`
          : null;
  // From the BILL_PAYMENT_FEES setting, so this page never shows an old fee.
  const feeList = (Object.keys(BILL_EMAIL_COLUMNS) as (keyof typeof BILL_EMAIL_COLUMNS)[])
    .map((provider) => ({ column: BILL_EMAIL_COLUMNS[provider], ...paymentFee(provider) }))
    .filter((f) => f.fee > 0);
  const fees = feeList.map((f) => `${formatPHP(f.fee)} for ${f.column}${f.note ? `, the ${f.note}` : ""}`);

  // Question ids are link targets: the Split Table's cards open #equal, #points, #shared-advances
  // and #month-final (components/split-table.tsx), so keep those.
  const paying = [
    {
      id: "payments",
      q: "How do I record that I paid?",
      a: (
        <>
          <p>
            Send what you owe to the {HOUSE_BUDGET_LABEL}. Then open <strong>Settle Up</strong>, tap{" "}
            <strong>I paid</strong> on your row and attach the screenshot of the transfer. The amount is filled in with
            what you owe; change it if you only paid part. The &ldquo;Your bill is ready&rdquo; email and banner link
            straight there. On a phone, the icon beside <strong>Who still owes</strong> switches to a compact list,
            each row on one line (emojis and the amount), and your phone remembers it.
          </p>
          <p>
            I paid always goes in the <strong>latest</strong> month. Once a new month has started, what you still owe
            from last month is in its Prev Month Unsettled column, so paying there settles it.
          </p>
          <p>
            It shows as <strong>Waiting for the admin</strong> and doesn&apos;t count until they&apos;ve checked it
            arrived and confirmed it; then it comes off your Final. If it didn&apos;t arrive, they{" "}
            <strong>reject</strong> it with a short reason, and you can cancel it and send it again. You can also
            cancel your own while it&apos;s waiting. Only you and the admin see your screenshot; the others see that
            you paid and how much.
          </p>
        </>
      ),
    },
    {
      id: "month-final",
      q: "What do Month Final and Final mean?",
      a: (
        <>
          <p>
            <strong>Month Final = your share of everything − what you paid this month</strong> (advances and any
            bills you paid).
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Positive (e.g. ₱1,250.00): you still need to pay this amount.</li>
            <li>Negative (e.g. −₱3,400.00): you paid more than your share and get this back.</li>
          </ul>
          <p>
            <strong>Final</strong> adds last month&apos;s unsettled balance, takes off any payments already made, and
            spells out what&apos;s left:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-rose-600">To pay</span> — pay this amount into the {HOUSE_BUDGET_LABEL}.
            </li>
            <li>
              <span className="font-medium text-emerald-700">To receive</span> — the admin pays this amount back to you
              from the {HOUSE_BUDGET_LABEL}.
            </li>
            <li>
              <span className="font-medium text-zinc-600">Settled</span> — ₱0.00, nothing to do.
            </li>
          </ul>
          <p>
            Everyone&apos;s Month Finals add up to ₱0.00 — what some owe is what others get back. If a Manual column
            is a few centavos over or short, the total shows that difference.
          </p>
        </>
      ),
    },
    {
      id: "carry-over",
      q: "What if I don't pay in full?",
      a: (
        <p>
          Nothing is lost: whatever is still unpaid at the end of a month carries over to the next month&apos;s
          &ldquo;Prev Month Unsettled&rdquo; column and is added to that month&apos;s Final. Money still in the{" "}
          {HOUSE_BUDGET_LABEL} carries over the same way.
        </p>
      ),
    },
    {
      id: "month-end",
      q: "What happens when the month ends?",
      a: (
        <>
          <p>
            After a month&apos;s last day it&apos;s <strong>locked for housemates</strong>: you can&apos;t add, edit or
            delete your advances or Helper visits in it anymore. The admin still can, so if you forgot something, tell
            the admin.
          </p>
          <p>
            Anything new goes in the next month, which usually starts by itself on the 1st. (If an I paid is still
            waiting for the admin, it starts the morning after they&apos;ve dealt with it, so nobody is shown the amount
            again and pays twice.) An expense keeps its own date, so something from the 30th logged into the next month is fine.
            Paying isn&apos;t affected: you can still send <strong>I paid</strong> after the month ends — that&apos;s
            when the bills arrive.
          </p>
          <p>
            Later, usually once everyone has paid, the admin <strong>closes</strong> the month. After that it&apos;s
            locked for everyone (if something needs fixing, the admin reopens it), and anything still unpaid carries
            over to the next month — once your bill has been emailed, the reminders keep coming until it&apos;s paid.
          </p>
        </>
      ),
    },
  ];

  const splitting = [
    {
      id: "equal",
      q: "How are bills split?",
      a: (
        <>
          <p>
            Water, PLDT and the Helper are always split <strong>equally</strong> between everyone in the house
            that month. Amounts are worked out to the exact centavo, so everyone&apos;s shares always add up to the real
            bill.
          </p>
          <p>
            When a bill doesn&apos;t divide evenly, the leftover centavos are handed out one each,{" "}
            <strong>the admin</strong> (who collects) first. Example: ₱1,000.02 split 5 ways is ₱200.004 each, so the
            admin and one other person pay ₱200.01 and the other three pay ₱200.00.
          </p>
          <p>
            Meralco is split by points (next question). A bill added later is set to <strong>Auto equal</strong> or{" "}
            <strong>Manual</strong> when it&apos;s added, and stays that way; for a Manual bill each person&apos;s
            amount is typed in, and the bill&apos;s total is the sum.
          </p>
        </>
      ),
    },
    {
      id: "points",
      q: "How is Meralco split? What do the points mean?",
      a: (
        <>
          <p>
            Electricity isn&apos;t used equally — aircon and a PC use a lot more — so Meralco is split with a{" "}
            <strong>point system</strong>. Each person has points based on what they use (see the table below). The
            bill is divided into as many equal parts as there are points in total, and each person pays for their own
            points.
          </p>
          <p>
            <strong>Cost per point = bill ÷ total points.</strong> Someone with 2 points pays twice as much as someone
            with 1 point. The admin sets everyone&apos;s points; if yours look wrong, tell the admin.
          </p>
        </>
      ),
    },
    {
      id: "shared-advances",
      q: "What are shared advances? Why do some columns leave someone out?",
      a: (
        <>
          <p>
            A shared advance is something one person paid for the whole house — groceries, palengke, gas, a service.
            It&apos;s logged into a <strong>shared column</strong>, usually <strong>Advances Shared</strong> (everyone),
            and everyone in that column pays an equal part — including the person who paid, who gets the rest back.
          </p>
          <p>
            When the usual split doesn&apos;t fit, the admin adds a separate column for that month. For example, if
            someone is away for part of the month, what&apos;s bought while they&apos;re gone can go into a column like
            &ldquo;Advances Shared w/o PA&rdquo;, shared only by the people at home. And when something isn&apos;t
            shared equally — say one person covers half of a purchase — the admin sets the column to{" "}
            <strong>Manual</strong> and types each person&apos;s amount. If those don&apos;t add up to the column&apos;s
            total, the table shows how much it&apos;s over or short.
          </p>
          <p>
            To see what&apos;s in a column, tap its total on the Split Table (once anything&apos;s logged in it):
            the Advances Log opens showing just that column. You can also pick one from its{" "}
            <strong>Filter by column</strong> list. Logged something wrong? Your own advances in Advances Shared
            have edit and delete buttons there until the month ends; for anything else, ask the admin.
            Everyone&apos;s shares are recalculated either way.
          </p>
          <p>
            The Advances tab&apos;s totals check each other. <strong>Advances by Category</strong> and{" "}
            <strong>Out-of-Pocket by Person</strong> add up the same log two ways. With no filters on the log, both
            totals match the log&apos;s total, and each person&apos;s amount matches the total on their group. Bills
            someone paid count too: they show in the log marked <strong>Own column</strong>, because each bill is
            split in its own column on the Split Table rather than in a shared one.
          </p>
        </>
      ),
    },
    {
      id: "helper",
      q: "How does the Helper work? What is early pay?",
      a: (
        <>
          <p>
            Every day the Helper works is logged on the <strong>Helper Visits</strong> tab: the date, her daily pay,
            and who paid her. Whoever is home can pay her and log it themselves.
          </p>
          <p>
            Sometimes she gets money <strong>before</strong> she works — <strong>early pay</strong>. She then owes it,
            and part of her later daily pay is taken off what she owes instead of being handed to her. The Helper
            Visits tab keeps track of what she still owes. The Total row under its list adds up the month.
          </p>
          <p>
            When logging a visit where something is taken off, type her <strong>full</strong> daily pay as Daily pay
            and the part kept back as Taken off — not the cash you handed her. The form shows the cash she gets
            underneath, so you can check it matches what you gave.
          </p>
          <p>
            <strong>Whoever hands her money gets it back.</strong> The month&apos;s Helper bill is everything handed
            to her that month — daily pay minus what was taken off, plus early pay — split equally like Water and
            PLDT. Each person&apos;s part counts as money they paid, so it comes off their Month Final. Example: pay
            her ₱650 and give ₱1,200 early pay on the same day, and you get ₱1,850 back that month.
          </p>
          <p>
            A month where she gets early pay can cost a bit more than her daily pay; the months when it&apos;s taken
            off cost a bit less. Over time the house pays exactly her pay.
          </p>
        </>
      ),
    },
    {
      id: "house-budget",
      q: `What is the ${HOUSE_BUDGET_LABEL}, and why does the admin pay the bills?`,
      a: (
        <>
          <p>
            The household&apos;s savings account, where everyone sends what they owe. The admin pays Meralco, Water,
            PLDT and usually the Helper upfront, then pays out of the {HOUSE_BUDGET_LABEL}: first to anyone who paid
            more than their share, then what&apos;s left to the admin.
          </p>
          <p>
            Whoever pays a bill — the admin or anyone else — gets it counted as money they paid, so it comes off their
            Month Final.
          </p>
          <p>
            The Split Table shows the {HOUSE_BUDGET_LABEL} as its own row under everyone: what it holds right now,
            still to be paid out. Anything still in it at the end of a month carries over to the next.
          </p>
        </>
      ),
    },
  ];

  const theApp = [
    {
      id: "emails",
      q: "What emails will I get, and when?",
      a: (
        <>
          <p>My House emails you, around 9am, from the household Gmail:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>{REMINDER_DAYS.week} days</strong> and <strong>{REMINDER_DAYS.three_days} days</strong> before the
              month ends — to log what you&apos;ve paid for the house.
            </li>
            <li>
              <strong>On the last day</strong> — today is the last day to log; from tomorrow the month is locked.
            </li>
            <li>
              <strong>When your bill is ready</strong> — once the bills are in and checked, the admin sends everyone
              their own share: what you owe, any of last month&apos;s still unpaid, any I paid still waiting, and a link
              to Settle Up. Nobody sees anyone else&apos;s amount. If you paid more than your share, it says what you get
              back instead (nothing to do — the admin sends it). Already settled? You get no email.
            </li>
            <li>
              <strong>If your bill is still unpaid</strong> — a reminder {UNPAID_REMINDER_DAYS.first} days after it, then
              every {UNPAID_REMINDER_DAYS.then} days, until you&apos;ve paid or tapped I paid for all of it. The month
              closing doesn&apos;t stop it (what&apos;s unpaid carries over); once next month&apos;s bill goes out, the
              reminders follow that one, which already includes what&apos;s left.
            </li>
          </ul>
          <p>
            The same reminders show at the top of the month&apos;s pages, in case an email lands in spam. &ldquo;Your
            bill is ready&rdquo; stays there, with a button to Settle Up, until you&apos;re settled.
          </p>
          <p>
            A small grey line there also shows the household&apos;s bills <strong>coming up</strong> in the next week
            (&ldquo;Coming up: PLDT Wifi Oct. 30&rdquo;), so you know what&apos;s due. The admin pays the billers, so
            there&apos;s nothing for you to do, and it never emails you about them.
          </p>
          <p>
            Amount looks wrong, or a question about an email? Message the admin before paying — they can fix the month
            and send the bill again.
          </p>
          <p>
            A <strong>view only</strong> login gets just one email a month: a short note when the month&apos;s bills are
            in, with a link to have a look. No amounts.
          </p>
          <p>
            Want a heads-up on your phone too? See{" "}
            <a href="#notifications" className="underline underline-offset-2">
              Can My House notify me on my phone?
            </a>{" "}
            — the emails keep coming either way.
          </p>
        </>
      ),
    },
    {
      id: "greeting-emoji",
      q: "What's the greeting at the top, and how do I change my emoji?",
      a: (
        <>
          <p>
            The card at the top of the Split Table says hello and tells you your own number in plain words: what you
            still have to pay into the House Budget (with a <strong>Settle up</strong> link), that your payment is
            waiting for the admin to confirm, that the House Budget pays you, or that you&apos;re all settled. It&apos;s
            the same amount as your bill email and banner, so a payment you&apos;ve already sent is never asked for
            again. While you still have some left to pay, a small line under it says when your last payment was (once
            the admin confirmed it), and how many months ago. It&apos;s only on your own card. Your own row in the table, and in
            Who owes what, is marked <strong>You</strong>.
          </p>
          <p>
            Everyone shows with their emoji, or a colour dot if they haven&apos;t picked one. To change yours, open the
            menu with your name at the bottom of the sidebar and type or paste one emoji into{" "}
            <strong>Your emoji</strong>; leave it empty to go back to the dot. The {HOUSE_BUDGET_LABEL} shows with the
            emoji the admin picks for it, or a bank icon.
          </p>
        </>
      ),
    },
    {
      id: "other-months",
      q: "How do I look at another month, and get back?",
      a: (
        <>
          <p>
            Tap the month&apos;s name at the top of the sidebar (on a phone, in the middle of the top bar) to pick any
            month, or use the arrows beside it. You stay on the same page: Advances in August opens Advances in
            September.
          </p>
          <p>
            When you&apos;re looking at an older month, a <strong>Back to</strong> link with the newest month&apos;s
            name shows under the month name and takes you to the newest month, on the same page. The house icon at the
            top takes you to the newest month&apos;s Split Table from anywhere.
          </p>
        </>
      ),
    },
    {
      id: "who-can-change-what",
      q: "Who can see and change what?",
      a: (
        <>
          <p>
            Everyone in the household signs in with their own login — Google, or a code sent to their email — and can
            see every month. Only emails the admin has added can sign in. A <strong>view only</strong> login (say,
            family abroad) sees the months too but changes nothing, and isn&apos;t part of any month, so they share in
            no bill and never owe or are owed. Their only email is a short note each month when the bills are in.
          </p>
          <p>
            You can log your own advances into <strong>Advances Shared</strong> and the Helper visits you paid, and edit
            or delete them until the month ends (see{" "}
            <a href="#month-end" className="underline underline-offset-2">
              What happens when the month ends?
            </a>
            ), and send your payments with <strong>I paid</strong>. Everything else — bills, points, other shared
            columns, confirming payments, moving in and out, closing months — is done by the admin. If one of your
            advances should be split differently, the admin moves it to the right column; after that, only the admin
            can change it.
          </p>
          <p>
            <strong>Receipts</strong> shows everyone the proof of each bill (the Helper&apos;s record is Helper Visits
            instead). A payment&apos;s screenshot, which can show
            your bank, only you and the admin see. <strong>Billers &amp; Accounts</strong> shows the lines shared with
            housemates; passwords stay hidden until you tap to reveal one. On a phone, tap a biller&apos;s name to
            open its card.
          </p>
        </>
      ),
    },
    {
      id: "trends",
      q: "Where can I see how much we spend over time?",
      a: (
        <>
          <p>
            <strong>Trends</strong> (in the sidebar, under Household) charts the household&apos;s spending for the last
            1, 3 or 6 months, up to the month you&apos;re on: a bar per month, split into each bill and each kind of
            shared purchase (groceries, food, services, misc). Tap or hover a bar to see the amounts (on a phone they
            show under the chart). While this month&apos;s bills are still coming in, <strong>1 month</strong> shows
            the last month that&apos;s complete.
          </p>
          <p>
            Below it, <strong>Where it went</strong> lists what took the most (on a phone, switch between the total
            and the monthly average in its corner). Tap a line to see what&apos;s in it: every grocery, food,
            service or misc purchase, or a bill&apos;s amount each month. <strong>Insights</strong> point out what&apos;s grown, a bill
            that&apos;s higher than usual, and the biggest single purchases, to help us spend wiser. A month whose
            bills aren&apos;t all in yet shows faded and isn&apos;t counted until they are, so it doesn&apos;t look
            cheaper than it was. You can still see what&apos;s been bought in it so far: open a line in Where it went
            and it&apos;s listed under the rest, marked &ldquo;not counted yet&rdquo;.
          </p>
        </>
      ),
    },
    {
      id: "install",
      q: "How do I put My House on my phone?",
      a: (
        <>
          <p>Installed, My House opens full-screen from your home screen, like an app:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Android</strong> (or a computer, in Chrome or Edge) — tap <strong>Install</strong> on the card at
              the bottom of the screen, or use the browser&apos;s menu (⋮) → Install app.
            </li>
            <li>
              <strong>iPhone</strong> — tap Share (or ••• then Share) → <strong>Add to Home Screen</strong>. Then sign
              in once more inside the app: on iPhone it keeps its own login.
            </li>
            <li>
              <strong>Opened the link in Messenger, Facebook or Instagram?</strong> Those can&apos;t install anything:
              open it in Chrome or Safari first.
            </li>
          </ul>
          <p>
            Closed the card? <strong>Install app</strong> in the menu under your name, at the bottom of the sidebar,
            brings it back. My House still needs an internet connection (
            <a href="#offline" className="underline underline-offset-2">
              what happens without one
            </a>
            ). Opening the app shows a short My House screen while your month loads.
          </p>
          <p>
            On a phone, tap ☰ or swipe right from near the left edge for the menu (start a finger-width in from the
            edge), and swipe it back left to close it.
          </p>
        </>
      ),
    },
    {
      id: "offline",
      q: "What if I lose my connection?",
      a: (
        <>
          <p>
            A <strong>No connection</strong> strip shows at the top. The page you have open stays, so you can keep
            looking.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Saving</strong> waits instead of failing: what you typed stays, and it saves by itself once
              you&apos;re back online. Keep My House open until then — closing it drops what was waiting.
            </li>
            <li>
              <strong>Another month or tab</strong> opens once you&apos;re back.
            </li>
            <li>
              <strong>Opening My House</strong> with no connection shows a No connection screen: tap{" "}
              <strong>Try again</strong> once you&apos;re back.
            </li>
          </ul>
          <p>Very rarely, something saved just as the connection dropped shows up twice: delete the extra one.</p>
        </>
      ),
    },
    {
      id: "notifications",
      q: "Can My House notify me on my phone?",
      a: (
        <>
          <p>
            Yes — a short notification with each reminder email, so you don&apos;t miss it. Tapping it opens the
            right page:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Before the month ends</strong> — {REMINDER_DAYS.week} days before, {REMINDER_DAYS.three_days}{" "}
              days before and on its last day, to log what you&apos;ve paid for the house.
            </li>
            <li>
              <strong>Your bill is ready</strong>, and <strong>if it&apos;s still unpaid</strong>{" "}
              {UNPAID_REMINDER_DAYS.first} days later, then every {UNPAID_REMINDER_DAYS.then} days until you&apos;ve paid or tapped I paid.
            </li>
            <li>
              <strong>Your I paid was confirmed</strong> by the admin — or needs a look (tap to see why).
            </li>
          </ul>
          <p>
            To turn them on, open the menu under your name at the bottom of the sidebar and tap{" "}
            <strong>Turn on notifications</strong>, then allow them. Inside the installed app a card offers it too. It
            works per phone, so turn it on on each one you use. On an <strong>iPhone</strong>, add My House to your
            Home Screen first and turn it on from there — Safari can&apos;t get them in a tab.
          </p>
          <p>
            Notifications never show amounts (anyone can see a lock screen); the emails still come with the details.
            Turn them off in the same menu any time. Signing out turns them off on that phone. A{" "}
            <strong>view only</strong> login gets no notifications, just its monthly email.
          </p>
        </>
      ),
    },
  ];

  const lessCommon = [
    {
      id: "emailed-bills",
      q: "What does “Pending” on a bill mean?",
      a: (
        <>
          <p>
            Meralco, Water and PLDT email their bills, and the app reads the amount and due date from the email. The
            bill goes into the month it&apos;s for — the month the provider names on the bill, not the day the email
            arrives — marked <strong>Pending</strong>.
          </p>
          <p>
            The small fee for paying it is added and shared like the bill
            {fees.length > 0 ? `: ${fees.join("; ")}` : ""}. Tap <strong>From email</strong> under the amount to see
            the emailed bill and the fee that was added. A bill the admin types in by hand includes the same fee.
          </p>
          <p>
            A pending bill is <strong>not counted yet</strong>: nobody&apos;s totals change until the admin checks it
            and confirms it.
          </p>
        </>
      ),
    },
    {
      id: "move-in-out",
      q: "What happens when someone moves in or out?",
      a: (
        <>
          <p>
            Someone who <strong>moves in</strong> joins every open month: equal bills are re-split to include them,
            they start at 0 Meralco points until theirs are set, and they share the everyday Advances Shared column.
          </p>
          <p>
            Someone who <strong>moves out</strong> is left out of future months. In a month where they already have
            something recorded — an advance, a payment, a bill or Helper visit they paid, or an amount typed for them
            in a Manual bill or column — they stay, so that month&apos;s numbers don&apos;t change. Otherwise
            they&apos;re taken out and the bills re-split. A new month&apos;s bill they&apos;re down as paying but
            that is still ₱0 goes to the admin.
          </p>
          <p>
            Someone who still owes, or is still owed, money from an earlier month also stays until it&apos;s settled,
            so an unpaid balance never disappears.
          </p>
        </>
      ),
    },
  ];

  const faqGroup = (id: string, title: string, items: typeof paying) => (
    <section id={id} className="scroll-mt-6 rounded-xl border bg-white px-5 pt-5 pb-2 shadow-xs">
      <h2 className="font-semibold">{title}</h2>
      <FaqAccordion items={items} />
    </section>
  );

  const page = (
    <div className="min-h-full">
      <header className="border-b bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
              <CircleHelp className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">How it works</h1>
              <p className="text-sm text-muted-foreground">How My House splits the house costs</p>
            </div>
          </div>
          {/* Phone: just "Back", so it stays on one line and leaves the title its room. */}
          <Link
            href={back}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back
            {period && <span className="hidden sm:inline">to {monthLabel(period.year, period.month)}</span>}
          </Link>
        </div>
      </header>

      {/* page-enter: the sections fade up in turn (app/globals.css, components/page-enter.tsx). */}
      <main className="page-enter mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <section id="your-part" className="rounded-xl border bg-white p-5 shadow-xs">
          <h2 className="font-semibold">Your part each month</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Two things to do. My House emails you a reminder for each, and shows it at the top of the month too.
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {YOUR_PART.map((step, i) => (
              <li key={step.title} className="flex gap-3 rounded-lg border bg-zinc-50/60 p-4">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-800">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium">{step.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <h3 className="mt-6 text-sm font-semibold">The automatic emails</h3>
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {TIMELINE.map((item) => (
              <li
                key={item.when}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 sm:flex-col sm:gap-1.5",
                  item.highlight && "border-amber-200 bg-amber-50",
                )}
              >
                <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground sm:mt-0" />
                <div>
                  <p className="text-sm font-medium">{item.when}</p>
                  <p className="text-xs text-muted-foreground">{item.what}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Sent around 9am from the household Gmail. Questions? Message the admin.{" "}
            <a href="#emails" className="underline underline-offset-2">
              More about the emails
            </a>
          </p>
        </section>

        <nav aria-label="Questions" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Questions:</span>
          {JUMP_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full border bg-white px-3 py-1 text-muted-foreground transition-colors hover:border-amber-300 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {faqGroup("paying", "Paying and settling up", paying)}
        {faqGroup("splitting", "How the costs are split", splitting)}

        <section id="points-table" className="scroll-mt-6 rounded-xl border bg-white p-5 shadow-xs">
          <h2 className="font-semibold">Meralco point system</h2>
          <p className="mt-1 text-sm text-muted-foreground">Current allocation as of {MERALCO_POINTS_AS_OF}.</p>
          {exampleNote && <p className="mt-1 text-sm text-muted-foreground">{exampleNote}</p>}

          {bills.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No bill is split by points in the latest month. Meralco is the points bill; its points are set in
              Manage Columns &amp; People.
            </p>
          ) : (
            bills.map((bill) => {
              const perPoint = bill.perUnit?.amount ?? 0;
              return (
                <div key={bill.id} className="mt-4">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-muted-foreground">
                      <tr>
                        <th className="py-2 font-medium">{bill.name}</th>
                        <th className="py-2 text-right font-medium">Points</th>
                        <th className="py-2 text-right font-medium">
                          {examplePeriod ? monthLabel(examplePeriod.year, examplePeriod.month) : ""} share
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {members.map((m) => {
                        const share = bill.shares[String(m.id)];
                        return (
                          <tr key={m.id}>
                            <td className="py-2">
                              <span className="flex items-center gap-2">
                                <MemberMark dotClass={m.dotClass} emoji={m.emoji} />
                                {m.name}
                              </span>
                            </td>
                            <td className="py-2 text-right font-mono tabular-nums">{share?.points ?? 0}</td>
                            <td className="py-2 text-right font-mono tabular-nums">
                              {bill.total > 0 ? formatPHP(share?.amount ?? 0) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t font-semibold">
                      <tr>
                        <td className="py-2">Total</td>
                        <td className="py-2 text-right font-mono tabular-nums">{bill.totalPoints}</td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {bill.total > 0 ? formatPHP(bill.total) : "—"}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  {bill.total > 0 && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Worked example: {formatPHP(bill.total)} ÷ {bill.totalPoints} points ≈{" "}
                      <strong>{formatPHP(perPoint)} per point</strong>. Someone with 1.5 points pays about{" "}
                      {formatPHP(Math.round(perPoint * 1.5))}.
                    </p>
                  )}
                </div>
              );
            })
          )}

          <h3 className="mt-6 text-sm font-semibold">Items considered</h3>
          <p className="text-sm text-muted-foreground">What each person&apos;s points are built from:</p>
          <ul className="mt-2 divide-y rounded-lg border text-sm">
            {MERALCO_POINT_ITEMS.map(({ item, points }) => (
              <li key={item} className="flex justify-between px-3 py-2">
                <span>{item}</span>
                <span className="font-mono tabular-nums">{points}</span>
              </li>
            ))}
          </ul>
        </section>

        {faqGroup("the-app", "Emails and the app", theApp)}
        {faqGroup("less-common", "Less common questions", lessCommon)}
      </main>
    </div>
  );

  // The same sidebar as the month pages, on the latest month (none yet: just the page).
  if (!view) return page;
  const viewer = preview ?? real;
  return (
    <AppShell viewer={viewer} previewBy={preview ? real : null} sidebar={sidebarProps(view, viewer, previewChoices)}>
      {page}
    </AppShell>
  );
}
