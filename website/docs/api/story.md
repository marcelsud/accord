# Story

`story()` runs a scenario against a fresh in-memory runtime and returns a tuple. Thrown assertions become `Unexpected`.

## Import

```ts
import { fail, ok, story } from '@marcelsud/accord'
```

## Usage

```ts
const [value, error] = await story(Bank, async (test) => {
  const [, givenError] = await test.given(Account, 'a-1', [Opened()])
  if (givenError !== null) return fail(givenError)

  const [receipt, commandError] = await test.bank.account.deposit('a-1', { amount: 100 })
  if (commandError !== null) return fail(commandError)

  test.equal(receipt.reply.balance, 100)
  return ok(undefined)
})

if (error !== null) throw error
```

## The test context

### test.bank

A wired runtime for the model.

### test.given(aggregate, id, events)

Seeds an [event-evolved aggregate](/docs/api/aggregate#event-evolved-aggregates) with history. It validates and folds the events into a fresh instance. Seeded events rebuild views and projections but **don't** run policies. Class and factory aggregates can't be seeded this way; call their methods instead.

### test.equal(actual, expected)

Deep strict equality. Throws on mismatch, which the story reports as `Unexpected`.

## Options

`story(model, body, options?)` accepts the same options as [`wire()`](/docs/api/model#wire-model-options): `storage` and `services`. `services` is required when the model declares dependencies.

```ts
await story(Bank, body, { services: { rules: { maximum: 1_000 } } })
```

See [Testing](/docs/guides/testing).
