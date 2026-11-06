import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregate, event, fail, integer, memory, model, ok, rejection, view, wire, type Result } from '../src/index.js';
import { failure, success } from './helpers.js';

const Deposited = event('Deposited', { amount: integer });
const Rejected = rejection('Rejected');
const defect = new Error('failed after mutation');
class Account extends aggregate('Account', { balance: 0, tags: ['new'] }) {
  async deposit(amount: number) {
    const balance = this.state.balance + amount;
    await Promise.resolve();
    this.state.balance = balance;
    this.emit(Deposited({ amount }));
    return ok({ balance });
  }

  label(value: string) {
    this.state.tags.push(value);
    return ok(undefined);
  }

  reject() {
    this.state.balance += 100;
    this.emit(Deposited({ amount: 100 }));
    return fail(Rejected());
  }

  throws(): Result<never, never> {
    this.state.balance += 200;
    this.emit(Deposited({ amount: 200 }));
    throw defect;
  }

  invalidReply() {
    this.state.balance += 300;
    this.emit(Deposited({ amount: 300 }));
    return ok(() => this.state.balance);
  }
}

const Balance = view('Balance', {
  from: Account, on: [Deposited], state: { total: integer }, initial: () => ({ total: 0 }),
}, (state, { amount }) => ({ total: state.total + amount }));
const Bank = model('ClassBank', { aggregates: { account: Account }, views: { balance: Balance } });

test('class factories copy state and keep pending events on the instance', async () => {
  const seed = { balance: 100, tags: ['restored'] };
  const account = Account.restore(seed);
  seed.tags.push('outside');
  account.getState().tags.push('outside');
  success(await account.deposit(50));
  assert.deepEqual(account.getState(), { balance: 150, tags: ['restored'] });
  assert.deepEqual(account.pullEvents(), [Deposited({ amount: 50 })]);
  assert.deepEqual(account.pullEvents(), []);
  assert.deepEqual(Account.create().getState(), { balance: 0, tags: ['new'] });
});

test('wire discards class mutations and events on rejection, exception, and failed receipt cloning', async () => {
  const storage = memory();
  const bank = wire(Bank, { storage });
  const initial = success(await bank.account.deposit('a', 10));
  assert.deepEqual(failure(await bank.account.reject('a')), Rejected());
  const thrown = failure(await bank.account.throws('a'));
  assert.equal(thrown._tag, 'Unexpected');
  if (thrown._tag === 'Unexpected') assert.equal(thrown.cause, defect);
  assert.equal(failure(await bank.account.invalidReply('a'))._tag, 'Unexpected');

  const restored = wire(Bank, { storage });
  assert.deepEqual(success(await restored.account.get('a')), { balance: 10, tags: ['new'] });
  assert.deepEqual(success(await restored.account.events('a')), initial.events);
  const next = success(await restored.account.deposit('a', 5));
  assert.equal(next.version, 2);
  assert.equal(next.events[0]?.seq, 2);
  assert.deepEqual(success(await restored.balance.get('a', { atLeast: next })), { total: 15 });
});

test('wire serializes class methods and tracks state versions separately from event cursors', async () => {
  const bank = wire(Bank);
  const label = success(await bank.account.label('a', 'active'));
  assert.equal(label.version, 1);
  assert.equal(label.eventCursor, 0);
  assert.deepEqual(label.events, []);
  assert.equal(success(await bank.balance.get('a', { atLeast: label })), null);

  const [first, second] = await Promise.all([bank.account.deposit('a', 100), bank.account.deposit('a', 50)]);
  assert.deepEqual(success(first).reply, { balance: 100 });
  const receipt = success(second);
  assert.deepEqual(receipt.reply, { balance: 150 });
  assert.equal(receipt.version, 3);
  assert.equal(receipt.eventCursor, 2);
  assert.deepEqual(success(await bank.balance.get('a', { atLeast: receipt })), { total: 150 });
  assert.deepEqual(success(await bank.account.get('a')), { balance: 150, tags: ['new', 'active'] });
});
