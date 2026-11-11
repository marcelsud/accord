# Stream

A stream is a keyed, append-only list of events that isn't owned by an aggregate. Think activity feeds and audit logs.

## Import

```ts
import { stream, string } from '@marcelsud/accord'
```

## Usage

```ts
const Activity = stream('Activity', { key: string, event: { text: string } })

const bank = wire(model('Bank', { aggregates: { account: Account }, streams: { activity: Activity } }))

await bank.streams.activity.append('a-1', { text: 'Opened' }, { id: 'evt-1' })
const [items] = await bank.streams.activity.list('a-1') // [{ id: 'evt-1', event: { text: 'Opened' }, seq: 1 }]
```

## Contract

### key

`Schema<string>`.

### event

`SchemaInput`. Validates appended events.

## Client

### append(key, event, { id? })

Returns `{ cursor }`. Appending the same `id` and event again is a no-op; the same `id` with a different event returns `CommandConflict`.

### list(key, { after? })

Returns `{ id, event, seq }[]`.

### watch(key, { signal? })

An async generator of snapshot tuples.

Streams are native runtime APIs. They aren't exposed over [HTTP](/docs/api/http).
