# Versioning and migrations

Accord stores events forever and keeps checkpoints per consumer name and version. Changing contracts is your job, and Accord gives you the tools to do it explicitly.

## What happens when you change things

| Change | Result |
| --- | --- |
| Change an aggregate contract without migrating snapshots | Stored state keeps the old shape; explicit validation fails |
| Change projection code but keep its version | Existing checkpoints prevent replay |
| Bump a projection version while assuming new payloads | Replay fails on old events |
| Bump a counter projection version and reuse its table | Replayed increments double the total |
| Subscribe only to a new event tag | Legacy events are filtered out |

These are all asserted in the [CRM example](/examples/crm).

## New event, new tag

The tag is persisted. Keep the old factory and add a new tag:

```ts
// v1.ts
export const DealChanged = event('DealChanged', schemaV1)

// v2.ts
export const DealChanged = event('DealChangedV2', schemaV2)
```

Inside v2, subscribe to both and adapt old events when reading them:

```ts
projection('Pipeline', { from: Deal, on: [V1.DealChanged, DealChanged], version: 2 }, body)
```

## Rebuild into a new destination

Bump the view or projection version **and** write to a fresh destination (a new table such as `pipeline_v2`). Replays then rebuild correctly.

::: warning
View versions can't decrease within a store. Starting an old app version against an upgraded file is not a rollback plan. Restore the pre-migration database instead.
:::

## Snapshot migrations

Snapshot migrations are offline and application-owned:

1. Stop application writers.
2. Back up the database.
3. Check the Accord storage format (`1`), update state while preserving versions and receipts, create the new projection destination, and record a migration ID, all in one transaction.
4. Start the new version, which rebuilds views and projections at version `2`.

Keep policy names and versions unchanged so their delivery progress is preserved.

::: info
Accord doesn't ship an automatic migration runner or an upcaster registry yet. The CRM example shows the explicit code against the current storage layout.
:::
