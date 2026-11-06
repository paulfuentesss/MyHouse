import { describe, expect, it } from "vitest";
import {
  cashOnHand,
  drawerChange,
  drawerEntryItem,
  drawerEntryValues,
  drawerFlagFor,
  drawerLedger,
  firstBelowZero,
  firstOverpaid,
  loansByPerson,
  personKey,
  type DrawerItem,
} from "./cash-drawer";
import type { Viewer } from "./permissions";

// Made-up names and amounts (never the household's real ones). Expected values are worked out
// by hand from docs/features/cash-drawer.md.

// `loggedAt` (when the line was saved) defaults to the same moment for all, so the source/id
// tie-break still shows; the tests about logging order pass their own.
const cashIn = (id: number, onDate: string, amount: number, loggedAt = 0): DrawerItem => ({
  source: "drawer",
  id,
  onDate,
  loggedAt,
  change: drawerChange("cash_in", amount),
});
const spent = (id: number, onDate: string, amount: number, loggedAt = 0): DrawerItem => ({
  source: "drawer",
  id,
  onDate,
  loggedAt,
  change: drawerChange("spent", amount),
});
const lent = (id: number, onDate: string, person: string, amount: number, loggedAt = 0): DrawerItem => ({
  source: "drawer",
  id,
  onDate,
  loggedAt,
  change: drawerChange("lent", amount),
  loan: { kind: "lent", person },
});
const paidBack = (id: number, onDate: string, person: string, amount: number, loggedAt = 0): DrawerItem => ({
  source: "drawer",
  id,
  onDate,
  loggedAt,
  change: drawerChange("paid_back", amount),
  loan: { kind: "paid_back", person },
});
const helper = (id: number, onDate: string, handedOver: number, loggedAt = 0): DrawerItem => ({
  source: "helper",
  id,
  onDate,
  loggedAt,
  change: -handedOver,
});
const advance = (id: number, onDate: string, amount: number, loggedAt = 0): DrawerItem => ({
  source: "advance",
  id,
  onDate,
  loggedAt,
  change: -amount,
});

// A month of the drawer, given out of order on purpose:
//   Aug 1  cash in   +5,000.00  → 5,000.00
//   Aug 1  Helper      −600.00  → 4,400.00  (same day: the cash in comes first)
//   Aug 3  advance     −250.50  → 4,149.50
//   Aug 5  lent Ben  −1,000.00  → 3,149.50
//   Aug 10 paid back   +400.00  → 3,549.50  ("ben " is the same person)
//   Aug 12 spent        −99.99  → 3,449.51
const AUGUST: DrawerItem[] = [
  helper(7, "2026-08-01", 60000),
  paidBack(3, "2026-08-10", "ben ", 40000),
  advance(4, "2026-08-03", 25050),
  cashIn(1, "2026-08-01", 500000),
  spent(5, "2026-08-12", 9999),
  lent(2, "2026-08-05", "Ben", 100000),
];

describe("drawerChange", () => {
  it("counts a cash in and a paid back as money in, spent and lent as money out", () => {
    expect(drawerChange("cash_in", 100)).toBe(100);
    expect(drawerChange("paid_back", 100)).toBe(100);
    expect(drawerChange("spent", 100)).toBe(-100);
    expect(drawerChange("lent", 100)).toBe(-100);
  });
});

