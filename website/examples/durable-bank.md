# Durable bank

Commit a deposit in one process, deliver it in another. A counter projection writes through the runtime's SQLite connection, so its SQL change and checkpoint commit together and nothing is counted twice.

Source: [`durable-bank/`](examples:durable-bank)

## Run it

Use a new filename for a fresh demo:

```sh
npm run durable -- /tmp/accord-runtime.sqlite deposit 100
npm run durable -- /tmp/accord-runtime.sqlite drain
npm run durable -- /tmp/accord-runtime.sqlite drain
```

Both drains print a projected total of `100`.

## The projection

```ts
using storage = sqlite(filename)
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

const Totals = projection(
  'Totals',
  { from: Account, on: [Deposited], batch: { size: 100 } },
  (batch) =>
    trycatch(() => {
      // The runtime owns this transaction and commits its checkpoint with these writes.
      for (const { source, event } of batch) increment.run(source.id, event.amount)
    })
)

const bank = wire(model('DurableBank', { aggregates: { account: Account }, projections: [Totals] }), { storage })
```

`deposit` commits and exits without flushing. `drain` calls `bank.flush()` and prints the table.

It reuses the `Account` from the [Notifications example](/examples/notifications). See the [SQLite store reference](/docs/api/sqlite) for the recovery table.
