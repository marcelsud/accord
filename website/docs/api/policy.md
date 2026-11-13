# Policy

A policy says "when this happens, do that". It reacts to **new** events only and never replays history.

## Import

```ts
import { on, policy } from '@marcelsud/accord'
```

## Usage

```ts
const NotifyDeposit = policy(
  'NotifyDeposit',
  { from: Account, uses: { notifications: Notifications } },
  on(Deposited, (event, { notifications }, { id, source }) =>
    notifications.send({
      eventId: id,
      accountId: source.id,
      amount: event.amount,
      balance: event.balance,
    })
  )
)

const Bank = model('Bank', { aggregates: { account: Account }, policies: [NotifyDeposit] })
```

Each handler receives:

1. the tagged event payload,
2. the declared services plus execution context,
3. the [envelope](/docs/concepts/delivery#the-commit).

Omit parameters you don't use. Return a `Result` or a promise of one. Add more `on()` handlers to react to other events from the same source.

## Options

### from

`Aggregate | View`. The source.

### uses <Badge type="info" text="optional" />

`Record<string, Dependency>`. Services the handlers need. See [Service](/docs/api/service).

### version <Badge type="info" text="optional" />

`number`, default `1`.

## Delivery

- Policies run when `bank.flush()` is called.
- New policies start at the current position. Existing policies resume where they left off.
- They skip history, including events forwarded while a view rebuilds.
- Delivery is at-least-once. Use the envelope `id` as an idempotency key.
- Duplicate event tags and empty handler lists are rejected.

## Effect handlers

```ts
on(Deposited, effectify((event, services, envelope) => Effect.succeed(undefined)))
```

See [Effect](/docs/api/effect).

## Contract form

`policy(name, { from, on, uses? }, body)` is also supported. The body receives `(envelope, context)`.