describe("drawerLedger", () => {
  it("puts the lines in date order with the cash left after each", () => {
    const ledger = drawerLedger(AUGUST);
    expect(ledger.map((l) => [l.source, l.id, l.leftAfter])).toEqual([
      ["drawer", 1, 500000],
      ["helper", 7, 440000],
      ["advance", 4, 414950],
      ["drawer", 2, 314950],
      ["drawer", 3, 354950],
      ["drawer", 5, 344951],
    ]);
  });

  it("on the same day, puts money out in the order it was logged, whatever its source or id", () => {
    // Logged: the lent at 09:00, the advance at 10:00, the Helper visit at 11:00, the spent at
    // 12:00. By source and id alone it would read spent, lent, Helper, advance.
    const day = "2026-08-05";
    const at = (hour: number) => Date.UTC(2026, 7, 5, hour);
    const ledger = drawerLedger([
      advance(1, day, 30000, at(10)),
      helper(9, day, 40000, at(11)),
      spent(2, day, 10000, at(12)),
      lent(8, day, "Ben", 10000, at(9)),
      cashIn(3, "2026-08-01", 100000),
    ]);
    // 1,000.00 in; then −100.00 → 900.00, −300.00 → 600.00, −400.00 → 200.00, −100.00 → 100.00.
    expect(ledger.map((l) => [`${l.source}${l.id}`, l.leftAfter])).toEqual([
      ["drawer3", 100000],
      ["drawer8", 90000],
      ["advance1", 60000],
      ["helper9", 20000],
      ["drawer2", 10000],
    ]);
  });

  it("on the same day, puts a cash in logged after the money out before it all the same", () => {
    const day = "2026-08-05";
    const ledger = drawerLedger([advance(1, day, 20000, 1000), cashIn(2, day, 50000, 2000), helper(3, day, 10000, 3000)]);
    expect(ledger.map((l) => [`${l.source}${l.id}`, l.leftAfter])).toEqual([
      ["drawer2", 50000],
      ["advance1", 30000],
      ["helper3", 20000],
    ]);
  });

  it("on the same day and logged at the same moment, puts money in first, then the drawer, Helper and advances by id", () => {
    const day = "2026-08-01";
    const ledger = drawerLedger([
      advance(1, day, 100),
      helper(9, day, 100),
      spent(8, day, 100),
      helper(2, day, 100),
      paidBack(6, day, "Ben", 100),
      cashIn(5, day, 100),
    ]);
    expect(ledger.map((l) => `${l.source}${l.id}`)).toEqual([
      "drawer5",
      "drawer6",
      "drawer8",
      "helper2",
      "helper9",
      "advance1",
    ]);
  });

  it("puts money in first on the same day even when it was logged after the money out", () => {
    // Spent (id 1) logged before the day's cash in (id 2) and paid back (id 3): by id alone the
    // drawer would read −300.00 after the spend.
    const day = "2026-08-01";
    const ledger = drawerLedger([spent(1, day, 30000), cashIn(2, day, 50000), paidBack(3, day, "Ben", 100)]);
    expect(ledger.map((l) => [l.id, l.leftAfter])).toEqual([
      [2, 50000],
      [3, 50100],
      [1, 20100],
    ]);
    expect(firstBelowZero(ledger)).toBeNull();
  });

  it("doesn't change the list it was given", () => {
    const items = [spent(2, "2026-08-02", 100), cashIn(1, "2026-08-01", 100)];
    drawerLedger(items);
    expect(items.map((i) => i.id)).toEqual([2, 1]);
  });
});

describe("cashOnHand", () => {
  it("is everything in minus everything out", () => {
    expect(cashOnHand(AUGUST)).toBe(344951);
  });

  it("is ₱0 with nothing logged", () => {
    expect(cashOnHand([])).toBe(0);
  });
});

describe("firstBelowZero", () => {
  it("finds the first line that takes the drawer below ₱0", () => {
    // Aug 2 spent 300 → −300 (the cash in on Aug 3 came too late).
    const ledger = drawerLedger([cashIn(1, "2026-08-03", 50000), spent(2, "2026-08-02", 30000)]);
    expect(firstBelowZero(ledger)).toMatchObject({ id: 2, leftAfter: -30000 });
  });

  it("is null when the drawer never goes below ₱0", () => {
    expect(firstBelowZero(drawerLedger(AUGUST))).toBeNull();
  });
});

describe("loansByPerson", () => {
  it("is what each person borrowed minus what they paid back, under the name last typed", () => {
    // Ben borrowed 1,000.00 and paid back 400.00 (as "ben "): owes 600.00.
    expect(loansByPerson(AUGUST)).toEqual([{ person: "ben", owes: 60000 }]);
  });

  it("keeps people apart, sorted by name, and keeps someone who paid it all back at ₱0", () => {
    const items = [
      lent(1, "2026-08-01", "Cara", 20000),
      lent(2, "2026-08-02", "Ben", 50000),
      paidBack(3, "2026-08-03", "Cara", 20000),
    ];
    expect(loansByPerson(items)).toEqual([
      { person: "Ben", owes: 50000 },
      { person: "Cara", owes: 0 },
    ]);
  });

  it("ignores lines that aren't loans", () => {
    expect(loansByPerson([cashIn(1, "2026-08-01", 100), helper(2, "2026-08-01", 100)])).toEqual([]);
  });
});

