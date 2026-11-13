# Events and delivery

Commands commit events. Consumers (views, policies, and projections) receive them later, when you call `flush()`.

```ts
const [receipt, error] = await bank.account.deposit('a-1', 100)
if (error !== null) throw error

// Deliver pending events to policies and projections.
const [, deliveryError] = await bank.flush()
if (deliveryError !== null) throw deliveryError
```

## The commit

A successful command saves the new state, its events, and a receipt in one step. The receipt describes the aggregate commit, not the success of every consumer.

Each event is wrapped in an **envelope**:

| Field | Meaning |
| --- | --- |
| `id` | Stable event ID, e.g. `["Bank","Account","a-1"]:2`. Use it as an idempotency key |
| `stream` | The source stream |
| `seq` | Sequence number within the stream |
| `at` | Timestamp (ms) |
| `source` | `{ type, id }` of the aggregate or view |
| `event` | The tagged event payload |

## Delivery

- **`flush()` is explicit.** There is no background worker or automatic backoff. Call `flush()` yourself (an `atLeast` read also flushes).
- **Failures retry.** A failed consumer stops that flush and keeps its checkpoint. The next `flush()` retries the unacknowledged delivery.
- **At-least-once.** Projection writes and policy actions must tolerate repeated delivery.
- **Ordering is per source stream.** There's no global ordering across sources.

::: warning
Don't await `flush()` from inside a consumer that is already running in that flush.
:::

## Who sees history

| Consumer | Replays history? | Rebuild trigger |
| --- | --- | --- |
| [View](/docs/api/view) | Yes | Bump `version` |
| [Projection](/docs/api/projection) | Yes | Bump `version` |
| [Policy](/docs/api/policy) | No, new events only | New policies start at the current position |

## Read your own writes

Views are eventually consistent. Pass the receipt to catch up first:

```ts
const [summary] = await bank.summary.get('a-1', { atLeast: receipt })
```

Without `atLeast`, you get whatever is materialized now, which may be `null`.
