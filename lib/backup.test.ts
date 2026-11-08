// The Download backup (lib/backup.ts): a backup is only worth something if it restores. These
// run the real migrations in PGlite (Postgres inside the test, never the live database), back
// up made-up rows, restore them into a fresh database and compare.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { backupZipStream, buildBackupSql, manilaClock, orderTables, type Query } from "./backup";
import { migratedDb } from "./test-db";

const NOW = new Date("2026-10-11T06:03:00Z");

const queryOf = (pg: PGlite): Query => async <T,>(text: string) => (await pg.query<T>(text)).rows;

/** Made-up rows in every table: centavos, quotes and backslashes, timestamps, nulls, a gap in the ids. */
const SAMPLE = `
  INSERT INTO members (name, sort_order, is_collector, email, auth_user_id, role) VALUES
    ('Ana', 0, true, 'ana@example.com', '00000000-0000-4000-8000-000000000001', 'admin'),
    ('Gone', 1, false, NULL, NULL, 'member'),
    ('Ben O''Neil \\ Jr.', 2, false, 'ben@example.com', NULL, 'member');
  DELETE FROM members WHERE name = 'Gone';
  INSERT INTO billing_periods (year, month, status, closed_at, notes) VALUES
    (2026, 8, 'closed', '2026-09-01T10:00:00.123456+08', E'line one\\nline "two"'),
    (2026, 9, 'open', NULL, NULL);
  INSERT INTO bill_items (period_id, name, total_amount, paid_by_id, split_mode, due_date, status) VALUES
    (1, 'Meralco', 4321.07, 1, 'points', '2026-08-20', 'confirmed'),
    (2, 'Water', 0.01, 3, 'equal', NULL, 'pending');
  INSERT INTO bill_item_shares (bill_item_id, member_id, amount, points, is_override) VALUES
    (1, 1, 2160.54, 12.50, false), (1, 3, 2160.53, 12.50, true);
  INSERT INTO shared_columns (period_id, name, split_mode, is_default) VALUES (1, 'Advances Shared', 'equal', true);
  INSERT INTO shared_column_members (column_id, member_id, included, amount) VALUES (1, 1, true, NULL), (1, 3, false, 99.99);
  INSERT INTO advances (period_id, column_id, payer_id, category, description, amount, spent_on, from_drawer) VALUES
    (1, 1, 3, 'grocery', 'Rice & eggs', 999999999.99, '2026-08-05', true);
  INSERT INTO payments (period_id, from_member_id, to_member_id, amount, paid_on, note) VALUES
    (1, 3, 1, 1500.00, '2026-08-31', 'GCash');
  INSERT INTO bill_emails (message_id, received_at, from_address, subject, snippet, provider, amount, fee, bill_year, bill_month, status, bill_item_id) VALUES
    ('<a@example.com>', '2026-08-15T01:02:03Z', 'bills@example.com', 'Your bill', 'Amount due…', 'meralco', 1234.56, 0.50, 2026, 8, 'imported', 1);
  INSERT INTO period_balances (period_id, member_id, opening_balance, closing_balance) VALUES (1, 1, 0, -12.34), (1, 3, 0, 12.34);
  INSERT INTO receipts (storage_path, content_type, size_bytes, original_name, payment_id, uploaded_by_id) VALUES
    ('2026/08/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg', 'image/jpeg', 1234, NULL, 1, 1);
  INSERT INTO keep_alive (id, pinged_at) VALUES (1, '2026-10-08T07:13:20Z');
  INSERT INTO household_settings (id, house_budget_emoji) VALUES (1, '🏦');
  INSERT INTO backups (taken_at, taken_by_id) VALUES ('2026-10-01T07:00:00Z', 1);
  INSERT INTO helper_entries (period_id, kind, payer_id, on_date, amount, deduction, note, from_drawer) VALUES
    (1, 'opening', NULL, NULL, 2000.00, 0, NULL, false), (1, 'visit', 3, '2026-08-09', 600.00, 100.00, 'Half day', true);
  INSERT INTO cash_drawer_entries (kind, on_date, amount, person, note, to_account) VALUES
    ('cash_in', '2026-08-01', 5000.00, NULL, 'From the bank', false), ('lent', '2026-08-02', 0.01, 'Ben O''Neil', NULL, false),
    ('paid_back', '2026-08-03', 0.01, 'Ben O''Neil', NULL, true);
  INSERT INTO reminder_sends (period_id, kind, member_id, sent_at, seen_at) VALUES
    (1, 'last_day', 3, '2026-08-31T00:00:00Z', NULL), (1, 'payables', 3, '2026-09-01T01:00:00Z', '2026-09-02T03:04:05.678901Z');
  INSERT INTO member_devices (member_id, via, platform) VALUES (1, 'app', 'iphone'), (3, 'web', 'other');
  INSERT INTO push_subscriptions (member_id, endpoint, p256dh, auth, platform, live) VALUES
    (1, 'https://web.push.apple.com/QAbc-123', 'BPub_key-1', 'auth-1', 'iphone', true),
    (3, 'https://fcm.googleapis.com/fcm/send/x:y', 'BPub_key-2', 'auth-2', 'android', false);
  INSERT INTO billers (name, sort_order) VALUES ('Water Co', 1);
  INSERT INTO biller_fields (biller_id, kind, label, value, secret_value, housemates_can_see) VALUES
    (1, 'text', 'Account no.', 'X-0001', NULL, true), (1, 'secret', 'Password', NULL, 'v1:bm9uY2U=:Y2lwaGVy', false);
`;

