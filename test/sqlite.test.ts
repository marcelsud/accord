import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { aggregate, event, fail, integer, model, ok, on, policy, stream, string, wire, workflow } from '../src/index.js';
import { sqlite } from '../src/sqlite.js';
import { Account, Deposited, NotOpen } from './fixtures.js';
import { durableBank, total } from './fixtures/durable-bank.js';
import { failure, success } from './helpers.js';
import { openLedger } from './fixtures/notification-ledger.js';
import { createBank as pureBank } from './fixtures/notification-pure.js';
import { createBank as effectBank } from './fixtures/notification-effect.js';

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'accord-storage-'));
  return { filename: join(directory, 'runtime.sqlite'), [Symbol.dispose]() { rmSync(directory, { recursive: true, force: true }); } };
}

test('SQLite restores state, stable event IDs, views, and consumer checkpoints after reopening', async () => {
  using temporary = temporaryDatabase();
  let eventIds: string[];
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    success(await bank.account.open('a', {}));
    success(await bank.account.deposit('a', { amount: 100 }));
    success(await bank.account.deposit('a', { amount: 50 }));
    eventIds = success(await bank.account.events('a')).map(event => event.id);
    assert.equal(total(storage), 0);
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    assert.deepEqual(success(await bank.account.get('a')), { open: true, balance: 150 });
    assert.deepEqual(success(await bank.account.events('a')).map(event => event.id), eventIds);
    success(await bank.flush());
    success(await bank.flush());
    assert.equal(total(storage), 150);
    assert.deepEqual(success(await bank.summary.get('a')), { balance: 150 });
    assert.equal(success(await bank.summary.events('a')).length, 2);
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    success(await bank.flush());
    assert.equal(total(storage), 150);
    assert.equal(success(await bank.summary.events('a')).length, 2);
    const receipt = success(await bank.account.deposit('a', { amount: 25 }));
    assert.equal(receipt.events[0]!.seq, 4);
    assert.ok(!eventIds.includes(receipt.events[0]!.id));
    assert.deepEqual(success(await bank.summary.get('a', { atLeast: receipt })), { balance: 175 });
    assert.equal(total(storage), 175);
  }
});

test('SQLite persists command receipts and rejects conflicting command retries after restart', async () => {
  using temporary = temporaryDatabase();
  let original;
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    success(await bank.account.open('a', {}, { commandId: 'open' }));
    original = success(await bank.account.deposit('a', { amount: 25 }, { commandId: 'deposit' }));
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    assert.deepEqual(success(await bank.account.deposit('a', { amount: 25 }, { commandId: 'deposit' })), original);
    assert.equal(failure(await bank.account.deposit('a', { amount: 30 }, { commandId: 'deposit' }))._tag, 'CommandConflict');
    assert.equal(success(await bank.account.events('a')).length, 2);
    success(await bank.flush());
    assert.equal(total(storage), 25);
  }
});

test('SQLite rolls back projection writes on failure and retries the pending batch after restart', async () => {
  using temporary = temporaryDatabase();
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage, () => fail(NotOpen()));
    success(await bank.account.open('a', {}));
    success(await bank.account.deposit('a', { amount: 100 }));
    success(await bank.account.deposit('a', { amount: 50 }));
    assert.equal(failure(await bank.flush())._tag, 'NotOpen');
    assert.equal(total(storage), 0);
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    success(await bank.flush());
    success(await bank.flush());
    assert.equal(total(storage), 150);
  }
});

test('SQLite commits projection effects and checkpoints atomically even when checkpoint writes fail', async () => {
  using temporary = temporaryDatabase();
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    success(await bank.account.open('a', {}));
    success(await bank.account.deposit('a', { amount: 100 }));
    storage.database.exec(`
      CREATE TRIGGER reject_checkpoint BEFORE INSERT ON accord_checkpoints
      WHEN NEW.kind = 'cursors' AND NEW.consumer = '["DurableBank","consumer","Totals",1]' AND NEW.seq > 1
      BEGIN SELECT RAISE(ABORT, 'checkpoint failed'); END;
    `);
    assert.equal(failure(await bank.flush())._tag, 'Unexpected');
    assert.equal(total(storage), 0);
  }
  {
    using storage = sqlite(temporary.filename);
    storage.database.exec('DROP TRIGGER reject_checkpoint');
    const bank = durableBank(storage);
    success(await bank.flush());
    assert.equal(total(storage), 100);
  }
});

