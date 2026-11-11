# SQLite store

`sqlite()` is a durable store built on Node.js 24's built-in `node:sqlite`. It adds no npm runtime dependency, and the core entry point never imports it.

## Import

```ts
import { sqlite } from '@marcelsud/accord/sqlite'
```

## Usage

```ts
using storage = sqlite('app.sqlite')
const bank = wire(Bank, { storage, services })

const [, error] = await bank.flush()
if (error !== null) throw error
```

## API

### sqlite(filename)

Opens or creates `filename`. `':memory:'` is supported but doesn't survive the process.

### storage.database

The underlying `DatabaseSync` connection. Use it inside projections to commit SQL effects with the checkpoint.

### storage.close()

Closes the connection. Also called when a `using` scope ends. Closing with pending operations is rejected.

## What gets stored

Aggregate snapshots and versions, immutable event envelopes, command receipts, view rows and forwarded history, consumer registrations, per-stream checkpoints, consistency watermarks, and explicit streams.

- Event IDs keep their sequences across restarts.
- Empty policy registrations are durable, so reopening doesn't skip events emitted before the first flush.
- Values are stored with Node's V8 serialization, not JSON. Dates, maps, `bigint`, and `undefined` survive. Values must support both `structuredClone` and V8 serialization.
- Storage format version `1` is checked on open. Newer unsupported formats are rejected.

## Transactions

Each successful command commits its snapshot, events, and receipt in one transaction.

Each consumer batch also runs in a transaction. Projection handlers that write through **the same `storage.database` connection** join it:

```ts
storage.database.exec(`
  CREATE TABLE IF NOT EXISTS deposit_totals (
    account_id TEXT PRIMARY KEY,
    total INTEGER NOT NULL
  ) STRICT
`)
const increment = storage.database.prepare(`
  INSERT INTO deposit_totals(account_id, total) VALUES (?, ?)
  ON CONFLICT(account_id) DO UPDATE SET total = total + excluded.total
`)

const Totals = projection('Totals', { from: Account, on: [Deposited] }, (batch) =>
  trycatch(() => {
    for (const { source, event } of batch) increment.run(source.id, event.amount)
  })
)
```

- Return `ok()` only after all writes finish. Return `fail()` or throw to roll back the batch.
- Don't issue `BEGIN`, `COMMIT`, or `ROLLBACK` in the handler. The runtime commits your writes and the checkpoint together.

## Recovery

| Failure point | Recovery |
| --- | --- |
| After a command commits, before flush | The next process reads the stored events and delivers them |
| During a shared-connection projection write | SQLite rolls back; the batch stays pending |
| During checkpoint update or `COMMIT` | Projection changes and checkpoint both roll back |
| After the batch commits, before success is reported | The saved checkpoint prevents applying it again |

::: warning
These guarantees cover SQL effects on the same connection, for the same model, consumer name, and version. External HTTP calls, other connections (even to the same file), and other systems don't join the transaction. Use stable event IDs and idempotent destinations for those.
:::

## Concurrency

- WAL mode with `synchronous=FULL`.
- Runtime operations are serialized per file within a process. SQLite's writer lock prevents conflicting commits across processes; a conflicting process may get an `Unexpected` busy error and should retry.
- Keep handlers short: a handler holds the writer transaction while it runs.
- A handler must not call another runtime operation on the same SQLite file. Nested transactions are rejected.
- Watchers are local to their connection. Use reads or `flush()` to observe other connections.

## Rebuilds

Reopen with stable names and versions for normal recovery. Changing a projection or view version intentionally replays history. No automatic schema migration, retention, or rebuild orchestration is included. Models with workflows are rejected on SQLite.

See [Versioning and migrations](/docs/guides/migrations).
