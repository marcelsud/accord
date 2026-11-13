# Notifications + SQLite ledger

Open an account, deposit money, record a ledger entry in SQLite, and ask an external notification system to tell the account holder. The domain only knows two contracts: `Notifications.send` and `LedgerStore.record`.

Source: [`notifications/`](examples:notifications)

## Run it

```sh
npm run notifications
npm run notifications:effect
```

Each prints the mode, a committed balance of `100`, one ledger row, and `Notifications sent: 1`. The runner starts a dummy notification service on a loopback port. No public service or account needed.

Pass a fresh filename to inspect the ledger afterwards:

```sh
npm run notifications -- /tmp/accord-pure.sqlite
```

## The flow

```ts
const [, openError] = await bank.account.open('a-1')
if (openError !== null) throw openError

const [receipt, error] = await bank.account.deposit('a-1', 100)
if (error !== null) throw error
console.log(receipt.reply.balance) // 100

const [, deliveryError] = await bank.flush()
if (deliveryError !== null) throw deliveryError
```

1. A method updates state and emits `Opened` or `Deposited`. State and events commit together.
2. `flush()` delivers events to the ledger projection and the notification policy.
3. The policy uses the envelope's stable event ID as the notification's idempotency key.

## Swap in a fake

```ts
const notifications: NotificationPort = {
  async send(input) {
    console.log('Notification requested:', input.accountId)
    return ok({ id: `fake-${input.eventId}` })
  },
}

const { bank } = createBank(ledger, notifications)
```

## Adapters

- The HTTP adapters send the event ID as an idempotency key, validate acknowledgements, time out after five seconds, and forward cancellation.
- Conflicts become `NotificationConflict`; failed responses become `NotificationsUnavailable`; network and decoding failures become `Unexpected`.
- The SQLite adapter upserts by event ID, so replays are safe. A failed statement rolls back the whole batch.

::: warning
The default runner persists the **ledger only**. Aggregate state and checkpoints stay in memory. For durable state, pass a SQLite runtime store and share its connection with the ledger:

```ts
using storage = sqlite('bank.sqlite')
using ledger = openLedger(storage.database)
const { bank } = createBank(ledger, notifications, storage)
```
:::

## Files

| File | Responsibility |
| --- | --- |
| [`domain.ts`](examples:notifications/domain.ts) | Account, rejections, external system contracts |
| [`pure.ts`](examples:notifications/pure.ts) | Native projection, policy, and model |
| [`with-effect.ts`](examples:notifications/with-effect.ts) | Effect projection, policy, and model |
| [`adapters/notifications.ts`](examples:notifications/adapters/notifications.ts) | Native notification adapter |
| [`adapters/notifications-effect.ts`](examples:notifications/adapters/notifications-effect.ts) | Effect notification adapter |
| [`adapters/dummy-notifications.ts`](examples:notifications/adapters/dummy-notifications.ts) | Dummy notification service |
| [`adapters/sqlite.ts`](examples:notifications/adapters/sqlite.ts) | SQLite ledger |
| [`run.ts`](examples:notifications/run.ts) | Binds adapters, wires the model, runs it |