test('SQLite resumes after the last committed batch rather than replaying earlier increments', async () => {
  using temporary = temporaryDatabase();
  {
    using storage = sqlite(temporary.filename);
    let batches = 0;
    const bank = durableBank(storage, () => ++batches === 2 ? fail(NotOpen()) : ok(undefined));
    success(await bank.account.open('a', {}));
    for (const amount of [1, 2, 3, 4, 5]) success(await bank.account.deposit('a', { amount }));
    assert.equal(failure(await bank.flush())._tag, 'NotOpen');
    assert.equal(total(storage), 3);
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    success(await bank.flush());
    assert.equal(total(storage), 15);
  }
});

test('SQLite rolls back state, events, and receipts when event persistence fails', async () => {
  using temporary = temporaryDatabase();
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    success(await bank.account.open('a', {}));
    success(await bank.account.deposit('a', { amount: 100 }));
    storage.database.exec(`CREATE TRIGGER reject_event BEFORE INSERT ON accord_events
      WHEN NEW.kind = 'aggregate' AND NEW.seq = 3 BEGIN SELECT RAISE(ABORT, 'event failed'); END`);
    assert.equal(failure(await bank.account.deposit('a', { amount: 50 }, { commandId: 'retry' }))._tag, 'Unexpected');
    assert.deepEqual(success(await bank.account.get('a')), { open: true, balance: 100 });
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    assert.equal(success(await bank.account.events('a')).length, 2);
    storage.database.exec('DROP TRIGGER reject_event');
    const receipt = success(await bank.account.deposit('a', { amount: 50 }, { commandId: 'retry' }));
    assert.equal(receipt.events[0]!.seq, 3);
    success(await bank.flush());
    assert.equal(total(storage), 150);
  }
});

test('SQLite rolls back projection effects and checkpoint updates when COMMIT fails', async () => {
  using temporary = temporaryDatabase();
  {
    using storage = sqlite(temporary.filename);
    storage.database.exec(`
      CREATE TABLE parents(id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE children(parent_id INTEGER REFERENCES parents(id) DEFERRABLE INITIALLY DEFERRED) STRICT;
    `);
    const bank = durableBank(storage, () => {
      storage.database.exec('INSERT INTO children(parent_id) VALUES (1)');
      return ok(undefined);
    });
    success(await bank.account.open('a', {}));
    success(await bank.account.deposit('a', { amount: 100 }));
    assert.equal(failure(await bank.flush())._tag, 'Unexpected');
    assert.equal(total(storage), 0);
    assert.equal(storage.database.prepare('SELECT COUNT(*) AS count FROM children').get()!.count, 0);
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    success(await bank.flush());
    success(await bank.flush());
    assert.equal(total(storage), 100);
  }
});

for (const mode of ['before-flush', 'during-write', 'after-flush']) {
  test(`SQLite recovers after an abrupt process exit ${mode}`, async () => {
    using temporary = temporaryDatabase();
    if (mode !== 'before-flush') {
      using storage = sqlite(temporary.filename);
      const bank = durableBank(storage);
      success(await bank.account.open('a', {}));
      success(await bank.account.deposit('a', { amount: 100 }));
    }
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/sqlite-crash.js', import.meta.url)), temporary.filename, mode], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(child.status, 42, child.error?.message ?? child.stderr);
    using storage = sqlite(temporary.filename);
    const bank = durableBank(storage);
    assert.deepEqual(success(await bank.account.get('a')), { open: true, balance: 100 });
    assert.equal(total(storage), mode === 'after-flush' ? 100 : 0);
    success(await bank.flush());
    success(await bank.flush());
    assert.equal(total(storage), 100);
  });
}

test('SQLite serializes independent connections without stale state or duplicate projection effects', async () => {
  using temporary = temporaryDatabase();
  using first = sqlite(temporary.filename);
  using second = sqlite(temporary.filename);
  const one = durableBank(first);
  const two = durableBank(second);
  success(await one.account.open('a', {}));
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? one : two).account.deposit('a', { amount: 5 })));
  results.forEach(result => success(result));
  (await Promise.all([one.flush(), two.flush()])).forEach(result => success(result));
  assert.deepEqual(success(await one.account.get('a')), { open: true, balance: 100 });
  assert.deepEqual(success(await two.account.get('a')), { open: true, balance: 100 });
  assert.equal(success(await one.account.events('a')).length, 21);
  assert.equal(total(first), 100);
});

