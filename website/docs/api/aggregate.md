# Aggregate

An aggregate holds state and the methods that change it. A successful method commits its state and emitted events together. A rejection or exception discards everything.

`aggregate()` has three forms. Pick the one that reads best for your domain.

| Form | Signature | Use when |
| --- | --- | --- |
| [Class](#class-aggregates) | `aggregate(name, initialState)` | You like classes and `this.state` |
| [Factory](#factory-aggregates) | `aggregate(name, initialState, factory, options?)` | Methods share a context or need services |
| [Event-evolved](#event-evolved-aggregates) | `aggregate(name, contract, evolve)` | State is a fold of events; you want declared commands (and HTTP) |

## Import

```ts
import { aggregate } from '@marcelsud/accord'
```

## Class aggregates

Extend `aggregate(name, initialState)` and write ordinary methods. The initial value types `this.state`.

```ts
const Deposited = event('Deposited', { amount: Cents, balance: integer })

class Account extends aggregate('Account', { balance: 0 }) {
  deposit(amount: number) {
    const event = Deposited({ amount, balance: this.state.balance + amount })

    this.state.balance = event.balance
    this.emit(event)

    return ok({ balance: this.state.balance })
  }
}
```

Give empty collections and nullable fields a type annotation when the default can't express the full type:

```ts
class Cart extends aggregate('Cart', { items: [] as string[], coupon: null as string | null }) {}
```

### Instance API

| Member | Description |
| --- | --- |
| `Account.create()` | A fresh instance with a copy of the defaults |
| `Account.restore(state)` | An instance seeded with a copy of `state` |
| `this.state` | Protected working state |
| `this.emit(event)` | Buffer an event (protected) |
| `getState()` | A copy of the state |
| `pullEvents()` | Drain the pending events |

Direct calls on an instance mutate that local instance. That's handy for unit tests. For stored state, go through `wire()`.

::: warning Reserved names
`get`, `events`, `getState`, `pullEvents`, `emit`, `constructor`, and `then` can't be used as method names.
:::

## Factory aggregates

Pass a factory that receives `{ state, emit }` and returns the methods. They share one context.

```ts
const Account = aggregate(
  'Account',
  { status: 'PENDING' as 'PENDING' | 'OPEN', balance: 0 },
  ({ state, emit, rules }) => ({
    open() {
      state.status = 'OPEN'
      emit(Opened())
      return ok(undefined)
    },
    deposit(amount: number) {
      if (state.status !== 'OPEN') return fail(NotOpen())
      if (amount > rules.maximum) return fail(DepositLimit({ maximum: rules.maximum }))

      state.balance += amount
      emit(Deposited({ amount, balance: state.balance }))
      return ok({ balance: state.balance })
    },
  }),
  { uses: { rules: DepositRules } }
)
```

### Options

#### uses <Badge type="info" text="optional" />

`uses: Record<string, Dependency>`. Declared [services](/docs/api/service) arrive in the factory context next to `state` and `emit`.

### Standalone instances

```ts
const account = Account.create(
  { status: 'OPEN', balance: 100 },
  { rules: { maximum: 1_000 } }
)
const [reply, error] = account.deposit(50)

account.getState() // { status: 'OPEN', balance: 150 }
account.pullEvents() // [{ _tag: 'Deposited', amount: 50, balance: 150 }]
```

`Account.create()` copies the defaults; `Account.create(state, services)` copies `state`. Pass `undefined` as the seed to start from defaults with services.

## Event-evolved aggregates

Declare commands with contracts, then fold events into state with `evolve`.

```ts
import { aggregate, command, event, fail, integer, match, ok, refine, rejection, s } from '@marcelsud/accord'

const Cents = refine(integer, (n) => n > 0, 'positive cents')
const State = s.object({ open: s.boolean, balance: integer })
const Opened = event('Opened')
const Deposited = event('Deposited', { amount: Cents })
const AlreadyOpen = rejection('AlreadyOpen')
const NotOpen = rejection('NotOpen')

const open = command(
  { state: State, input: {}, events: [Opened], rejects: [AlreadyOpen] },
  (state) => (state.open ? fail(AlreadyOpen()) : ok({ events: [Opened()] }))
)

const deposit = command(
  { state: State, input: { amount: Cents }, events: [Deposited], rejects: [NotOpen], reply: { balance: integer } },
  (state, { amount }) => {
    if (!state.open) return fail(NotOpen())
    return ok({ events: [Deposited({ amount })], reply: { balance: state.balance + amount } })
  }
)

export const Account = aggregate(
  'Account',
  { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open, deposit } },
  (state, event) =>
    match(event, {
      Opened: () => ({ ...state, open: true }),
      Deposited: ({ amount }) => ({ ...state, balance: state.balance + amount }),
    })
)
```

Calls take an input object: `bank.account.deposit('a-1', { amount: 100 })`. Input is validated and returns `InvalidInput` when it doesn't match.

### Command contract

| Field | Type | |
| --- | --- | --- |
| `state` | `SchemaInput` | State schema |
| `input` | `SchemaInput` | Input schema |
| `events` | `Event[]` | Events the command may emit |
| `rejects` | `Rejection[]` | <Badge type="info" text="optional" /> Declared rejections |
| `reply` | `SchemaInput` | <Badge type="info" text="optional" /> Reply schema |
| `uses` | `Record<string, Dependency>` | <Badge type="info" text="optional" /> Services |

The handler returns `ok({ events, reply? })` or `fail(rejection)`. Calling it directly (`deposit(state, input)`) validates and returns a decision without saving anything.

You can also declare the aggregate contract once as `{ state, commands }` and implement each command with `command(AccountContract, 'deposit', body)`. Those commands keep their declared names and state schema. Only `command()` definitions can be exposed over [HTTP](/docs/api/http).

## Calls through the runtime

```ts
const bank = wire(model('Bank', { aggregates: { account: Account } }))

const [receipt, error] = await bank.account.deposit('a-1', 100)
const [state] = await bank.account.get('a-1')
const [envelopes] = await bank.account.events('a-1', { after: 0 })
```

- Calls for one ID run in order. Each starts from a copy of stored state (or the defaults).
- A successful call saves state, events, and a receipt together.
- `get(id)` returns a copy of the stored state (the initial value for a fresh ID).
- `events(id, { after })` returns committed [envelopes](/docs/concepts/delivery#the-commit) after a sequence number.

### Receipt

| Field | Description |
| --- | --- |
| `reply` | What your method returned in `ok()` |
| `events` | The committed envelopes |
| `version` | Number of successful calls |
| `eventCursor` | Last committed event sequence (class and factory aggregates) |
| `commandId`, `stream` | Identity of the commit |

Pass the receipt to `view.get(key, { atLeast: receipt })` to [read your own write](/docs/api/view#read-your-own-writes).

### Call options (event-evolved commands)

#### commandId <Badge type="info" text="optional" />

`string`. Deduplicates successful commits per instance. Reusing it with different input returns `CommandConflict`.

#### expectedVersion <Badge type="info" text="optional" />

`number`. Optimistic concurrency. A stale version returns `Conflict`.

```ts
await bank.account.deposit('a-1', { amount: 100 }, { commandId: 'req-42', expectedVersion: 1 })
```

## See also

- [Model and wire](/docs/api/model)
- [Events and Rejections](/docs/api/events)
