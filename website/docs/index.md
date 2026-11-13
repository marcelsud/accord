# Accord

Accord is a **composable domain modeling** library for TypeScript. _Simplifying DDD for the rest of us._

You define business rules, record what happened, and describe what should happen next. Business failures are plain tagged values. Every operation returns `[value, null]` or `[null, error]`. Effect is optional.

```ts
import { aggregate, event, integer, model, ok, refine, wire } from '@marcelsud/accord'

const Cents = refine(integer, (amount) => amount > 0, 'positive cents')
const Deposited = event('Deposited', { amount: Cents, balance: integer })

class Account extends aggregate('Account', { balance: 0 }) {
  deposit(amount: number) {
    const event = Deposited({ amount, balance: this.state.balance + amount })

    this.state.balance = event.balance
    this.emit(event)

    return ok({ balance: this.state.balance })
  }
}

const Bank = model('Bank', { aggregates: { account: Account } })
const bank = wire(Bank)

const [receipt, error] = await bank.account.deposit('account-123', 100)
if (error !== null) throw error
console.log(receipt.reply) // { balance: 100 }
```

That's it. `wire()` gives you a typed client. Each call loads the stored state, runs your method on an isolated instance, and commits state and events together.

## Quick Start

Accord isn't on npm yet. Build a tarball from the repository and install it:

```sh
git clone https://github.com/marcelsud/accord.git
cd accord
npm ci --ignore-scripts
npm pack
```

Then follow [Getting Started](/docs/getting-started/basic).

## Features

- **Small API**: `aggregate`, `event`, `rejection`, `view`, `policy`, `projection`, `model`, `wire`. That's most of it.
- **Typed tuples**: no hidden throws. Rejections are values, and `match()` checks you handled every one.
- **Runtime schemas**: `integer`, `string`, `refine`, `union`, and friends validate events, rejections, and inputs at runtime.
- **Read your own writes**: `view.get(key, { atLeast: receipt })` catches a view up to your command.
- **Durable when you need it**: `@marcelsud/accord/sqlite` persists state, history, views, and checkpoints with Node.js's built-in SQLite.
- **Zero runtime dependencies**: Effect is an optional peer, used only by `@marcelsud/accord/effect`.
- **Testable**: `story()` runs a scenario against a fresh in-memory runtime and returns a tuple.

## Entry points

| Import | What you get |
| --- | --- |
| `@marcelsud/accord` | The core: schemas, results, definitions, runtime, HTTP transport, stories |
| `@marcelsud/accord/sqlite` | The `sqlite()` durable store (Node.js 24 built-in `node:sqlite`) |
| `@marcelsud/accord/effect` | `effectify()` for Effect v4.1.2+ |

::: warning Version 0.1
This is the first version. The runtime is in-process, workflows are memory-only, and no npm release has been published yet. See [Limits of v0.1](/docs/guides/limits).
:::

## Next

- [Getting Started](/docs/getting-started/basic): install and run your first aggregate.
- [Motivation](/docs/concepts/motivation): why Accord looks the way it does.
- [DDD concepts](/docs/concepts/ddd/): how the vocabulary maps onto Accord, with a lending-desk tutorial.
- [Examples](/examples/): bank, notifications, durable bank, and a CRM with migrations.
