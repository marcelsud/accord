import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBank as createPureBank } from '../examples/sqlite-http/pure.js';
import { createBank as createEffectBank } from '../examples/sqlite-http/with-effect.js';
import { startDummyEndpoint } from '../examples/sqlite-http/dummy-http.js';
import { Deposited, HttpFailure } from '../examples/sqlite-http/domain.js';
import { openLedger } from '../examples/sqlite-http/sqlite.js';
import { failure, success } from './helpers.js';

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'accord-sqlite-http-'));
  return {
    filename: join(directory, 'ledger.sqlite'),
    [Symbol.dispose]() { rmSync(directory, { recursive: true, force: true }); },
  };
}

for (const [mode, createBank] of [['pure', createPureBank], ['effect', createEffectBank]] as const) {
  test(`${mode}: SQLite projection persists, replay upserts, and HTTP policy sends once`, async () => {
    const accountId = 'a-1-💸';
    using temporary = temporaryDatabase();
    await using endpoint = await startDummyEndpoint();
    {
      using ledger = openLedger(temporary.filename);
      const { bank, projection } = createBank(ledger, endpoint.url);
      success(await bank.account.open(accountId, {}));
      const receipt = success(await bank.account.deposit(accountId, { amount: 100 }, { commandId: 'deposit-1' }));
      assert.deepEqual(success(ledger.list()), []);
      success(await bank.flush());
      const rows = success(ledger.list(accountId));
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], {
        eventId: receipt.events[0]!.id, accountId: accountId, seq: 2, amount: 100, balance: 100,
      });
      assert.equal(endpoint.received.size, 1);
      assert.equal(endpoint.received.get(encodeURIComponent(receipt.events[0]!.id))?.notification.balance, 100);

      // Replaying the projection writes the same event ID, without incrementing a total.
      const replay = receipt.events.map(envelope => ({ ...envelope, event: Deposited.parse(envelope.event) }));
      success(await projection.handle(replay, { ledger }));
      assert.deepEqual(success(ledger.list(accountId)), rows);

      assert.deepEqual(success(await bank.account.deposit(accountId, { amount: 100 }, { commandId: 'deposit-1' })), receipt);
      success(await bank.flush());
      assert.equal(success(ledger.list()).length, 1);
      assert.equal(endpoint.attempts, 1);
    }
    // The projection remains on disk after its database connection closes.
    using reopened = openLedger(temporary.filename);
    assert.equal(success(reopened.list(accountId))[0]?.balance, 100);
  });

  test(`${mode}: failed HTTP responses retry the same accepted notification`, async () => {
    using ledger = openLedger();
    await using endpoint = await startDummyEndpoint({ failFirstAfterAccept: true });
    const { bank } = createBank(ledger, endpoint.url);
    success(await bank.account.open('a-1', {}));
    success(await bank.account.deposit('a-1', { amount: 100 }));
    assert.deepEqual(failure(await bank.flush()), HttpFailure({ status: 503 }));
    assert.equal(endpoint.attempts, 1);
    assert.equal(endpoint.received.size, 1);
    assert.equal(success(await bank.account.get('a-1')).balance, 100);

    success(await bank.flush());
    assert.equal(endpoint.attempts, 2);
    assert.equal(endpoint.received.size, 1);
    assert.equal(success(ledger.list()).length, 1);
  });

  test(`${mode}: the HTTP adapter returns tagged conflicts and respects cancellation`, async () => {
    using ledger = openLedger();
    await using endpoint = await startDummyEndpoint();
    const { notify } = createBank(ledger, endpoint.url);
    const input = { eventId: 'event-1', accountId: 'a-1', amount: 100, balance: 100 };
    const first = success(await notify(input));
    assert.deepEqual(success(await notify(input)), first);
    assert.deepEqual(failure(await notify({ ...input, amount: 200 })), HttpFailure({ status: 409 }));
    const attempts = endpoint.attempts;
    const controller = new AbortController();
    controller.abort();
    assert.equal(failure(await notify({ ...input, eventId: 'cancelled' }, { signal: controller.signal }))._tag, 'Unexpected');
    assert.equal(endpoint.attempts, attempts);
    assert.equal(endpoint.received.size, 1);
  });
}

test('SQLite batches roll back on constraint failures and bind account IDs as values', () => {
  using ledger = openLedger();
  const row = { eventId: 'one', accountId: "a'); DROP TABLE ledger; --", seq: 1, amount: 100, balance: 100 };
  assert.equal(failure(ledger.record([row, { ...row, eventId: 'two', amount: 0 }]))._tag, 'Unexpected');
  assert.deepEqual(success(ledger.list()), []);
  success(ledger.record([row]));
  assert.deepEqual(success(ledger.list(row.accountId)), [row]);
});
