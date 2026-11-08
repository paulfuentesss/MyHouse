import { describe, expect, it } from "vitest";
import {
  countsInBill,
  firstOverdrawn,
  handedOver,
  helperBillTotal,
  helperMonthSummary,
  helperPaidBy,
  ledgerCompare,
  owesAfter,
  visitCashHint,
  type HelperEntryInput,
} from "./helper";

// Made-up members and amounts (never the household's real ones). Expected values are worked out
// by hand from the rule in docs/settlement-rules.md → "The Helper".
const ANA = 1;
const BEN = 2;
const PA = 5;

let nextId = 1;
const visit = (payerId: number, amount: string, deduction = "0"): HelperEntryInput => ({
  id: nextId++,
  kind: "visit",
  payerId,
  amount,
  deduction,
});
const earlyPay = (payerId: number, amount: string): HelperEntryInput => ({
  id: nextId++,
  kind: "early_pay",
  payerId,
  amount,
  deduction: "0",
});
const opening = (amount: string): HelperEntryInput => ({
  id: nextId++,
  kind: "opening",
  payerId: null,
  amount,
  deduction: "0",
});

// One month, in ledger order. Debt starts at ₱300.00 (carried over from the sheet).
const start = opening("300.00"); //                         debt 300.00
const benVisit = visit(BEN, "700.00"); //                   handed 700.00, debt 300.00
const anaEarly = earlyPay(ANA, "500.00"); //                handed 500.00, debt 800.00
const paVisit = visit(PA, "700.00", "150.00"); //           handed 550.00, debt 650.00
const paFullyTakenOff = visit(PA, "350.00", "350.00"); //   handed   0.00, debt 300.00
const month = [start, benVisit, anaEarly, paVisit, paFullyTakenOff];

describe("handedOver", () => {
  it("is the daily pay minus what was taken off, for a visit", () => {
    expect(handedOver(benVisit)).toBe(70000);
    expect(handedOver(paVisit)).toBe(55000);
    expect(handedOver(paFullyTakenOff)).toBe(0);
  });

  it("is the whole early pay, and nothing for the carried-over debt", () => {
    expect(handedOver(anaEarly)).toBe(50000);
    expect(handedOver(start)).toBe(0);
  });
});

describe("visitCashHint", () => {
  it("is the daily pay minus what's taken off, as typed", () => {
    expect(visitCashHint("800", "200")).toEqual({ pay: 80000, takenOff: 20000, cash: 60000 });
    expect(visitCashHint("1,000", "₱ 250.5")).toEqual({ pay: 100000, takenOff: 25050, cash: 74950 });
    expect(visitCashHint("350", "350")).toEqual({ pay: 35000, takenOff: 35000, cash: 0 });
  });

  it("counts an empty Taken off as nothing taken off", () => {
    expect(visitCashHint("800", "")).toEqual({ pay: 80000, takenOff: 0, cash: 80000 });
    expect(visitCashHint("800", "  ")).toEqual({ pay: 80000, takenOff: 0, cash: 80000 });
  });

  it("goes below zero when more is taken off than her pay", () => {
    expect(visitCashHint("200", "300")).toEqual({ pay: 20000, takenOff: 30000, cash: -10000 });
  });

  it("is null while Daily pay is empty or either amount isn't valid", () => {
    expect(visitCashHint("", "200")).toBeNull();
    expect(visitCashHint("abc", "0")).toBeNull();
    expect(visitCashHint("800", "2x")).toBeNull();
  });
});

