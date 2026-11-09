import { model, ok, projection, trycatch, wire, type MaybePromise, type Result, type Tagged } from '../../src/index.js';
import type { SQLiteStore } from '../../src/sqlite.js';
import { Account, Deposited, Summary } from '../fixtures.js';

/** Deliberately increments a counter: replaying a committed batch would double-count it. */
export function durableBank(storage: SQLiteStore, afterWrite?: () => MaybePromise<Result<void, Tagged>>) {
  storage.database.exec('CREATE TABLE IF NOT EXISTS deposited_totals(account_id TEXT PRIMARY KEY, total INTEGER NOT NULL) STRICT');
  const increment = storage.database.prepare(`
    INSERT INTO deposited_totals(account_id, total) VALUES (?, ?)
    ON CONFLICT(account_id) DO UPDATE SET total = total + excluded.total
  `);
  const totals = projection('Totals', { from: Account, on: [Deposited], batch: { size: 2 } }, batch => {
    const result = trycatch(() => { for (const { source, event } of batch) increment.run(source.id, event.amount); });
    if (result[1] !== null) return result;
    return afterWrite?.() ?? ok(undefined);
  });
  return wire(model('DurableBank', {
    aggregates: { account: Account }, views: { summary: Summary }, projections: [totals],
  }), { storage });
}

export function total(storage: SQLiteStore, accountId = 'a'): number {
  return (storage.database.prepare('SELECT total FROM deposited_totals WHERE account_id = ?').get(accountId)?.total ?? 0) as number;
}
