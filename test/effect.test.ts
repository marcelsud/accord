import assert from 'node:assert/strict';
import test from 'node:test';
import { Cause, Effect, Exit, Layer } from 'effect';
import { effectify } from '../src/effect.js';
import { aggregate, command, external, fail, wire, integer, match, model, ok, on, policy, service, string, view } from '../src/index.js';
import { Account, Balance, Cents, Deposited, NotOpen, Opened, State, open } from './fixtures.js';
import { failure, success } from './helpers.js';
import { Bank as BankModel, DepositRules } from './fixtures/bank-domain.js';

const Rules = service('DepositRules', { maximum: integer });
const RulesKey = effectify(Rules);
const LimitedAccountContract = {
  state: State,
  commands: {
    deposit: { input: { amount: Cents }, events: [Deposited], rejects: [NotOpen], reply: Balance, uses: { rules: Rules } },
  },
};
const limited = command(
  LimitedAccountContract, 'deposit',
  effectify((state, input) => Effect.gen(function* () {
    const rules = yield* effectify(Rules);
    if (!state.open || input.amount > rules.maximum) return yield* Effect.fail(NotOpen());
    return { events: [Deposited(input)], reply: { balance: state.balance + input.amount } };
  })),
);
const LimitedAccount = aggregate('LimitedAccount', { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open, deposit: limited } },
  (state, event) => match(event, {
    Opened: () => ({ ...state, open: true }),
    Deposited: ({ amount }) => ({ ...state, balance: state.balance + amount }),
  }),
);

test('effectify creates stable function-style service keys without .service', () => {
  assert.equal(effectify(Rules), RulesKey);
  assert.equal(Effect.runSync(Effect.provideService(Effect.gen(function* () { return yield* effectify(Rules); }), RulesKey, { maximum: 100 })).maximum, 100);
});

test('Effect.gen command bodies use declared services and still return native tuples', async () => {
  const bank = wire(model('EffectBank', { aggregates: { account: LimitedAccount } }), { services: { rules: { maximum: 100 } } });
  success(await bank.account.open('a', {}));
  assert.equal(success(await bank.account.deposit('a', { amount: 50 })).reply.balance, 50);
  assert.equal(failure(await bank.account.deposit('a', { amount: 101 }))._tag, 'NotOpen');
  assert.equal(success(await bank.account.get('a')).balance, 50);
});

test('effectified command functions are lazy and compose with normal yield*', async () => {
  const program = Effect.gen(function* () {
    const result = yield* effectify(limited)({ open: true, balance: 10 }, { amount: 20 });
    return result.reply.balance;
  });
  assert.equal(await Effect.runPromise(Effect.provideService(program, RulesKey, { maximum: 100 })), 30);
  const rejection = await Effect.runPromiseExit(Effect.provideService(
    effectify(limited)({ open: false, balance: 0 }, { amount: 1 }), RulesKey, { maximum: 100 },
  ));
  assert.ok(Exit.isFailure(rejection));
  assert.deepEqual(Cause.squash(rejection.cause), NotOpen());
});

test('Effect-backed handlers run finalizers before returning tuples', async () => {
  const order: string[] = [];
  const finalizing = command(
    { state: State, input: {}, events: [Opened] },
    effectify(() => Effect.ensuring(
      Effect.sync(() => { order.push('body'); return { events: [Opened()] }; }),
      Effect.sync(() => { order.push('finalizer'); }),
    )),
  );
  success(await finalizing({ open: false, balance: 0 }, {}));
  assert.deepEqual(order, ['body', 'finalizer']);
});

test('Effect defects retain their original cause and never commit', async () => {
  const original = new TypeError('broken');
  const broken = command({ state: State, input: {}, events: [Opened] }, effectify(() => Effect.die(original)));
  const error = failure(await broken({ open: false, balance: 0 }, {}));
  assert.equal(error._tag, 'Unexpected');
  if (error._tag === 'Unexpected') assert.equal(error.cause, original);
});

test('Effect interruption cancels execution, runs finalizers, and leaves state unchanged', async () => {
  let finalized = false;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const slow = command(
    { state: State, input: {}, events: [Opened] },
    effectify(() => Effect.ensuring(
      Effect.gen(function* () {
        yield* Effect.sync(started);
        yield* Effect.never;
        return { events: [Opened()] };
      }),
      Effect.sync(() => { finalized = true; }),
    )),
  );
  const SlowAccount = aggregate('SlowAccount', { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open: slow } }, state => ({ ...state, open: true }));
  const bank = wire(model('SlowBank', { aggregates: { account: SlowAccount } }));
  const controller = new AbortController();
  const pending = bank.account.open('a', {}, { signal: controller.signal });
  await ready;
  controller.abort();
  assert.equal(failure(await pending)._tag, 'Unexpected');
  assert.equal(finalized, true);
  assert.equal(success(await bank.account.get('a')).open, false);
});

test('external dependency keys retain the native tuple service shape', async () => {
  const Notify = external('NotifyEffect', { input: { text: string }, reply: { id: string } }, input => ok({ id: input.text }));
  const notify = Notify.implement({});
  const program = Effect.gen(function* () {
    const send = yield* effectify(Notify);
    return yield* Effect.promise(() => send({ text: 'hello' }));
  });
  assert.deepEqual(success(await Effect.runPromise(Effect.provideService(program, effectify(Notify), notify))), { id: 'hello' });
});