describe("helperPaidBy and helperBillTotal", () => {
  it("credits each person what they handed over, and the bill is their sum", () => {
    // Ben 700.00 · Ana 500.00 · PA 550.00 + 0.00 → bill 1,750.00
    expect(helperPaidBy(month)).toEqual(
      new Map([
        [BEN, 70000],
        [ANA, 50000],
        [PA, 55000],
      ]),
    );
    expect(helperBillTotal(month)).toBe(175000);
  });

  it("adds daily pay and early pay handed over by the same person on the same day", () => {
    // Ana: 650.00 daily pay + 1,200.00 early pay = 1,850.00
    const sameDay = [visit(ANA, "650.00"), earlyPay(ANA, "1200.00")];
    expect(helperPaidBy(sameDay)).toEqual(new Map([[ANA, 185000]]));
    expect(helperBillTotal(sameDay)).toBe(185000);
  });

  it("leaves out someone whose only visit was fully taken off", () => {
    expect(helperPaidBy([paFullyTakenOff])).toEqual(new Map());
    expect(helperBillTotal([paFullyTakenOff])).toBe(0);
  });

  it("makes a month where she only works off debt cheaper than her daily pay", () => {
    // Daily pay 650.00 + 650.00 = 1,300.00; 150.00 + 150.00 taken off → bill 1,000.00
    const workingOff = [visit(PA, "650.00", "150.00"), visit(BEN, "650.00", "150.00")];
    expect(helperBillTotal(workingOff)).toBe(100000);
    expect(helperPaidBy(workingOff)).toEqual(
      new Map([
        [PA, 50000],
        [BEN, 50000],
      ]),
    );
  });
});

describe("helperMonthSummary", () => {
  it("breaks the bill down as daily pay + early pay − taken off", () => {
    // Daily pay 700 + 700 + 350 = 1,750.00 · early pay 500.00 · taken off 150 + 350 = 500.00
    // → 1,750.00 + 500.00 − 500.00 = 1,750.00 handed over
    expect(helperMonthSummary(month)).toEqual({
      dailyPay: 175000,
      earlyPay: 50000,
      takenOff: 50000,
      handedOver: 175000,
    });
  });

  it("ignores the carried-over debt", () => {
    expect(helperMonthSummary([start])).toEqual({ dailyPay: 0, earlyPay: 0, takenOff: 0, handedOver: 0 });
  });
});

describe("owesAfter", () => {
  it("adds early pay and the carried-over debt, minus everything taken off", () => {
    // 300.00 + 500.00 − 150.00 − 350.00 = 300.00
    expect(owesAfter(month).get(paFullyTakenOff.id)).toBe(30000);
  });

  it("gives her debt after each entry, like the sheet's Remaining column", () => {
    expect(owesAfter(month)).toEqual(
      new Map([
        [start.id, 30000],
        [benVisit.id, 30000],
        [anaEarly.id, 80000],
        [paVisit.id, 65000],
        [paFullyTakenOff.id, 30000],
      ]),
    );
  });

});

describe("countsInBill", () => {
  it("is false only for the debt carried over from the sheet", () => {
    expect(countsInBill(benVisit)).toBe(true);
    expect(countsInBill(anaEarly)).toBe(true);
    expect(countsInBill(start)).toBe(false);
  });
});

describe("ledgerCompare", () => {
  const at = (entry: HelperEntryInput, onDate: string | null) => ({ ...entry, onDate });

  it("puts the starting debt first, then dates, with no date last", () => {
    const sorted = [
      at(benVisit, null),
      at(paVisit, "2026-08-20"),
      at(start, null),
      at(anaEarly, "2026-08-05"),
    ].sort(ledgerCompare);
    expect(sorted.map((e) => e.id)).toEqual([start.id, anaEarly.id, paVisit.id, benVisit.id]);
  });

  it("puts early pay before a visit on the same day, whatever was logged first", () => {
    const sorted = [at(paVisit, "2026-08-12"), at(anaEarly, "2026-08-12")].sort(ledgerCompare);
    expect(sorted.map((e) => e.id)).toEqual([anaEarly.id, paVisit.id]);
  });
});

describe("firstOverdrawn", () => {
  it("is null while she never owes less than ₱0", () => {
    expect(firstOverdrawn(month)).toBeNull();
  });

  it("finds the first entry taking off more than she had, even if the end total is fine", () => {
    // Taken off 150.00 with nothing owed yet → −150.00; the early pay after it brings it to 350.00.
    const early = visit(PA, "700.00", "150.00");
    expect(firstOverdrawn([early, anaEarly])).toEqual({ entry: early, owes: -15000 });
  });
});
