import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregate, command, event, external, fail, wire, integer, literal, match, memory, model, nullable, number,
  object, ok, optional, parse, policy, projection, rejection, service, stream, string, trycatch, unexpected,
  union, view, type Result, type Tagged,
} from '../src/index.js';
import { Account, AlreadyOpen, Balance, Bank, Cents, Deposited, InsufficientFunds, NotOpen, Opened, State, Withdrawn, deposit, open } from './fixtures.js';

import { success, failure } from './helpers.js';

test('shapes validate properties, refinements, optionals, unions, and hostile keys', () => {
  const Shape = { label: string, count: optional(integer), note: nullable(string) };
  assert.deepEqual(parse(Shape, { label: 'one', note: null }), { label: 'one', note: null });
  assert.throws(() => parse(Shape, { label: 'one', note: null, extra: true }));
  assert.throws(() => parse(number, NaN));
  assert.throws(() => parse(integer, 1.5));
  assert.throws(() => parse(Cents, 0));
  assert.equal(parse(union(literal('yes'), literal('no')), 'yes'), 'yes');
  assert.throws(() => parse(union(literal('yes'), literal('no')), 'other'));
  const shape = object(JSON.parse('{"__proto__":{}}'));
  assert.throws(() => shape.parse({}));
});

test('events and rejections use fixed shapes and immutable tags', () => {
  assert.deepEqual(NotOpen(), { _tag: 'NotOpen' });
  assert.deepEqual(InsufficientFunds({ balance: 1, requested: 2 }), { _tag: 'InsufficientFunds', balance: 1, requested: 2 });
  assert.throws(() => (NotOpen as Function)({ anything: true }));
  assert.throws(() => InsufficientFunds({ balance: 1, requested: 0 }));
  assert.throws(() => (InsufficientFunds as Function)({ balance: 1, requested: 2, extra: true }));
  assert.throws(() => (rejection as Function)('Broken', { _tag: string }));
  assert.throws(() => Object.assign(NotOpen(), { _tag: 'Other' }));
});

test('trycatch preserves thrown values through cause for sync functions, async functions, and promises', async () => {
  assert.deepEqual(trycatch(() => 'ok'), ['ok', null]);
  assert.deepEqual(trycatch(() => null), [null, null]);
  assert.deepEqual(await trycatch(async () => 10), [10, null]);
  assert.deepEqual(await trycatch(Promise.resolve(undefined)), [undefined, null]);
  for (const thrown of [null, undefined, false, 'oops', Symbol('bad'), new Error('original')]) {
    const error = failure(trycatch(() => { throw thrown; }));
    assert.ok(error instanceof Error);
    assert.equal(error._tag, 'Unexpected');
    assert.equal(error.cause, thrown);
    assert.equal(failure(await trycatch(Promise.reject(thrown))).cause, thrown);
  }
});

test('match dispatches by tag and rejects malformed runtime inputs', () => {
  const value = match(InsufficientFunds({ balance: 3, requested: 4 }), { InsufficientFunds: e => e.requested - e.balance });
  assert.equal(value, 1);
  assert.throws(() => (match as Function)({ _tag: 'Other' }, { NotOpen: () => 0 }));
});

test('direct commands validate input, events, replies, and declared rejections', async () => {
  assert.equal(failure(await deposit({ open: false, balance: 0 }, { amount: 1 }))._tag, 'NotOpen');
  assert.equal(failure(await deposit({ open: true, balance: 0 }, { amount: 0 }))._tag, 'InvalidInput');
  assert.deepEqual(success(await deposit({ open: true, balance: 10 }, { amount: 5 })).reply, { balance: 15 });
  const broken = command({ state: State, input: {}, events: [Opened] }, (() => ok({ events: [{ _tag: 'Wrong' }] })) as never);
  assert.equal(failure(await broken({ open: false, balance: 0 }, {}))._tag, 'Unexpected');
  const rejected = command({ state: State, input: {}, events: [Opened] }, (() => fail(NotOpen())) as never);
  assert.equal(failure(await rejected({ open: false, balance: 0 }, {}))._tag, 'Unexpected');
  const wrongReply = command({ state: State, input: {}, events: [Opened], reply: Balance }, (() => ok({ events: [], reply: { balance: 'wrong' } })) as never);
  assert.equal(failure(await wrongReply({ open: false, balance: 0 }, {}))._tag, 'Unexpected');
});