describe("firstOverpaid", () => {
  it("finds someone who paid back more than they borrowed", () => {
    // Dan borrowed 400.00 and paid back 500.00: −100.00.
    const items = [lent(1, "2026-08-01", "Dan", 40000), paidBack(2, "2026-08-02", "dan", 50000)];
    expect(firstOverpaid(items)).toEqual({ person: "dan", owes: -10000 });
  });

  it("catches a loan shrunk below what was already paid back", () => {
    // Ben paid back 400.00 of a loan now edited down to 300.00.
    const items = [lent(1, "2026-08-01", "Ben", 30000), paidBack(2, "2026-08-02", "Ben", 40000)];
    expect(firstOverpaid(items)?.owes).toBe(-10000);
  });

  it("is null when nobody paid back too much", () => {
    expect(firstOverpaid(AUGUST)).toBeNull();
  });
});

describe("drawerEntryItem", () => {
  it("turns a stored entry into a ledger line, with the borrower on a loan and when it was logged", () => {
    const createdAt = new Date("2026-08-05T09:30:00Z");
    expect(
      drawerEntryItem({ id: 4, kind: "lent", onDate: "2026-08-05", amount: "1000.50", person: "Ben", createdAt }),
    ).toEqual({
      source: "drawer",
      id: 4,
      onDate: "2026-08-05",
      loggedAt: Date.UTC(2026, 7, 5, 9, 30),
      change: -100050,
      loan: { kind: "lent", person: "Ben" },
    });
    expect(
      drawerEntryItem({ id: 5, kind: "cash_in", onDate: "2026-08-01", amount: "0.01", person: null, createdAt }),
    ).toEqual({
      source: "drawer",
      id: 5,
      onDate: "2026-08-01",
      loggedAt: Date.UTC(2026, 7, 5, 9, 30),
      change: 1,
    });
  });
});

describe("drawerFlagFor", () => {
  const admin: Viewer = { memberId: 5, name: "PA", role: "admin", email: null };
  const ben: Viewer = { memberId: 2, name: "Ben", role: "member", email: null };

  it("is ticked or not for the admin's own payment, with a date", () => {
    expect(drawerFlagFor(true, 5, "2026-08-05", admin)).toBe(true);
    expect(drawerFlagFor(false, 5, "2026-08-05", admin)).toBe(false);
    // Unticked needs neither a date nor the admin as payer.
    expect(drawerFlagFor(false, 2, null, admin)).toBe(false);
  });

  it("refuses someone else's payment, or no date", () => {
    expect(() => drawerFlagFor(true, 2, "2026-08-05", admin)).toThrow("Only what you paid yourself");
    expect(() => drawerFlagFor(true, null, "2026-08-05", admin)).toThrow("Only what you paid yourself");
    expect(() => drawerFlagFor(true, 5, null, admin)).toThrow("Choose a date");
  });

  it("leaves it alone on a housemate's save, whatever the form sent", () => {
    expect(drawerFlagFor(true, 2, "2026-08-05", ben)).toBeUndefined();
    expect(drawerFlagFor(false, 2, "2026-08-05", ben)).toBeUndefined();
  });
});

describe("drawerEntryValues", () => {
  const typed = { onDate: "2026-08-05", amount: 100050, note: null };

  it("keeps the person on a loan, trimmed, and saves the amount as numeric text", () => {
    expect(drawerEntryValues({ ...typed, kind: "lent", person: "  Ben " })).toEqual({
      kind: "lent",
      onDate: "2026-08-05",
      amount: "1000.50",
      person: "Ben",
      note: null,
    });
  });

  it("drops a person typed on anything but a loan", () => {
    expect(drawerEntryValues({ ...typed, kind: "cash_in", person: "Ben" }).person).toBeNull();
    expect(drawerEntryValues({ ...typed, kind: "spent", person: "" }).person).toBeNull();
  });

  it("refuses a loan without a person", () => {
    expect(() => drawerEntryValues({ ...typed, kind: "lent", person: " " })).toThrow("Enter who borrowed it.");
    expect(() => drawerEntryValues({ ...typed, kind: "paid_back", person: "" })).toThrow("Enter who paid it back.");
  });
});

describe("personKey", () => {
  it("ignores capitals and extra spaces", () => {
    expect(personKey("  Ben  O'Neil ")).toBe(personKey("ben o'neil"));
  });
});
