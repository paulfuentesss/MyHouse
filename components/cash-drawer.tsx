"use client";

import { ArrowUpRight, Pencil } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { deleteDrawerEntry } from "@/app/periods/[year]/[month]/actions";
import { ConfirmDeleteButton } from "@/components/confirm-button";
import { EmptyState } from "@/components/empty-state";
import { AddDrawerEntryDialog, EditDrawerEntryDialog } from "@/components/entry-dialogs";
import { Button } from "@/components/ui/button";
import { DRAWER_KIND_LABELS, FIRST_MONTHS, MORE_MONTHS, shownMonthCount, type DrawerKind } from "@/lib/cash-drawer";
import type { CashDrawerView, DrawerLine } from "@/lib/cash-drawer-data";
import { dateLabel, dayLabel, monthLabel } from "@/lib/format";
import { formatPHP } from "@/lib/money";
import { cn } from "@/lib/utils";

type DrawerEntry = Extract<DrawerLine, { source: "drawer" }>;

const PILL = "rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";
const KIND_PILLS: Record<DrawerKind, string> = {
  cash_in: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  spent: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  lent: "bg-amber-50 text-amber-700 ring-amber-200",
  paid_back: "bg-sky-50 text-sky-700 ring-sky-200",
};
const LINKED_PILL = "bg-violet-50 text-violet-700 ring-violet-200";

const COLUMNS = 6;

/** The pill, and the words beside it. */
function describe(line: DrawerLine): { pill: string; pillClass: string; text: string | null } {
  switch (line.source) {
    case "drawer":
      return {
        pill: DRAWER_KIND_LABELS[line.kind],
        pillClass: KIND_PILLS[line.kind],
        text: [line.person, line.toAccount && "to bank / e-wallet", line.note].filter(Boolean).join(" · ") || null,
      };
    case "helper":
      return {
        pill: "Helper",
        pillClass: LINKED_PILL,
        text: [line.helperKind === "visit" ? "Visit" : "Early pay", line.note].filter(Boolean).join(" · "),
      };
    case "advance":
      return { pill: "Advance", pillClass: LINKED_PILL, text: line.description };
  }
}

/** Where a linked line is edited: its month's Helper or Advances tab. */
function linkedHref(line: DrawerLine): { href: string; tab: string } | null {
  if (line.source === "drawer") return null;
  const base = `/periods/${line.year}/${line.month}`;
  return line.source === "helper" ? { href: `${base}/helper`, tab: "Helper Visits" } : { href: `${base}/advances`, tab: "Advances" };
}