test('wire serializes commands, deduplicates identities, and checks optimistic versions', async () => {
  const bank = wire(Bank);
  success(await bank.account.open('a', {}));
  const first = success(await bank.account.deposit('a', { amount: 10 }, { commandId: 'same' }));
  assert.deepEqual(success(await bank.account.deposit('a', { amount: 10 }, { commandId: 'same' })), first);
  assert.equal(failure(await bank.account.deposit('a', { amount: 20 }, { commandId: 'same' }))._tag, 'CommandConflict');
  assert.equal(failure(await bank.account.deposit('a', { amount: 10 }, { expectedVersion: 0 }))._tag, 'Conflict');
  const results = await Promise.all(Array.from({ length: 30 }, () => bank.account.deposit('a', { amount: 1 })));
  for (const result of results) success(result);
  assert.deepEqual(success(await bank.account.get('a')), { open: true, balance: 40 });
  assert.equal(success(await bank.account.events('a')).length, 32);
  assert.equal(success(await bank.account.events('a', { after: 30 })).length, 2);
});

test('aggregate contract commands share validation and state isolation in direct and runtime execution', async () => {
  const AccountContract = {
    state: State,
    commands: {
      open: { input: {}, events: [Opened], rejects: [AlreadyOpen] },
      deposit: { input: { amount: Cents }, events: [Deposited], rejects: [NotOpen], reply: Balance },
    },
  };
  const open = command(AccountContract, 'open', state => {
    if (state.open) return fail(AlreadyOpen());
    return ok({ events: [Opened()] });
  });
  const deposit = command(AccountContract, 'deposit', (state, input) => {
    const balance = state.balance + input.amount;
    state.balance = 999;
    if (!state.open) return fail(NotOpen());
    return ok({ events: [Deposited(input)], reply: { balance } });
  });
  const snapshot = { open: true, balance: 10 };
  assert.deepEqual(success(await deposit(snapshot, { amount: 5 })).reply, { balance: 15 });
  assert.deepEqual(snapshot, { open: true, balance: 10 });
  assert.equal(failure(await deposit(snapshot, { amount: 0 }))._tag, 'InvalidInput');
  assert.equal(failure(await deposit({ open: false, balance: 0 }, { amount: 5 }))._tag, 'NotOpen');
  assert.equal(failure(await deposit({ open: 'wrong', balance: 0 } as never, { amount: 5 }))._tag, 'Unexpected');
  const account = aggregate('NamedAccount', {
    state: AccountContract.state, initial: () => ({ open: false, balance: 0 }), commands: { open, deposit },
  }, Account.evolve);
  const bank = wire(model('NamedBank', { aggregates: { account } }));
  failure(await bank.account.deposit('a', { amount: 5 }));
  assert.deepEqual(success(await bank.account.get('a')), { open: false, balance: 0 });
  success(await bank.account.open('a', {}));
  assert.deepEqual(success(await bank.account.deposit('a', { amount: 5 })).reply, { balance: 5 });
  assert.deepEqual(success(await bank.account.get('a')), { open: true, balance: 5 });
});

test('aggregate contract commands reject unknown names, state overrides, and mismatched registrations', () => {
  const Contract = { state: State, commands: {
    open: { input: {}, events: [Opened] },
    deposit: { input: { amount: Cents }, events: [Deposited] },
  } };
  const body = () => ok({ events: [] });
  for (const name of ['missing', 'toString', '__proto__']) {
    assert.throws(() => (command as Function)(Contract, name, body), /Unknown command/);
  }
  assert.throws(() => (command as Function)({ state: State, commands: {
    open: { ...Contract.commands.open, state: State },
  } }, 'open', body), /state is inherited/);
  const open = command(Contract, 'open', body);
  const deposit = command({ ...Contract }, 'deposit', body);
  const initial = () => ({ open: false, balance: 0 });
  assert.throws(() => aggregate('WrongName', { state: State, initial, commands: { renamed: open } }, state => state), /does not belong/);
  assert.throws(() => aggregate('WrongState', { state: { open: integer }, initial: () => ({ open: 0 }), commands: { open } } as never, state => state), /does not belong/);
  assert.doesNotThrow(() => aggregate('SharedState', { state: State, initial, commands: { open, deposit } }, state => state));
});

