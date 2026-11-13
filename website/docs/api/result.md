# Results

Accord operations return tuples. This page covers the helpers for building and consuming them. For the why, see [Tuples, not throws](/docs/concepts/results).

## Import

```ts
import { fail, match, ok, trycatch, unexpected } from '@marcelsud/accord'
import type { Result } from '@marcelsud/accord'
```

## Result

```ts
type Result<T, E extends Tagged> =
  | readonly [value: T, error: null]
  | readonly [value: unknown, error: E]
```

Check `error !== null` to narrow the value.

## ok(value)

```ts
ok({ balance: 100 }) // [{ balance: 100 }, null]
```

## fail(error)

```ts
fail(NotOpen()) // [null, { _tag: 'NotOpen' }]
```

## trycatch(task)

Converts thrown or rejected values into `Unexpected`.

```ts
const [data, error] = trycatch(() => JSON.parse(text)) // sync function
const [res, fetchError] = await trycatch(() => fetch(url)) // async function
const [value] = await trycatch(Promise.resolve(3)) // promise
```

- Prefer passing a function when the work should start later.
- `trycatch` doesn't flatten an existing tuple. Accord operations already return tuples; don't wrap them.

## match(value, cases)

Exhaustive pattern matching on `_tag`. Handlers receive the narrowed value.

```ts
const next = match(event, {
  Opened: () => ({ ...state, open: true }),
  Deposited: ({ amount }) => ({ ...state, balance: state.balance + amount }),
})
```

Missing or unknown cases fail type checking. Adding a new event or rejection points you at every `match` that needs updating. At runtime, an unhandled tag throws a `TypeError`.

## unexpected(cause)

Builds an `Unexpected` error: an `Error` with `_tag: 'Unexpected'` and `cause`.

## Built-in error tags

| Tag | Shape | When |
| --- | --- | --- |
| `Unexpected` | `Error & { _tag, cause }` | A throw, or an invalid runtime result |
| `InvalidInput` | `{ _tag, message }` | Input failed a schema |
| `Conflict` | `{ _tag, expected, actual }` | `expectedVersion` didn't match |
| `CommandConflict` | `{ _tag, commandId }` | A `commandId` was reused with different input |
| `ConsistencyTimeout` | `{ _tag, stream, version }` | An `atLeast` read couldn't catch up |
| `Unauthorized`, `NotFound` | `{ _tag }` | HTTP transport |