// The Cash Drawer tab (docs/features/cash-drawer.md): PA's cash at home, like his notebook —
// what's in it now, who owes it, and every peso in and out, newest first.
export function CashDrawer({ drawer }: { drawer: CashDrawerView }) {
  const [editing, setEditing] = useState<DrawerEntry | null>(null);
  // Newest first, under a heading per month (of the line's date). Plain loops, not Map.groupBy,
  // which older phones' browsers don't have.
  const months = new Map<string, DrawerLine[]>();
  for (const line of [...drawer.lines].reverse()) {
    const key = line.onDate.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), line]);
  }
  const below = drawer.belowZero;
  // Only the newest months are drawn at first, so the list doesn't grow forever; "Show older
  // months" adds more (shownMonthCount).
  const monthKeys = [...months.keys()];
  const [askedMonths, setAskedMonths] = useState(FIRST_MONTHS);
  const shownMonths = shownMonthCount(monthKeys, below ? below.onDate.slice(0, 7) : null, askedMonths);
  const hiddenMonths = monthKeys.length - shownMonths;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border bg-white p-5 shadow-xs">
          <h2 className="text-sm font-medium text-muted-foreground">Cash on hand</h2>
          <p
            className={cn(
              "mt-1 font-mono text-3xl font-semibold tabular-nums",
              drawer.cashOnHand < 0 && "text-destructive",
            )}
          >
            {formatPHP(drawer.cashOnHand)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {below
              ? `It went below ₱0 on ${dateLabel(below.onDate)} (${describe(below).pill.toLowerCase()}) — is a Cash in missing before it?`
              : "Everything put in, minus everything paid out or lent. Paybacks to your bank or e-wallet aren't in it. Only you see this tab."}
          </p>
        </section>
        <section className="rounded-xl border bg-white p-5 shadow-xs">
          <h2 className="text-sm font-medium text-muted-foreground">Owed to the drawer</h2>
          {drawer.owing.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nobody owes the drawer anything.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {drawer.owing.map((loan) => (
                <li key={loan.person} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{loan.person}</span>
                  <span className="font-mono text-lg font-semibold tabular-nums">{formatPHP(loan.owes)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border bg-white shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
          <div>
            <h2 className="text-base font-semibold">Ins &amp; Outs</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Newest first, with what was left after each. Helper visits and advances ticked &ldquo;Paid from the cash
              drawer&rdquo; show up here by themselves — change them on their own tab.
            </p>
          </div>
          <AddDrawerEntryDialog people={drawer.people} />
        </div>

        <div className="overflow-x-auto">
          {/* Fixed layout on phones holds the table to the screen's width, so a long note wraps
              instead of widening the table into a sideways scroll. */}
          <table className="w-full text-sm max-md:table-fixed">
            {/* Phones get a two-line layout per line, so no column headings. */}
            <thead className="hidden bg-amber-50/60 text-left text-amber-900 md:table-header-group">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Date</th>
                <th className="px-3 py-2.5 font-semibold">What</th>
                <th className="px-3 py-2.5 text-right font-semibold">In</th>
                <th className="px-3 py-2.5 text-right font-semibold">Out</th>
                <th className="px-3 py-2.5 text-right font-semibold">Left after</th>
                <th className="w-24 px-3 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...months].slice(0, shownMonths).map(([key, lines]) => (
                <Fragment key={key}>
                  <tr className="border-t bg-zinc-50">
                    <th
                      colSpan={COLUMNS}
                      scope="colgroup"
                      className="px-5 py-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                      {monthLabel(Number(key.slice(0, 4)), Number(key.slice(5, 7)))}
                    </th>
                  </tr>
                  {lines.map((line) => {
                    const { pill, pillClass, text } = describe(line);
                    const linked = linkedHref(line);
                    const date = dayLabel(line.onDate);
                    // A payback to the bank / e-wallet moved no cash (change 0), so take the entry's
                    // own amount, and show it outside In and Out.
                    const amount = formatPHP(line.source === "drawer" ? line.amount : Math.abs(line.change));
                    const offDrawer = line.change === 0;
                    const left = (
                      <span className={cn(line.leftAfter < 0 && "text-destructive")}>{formatPHP(line.leftAfter)}</span>
                    );
                    const kindPill = <span className={cn(PILL, pillClass)}>{pill}</span>;
                    const label = `${pill}${text ? ` · ${text}` : ""} · ${date} · ${amount}`;
                    const actions =
                      line.source === "drawer" ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${label}`}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => setEditing(line)}
                          >
                            <Pencil />
                          </Button>
                          <ConfirmDeleteButton
                            label={`Delete ${label}`}
                            title="Delete this entry?"
                            description={`${label}. Cash on hand is recalculated.`}
                            onConfirm={() => deleteDrawerEntry(line.id)}
                          />
                        </>
                      ) : (
                        linked && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Open ${label} in ${linked.tab}`}
                            className="text-muted-foreground hover:text-foreground"
                            render={<Link href={linked.href} />}
                          >
                            <ArrowUpRight />
                          </Button>
                        )
                      );
                    return (
                      <Fragment key={`${line.source}-${line.id}`}>
                        {/* Phone: what and amount, then date, what was left and buttons. */}
                        <tr className="border-t border-zinc-100 md:hidden">
                          <td colSpan={COLUMNS} className="px-5 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <span className="flex min-w-0 items-start gap-2">
                                <span className="shrink-0">{kindPill}</span>
                                <span className="min-w-0 break-words">{text}</span>
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 font-mono font-semibold tabular-nums",
                                  line.change > 0 && "text-emerald-700",
                                  offDrawer && "font-normal text-muted-foreground",
                                )}
                              >
                                {offDrawer ? "" : line.change > 0 ? "+" : "−"}
                                {amount}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {date} · {left} left
                              </div>
                              <div className="-my-1 flex shrink-0">{actions}</div>
                            </div>
                          </td>
                        </tr>
                        <tr className="hidden border-t border-zinc-100 hover:bg-zinc-50/60 md:table-row">
                          <td className="px-5 py-2.5 text-muted-foreground tabular-nums">{date}</td>
                          <td className="px-3 py-2.5">
                            <span className="flex flex-wrap items-center gap-2">
                              {kindPill}
                              {text && <span className="text-muted-foreground">{text}</span>}
                              {offDrawer && (
                                <span className="font-mono text-muted-foreground tabular-nums">{amount}</span>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-emerald-700 tabular-nums">
                            {line.change > 0 ? amount : ""}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">{line.change < 0 ? amount : ""}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">{left}</td>
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">{actions}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
              {drawer.lines.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS} className="p-4">
                    <EmptyState>
                      Nothing logged yet. Start with what&apos;s in the drawer now: Add entry → Cash in.
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {hiddenMonths > 0 && (
          <div className="flex justify-center border-t p-4">
            <Button variant="outline" onClick={() => setAskedMonths(shownMonths + MORE_MONTHS)}>
              Show older months
            </Button>
          </div>
        )}
      </section>
      <EditDrawerEntryDialog entry={editing} people={drawer.people} onClose={() => setEditing(null)} />
    </div>
  );
}
