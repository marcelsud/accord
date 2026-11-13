# Projection

A projection writes events somewhere else, in batches. It's replayable, so writes must be idempotent.

## Import

```ts
import { projection, trycatch } from '@marcelsud/accord'
```

## Usage

```ts
const Totals = projection(
  'Totals',
  { from: Account, on: [Deposited], batch: { size: 100 } },
  (batch) =>
    trycatch(() => {
      for (const { source, event } of batch) increment.run(source.id, event.amount)
    })
)

const Bank = model('Bank', { aggregates: { account: Account }, projections: [Totals] })
```

The body receives an array of envelopes, batched per source instance, and returns a `Result`.

## Options

### from

`Aggregate | View`.

### on

`Event[]`. The events to receive.

### uses <Badge type="info" text="optional" />

`Record<string, Dependency>`.

### version <Badge type="info" text="optional" />

`number`, default `1`. A new version replays **all** source history.

### batch <Badge type="info" text="optional" />

`{ size: number }`, default `{ size: 100 }`.

## Idempotency

- Use stable event IDs in destination upserts.
- Bumping the version replays history. Migrate or clear the destination first, or write to a new versioned destination, otherwise counters double.

::: tip Atomic SQL effects
With the [SQLite store](/docs/api/sqlite), write through `storage.database` inside the handler. The batch's SQL changes and its checkpoint commit or roll back together.
:::
