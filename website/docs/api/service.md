# Service

A service declares a typed dependency. You declare it once, list it in `uses`, and supply it in `wire()`.

## Import

```ts
import { integer, service } from '@marcelsud/accord'
```

## Usage

```ts
const DepositRules = service('DepositRules', { maximum: integer })

const Account = aggregate(
  'Account',
  { balance: 0 },
  ({ state, emit, rules }) => ({
    deposit(amount: number) {
      if (amount > rules.maximum) return fail(DepositLimit({ maximum: rules.maximum }))
      // ...
    },
  }),
  { uses: { rules: DepositRules } }
)

const bank = wire(Bank, { services: { rules: { maximum: 1_000 } } })
```

## Where `uses` goes

| Definition | Where | Received as |
| --- | --- | --- |
| Factory aggregate | 4th argument `{ uses }` | factory context, `ctx.rules` |
| Command | contract `uses` | context argument |
| Policy / projection | contract `uses` | second handler argument |
| External / workflow | contract `uses` | `ctx` / `run.services` |

## Rules

- Service names identify dependencies and must be unique.
- Each alias must refer to the same dependency throughout a model.
- `actor`, `signal`, `commandId`, `at`, `idempotencyKey`, `services`, `step`, `wait`, and `sleep` are reserved aliases.
- A dependency can be a `service()` or an [`external()`](/docs/api/external) operation.
- Supplied service values are validated against the service schema.
- Commands receive trusted metadata from the runtime. HTTP callers can't supply an actor or dependency bindings.

## With Effect

`effectify(DepositRules)` returns a stable Effect service key:

```ts
const RulesLive = Layer.succeed(effectify(DepositRules), { maximum: 1_000 })
```