test('SQLite queues reads behind a running handler and rejects close until its transaction finishes', async () => {
  using temporary = temporaryDatabase();
  using storage = sqlite(temporary.filename);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const bank = durableBank(storage, async () => { entered(); await resume; return ok(undefined); });
  success(await bank.account.open('a', {}));
  success(await bank.account.deposit('a', { amount: 100 }));
  const flushing = bank.flush();
  await started;
  let readCompleted = false;
  const reading = bank.account.get('a').then(result => { readCompleted = true; return result; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(readCompleted, false);
    assert.throws(() => storage.close(), /Await pending runtime operations/);
  } finally { release(); }
  success(await flushing);
  assert.deepEqual(success(await reading), { open: true, balance: 100 });
});

test('SQLite retains empty policy registration and pending deliveries across restart', async () => {
  using temporary = temporaryDatabase();
  const delivered: number[] = [];
  const reaction = policy('Notify', { from: Account }, on(Deposited, event => { delivered.push(event.amount); return ok(undefined); }));
  const definition = model('PolicyBank', { aggregates: { account: Account }, policies: [reaction] });
  {
    using storage = sqlite(temporary.filename);
    const bank = wire(definition, { storage });
    success(await bank.account.open('a', {}));
    success(await bank.account.deposit('a', { amount: 100 }));
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = wire(definition, { storage });
    success(await bank.flush());
    success(await bank.flush());
    assert.deepEqual(delivered, [100]);
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = wire(definition, { storage });
    success(await bank.flush());
    assert.deepEqual(delivered, [100]);
  }
});

test('SQLite persists factory snapshots, rich data, no-event commands, and explicit streams', async () => {
  using temporary = temporaryDatabase();
  const Changed = event('Changed');
  const Factory = aggregate('Factory', { values: new Map<string, bigint>(), at: new Date(0) }, ({ state, emit }) => ({
    set() { state.values.set('amount', 100n); state.at = new Date('2026-11-09T00:00:00Z'); emit(Changed()); return ok(100n); },
    touch() { state.values.set('touched', 1n); return ok(undefined); },
  }));
  const definition = model('Rich', { aggregates: { factory: Factory }, streams: { audit: stream('Audit', { key: string, event: { value: integer } }) } });
  {
    using storage = sqlite(temporary.filename);
    const bank = wire(definition, { storage });
    success(await bank.factory.set('a'));
    success(await bank.factory.touch('a'));
    success(await bank.streams.audit.append('all', { value: 1 }, { id: 'one' }));
  }
  {
    using storage = sqlite(temporary.filename);
    const bank = wire(definition, { storage });
    assert.deepEqual(success(await bank.factory.get('a')), { values: new Map([['amount', 100n], ['touched', 1n]]), at: new Date('2026-11-09T00:00:00Z') });
    assert.equal(success(await bank.factory.set('a')).version, 3);
    assert.equal(success(await bank.factory.events('a')).length, 2);
    assert.equal(success(await bank.streams.audit.append('all', { value: 1 }, { id: 'one' })).cursor, 1);
    assert.equal(success(await bank.streams.audit.list('all')).length, 1);
  }
});

test('SQLite rejects workflows rather than silently losing their progress', () => {
  using storage = sqlite(':memory:');
  const flow = workflow('Flow', { input: {}, reply: {}, key: () => 'one' }, () => ok({}));
  assert.throws(() => wire(model('Workflows', { aggregates: {}, workflows: { flow } }), { storage }), /does not yet support durable workflows/);
});

for (const [mode, createBank] of [['native', pureBank], ['Effect', effectBank]] as const) {
  test(`SQLite notification example shares the runtime transaction with the ${mode} projection`, async () => {
    using temporary = temporaryDatabase();
    const sent: string[] = [];
    const notifications = { async send(input: { eventId: string }) { sent.push(input.eventId); return ok({ id: input.eventId }); } };
    {
      using storage = sqlite(temporary.filename);
      using ledger = openLedger(storage.database);
      const { bank } = createBank(ledger, notifications, storage);
      success(await bank.account.open('a'));
      success(await bank.account.deposit('a', 100));
    }
    {
      using storage = sqlite(temporary.filename);
      using ledger = openLedger(storage.database);
      const { bank } = createBank(ledger, notifications, storage);
      success(await bank.flush());
      assert.equal(success(ledger.list()).length, 1);
      assert.equal(sent.length, 1);
    }
    {
      using storage = sqlite(temporary.filename);
      using ledger = openLedger(storage.database);
      const { bank } = createBank(ledger, notifications, storage);
      success(await bank.flush());
      assert.equal(success(ledger.list()).length, 1);
      assert.equal(sent.length, 1);
      assert.deepEqual(success(await bank.account.get('a')), { open: true, balance: 100 });
    }
  });
}
