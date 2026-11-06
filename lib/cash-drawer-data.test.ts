// The Cash Drawer's database side (lib/cash-drawer-data.ts) against a real Postgres (PGlite:
// docs/testing.md → Database tests), with the made-up August 2026. Expected values are worked
// out by hand from docs/features/cash-drawer.md.

import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { advances, cashDrawerEntries, helperEntries, sharedColumns } from "@/db/schema";
import { loadAugust, type LoadedAugust } from "@/lib/__fixtures__/load-august";
import { drawerEntryValues } from "@/lib/cash-drawer";
import { toCentavos } from "@/lib/money";
import type { Viewer } from "@/lib/permissions";
import { resetDb, testDatabase } from "./test-db";

const auth = vi.hoisted(() => ({ viewer: null as Viewer | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => (await import("./test-db")).dbModule());
vi.mock("@/lib/auth", () => ({ requireViewer: async () => auth.viewer }));

const { addDrawerEntryIn, deleteDrawerEntryIn, getCashDrawer, updateDrawerEntryIn } = await import(
  "@/lib/cash-drawer-data"
);
const { pg, db } = await testDatabase();
let august: LoadedAugust;

beforeEach(async () => {
  await resetDb(pg);
  august = await db.transaction((tx) => loadAugust(tx));
  auth.viewer = { memberId: august.idOf("PA"), name: "PA", role: "admin", email: null };
});

type Kind = "cash_in" | "spent" | "lent" | "paid_back";
const values = (kind: Kind, onDate: string, pesos: string, person = "", note: string | null = null) =>
  drawerEntryValues({ kind, onDate, amount: toCentavos(pesos), person, note });
const add = (...args: Parameters<typeof values>) => db.transaction((tx) => addDrawerEntryIn(tx, values(...args)));
const entries = () =>
  db
    .select({ kind: cashDrawerEntries.kind, amount: cashDrawerEntries.amount, person: cashDrawerEntries.person })
    .from(cashDrawerEntries)
    .orderBy(asc(cashDrawerEntries.id));
const idOf = async (kind: Kind) =>
  (await db.select({ id: cashDrawerEntries.id }).from(cashDrawerEntries).where(eq(cashDrawerEntries.kind, kind)))[0].id;

describe("the drawer's own entries", () => {
  it("saves a cash in, a loan and part of it paid back", async () => {
    await add("cash_in", "2026-08-01", "5000.00", "", "From the bank");
    await add("lent", "2026-08-05", "1000.00", "Ben");
    await add("paid_back", "2026-08-06", "300.00", "ben");
    expect(await entries()).toEqual([
      { kind: "cash_in", amount: "5000.00", person: null },
      { kind: "lent", amount: "1000.00", person: "Ben" },
      { kind: "paid_back", amount: "300.00", person: "ben" },
    ]);
  });

  it("refuses paying back more than was borrowed, writing nothing", async () => {
    await add("lent", "2026-08-05", "400.00", "Ben");
    // 400.00 borrowed, 500.00 back: 100.00 too much.
    await expect(add("paid_back", "2026-08-06", "500.00", "Ben")).rejects.toThrow(
      "That would leave Ben paying back ₱100.00 more than was borrowed.",
    );
    expect(await entries()).toHaveLength(1);
  });

  it("refuses a paid back from someone who never borrowed", async () => {
    await expect(add("paid_back", "2026-08-06", "50.00", "Cara")).rejects.toThrow("Cara paying back ₱50.00");
  });

  it("refuses shrinking a loan below what was already paid back", async () => {
    await add("lent", "2026-08-05", "1000.00", "Ben");
    await add("paid_back", "2026-08-06", "300.00", "Ben");
    const lent = await idOf("lent");
    await expect(
      db.transaction((tx) => updateDrawerEntryIn(tx, lent, values("lent", "2026-08-05", "200.00", "Ben"))),
    ).rejects.toThrow("₱100.00 more than was borrowed");
    expect((await entries())[0].amount).toBe("1000.00");
  });

  it("refuses moving a paid back to someone else", async () => {
    await add("lent", "2026-08-05", "1000.00", "Ben");
    await add("paid_back", "2026-08-06", "300.00", "Ben");
    const back = await idOf("paid_back");
    await expect(
      db.transaction((tx) => updateDrawerEntryIn(tx, back, values("paid_back", "2026-08-06", "300.00", "Dan"))),
    ).rejects.toThrow("Dan paying back ₱300.00");
  });

  it("refuses deleting a loan that was partly paid back", async () => {
    await add("lent", "2026-08-05", "1000.00", "Ben");
    await add("paid_back", "2026-08-06", "300.00", "Ben");
    const lent = await idOf("lent");
    await expect(db.transaction((tx) => deleteDrawerEntryIn(tx, lent))).rejects.toThrow("Ben paying back ₱300.00");
    expect(await entries()).toHaveLength(2);
  });

  it("edits and deletes an entry", async () => {
    await add("spent", "2026-08-02", "99.99");
    const spent = await idOf("spent");
    await db.transaction((tx) => updateDrawerEntryIn(tx, spent, values("spent", "2026-08-02", "120.00")));
    expect((await entries())[0].amount).toBe("120.00");
    await db.transaction((tx) => deleteDrawerEntryIn(tx, spent));
    expect(await entries()).toEqual([]);
  });

  it("says so when the entry being edited was deleted", async () => {
    await expect(
      db.transaction((tx) => updateDrawerEntryIn(tx, 999, values("spent", "2026-08-02", "1.00"))),
    ).rejects.toThrow("That entry was deleted.");
  });
});

describe("getCashDrawer", () => {
  async function flaggedMonth() {
    const pa = august.idOf("PA");
    const [column] = await db
      .select({ id: sharedColumns.id })
      .from(sharedColumns)
      .where(and(eq(sharedColumns.periodId, august.periodId), eq(sharedColumns.isDefault, true)));
    await db.insert(helperEntries).values([
      // Handed over 600.00 − 100.00 = 500.00 from the drawer.
      { periodId: august.periodId, kind: "visit", payerId: pa, onDate: "2026-08-02", amount: "600.00", deduction: "100.00", fromDrawer: true },
      // All of it taken off her debt: nothing left the drawer.
      { periodId: august.periodId, kind: "visit", payerId: pa, onDate: "2026-08-03", amount: "600.00", deduction: "600.00", fromDrawer: true },
      // Not from the drawer.
      { periodId: august.periodId, kind: "visit", payerId: pa, onDate: "2026-08-02", amount: "600.00" },
      // Early pay counts in full: 200.00.
      { periodId: august.periodId, kind: "early_pay", payerId: pa, onDate: "2026-08-07", amount: "200.00", fromDrawer: true },
    ]);
    await db.insert(advances).values([
      { periodId: august.periodId, columnId: column.id, payerId: pa, category: "grocery", description: "Rice", amount: "1250.25", spentOn: "2026-08-04", fromDrawer: true },
      { periodId: august.periodId, columnId: column.id, payerId: pa, category: "grocery", description: "Not drawer", amount: "10.00", spentOn: "2026-08-04" },
    ]);
    await add("cash_in", "2026-08-01", "5000.00", "", "From the bank");
    await add("lent", "2026-08-05", "1000.00", "Ben");
    await add("paid_back", "2026-08-06", "300.00", "ben");
  }

  it("puts the drawer's entries and the flagged Helper entries and advances in one ledger", async () => {
    await flaggedMonth();
    const drawer = (await getCashDrawer())!;
    // 5,000.00 − 500.00 (Helper visit) − 1,250.25 (Rice) − 1,000.00 (lent) + 300.00 (paid back)
    // − 200.00 (early pay).
    expect(drawer.lines.map((l) => [l.source, l.onDate, l.change, l.leftAfter])).toEqual([
      ["drawer", "2026-08-01", 500000, 500000],
      ["helper", "2026-08-02", -50000, 450000],
      ["advance", "2026-08-04", -125025, 324975],
      ["drawer", "2026-08-05", -100000, 224975],
      ["drawer", "2026-08-06", 30000, 254975],
      ["helper", "2026-08-07", -20000, 234975],
    ]);
    expect(drawer.cashOnHand).toBe(234975);
    expect(drawer.owing).toEqual([{ person: "ben", owes: 70000 }]);
    expect(drawer.people).toEqual(["ben"]);
    expect(drawer.belowZero).toBeNull();
  });

  it("links each Helper entry and advance to its month", async () => {
    await flaggedMonth();
    const linked = (await getCashDrawer())!.lines.filter((l) => l.source !== "drawer");
    expect(linked).toMatchObject([
      { source: "helper", helperKind: "visit", year: 2026, month: 8 },
      { source: "advance", description: "Rice", year: 2026, month: 8 },
      { source: "helper", helperKind: "early_pay", year: 2026, month: 8 },
    ]);
  });

  it("orders a day's lines by when each was saved, across the three tables", async () => {
    const pa = august.idOf("PA");
    const [column] = await db
      .select({ id: sharedColumns.id })
      .from(sharedColumns)
      .where(and(eq(sharedColumns.periodId, august.periodId), eq(sharedColumns.isDefault, true)));
    const day = "2026-08-05";
    const at = (hour: number) => new Date(Date.UTC(2026, 7, 5, hour));
    // Saved: the advance at 09:00, the spent at 10:00, the Helper visit at 11:00. By source alone
    // it would read spent, Helper, advance.
    await db.insert(helperEntries).values({
      periodId: august.periodId, kind: "visit", payerId: pa, onDate: day, amount: "400.00", fromDrawer: true, createdAt: at(11),
    });
    await db.insert(cashDrawerEntries).values({ kind: "spent", onDate: day, amount: "100.00", createdAt: at(10) });
    await db.insert(advances).values({
      periodId: august.periodId, columnId: column.id, payerId: pa, category: "grocery", description: "Rice", amount: "300.00", spentOn: day, fromDrawer: true, createdAt: at(9),
    });
    const lines = (await getCashDrawer())!.lines;
    expect(lines.map((l) => [l.source, l.loggedAt])).toEqual([
      ["advance", at(9).getTime()],
      ["drawer", at(10).getTime()],
      ["helper", at(11).getTime()],
    ]);
  });

  it("points at the first line that took the drawer below ₱0", async () => {
    await add("spent", "2026-08-02", "300.00");
    await add("cash_in", "2026-08-03", "100.00");
    expect((await getCashDrawer())!.belowZero).toMatchObject({ onDate: "2026-08-02", leftAfter: -30000 });
  });

  it("is only for the admin", async () => {
    auth.viewer = { memberId: august.idOf("Ben"), name: "Ben", role: "member", email: null };
    expect(await getCashDrawer()).toBeNull();
  });
});

describe("the database itself", () => {
  /** Expects the write to be refused by that check constraint (not some other error). */
  async function refusedBy(write: PromiseLike<unknown>, constraint: string) {
    const error: unknown = await Promise.resolve(write).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error, constraint).not.toBeNull();
    const { message, cause } = error as { message: string; cause?: { message?: string } };
    expect(`${message} ${cause?.message ?? ""}`).toContain(constraint);
  }

  it("refuses a drawer-paid Helper entry or advance without a date, and the starting debt from the drawer", async () => {
    const pa = august.idOf("PA");
    await refusedBy(
      db.insert(helperEntries).values({ periodId: august.periodId, kind: "visit", payerId: pa, amount: "1.00", fromDrawer: true }),
      "helper_entries_drawer_dated",
    );
    await refusedBy(
      db.insert(helperEntries).values({ periodId: august.periodId, kind: "opening", onDate: "2026-08-01", amount: "1.00", fromDrawer: true }),
      "helper_entries_opening_not_drawer",
    );
    const [column] = await db.select({ id: sharedColumns.id }).from(sharedColumns).where(eq(sharedColumns.periodId, august.periodId));
    await refusedBy(
      db.insert(advances).values({ periodId: august.periodId, columnId: column.id, payerId: pa, category: "misc", description: "x", amount: "1.00", fromDrawer: true }),
      "advances_drawer_dated",
    );
  });

  it("refuses a loan without a person, and a person on anything else", async () => {
    await refusedBy(
      db.insert(cashDrawerEntries).values({ kind: "lent", onDate: "2026-08-01", amount: "1.00" }),
      "cash_drawer_entries_person",
    );
    await refusedBy(
      db.insert(cashDrawerEntries).values({ kind: "cash_in", onDate: "2026-08-01", amount: "1.00", person: "Ben" }),
      "cash_drawer_entries_person",
    );
  });
});