test('failed reducers cannot partially commit and handler mutations do not escape', async () => {
  const mutate = command({ state: State, input: {}, events: [Opened], rejects: [NotOpen] }, state => {
    state.balance = 900;
    return fail(NotOpen());
  });
  const broken = aggregate('Broken', { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open, mutate } }, () => { throw new Error('reduce'); });
  const bank = wire(model('BrokenModel', { aggregates: { account: broken } }));
  assert.equal(failure(await bank.account.open('a', {}))._tag, 'Unexpected');
  assert.equal(failure(await bank.account.mutate('a', {}))._tag, 'NotOpen');
  assert.deepEqual(success(await bank.account.get('a')), { open: false, balance: 0 });
  assert.deepEqual(success(await bank.account.events('a')), []);
});

test('views catch up at receipts and returned snapshots cannot mutate stored state', async () => {
  const bank = wire(Bank);
  success(await bank.account.open('a', {}));
  const receipt = success(await bank.account.deposit('a', { amount: 50 }));
  assert.equal(success(await bank.summary.get('a')), null);
  const summary = success(await bank.summary.get('a', { atLeast: receipt }));
  assert.deepEqual(summary, { balance: 50 });
  summary!.balance = 900;
  assert.deepEqual(success(await bank.summary.get('a')), { balance: 50 });
  assert.equal(success(await bank.summary.snapshot('a')).cursor, 1);
  assert.equal(success(await bank.summary.events('a')).length, 1);
  assert.equal(failure(await bank.summary.get('a', { atLeast: { stream: receipt.stream, version: 999 } }))._tag, 'ConsistencyTimeout');
});

test('view versions rebuild from full history and model names isolate storage', async () => {
  const storage = memory();
  const bank = wire(Bank, { storage });
  success(await bank.account.open('a', {}));
  success(await bank.account.deposit('a', { amount: 10 }));
  success(await bank.flush());
  const Changed = view('Summary', { from: Account, on: [Deposited], state: Balance, version: 2, initial: () => ({ balance: 0 }) }, (state, event) => ({ balance: state.balance + 2 * event.amount }));
  const changed = wire(model('Bank', { aggregates: { account: Account }, views: { summary: Changed } }), { storage });
  success(await changed.flush());
  assert.deepEqual(success(await changed.summary.get('a')), { balance: 20 });
  const other = wire(model('OtherBank', { aggregates: { account: Account } }), { storage });
  assert.deepEqual(success(await other.account.get('a')), { open: false, balance: 0 });
});

test('policies start with new events and failed deliveries remain pending', async () => {
  const storage = memory();
  const first = wire(Bank, { storage });
  success(await first.account.open('a', {}));
  success(await first.account.deposit('a', { amount: 10 }));
  let attempts = 0;
  const Notify = service('Notify', { send: { parse: value => value as (id: string) => Promise<Result<void, ReturnType<typeof NotOpen>>> } });
  const reaction = policy('NotifyDeposit', { from: Account, on: [Deposited], uses: { notify: Notify } }, async ({ id }, { notify }) => notify.send(id));
  const delivered: string[] = [];
  const bank = wire(model('Bank', { aggregates: { account: Account }, policies: [reaction] }), {
    storage, services: { notify: { async send(id: string) { attempts++; if (attempts === 1) return fail(NotOpen()); delivered.push(id); return ok(undefined); } } },
  });
  success(await bank.flush());
  assert.equal(attempts, 0);
  success(await bank.account.deposit('a', { amount: 20 }));
  // A later ignored event must not move the checkpoint past the failed deposit.
  success(await bank.account.withdraw('a', { amount: 1 }));
  assert.equal(failure(await bank.flush())._tag, 'NotOpen');
  success(await bank.flush());
  success(await bank.flush());
  assert.equal(attempts, 2);
  assert.equal(delivered.length, 1);
});

test('projections replay history, batch inputs, and preserve stable event identities', async () => {
  const storage = memory();
  const bank = wire(Bank, { storage });
  success(await bank.account.open('a', {}));
  for (let i = 0; i < 5; i++) success(await bank.account.deposit('a', { amount: 1 }));
  const rows = new Map<string, number>();
  const sizes: number[] = [];
  const ledger = projection('Ledger', { from: Account, on: [Deposited], batch: { size: 2 } }, batch => {
    sizes.push(batch.length);
    for (const envelope of batch) rows.set(envelope.id, envelope.event.amount);
    return ok(undefined);
  });
  const projecting = wire(model('Bank', { aggregates: { account: Account }, projections: [ledger] }), { storage });
  success(await projecting.flush());
  success(await projecting.flush());
  assert.deepEqual(sizes, [2, 2, 1]);
  assert.equal(rows.size, 5);
});

