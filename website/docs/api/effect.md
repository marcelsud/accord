# Effect

`@marcelsud/accord/effect` adapts Accord to [Effect](https://effect.website) v4.1.2+ in the v4 line.

## Import

```ts
import { effectify } from '@marcelsud/accord/effect'
```

## effectify overloads

| Call | Returns |
| --- | --- |
| `effectify(Model, 'Name')` | A named Effect service key with a `layer` |
| `effectify(Model)` | An Effect that resolves dependencies and builds a client |
| `effectify(Dependency)` | A stable Effect service key for a `service()` or `external()` |
| `effectify(command)` | `(state, input) => Effect` running the command decision with its services from the environment |
| `effectify(handler)` | An Effect-returning handler for `on()`, projections, workflows, and externals |

## Model as a service

```ts
const Bank = effectify(BankModel, 'Bank')
const RulesLive = Layer.succeed(effectify(DepositRules), { maximum: 1_000 })
const BankLive = Bank.layer.pipe(Layer.provide(RulesLive))

const program = Effect.gen(function* () {
  const bank = yield* Bank
  yield* bank.account.open('a-1')
  const receipt = yield* bank.account.deposit('a-1', 100)
  return yield* bank.summary.get('a-1', { atLeast: receipt })
})

await Effect.runPromise(Effect.provide(program, BankLive))
```

- The layer requires the model's declared dependencies.
- Effects that yield the same service from one layer provision share a runtime and its in-memory store. Use distinct names for distinct model services.

## Direct acquisition

```ts
const program = Effect.gen(function* () {
  const bank = yield* effectify(BankModel)
  // ...
})
```

## Semantics

- Calls that return a promise of a tuple become lazy Effects. The value becomes the Effect result; the error becomes a typed failure.
- Watch methods still return async generators.
- If a caller is interrupted while waiting on a native call, that call may still finish in the runtime.
- Native dependency shapes keep their tuple results when called from inside a generator.

## Effect handlers

Wrap a handler with `effectify` and get services through their Effect keys:

```ts
const NotifyDeposit = policy(
  'NotifyDeposit',
  { from: Account, uses: { notifications: Notifications } },
  on(
    Deposited,
    effectify((event, _services, { id, source }) =>
      Effect.gen(function* () {
        const notifications = yield* effectify(Notifications)
        const [, error] = yield* Effect.promise((signal) =>
          notifications.send(
            { eventId: id, accountId: source.id, amount: event.amount, balance: event.balance },
            { signal }
          )
        )
        if (error !== null) return yield* Effect.fail(error)
        return undefined
      })
    )
  )
)
```

`uses` declares the Effect requirements the handler may use. A typed Effect failure becomes a rejection; interrupts and defects become `Unexpected`. From the [Notifications example](/examples/notifications).
