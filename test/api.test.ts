import assert from 'node:assert/strict';
import test from 'node:test';
import { api, client, fail, host, ok, rejection, serve } from '../src/index.js';
import { Account, Bank, Summary } from './fixtures.js';
import { failure, success } from './helpers.js';

const Unauthorized = rejection('Unauthorized');
const Public = api('Public', { model: Bank, commands: [Account.commands.open, Account.commands.deposit], views: [Summary], rejects: [Unauthorized] }, request => {
  if (request.headers.get('authorization') !== 'Bearer test') return fail(Unauthorized());
  return ok({ actor: 'alice' });
});
function setup() {
  const bank = host(Bank);
  const fetch = serve(Public, { runtime: bank });
  const localFetch: typeof globalThis.fetch = async (input, options) => fetch(new Request(input, options));
  const remote = client<typeof Public>('https://accord.test/api', { fetch: localFetch, headers: { authorization: 'Bearer test' } });
  return { bank, fetch, localFetch, remote };
}

test('typed HTTP clients round-trip commands, receipts, and consistent view reads', async () => {
  const { remote } = setup();
  success(await remote.account.open('a', {}));
  const receipt = success(await remote.account.deposit('a', { amount: 12 }, { commandId: 'one' }));
  assert.equal(receipt.reply.balance, 12);
  assert.deepEqual(success(await remote.summary.get('a', { atLeast: receipt })), { balance: 12 });
  assert.equal(success(await remote.summary.snapshot('a')).cursor, 1);
  assert.equal(success(await remote.summary.events('a')).length, 1);
});

test('authorization guards commands and every read operation', async () => {
  const { localFetch, bank } = setup();
  const denied = client<typeof Public>('https://accord.test/api', { fetch: localFetch });
  assert.equal(failure(await denied.account.open('a', {}))._tag, 'Unauthorized');
  assert.equal(failure(await denied.summary.get('a'))._tag, 'Unauthorized');
  assert.deepEqual(success(await bank.account.get('a')), { open: false, balance: 0 });
});

test('unexposed commands and prototype properties cannot be reached over HTTP', async () => {
  const { fetch, bank } = setup();
  success(await bank.account.open('a', {}));
  success(await bank.account.deposit('a', { amount: 10 }));
  for (const operation of ['account.withdraw', 'account.get', 'account.constructor', '__proto__.get', 'summary.watch']) {
    const response = await fetch(new Request('https://accord.test/api', {
      method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: operation.startsWith('summary') ? 'view' : 'command', operation, target: 'a', input: { amount: 1 } }),
    }));
    assert.equal(response.status, 404);
    assert.equal((await response.json())[1]._tag, 'NotFound');
  }
  assert.equal(success(await bank.account.get('a')).balance, 10);
});

test('malformed JSON and request shapes become structured failures', async () => {
  const { fetch } = setup();
  assert.equal((await fetch(new Request('https://accord.test/api'))).status, 405);
  const malformed = await fetch(new Request('https://accord.test/api', { method: 'POST', body: '{' }));
  assert.equal(malformed.status, 400);
  const wrong = await fetch(new Request('https://accord.test/api', { method: 'POST', body: '{}' }));
  assert.equal(wrong.status, 400);
});

test('client transport failures and invalid responses become Unexpected errors', async () => {
  const broken = client<typeof Public>('https://accord.test/api', { fetch: async () => { throw false; } });
  const error = failure(await broken.account.open('a', {}));
  assert.equal(error._tag, 'Unexpected');
  if (error._tag === 'Unexpected') assert.equal(error.cause, false);
  const malformed = client<typeof Public>('https://accord.test/api', { fetch: async () => new Response('{}') });
  assert.equal(failure(await malformed.account.open('a', {}))._tag, 'Unexpected');
});

test('API authorization defects hide server causes and retain a client Error object', async () => {
  const Defective = api('Defective', { model: Bank, commands: [Account.commands.open], views: [] }, () => { throw new Error('secret: credential'); });
  const fetch = serve(Defective, { runtime: host(Bank) });
  const response = await fetch(new Request('https://accord.test/api', { method: 'POST', body: JSON.stringify({ kind: 'command', operation: 'account.open', target: 'a', input: {} }) }));
  const text = await response.text();
  assert.ok(!text.includes('credential'));
  const remote = client<typeof Defective>('https://accord.test/api', { fetch: async (input, options) => fetch(new Request(input, options)) });
  assert.ok(failure(await remote.account.open('a', {})) instanceof Error);
});
