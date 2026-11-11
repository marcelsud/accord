# Model and wire

`model()` registers your definitions. `wire()` turns a model into a typed runtime client.

## Import

```ts
import { memory, model, wire } from '@marcelsud/accord'
```

## model(name, contract)

```ts
const Bank = model('Bank', {
  aggregates: { account: Account, savings: SavingsAccount },
  views: { summary: Summary },
  policies: [NotifyDeposit],
  projections: [Totals],
  workflows: { job: Job },
  streams: { activity: Activity },
})
```

### aggregates

`Record<string, Aggregate>`. The keys are the client aliases: `bank.account`, `bank.savings`.

### views <Badge type="info" text="optional" />

`Record<string, View>`. Exposed as `bank.summary`.

### policies <Badge type="info" text="optional" />

`Policy[]`.

### projections <Badge type="info" text="optional" />

`Projection[]`.

### workflows <Badge type="info" text="optional" />

`Record<string, Workflow>`. Exposed as `bank.workflows.job`.

### streams <Badge type="info" text="optional" />

`Record<string, Stream>`. Exposed as `bank.streams.activity`.

Rules checked when you call `model()`:

- Every definition name must be unique and non-empty.
- Aliases must be unique and can't be `workflows`, `streams`, `flush`, or `then`.
- Views and consumers must subscribe to a registered source, and only to events that source declares.
- Versions are safe integers `>= 1`.

## wire(model, options?)

```ts
const bank = wire(Bank, {
  storage: memory(),
  services: { rules: { maximum: 1_000 } },
})
```

### storage <Badge type="info" text="optional" />

`RuntimeStore`. Defaults to a fresh `memory()` store. Pass the same `memory()` object to share state between runtimes in one process, or a [SQLite store](/docs/api/sqlite) for durability.

### services

`Record<string, Service>`. **Required** when anything in the model declares `uses`. TypeScript tells you what's missing.

## The runtime

| Member | Description |
| --- | --- |
| `bank.<aggregate>.<method>(id, ...args)` | Run a command. See [Aggregate](/docs/api/aggregate#calls-through-the-runtime) |
| `bank.<aggregate>.get(id)` / `.events(id)` | Read state / history |
| `bank.<view>.get(key, options?)` | Read a view. See [View](/docs/api/view) |
| `bank.workflows.<name>(input)` | Run a [workflow](/docs/api/workflow) |
| `bank.streams.<name>` | Append to and read a [stream](/docs/api/stream) |
| `bank.flush()` | Deliver pending events to consumers |

## flush()

```ts
const [, error] = await bank.flush()
if (error !== null) throw error
```

Catches all consumers up and returns the first delivery failure. Failed deliveries keep their checkpoint and retry on the next flush. There's no background scheduler or automatic backoff.

## memory()

The default in-process store. It provides atomic aggregate commits, keyed concurrency, receipts, replay, and consumer checkpoints, and also holds workflow checkpoints.