/** Every table's rows as text, to compare two databases. */
async function snapshot(pg: PGlite): Promise<Record<string, string[]>> {
  const { rows: tables } = await pg.query<{ name: string }>(
    `SELECT quote_ident(relname) AS name FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname`,
  );
  const result: Record<string, string[]> = {};
  for (const { name } of tables) {
    const { rows } = await pg.query<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM public.${name} t ORDER BY 1`);
    result[name] = rows.map((r) => r.row);
  }
  return result;
}

/** What `psql -f` does, minus its own \set line. */
const restore = (pg: PGlite, dump: string) => pg.exec(dump.replace(/^\\set .*$/m, ""));

describe("orderTables", () => {
  const t = (oid: number) => ({ oid, ident: `t${oid}` });

  it("puts parents before children", () => {
    // 3 → 2 → 1, and 3 → 1
    const ordered = orderTables([t(3), t(2), t(1)], [[3, 2], [2, 1], [3, 1]]).map((x) => x.oid);
    expect(ordered).toEqual([1, 2, 3]);
  });

  it("ignores parents outside the tables being backed up", () => {
    expect(orderTables([t(1)], [[1, 99]]).map((x) => x.oid)).toEqual([1]);
  });

  it("refuses a cycle and a table that references itself", () => {
    expect(() => orderTables([t(1), t(2)], [[1, 2], [2, 1]])).toThrow(/cycle: t1, t2/);
    expect(() => orderTables([t(1)], [[1, 1]])).toThrow(/t1: it references itself/);
  });
});

describe("buildBackupSql", () => {
  it("restores every row exactly into a freshly migrated database", { timeout: 60_000 }, async () => {
    const source = await migratedDb();
    await source.exec(SAMPLE);
    await source.exec(`CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial);
      INSERT INTO drizzle.__drizzle_migrations DEFAULT VALUES; INSERT INTO drizzle.__drizzle_migrations DEFAULT VALUES;`);
    // A new table needs sample rows above, or a backup bug in it would go unnoticed here.
    const empty = Object.entries(await snapshot(source)).filter(([, rows]) => rows.length === 0);
    expect(empty.map(([name]) => name), "tables with no rows in SAMPLE").toEqual([]);
    const dump = await buildBackupSql(queryOf(source), { now: NOW, commit: "abc1234" });

    expect(dump).toMatch(/^-- Made 2026-10-11 \(Manila\)/m);
    expect(dump).toMatch(/commit abc1234; migrations applied: 2\./);
    expect(dump).toMatch(/^-- Rows: .*\bmembers 2\b/m);
    expect(dump).toMatch(/^-- Rows: .*\bkeep_alive 1\b/m);
    expect(dump).toMatch(/^\\set ON_ERROR_STOP on\nBEGIN;$/m);
    expect(dump.trimEnd().endsWith("COMMIT;")).toBe(true);

    const target = await migratedDb();
    await restore(target, dump);
    expect(await snapshot(target)).toEqual(await snapshot(source));

    // The id counters moved past the restored ids (3, after the gap), so new rows don't collide.
    const { rows } = await target.query<{ id: number }>(`INSERT INTO members (name) VALUES ('New') RETURNING id`);
    expect(rows[0].id).toBe(4);
  });

  it("changes nothing when the database isn't empty", { timeout: 60_000 }, async () => {
    const db = await migratedDb();
    await db.exec(SAMPLE);
    const before = await snapshot(db);
    const dump = await buildBackupSql(queryOf(db), { now: NOW });
    expect(dump).toMatch(/commit unknown; migrations applied: unknown\./);

    await expect(restore(db, dump)).rejects.toThrow(/duplicate key/);
    await db.exec("ROLLBACK"); // psql would have stopped and disconnected here
    expect(await snapshot(db)).toEqual(before);
  });

  it("fails loudly in a different schema instead of leaving a column empty", { timeout: 60_000 }, async () => {
    const source = await migratedDb();
    await source.exec(SAMPLE);
    const dump = await buildBackupSql(queryOf(source), { now: NOW });

    // A money column renamed since the backup: the restore stops, nothing is written.
    const renamed = await migratedDb();
    await renamed.exec(`ALTER TABLE bill_emails RENAME COLUMN fee TO payment_fee`);
    await expect(restore(renamed, dump)).rejects.toThrow(/column "fee"/);
    await renamed.exec("ROLLBACK");
    expect(Object.values(await snapshot(renamed)).flat()).toEqual([]);

    // A column added since the backup: restored rows get its default, not an empty value.
    const added = await migratedDb();
    await added.exec(`ALTER TABLE period_balances ADD COLUMN carried numeric(12,2) NOT NULL DEFAULT 0`);
    await restore(added, dump);
    const { rows } = await added.query<{ carried: string }>(`SELECT carried::text FROM period_balances`);
    expect(rows.map((r) => r.carried)).toEqual(["0.00", "0.00"]);
  });

  it("backs up an empty database as a file that restores to nothing", { timeout: 60_000 }, async () => {
    const empty = await migratedDb();
    const dump = await buildBackupSql(queryOf(empty), { now: NOW });
    expect(dump).not.toMatch(/^INSERT/m);
    const target = await migratedDb();
    await restore(target, dump);
    expect(Object.values(await snapshot(target)).flat()).toEqual([]);
  });
});

describe("backupZipStream", () => {
  const pictures: Record<string, Uint8Array> = {
    "2026/08/a.jpg": new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]),
    "2026/09/b.png": new Uint8Array(200_000).map((_, i) => i % 251),
  };

  /** Reads the stream to the end, like the browser saving the download. */
  const collect = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());

  it("holds the .sql and every picture under receipts/, byte for byte; skips a deleted one", async () => {
    const skipped: string[] = [];
    const zip = await collect(
      backupZipStream({
        sqlName: "data.sql",
        sql: "-- hello ₱\nBEGIN;\n",
        now: NOW,
        paths: ["2026/08/a.jpg", "2026/08/deleted.jpg", "2026/09/b.png"],
        download: async (path) => pictures[path] ?? null,
        onSkip: (path) => skipped.push(path),
      }),
    );
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["data.sql", "receipts/2026/08/a.jpg", "receipts/2026/09/b.png"]);
    expect(new TextDecoder().decode(files["data.sql"])).toBe("-- hello ₱\nBEGIN;\n");
    expect(files["receipts/2026/08/a.jpg"]).toEqual(pictures["2026/08/a.jpg"]);
    expect(files["receipts/2026/09/b.png"]).toEqual(pictures["2026/09/b.png"]);
    expect(skipped).toEqual(["2026/08/deleted.jpg"]);
  });

  it("works with no pictures at all", async () => {
    const zip = await collect(backupZipStream({ sqlName: "data.sql", sql: "x", now: NOW, paths: [], download: async () => null }));
    expect(Object.keys(unzipSync(zip))).toEqual(["data.sql"]);
  });

  it("fails the stream when a picture can't be downloaded", async () => {
    let done = false;
    const stream = backupZipStream({
      sqlName: "data.sql",
      sql: "x",
      now: NOW,
      paths: ["2026/08/a.jpg"],
      onDone: async () => {
        done = true;
      },
      download: async () => {
        throw new Error("Storage is down");
      },
    });
    await expect(collect(stream)).rejects.toThrow("Storage is down");
    expect(done).toBe(false); // a failed backup isn't recorded, so the reminder stays
  });

  it("is recorded once every file is in, before the stream ends", async () => {
    const events: string[] = [];
    const stream = backupZipStream({
      sqlName: "data.sql",
      sql: "x",
      now: NOW,
      paths: ["2026/08/a.jpg"],
      download: async (path) => pictures[path],
      onDone: async () => {
        events.push("done");
      },
    });
    const zip = await collect(stream);
    events.push("read");
    expect(events).toEqual(["done", "read"]);
    expect(Object.keys(unzipSync(zip))).toHaveLength(2);
  });

  it("dates the files on Manila's clock, whatever the server's timezone", async () => {
    // 07:00 UTC is 3:00 PM in Manila. A zip stores the time without a timezone.
    const clock = manilaClock(new Date("2026-10-11T07:00:00Z"));
    expect([clock.getFullYear(), clock.getMonth() + 1, clock.getDate(), clock.getHours(), clock.getMinutes()]).toEqual([2026, 10, 11, 15, 0]);
    // Just after midnight in Manila is still the previous day in UTC.
    expect(manilaClock(new Date("2026-10-11T16:30:00Z")).getDate()).toBe(12);

    // The first file's header (offset 0): time at bytes 10–11, date at 12–13 (MS-DOS format).
    const zip = await collect(backupZipStream({ sqlName: "data.sql", sql: "x", now: NOW, paths: [], download: async () => null }));
    const view = new DataView(zip.buffer, zip.byteOffset);
    const time = view.getUint16(10, true);
    const date = view.getUint16(12, true);
    // NOW is 06:03 UTC → 14:03 in Manila.
    expect([1980 + (date >> 9), (date >> 5) & 15, date & 31, time >> 11, (time >> 5) & 63]).toEqual([2026, 10, 11, 14, 3]);
  });
});

describe("what the backup covers", () => {
  // New tables are covered on their own (read from the catalog; SAMPLE must fill them). Files
  // aren't: each Storage bucket has to be added to the zip (app/backup/route.ts) and to
  // storage:backup / storage:restore by hand. This fails until a new bucket is.
  const BACKED_UP_BUCKETS = ["RECEIPTS_BUCKET"];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sourceFiles(path);
      return /\.(ts|tsx|mts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it("has every Storage bucket the code uses", () => {
    const root = join(__dirname, "..");
    const used = ["app", "components", "lib", "db", "scripts"]
      .flatMap((d) => sourceFiles(join(root, d)))
      .flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/storage\s*\.\s*(?:from|createBucket|updateBucket|getBucket)\(\s*([^),]+)/g)].map(
          (m) => `${m[1].trim()} (${relative(root, file)})`,
        ),
      );
    expect(used.length).toBeGreaterThan(0);
    const unknown = used.filter((u) => !BACKED_UP_BUCKETS.includes(u.split(" ")[0]));
    expect(unknown, "buckets the Download backup doesn't cover").toEqual([]);
  });
});