test('views support multiple routing keys and downstream folds', async () => {
  const Routed = view('Routed', { from: Account, on: [Deposited], state: Balance, initial: () => ({ balance: 0 }), keyOf: () => ['all', 'copy'] }, (state, event) => ({ balance: state.balance + event.amount }));
  const Downstream = view('Downstream', { from: Routed, on: [Deposited], state: Balance, initial: () => ({ balance: 0 }) }, (state, event) => ({ balance: state.balance + event.amount }));
  const bank = wire(model('RoutedBank', { aggregates: { account: Account }, views: { routed: Routed, downstream: Downstream } }));
  success(await bank.account.open('a', {}));
  success(await bank.account.deposit('a', { amount: 7 }));
  success(await bank.flush());
  assert.deepEqual(success(await bank.routed.get('all')), { balance: 7 });
  assert.deepEqual(success(await bank.downstream.get('copy')), { balance: 7 });
});

test('native view watchers yield snapshots and detach on cancellation', async () => {
  const storage = memory();
  const bank = wire(Bank, { storage });
  const controller = new AbortController();
  const watcher = bank.summary.watch('a', { signal: controller.signal });
  const initial = await watcher.next();
  if (initial.done) throw new Error('Expected an initial snapshot');
  assert.equal(success(initial.value).state, null);
  success(await bank.account.open('a', {}));
  success(await bank.account.deposit('a', { amount: 1 }));
  success(await bank.flush());
  const update = await watcher.next();
  if (update.done) throw new Error('Expected an update');
  assert.deepEqual(success(update.value).state, { balance: 1 });
  const pending = watcher.next();
  controller.abort();
  assert.equal((await pending).done, true);
  assert.equal(storage.listeners.size, 0);
});

test('external operations validate both sides and normalize vendor failures', async () => {
  const Refused = rejection('Refused', { reason: string });
  const api = external('Api', { input: { name: string }, reply: { id: string }, rejects: [Refused] }, input => input.name === 'bad' ? fail(Refused({ reason: 'bad' })) : ok({ id: input.name }));
  const call = api.implement({});
  assert.deepEqual(success(await call({ name: 'one' })), { id: 'one' });
  assert.equal(failure(await call({ name: 'bad' }))._tag, 'Refused');
  const Broken = external('Broken', { input: {}, reply: { id: string } }, (() => ok({ id: 1 })) as never);
  assert.equal(failure(await Broken.implement({})({}))._tag, 'Unexpected');
  const Thrown = external('Thrown', { input: {} }, () => { throw false; });
  const error = failure(await Thrown.implement({})({}));
  assert.equal(error._tag, 'Unexpected');
  if (error._tag === 'Unexpected') assert.equal(error.cause, false);
});

test('streams validate, deduplicate, and reject conflicting replay identities', async () => {
  const Activity = stream('Activity', { key: string, event: { text: string } });
  const bank = wire(model('Streams', { aggregates: { account: Account }, streams: { activity: Activity } }));
  assert.equal(success(await bank.streams.activity.append('a', { text: 'one' }, { id: 'same' })).cursor, 1);
  assert.equal(success(await bank.streams.activity.append('a', { text: 'one' }, { id: 'same' })).cursor, 1);
  assert.equal(failure(await bank.streams.activity.append('a', { text: 'two' }, { id: 'same' }))._tag, 'CommandConflict');
  assert.equal(success(await bank.streams.activity.list('a')).length, 1);
});

test('new and rebuilt views never trigger historical policy actions', async () => {
  const storage = memory();
  const original = wire(Bank, { storage });
  success(await original.account.open('a', {}));
  success(await original.account.deposit('a', { amount: 10 }));
  let actions = 0;
  const Seen = view('Seen', { from: Account, on: [Deposited], state: Balance, initial: () => ({ balance: 0 }) }, (state, event) => ({ balance: state.balance + event.amount }));
  const reaction = policy('OnSeen', { from: Seen, on: [Deposited] }, () => { actions++; return ok(undefined); });
  const bank = wire(model('Bank', { aggregates: { account: Account }, views: { seen: Seen }, policies: [reaction] }), { storage });
  success(await bank.flush());
  assert.equal(actions, 0);
  success(await bank.account.deposit('a', { amount: 1 }));
  success(await bank.flush());
  assert.equal(actions, 1);
  const Rebuilt = view('Seen', { from: Account, on: [Deposited], state: Balance, version: 2, initial: () => ({ balance: 0 }) }, (state, event) => ({ balance: state.balance + event.amount }));
  const updatedPolicy = policy('OnSeen', { from: Rebuilt, on: [Deposited] }, () => { actions++; return ok(undefined); });
  const rebuilt = wire(model('Bank', { aggregates: { account: Account }, views: { seen: Rebuilt }, policies: [updatedPolicy] }), { storage });
  success(await rebuilt.flush());
  assert.equal(actions, 1);
  assert.throws(() => wire(model('Bank', { aggregates: { account: Account }, views: { seen: Seen } }), { storage }));
});

