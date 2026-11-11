# Testing

Accord code is easy to test because everything returns values. You have three levels.

## 1. Unit test an aggregate directly

No runtime needed. Create an instance, call a method, check the state and events.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from './domain.ts'

test('deposit adds to the balance', () => {
  const account = Account.create({ status: 'OPEN', balance: 100 }, { rules: { maximum: 1_000 } })

  const [reply, error] = account.deposit(50)

  assert.equal(error, null)
  assert.deepEqual(reply, { balance: 150 })
  assert.deepEqual(account.getState(), { status: 'OPEN', balance: 150 })
  assert.deepEqual(account.pullEvents(), [{ _tag: 'Deposited', amount: 50, balance: 150 }])
})
```

Use `Account.restore(state)` for class aggregates.

## 2. Run a story

[`story()`](/docs/api/story) wires a fresh in-memory runtime and turns failed assertions into `Unexpected`.

```ts
test('deposit through the runtime', async () => {
  const [, error] = await story(
    Bank,
    async (t) => {
      const [, openError] = await t.bank.account.open('a-1')
      if (openError !== null) return fail(openError)

      const [receipt, depositError] = await t.bank.account.deposit('a-1', 100)
      if (depositError !== null) return fail(depositError)

      const [summary] = await t.bank.summary.get('a-1', { atLeast: receipt })
      t.equal(summary, { balance: 100 })
      return ok(undefined)
    },
    { services: { rules: { maximum: 1_000 } } }
  )

  assert.equal(error, null)
})
```

## 3. Fake external systems

Services are plain values, so pass a fake through `wire()`:

```ts
const sent: unknown[] = []
const bank = wire(Bank, {
  services: {
    notifications: {
      send: async (message) => {
        sent.push(message)
        return ok(undefined)
      },
    },
  },
})
```

For HTTP, give [`client()`](/docs/api/http#client-url-fetch-headers) a custom `fetch` that calls your `serve()` handler directly. No server needed.

## Run tests

Accord itself uses Node's built-in test runner:

```sh
node --test
```
