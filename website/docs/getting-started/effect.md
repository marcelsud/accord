# Effect

Accord works without [Effect](https://effect.website). If you use Effect, `@marcelsud/accord/effect` turns your model into an Effect service whose calls are lazy Effects.

## Install

Effect is an optional peer dependency. Install `effect@^4.1.2`:

::: code-group

```sh [npm]
npm install effect@^4.1.2
```

```sh [yarn]
yarn add effect@^4.1.2
```

```sh [pnpm]
pnpm add effect@^4.1.2
```

```sh [bun]
bun add effect@^4.1.2
```

:::

## Usage

```ts
import { Effect, Layer } from 'effect'
import { effectify } from '@marcelsud/accord/effect'
import { Bank as BankModel, DepositRules } from './domain.ts'

const Bank = effectify(BankModel, 'Bank')
const RulesLive = Layer.succeed(effectify(DepositRules), { maximum: 1_000 })
const BankLive = Bank.layer.pipe(Layer.provide(RulesLive))

const program = Effect.gen(function* () {
  const bank = yield* Bank
  const id = 'a-1'

  yield* bank.account.open(id)
  const receipt = yield* bank.account.deposit(id, 100)
  return yield* bank.summary.get(id, { atLeast: receipt })
})

const summary = await Effect.runPromise(Effect.provide(program, BankLive))
console.log(summary) // { balance: 100 }
```

- `effectify(BankModel, 'Bank')` creates a named service key with a `layer`.
- The layer requires the model's declared dependencies. Provide them with layers built from `effectify(Dependency)`.
- A successful tuple becomes the Effect's value; its error becomes a typed failure.

The bank domain is in the [Bank example](/examples/bank).

## Next

See the [Effect API reference](/docs/api/effect).
