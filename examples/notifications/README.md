# An external notification system and a SQLite ledger

This example opens an account, deposits money, records a ledger entry, and asks
an external notification system to notify the account holder. Both versions use
the same domain contracts and dependencies:

- [`pure.ts`](pure.ts) uses native tuples.
- [`with-effect.ts`](with-effect.ts) uses `effectify`, `Effect.gen`, and `yield*`.

The domain depends on `Notifications.send` and `LedgerStore.record`. It knows
nothing about how either system stores or delivers data. You can inject a fake
notification system directly; the tests exercise this for both versions.

## Run both versions

Use Node.js 24 or newer. From the repository root:

```sh
npm ci --ignore-scripts
npm run check
npm run example:sqlite
npm run example:sqlite:effect
```

Each prints the selected mode, a committed balance of `100`, one ledger row,
and `Notifications sent: 1`. The runner starts a dummy notification system and
closes its resources when finished. The default ledger is SQLite's in-memory
`:memory:` database.

To inspect a database file afterward, pass a new filename:

```sh
npm run example:sqlite -- /tmp/accord-pure.sqlite
npm run example:sqlite:effect -- /tmp/accord-effect.sqlite
```

Choose an empty ledger for each run. The runner refuses a nonempty ledger
because aggregate state and event sequence numbers start fresh in memory.

## Follow the domain

1. A command decides an `Opened` or `Deposited` event and commits it through the
   Accord host.
2. `bank.flush()` delivers events to the ledger projection and notification
   policy.
3. The projection calls `LedgerStore.record`. Stable event IDs allow the store to
   accept a replay without adding another entry.
4. The policy calls `Notifications.send`. The external system returns an
   acknowledgement or a domain rejection such as `NotificationsUnavailable` or
   `NotificationConflict({ eventId })`.

The consumers are independent. A committed receipt does not mean both have
completed. `flush()` reports the first failed delivery; another flush retries it.
There is no transaction across the ledger and notification system.

## Swap the external system

Pass any implementation of `NotificationPort` to `createBank`:

```ts
const notifications: NotificationPort = {
  async send(input) {
    console.log("Notification requested:", input.accountId);
    return ok({ id: `fake-${input.eventId}` });
  },
};

const { bank } = createBank(ledger, notifications);
```

This is an excerpt using `NotificationPort` from `domain.ts`, `ok` from Accord,
an opened ledger adapter, and `createBank` from either implementation.

## Adapter implementation

Only the adapters know the delivery protocol. The runnable example uses a real
HTTP connection to a dummy service on an available loopback port. No public
service or account is required.

The notification adapters URL-encode the stable event ID as an idempotency key,
validate acknowledgements, impose a five-second timeout, and forward
cancellation. They translate a conflicting request into `NotificationConflict`
and an unsuccessful service response into `NotificationsUnavailable`. Network
and decoding failures become `Unexpected`. Transport status codes stay inside
the adapters.

The dummy service can accept a notification and then fail its response. A retry
returns the original acknowledgement. Deduplication belongs to the receiving
system; an idempotency key alone cannot guarantee it.

The SQLite adapter uses prepared statements and transactions. Replaying a batch
upserts the same event IDs. A failed statement rolls back the entire batch.

## Read the files

| File                                                                   | Responsibility                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`domain.ts`](domain.ts)                                               | Domain contracts, rejections, and external-system interfaces |
| [`pure.ts`](pure.ts)                                                   | Native commands, projection, policy, and model composition   |
| [`with-effect.ts`](with-effect.ts)                                     | Equivalent Effect-backed domain behavior                     |
| [`adapters/notifications.ts`](adapters/notifications.ts)               | Native notification adapter                                  |
| [`adapters/notifications-effect.ts`](adapters/notifications-effect.ts) | Effect notification adapter                                  |
| [`adapters/dummy-notifications.ts`](adapters/dummy-notifications.ts)   | Dummy notification system                                    |
| [`adapters/sqlite.ts`](adapters/sqlite.ts)                             | SQLite ledger implementation                                 |
| [`run.ts`](run.ts)                                                     | Binds the adapters, hosts the model, and runs the example    |

## Verify failure and replay behavior

[`test/notifications.test.ts`](../../test/notifications.test.ts) runs both domain
implementations with fake notifications and with real adapters. It verifies
persistence after reopening SQLite, projection replay, command deduplication,
failed-response retries, conflicting requests, cancellation, and SQL rollback.

Enable the dummy system's failed-response mode with
`startDummyNotifications({ failFirstAfterAccept: true })`.

SQLite persists the **derived ledger only**. Aggregate state, event history,
receipts, and delivery checkpoints remain in memory. Keeping the ledger does
not restore an account or its pending deliveries after a restart. The dummy
notification system's deduplication map also lives in memory.