test('receipt consistency works through chained views', async () => {
  const First = view('First', { from: Account, on: [Deposited], state: Balance, initial: () => ({ balance: 0 }) }, (state, event) => ({ balance: state.balance + event.amount }));
  const Second = view('Second', { from: First, on: [Deposited], state: Balance, initial: () => ({ balance: 0 }) }, (state, event) => ({ balance: state.balance + event.amount }));
  const bank = wire(model('Chained', { aggregates: { account: Account }, views: { second: Second, first: First } }));
  success(await bank.account.open('a', {}));
  const receipt = success(await bank.account.deposit('a', { amount: 10 }));
  assert.deepEqual(success(await bank.second.get('a', { atLeast: receipt })), { balance: 10 });
});

test('native cancellation after a handler starts still prevents a commit', async () => {
  const controller = new AbortController();
  const late = command({ state: State, input: {}, events: [Opened] }, async () => {
    controller.abort();
    return ok({ events: [Opened()] });
  });
  const Late = aggregate('Late', { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open: late } }, state => ({ ...state, open: true }));
  const bank = wire(model('LateModel', { aggregates: { account: Late } }));
  assert.equal(failure(await bank.account.open('a', {}, { signal: controller.signal }))._tag, 'Unexpected');
  assert.equal(success(await bank.account.get('a')).open, false);
});

test('reserved API names and conflicting dependency identities fail during setup', () => {
  assert.throws(() => aggregate('Reserved', { state: State, initial: () => ({ open: false, balance: 0 }), commands: { get: open } }, state => state));
  assert.throws(() => model('Reserved', { aggregates: { flush: Account } }));
  const First = service('SameService', { value: integer });
  const Second = service('SameService', { value: integer });
  const one = policy('One', { from: Account, on: [Deposited], uses: { first: First } }, () => ok(undefined));
  const two = policy('Two', { from: Account, on: [Deposited], uses: { second: Second } }, () => ok(undefined));
  assert.throws(() => wire(model('Same', { aggregates: { account: Account }, policies: [one, two] }), { services: { first: { value: 1 }, second: { value: 2 } } }));
});

test('command identities distinguish structured-cloneable custom schema values', async () => {
  const DateSchema = { parse(value: unknown) { if (!(value instanceof Date)) throw new TypeError('Expected Date'); return value; } };
  const dated = command({ state: State, input: { at: DateSchema }, events: [Opened] }, () => ok({ events: [Opened()] }));
  const Dated = aggregate('Dated', { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open: dated } }, state => ({ ...state, open: true }));
  const bank = wire(model('DatedModel', { aggregates: { account: Dated } }));
  success(await bank.account.open('a', { at: new Date(0) }, { commandId: 'same' }));
  assert.equal(failure(await bank.account.open('a', { at: new Date(1) }, { commandId: 'same' }))._tag, 'CommandConflict');
});

test('consistent view reads succeed even when an unrelated policy is pending', async () => {
  const reaction = policy('AlwaysFails', { from: Account, on: [Deposited] }, () => fail(NotOpen()));
  const bank = wire(model('ReadDespitePolicy', { aggregates: { account: Account }, views: Bank.views, policies: [reaction] }));
  success(await bank.account.open('a', {}));
  const receipt = success(await bank.account.deposit('a', { amount: 10 }));
  assert.deepEqual(success(await bank.summary.get('a', { atLeast: receipt })), { balance: 10 });
  assert.equal(failure(await bank.flush())._tag, 'NotOpen');
});

test('trycatch handles synchronously throwing promise factories and hostile thenables', async () => {
  const factory: () => Promise<number> = () => { throw 'before promise'; };
  assert.equal(failure(await trycatch(factory)).cause, 'before promise');
  const thenable = Object.defineProperty({}, 'then', { get() { throw 'then getter'; } }) as PromiseLike<number>;
  assert.equal(failure(await trycatch(thenable)).cause, 'then getter');
});
