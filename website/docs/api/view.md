# View

A view folds events into read state. It can rebuild from history at any time.

## Import

```ts
import { on, view } from '@marcelsud/accord'
```

## Usage

```ts
const Summary = view(
  'Summary',
  { from: Account, initial: { balance: 0, deposits: 0 } },
  on(Deposited, (state, { balance }) => ({ balance, deposits: state.deposits + 1 })),
  on(Withdrawn, (state, { balance }) => ({ ...state, balance }))
)

const Bank = model('Bank', { aggregates: { account: Account }, views: { summary: Summary } })
```

Each handler receives `(state, event, envelope)` and returns the next state **synchronously**, so the same handler works during replay.

## Options

### from

`Aggregate | View`. The source. Views can also listen to other views; downstream views consume the forwarded source events.

### initial

The starting state for each row. It also supplies the view's state type.

### schema <Badge type="info" text="optional" />

`SchemaInput`. Validate state at runtime.

### version <Badge type="info" text="optional" />

`number`, default `1`. Bump it when the calculation changes to rebuild from history. Versions can't decrease within a store.

### keyOf <Badge type="info" text="optional" />

`(envelope) => string | string[] | undefined`. Rows are keyed by the source instance ID by default. Return several keys to fan out, or `undefined` to skip the event.

```ts
const ByCurrency = view(
  'ByCurrency',
  { from: Account, initial: { total: 0 }, keyOf: ({ event }) => event.currency },
  on(Deposited, (state, { amount }) => ({ total: state.total + amount }))
)
```

## Reading

```ts
const [summary, error] = await bank.summary.get('a-1')
const [snapshot] = await bank.summary.snapshot('a-1') // { state, cursor }
const [history] = await bank.summary.events('a-1', { after: 0 })
```

### Read your own writes

Without options, `get()` returns what is materialized now, which may be `null`. Pass a command receipt to flush and catch up first:

```ts
const [receipt] = await bank.account.deposit('a-1', 100)
const [summary] = await bank.summary.get('a-1', { atLeast: receipt })
```

### Watch

Native watchers are async generators of snapshot tuples. Pass an `AbortSignal` to stop.

```ts
const controller = new AbortController()

for await (const [snapshot, error] of bank.summary.watch('a-1', { signal: controller.signal })) {
  if (error !== null) break
  console.log(snapshot.state)
}
```

## Contract form

`view(name, { from, on, state, initial, version?, keyOf? }, evolve)` is also supported. `evolve` is `(state, event) => state`, usually with [`match`](/docs/api/result#match-value-cases).

```ts
const Summary = view(
  'Summary',
  { from: Account, on: [Deposited, Withdrawn], state: { balance: integer }, initial: () => ({ balance: 0 }) },
  (state, event) =>
    match(event, {
      Deposited: ({ amount }) => ({ balance: state.balance + amount }),
      Withdrawn: ({ amount }) => ({ balance: state.balance - amount }),
    })
)
```
