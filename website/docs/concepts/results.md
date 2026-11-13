# Tuples, not throws

Every Accord operation returns a tuple: `[value, null]` on success, `[null, error]` on failure. Errors are objects with a `_tag`.

```ts
const [receipt, error] = await bank.account.deposit('a-1', 100)

// receipt is unknown until error is narrowed.
if (error !== null) {
  console.error(error._tag)
} else {
  console.log(receipt.reply.balance)
}
```

::: warning
Always check the error slot. A successful operation can return `null` or `undefined` as its value, so `if (receipt)` is not a success check.
:::

## Three kinds of failure

| Tag | Where it comes from |
| --- | --- |
| Your rejections, e.g. `NotOpen` | You returned `fail(NotOpen())` |
| `InvalidInput` | Input failed a schema at a boundary (`{ _tag, message }`) |
| `Unexpected` | Something threw, or a handler returned something that isn't a valid tuple |

`Unexpected` is a real `Error` with `_tag: 'Unexpected'` and the original thrown value in `cause`.

::: tip
Constructing an event with invalid data throws a `TypeError` inside your method. The runtime catches it, discards the working instance, and returns `Unexpected`. If a value can be invalid for business reasons, check it first and return a rejection instead.
:::

## Producing results

```ts
import { fail, ok, rejection } from '@marcelsud/accord'

const NotOpen = rejection('NotOpen')

ok({ balance: 100 }) // [{ balance: 100 }, null]
fail(NotOpen()) // [null, { _tag: 'NotOpen' }]
```

Wrap code that throws with `trycatch`:

```ts
import { trycatch } from '@marcelsud/accord'

const [data, error] = trycatch(() => JSON.parse(text))
const [response, fetchError] = await trycatch(fetch(url))
```

## Handling them

Use `match` for exhaustive handling. Missing or unknown cases fail type checking.

```ts
import { match } from '@marcelsud/accord'

const message = match(error, {
  NotOpen: () => 'Open the account first',
  DepositLimit: ({ maximum }) => `The limit is ${maximum}`,
  InvalidInput: ({ message }) => message,
  Unexpected: () => 'Something went wrong',
  Conflict: () => 'Try again',
  CommandConflict: () => 'Duplicate command',
})
```

See [Results](/docs/api/result) for the full API.
