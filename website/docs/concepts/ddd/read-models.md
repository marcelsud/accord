# Projections and read models

A read model answers a query without replaying the decision. Accord has two.

A [`view()`](/docs/api/view) folds events into state inside the runtime. It can rebuild from history. `get(id, { atLeast: receipt })` flushes and then reads your own write. Without `atLeast`, you get whatever is materialized, which may be `null`.

A [`projection()`](/docs/api/projection) writes events somewhere else, in batches. It also replays when its version changes, so the write has to be idempotent. Use the envelope id as the primary key.

<<< @/snippets/ddd/read-models.ts

`OnLoan` counts `Borrowed` events. It does not copy the aggregate's `loans` field. `LoanLog` inserts through `storage.database`, so the row and the consumer checkpoint commit or roll back together. `ON CONFLICT(event_id) DO NOTHING` keeps a second `flush()` from inserting the same event again.

Views and projections see history. Policies do not. Ordering is per source stream.

## See also

- [View](/docs/api/view)
- [Projection](/docs/api/projection)
- [Events and delivery](/docs/concepts/delivery)
