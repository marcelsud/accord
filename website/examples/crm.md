# CRM and migrations

Companies, contacts, and deals. Qualify a contact, open a deal, and move it from discovery through proposal to won. Policies create follow-up and onboarding tasks, a view serves the deal card, and a projection maintains a searchable SQLite pipeline. Then v2 changes the contracts and migrates.

Source: [`crm/`](examples:crm)

## Run v1

```sh
npm run crm -- /tmp/accord-crm.sqlite seed
npm run crm -- /tmp/accord-crm.sqlite drain
npm run crm -- /tmp/accord-crm.sqlite drain
```

- `seed` commits the sales flow without flushing consumers.
- The first `drain` restores state and delivers pending events: one won pipeline row for 2,400,000 minor BRL units and two task records.
- Repeated drains change nothing. `show` reads without draining.

## Run the migrations

After the v1 seed and drain:

```sh
npm run crm:migrations -- /tmp/accord-crm.sqlite
```

The script opens the database read-only and runs every experiment on SQLite backups. v2 replaces `amount` and `currency` with `money: { minor, currency }` and adds a required `channel`. Migrated records get `LEGACY`; new v2 deals get `INBOUND`.

## Versioned event tags

```ts
// v1.ts
export const DealChanged = event('DealChanged', schemaV1)

// v2.ts
export const DealChanged = event('DealChangedV2', schemaV2)
```

The v2 projection subscribes to `[V1.DealChanged, DealChanged]`.

## What it proves

| Experiment | Result |
| --- | --- |
| Change the aggregate contract without migrating snapshots | Stored state keeps the old shape; v2 validation fails |
| Change projection code but keep its version | Existing checkpoints prevent replay |
| Bump the version while assuming new payloads | Replay fails: old events lack `details.money` |
| Change `CREATE TABLE IF NOT EXISTS` | Existing columns don't change |
| Subscribe only to the new event tag | Legacy events are filtered out |
| Bump a counter version and reuse its destination | Totals double; a fresh destination rebuilds correctly |
| Fail halfway through a snapshot migration | Everything rolls back; retry succeeds |
| Migrate snapshots and adapt old events during replay | The old deal rebuilds into v2 without repeating tasks |
| Restart with mixed history | Two pipeline rows and three tasks stay stable |

See [Versioning and migrations](/docs/guides/migrations) for the rules behind this.

## Files

| File | What it does |
| --- | --- |
| [`v1.ts`](examples:crm/v1.ts) | Full CRM, SQLite adapters, seed/drain/show CLI |
| [`v2.ts`](examples:crm/v2.ts) | New contracts, history readers, v2 projection |
| [`migrations.ts`](examples:crm/migrations.ts) | Backup-based migration and failure experiments |
