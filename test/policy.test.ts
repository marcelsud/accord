import assert from 'node:assert/strict';
import test from 'node:test';
import {
  event, fail, memory, model, ok, on, policy, service, integer, view,
  wire, type Envelope,
} from '../src/index.js';
import { Account, Bank, Deposited, NotOpen, Opened } from './fixtures.js';
import { failure, success } from './helpers.js';

test('on() policies dispatch payloads with services and optional envelope metadata', async () => {
  const Rules = service('PolicyRules', { maximum: integer });
  const seen: string[] = [];
  const received: Envelope<ReturnType<typeof Deposited>>[] = [];
  const reaction = policy('PayloadPolicy', { from: Account, uses: { rules: Rules } },
    on(Opened, event => { seen.push(event._tag); return ok(undefined); }),
    on(Deposited, async (event, { rules, idempotencyKey, at }, envelope) => {
      assert.equal(event, envelope.event);
      assert.equal(idempotencyKey, envelope.id);
      assert.equal(at, envelope.at);
      seen.push(`${event._tag}:${Math.min(event.amount, rules.maximum)}`);
      received.push(envelope);
      return ok(undefined);
    }),
  );
  const bank = wire(model('PayloadBank', { aggregates: { account: Account }, policies: [reaction] }), {
    services: { rules: { maximum: 50 } },
  });
  success(await bank.account.open('a', {}));
  const receipt = success(await bank.account.deposit('a', { amount: 100 }));
  success(await bank.account.withdraw('a', { amount: 1 }));
  assert.deepEqual(seen, []);
  success(await bank.flush());
  success(await bank.flush());
  assert.deepEqual(seen, ['Opened', 'Deposited:50']);
  assert.deepEqual(received, receipt.events);
});

test('on() policies skip history and retry failed events with stable metadata', async () => {
  const storage = memory();
  const original = wire(Bank, { storage });
  success(await original.account.open('a', {}));
  success(await original.account.deposit('a', { amount: 10 }));
  const attempts: Envelope<ReturnType<typeof Deposited>>[] = [];
  const reaction = policy('RetryPayload', { from: Account }, on(Deposited, (event, _services, envelope) => {
    attempts.push(envelope);
    assert.equal(event.amount, 20);
    return attempts.length === 1 ? fail(NotOpen()) : ok(undefined);
  }));
  const bank = wire(model('Bank', { aggregates: { account: Account }, policies: [reaction] }), { storage });
  success(await bank.flush());
  assert.equal(attempts.length, 0);
  const receipt = success(await bank.account.deposit('a', { amount: 20 }));
  success(await bank.account.withdraw('a', { amount: 1 }));
  assert.equal(failure(await bank.flush())._tag, 'NotOpen');
  success(await bank.flush());
  success(await bank.flush());
  assert.deepEqual(attempts, [receipt.events[0], receipt.events[0]]);
});

test('on() policies consume view events and skip historical view rebuilds', async () => {
  const storage = memory();
  const initial = wire(Bank, { storage });
  success(await initial.account.open('a', {}));
  success(await initial.account.deposit('a', { amount: 10 }));
  const makeView = (version: number) => view('PolicySource', { from: Account, initial: { total: 0 }, version },
    on(Deposited, (state, event) => ({ total: state.total + event.amount })),
  );
  const received: number[] = [];
  const makeBank = (version: number) => {
    const source = makeView(version);
    const reaction = policy('ViewPolicy', { from: source }, on(Deposited, event => {
      received.push(event.amount);
      return ok(undefined);
    }));
    return wire(model('Bank', { aggregates: { account: Account }, views: { source }, policies: [reaction] }), { storage });
  };
  const first = makeBank(1);
  success(await first.flush());
  assert.deepEqual(received, []);
  success(await first.account.deposit('a', { amount: 20 }));
  success(await first.flush());
  const rebuilt = makeBank(2);
  success(await rebuilt.flush());
  assert.deepEqual(received, [20]);
  success(await rebuilt.account.deposit('a', { amount: 30 }));
  success(await rebuilt.flush());
  assert.deepEqual(received, [20, 30]);
});

test('policy declarations reject missing, duplicate, malformed, and mixed handlers', () => {
  assert.throws(() => (policy as Function)('Empty', { from: Account }), /at least one/);
  assert.throws(() => policy('Duplicate', { from: Account }, on(Deposited, () => ok(undefined)), on(Deposited, () => ok(undefined))), /Duplicate policy handler/);
  assert.throws(() => (policy as Function)('Malformed', { from: Account }, { event: Deposited, handle: 1 }), /Expected an on\(\) policy handler/);
  assert.throws(() => (policy as Function)('Mixed', { from: Account, on: [Deposited] }, on(Deposited, () => ok(undefined))), /either a policy contract body or on\(\) handlers/);
  const unknown = policy('Unknown', { from: Account }, (on as Function)(event('Unrelated'), () => ok(undefined)));
  assert.throws(() => model('BadSource', { aggregates: { account: Account }, policies: [unknown] }), /Unknown source event/);
});

test('on() policy exceptions and malformed results become Unexpected failures', async () => {
  const original = new Error('handler failed');
  const broken = policy('Broken', { from: Account }, on(Deposited, () => { throw original; }));
  const invalid = (policy as Function)('Invalid', { from: Account }, (on as Function)(Deposited, () => 42));
  const bank = wire(Bank);
  success(await bank.account.open('a', {}));
  const envelope = success(await bank.account.deposit('a', { amount: 1 })).events[0]!;
  const error = failure(await broken.handle({ ...envelope, event: Deposited.parse(envelope.event) }, {}));
  assert.equal(error._tag, 'Unexpected');
  assert.ok(error instanceof Error);
  assert.equal(error.cause, original);
  assert.equal(failure(await invalid.handle(envelope, {}))._tag, 'Unexpected');
});
