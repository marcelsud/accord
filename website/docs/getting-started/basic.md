# Getting Started

Using Accord is easy. Let's build a tiny bank: one aggregate, one event, one rejection, and a view.

## Requirements

- Node.js **24** or newer (Accord uses `node:sqlite`, `using`, and runs `.ts` files directly in Node 24)
- TypeScript is recommended; Accord infers almost every type for you.

## Install

Accord isn't published to npm yet. Build a tarball from the repository:

```sh
git clone https://github.com/marcelsud/accord.git
cd accord
npm ci --ignore-scripts
npm pack # creates marcelsud-accord-0.1.0.tgz
```

Then install it in your project:

::: code-group

```sh [npm]
npm install ../accord/marcelsud-accord-0.1.0.tgz
```

```sh [yarn]
yarn add ../accord/marcelsud-accord-0.1.0.tgz
```

```sh [pnpm]
pnpm add ../accord/marcelsud-accord-0.1.0.tgz
```

```sh [bun]
bun add ../accord/marcelsud-accord-0.1.0.tgz
```

:::

Accord is ESM-only, so set `"type": "module"` in your `package.json`.

## Hello Bank

```ts [index.ts]
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

Run it:

```sh
node index.ts
```

What happened:

1. `aggregate('Account', { balance: 0 })` creates a base class. The initial state types `this.state`.
2. `event('Deposited', shape)` creates a factory that validates its payload at runtime.
3. `model()` registers the aggregate under the alias `account`.
4. `wire()` returns a typed client. `bank.account.deposit(id, ...args)` takes the instance ID first.

## Reject bad requests

Business refusals are values. Declare them with `rejection()` and return them with `fail()`.

```ts
import { aggregate, event, fail, integer, model, ok, rejection, wire } from '@marcelsud/accord'

const Deposited = event('Deposited', { amount: integer, balance: integer })
const NotOpen = rejection('NotOpen')

class Account extends aggregate('Account', { open: false, balance: 0 }) {
  open() {
    this.state.open = true
    return ok(undefined)
  }

  deposit(amount: number) {
    if (!this.state.open) return fail(NotOpen())

    this.state.balance += amount
    this.emit(Deposited({ amount, balance: this.state.balance }))
    return ok({ balance: this.state.balance })
  }
}

const bank = wire(model('Bank', { aggregates: { account: Account } }))

const [, error] = await bank.account.deposit('a-1', 100)
console.log(error) // { _tag: 'NotOpen' }

await bank.account.open('a-1')
const [receipt] = await bank.account.deposit('a-1', 100)
console.log(receipt?.reply) // { balance: 100 }
```

A `fail()` result discards the working instance. Nothing is saved.

## Add a view

A view folds events into read state, keyed by the aggregate ID by default.

```ts
import { on, view } from '@marcelsud/accord'

const Summary = view(
  'Summary',
  { from: Account, initial: { balance: 0 } },
  on(Deposited, (_state, { balance }) => ({ balance }))
)

const Bank = model('Bank', {
  aggregates: { account: Account },
  views: { summary: Summary },
})
const bank = wire(Bank)

await bank.account.open('a-1')
const [receipt] = await bank.account.deposit('a-1', 100)
const [summary] = await bank.summary.get('a-1', { atLeast: receipt })
console.log(summary) // { balance: 100 }
```

`atLeast: receipt` catches the view up to your command before reading.

## Next

- Keep your data across restarts with [SQLite](/docs/getting-started/sqlite).
- Use Accord from [Effect](/docs/getting-started/effect).
- Learn the full [Aggregate API](/docs/api/aggregate).