test('Effect-backed policies receive uses as their environment', async () => {
  const seen: number[] = [];
  const reaction = policy('EffectPolicy', { from: Account, on: [Deposited], uses: { rules: Rules } },
    effectify(envelope => Effect.gen(function* () {
      const rules = yield* effectify(Rules);
      seen.push(Math.min(envelope.event.amount, rules.maximum));
      return undefined;
    })),
  );
  const bank = wire(model('PolicyBank', { aggregates: { account: Account }, policies: [reaction] }), { services: { rules: { maximum: 50 } } });
  success(await bank.account.open('a', {}));
  success(await bank.account.deposit('a', { amount: 100 }));
  success(await bank.flush());
  assert.deepEqual(seen, [50]);
});

test('Effect on() policies receive payloads, services, metadata, and finalize each retry', async () => {
  const attempts: string[] = [];
  const seen: number[] = [];
  let finalized = 0;
  const reaction = policy('EffectPayloadPolicy', { from: Account, uses: { rules: Rules } },
    on(Opened, event => { assert.equal(event._tag, 'Opened'); return ok(undefined); }),
    on(Deposited, effectify((event, services, envelope) => Effect.ensuring(
      Effect.gen(function* () {
        const rules = yield* effectify(Rules);
        assert.equal(rules, services.rules);
        assert.equal(services.idempotencyKey, envelope.id);
        assert.equal(event, envelope.event);
        attempts.push(envelope.id);
        if (attempts.length === 1) return yield* Effect.fail(NotOpen());
        seen.push(Math.min(event.amount, rules.maximum));
        return undefined;
      }),
      Effect.sync(() => { finalized++; }),
    ))),
  );
  const bank = wire(model('EffectPayloadBank', { aggregates: { account: Account }, policies: [reaction] }), {
    services: { rules: { maximum: 50 } },
  });
  success(await bank.account.open('a', {}));
  const receipt = success(await bank.account.deposit('a', { amount: 100 }));
  assert.equal(failure(await bank.flush())._tag, 'NotOpen');
  success(await bank.flush());
  success(await bank.flush());
  assert.deepEqual(attempts, [receipt.events[0]!.id, receipt.events[0]!.id]);
  assert.deepEqual(seen, [50]);
  assert.equal(finalized, 2);
});

test('effectified models resolve layers and run factory methods lazily through yield*', async () => {
  let calls = 0;
  const Audit = service('DepositAudit', { multiplier: integer });
  const audited: number[] = [];
  const Account = aggregate('FactoryAccount', { balance: 0 }, ({ state, emit, rules }) => ({
    deposit(amount: number) {
      calls++;
      state.balance += amount;
      emit(Deposited({ amount }));
      return amount > rules.maximum ? fail(NotOpen()) : ok({ balance: state.balance });
    },
  }), { uses: { rules: Rules } });
  const Summary = view('FactorySummary', { from: Account, on: [Deposited], state: Balance, initial: () => ({ balance: 0 }) },
    (state, event) => ({ balance: state.balance + event.amount }),
  );
  const audit = policy('AuditDeposit', { from: Account, on: [Deposited], uses: { audit: Audit } },
    ({ event }, { audit }) => {
      audited.push(event.amount * audit.multiplier);
      return ok(undefined);
    },
  );
  const Bank = model('FactoryBank', { aggregates: { account: Account }, views: { summary: Summary }, policies: [audit] });

  const program = Effect.gen(function* () {
    const bank = yield* effectify(Bank);
    const deposit = bank.account.deposit('a', 50);
    assert.equal(calls, 0);
    assert.deepEqual(yield* bank.account.get('a'), { balance: 0 });

    const receipt = yield* deposit;
    assert.equal(calls, 1);
    assert.deepEqual(receipt.reply, { balance: 50 });
    assert.deepEqual(yield* bank.summary.get('a', { atLeast: receipt }), { balance: 50 });

    const rejected = yield* Effect.exit(bank.account.deposit('a', 101));
    assert.ok(Exit.isFailure(rejected));
    assert.deepEqual(Cause.squash(rejected.cause), NotOpen());
    assert.deepEqual(yield* bank.account.get('a'), { balance: 50 });
    assert.deepEqual(yield* bank.account.events('a'), receipt.events);
  });

  const dependencies = Layer.merge(
    Layer.succeed(RulesKey, { maximum: 100 }),
    Layer.succeed(effectify(Audit), { multiplier: 2 }),
  );
  await Effect.runPromise(Effect.provide(program, dependencies));
  assert.deepEqual(audited, [100]);
});

test('named model layers share a wired bank within each provision', async () => {
  const Bank = effectify(BankModel, 'Bank');
  const BankLive = Bank.layer.pipe(Layer.provide(
    Layer.succeed(effectify(DepositRules), { maximum: 100 }),
  ));
  const read = Effect.gen(function* () {
    const bank = yield* Bank;
    return yield* bank.account.get('a');
  });
  const deposit = Effect.gen(function* () {
    const bank = yield* Bank;
    yield* bank.account.open('a');
    return yield* bank.account.deposit('a', 75);
  });
  const program = Effect.gen(function* () {
    const receipt = yield* deposit;
    const state = yield* read;
    const bank = yield* Bank;
    const summary = yield* bank.summary.get('a', { atLeast: receipt });
    return { state, summary };
  });

  assert.deepEqual(await Effect.runPromise(Effect.provide(program, BankLive)), {
    state: { status: 'OPEN', balance: 75 },
    summary: { balance: 75 },
  });
  assert.deepEqual(await Effect.runPromise(Effect.provide(read, BankLive)), {
    status: 'PENDING',
    balance: 0,
  });
});
