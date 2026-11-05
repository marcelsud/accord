import assert from 'node:assert/strict';
import test from 'node:test';
import { fail, model, ok, policy, story } from '../src/index.js';
import { Account, Bank, Deposited, Opened } from './fixtures.js';
import { failure, success } from './helpers.js';

test('stories seed validated histories and execute commands with typed receipts', async () => {
  const result = await story(Bank, async test => {
    const [, givenError] = await test.given(Account, 'a', [Opened(), Deposited({ amount: 10 })]);
    if (givenError !== null) return fail(givenError);
    const [receipt, error] = await test.bank.account.deposit('a', { amount: 5 });
    if (error !== null) return fail(error);
    test.equal(receipt.reply.balance, 15);
    return ok(receipt.reply.balance);
  });
  assert.equal(success(result), 15);
});

test('seeded history does not trigger policies and assertion failures become tuples', async () => {
  let reactions = 0;
  const reaction = policy('StoryReaction', { from: Account, on: [Deposited] }, () => { reactions++; return ok(undefined); });
  const StoryBank = model('StoryBank', { aggregates: { account: Account }, policies: [reaction] });
  const result = await story(StoryBank, async test => {
    success(await test.given(Account, 'a', [Opened(), Deposited({ amount: 10 })]));
    success(await test.bank.flush());
    test.equal(reactions, 0);
    test.equal(1, 2);
    return ok(undefined);
  });
  assert.equal(failure(result)._tag, 'Unexpected');
});
