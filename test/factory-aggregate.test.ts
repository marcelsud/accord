import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregate, event, fail, integer, memory, model, ok, rejection, wire } from '../src/index.js';
import { Account, Bank } from '../examples/bank/domain.js';
import { failure, success } from './helpers.js';

test('factory aggregates restore value objects from stored snapshots and deliver their events', async () => {
  const storage = memory();
  const bank = wire(Bank, { storage });
  assert.equal(failure(await bank.account.deposit('a', 10))._tag, 'NotOpen');
  success(await bank.account.open('a'));
  success(await bank.account.deposit('a', 100));
  assert.deepEqual(success(await bank.account.get('a')), { status: 'OPEN', balance: 100 });

  const restarted = wire(Bank, { storage });
  const receipt = success(await restarted.account.deposit('a', 50));
  assert.deepEqual(receipt.reply, { balance: 150 });
  assert.deepEqual(success(await restarted.summary.get('a', { atLeast: receipt })), { balance: 150 });
  const local = Account.restore(success(await restarted.account.get('a')));
  assert.deepEqual(success(local.deposit(25)), { balance: 175 });
  assert.deepEqual(local.getState(), { status: 'OPEN', balance: 175 });
  assert.deepEqual(local.pullEvents(), [{ _tag: 'Deposited', amount: 25, balance: 175 }]);
  assert.deepEqual(success(await restarted.account.get('a')), { status: 'OPEN', balance: 150 });
});

test('factory calls use one isolated context and discard changes on rejection or failed snapshot', async () => {
  const Changed = event('Changed', { value: integer });
  const Rejected = rejection('Rejected');
  const defect = new Error('cannot save negative value');
  let contexts = 0;
  const Counter = aggregate('Counter', { value: 0 }, ({ state, emit }) => {
    contexts++;
    return {
      change(value: number, reject = false) {
        state.value = value;
        emit(Changed({ value }));
        return reject ? fail(Rejected()) : ok(value);
      },
    };
  }, {
    snapshot(state) {
      if (state.value < 0) throw defect;
      return state;
    },
    restore: state => state,
  });
  const runtime = wire(model('Counters', { aggregates: { counter: Counter } }));
  const client = runtime.counter;
  const change = client.change;
  assert.equal(change, client.change);
  assert.deepEqual(Object.keys(client), ['get', 'events']);
  assert.equal(Reflect.get(client, 'then'), undefined);
  assert.equal(Reflect.get(client, 'toJSON'), undefined);
  assert.equal(Reflect.get(client, Symbol.toStringTag), undefined);
  assert.equal(await client, client);
  assert.equal(JSON.stringify(client), '{}');
  assert.deepEqual(success(await client.get('c')), { value: 0 });
  assert.equal(contexts, 0);

  const first = success(await change('c', 1));
  assert.equal(contexts, 1);
  assert.deepEqual(failure(await runtime.counter.change('c', 2, true)), Rejected());
  const error = failure(await runtime.counter.change('c', -1));
  assert.equal(error._tag, 'Unexpected');
  if (error._tag === 'Unexpected') assert.equal(error.cause, defect);
  assert.equal(contexts, 3);
  assert.deepEqual(success(await runtime.counter.get('c')), { value: 1 });
  assert.deepEqual(success(await runtime.counter.events('c')), first.events);
  const missing = failure(await Reflect.get(client, 'missing')('c'));
  assert.equal(missing._tag, 'Unexpected');
  assert.ok(missing instanceof Error);
  assert.match(String(missing.cause), /Missing aggregate method: missing/);
  assert.equal(contexts, 4);
  assert.equal(success(await runtime.counter.change('c', 3)).version, 2);
});
