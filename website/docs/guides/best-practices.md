# Best Practices

Accord is flexible. These habits keep your models simple and safe.

## Always check the error slot

```ts
const [receipt, error] = await bank.account.deposit('a-1', 100)
if (error !== null) return fail(error) // or handle it
```

Never test the value for truthiness. `null` and `undefined` are valid success values.

## Reject, don't throw

Return `fail(SomeRejection())` for business refusals. Throws become `Unexpected` and lose their meaning for callers. Validate inputs before constructing events, because invalid event data throws.

## Keep state plain

Store plain data that round-trips through `structuredClone` (and JSON if you use HTTP). Use [value objects](/docs/api/value-object) for logic, then write raw values back to state.

## Name things once

Definition names, service names, and event tags are identities. They show up in stream IDs, checkpoints, and persisted data. Don't rename them casually; version them.

## Make consumers idempotent

Delivery is at-least-once. Use the envelope `id` as the idempotency key for external calls, and upserts for projections.

## Put I/O inside workflow steps

Code outside `run.step()` can run again on resume.

## Flush deliberately

There's no background worker. Call `bank.flush()` where it makes sense: after a request, on a timer you own, or via `atLeast` reads.

## Keep handlers short on SQLite

A consumer holds the writer transaction while it runs. Do slow external work in policies with idempotency keys rather than inside a shared-connection projection.
