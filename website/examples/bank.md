# Bank

A factory aggregate with a status and a balance in cents, a `Balance` value object, a view, and deposit rules supplied as a service. Same domain, two runners: native tuples and Effect.

Source: [`bank/`](examples:bank)

## Run it

```sh
npm run bank
npm run bank:effect
```

The native runner prints:

```txt
Balance view: { balance: 100 }
Account snapshot: { status: 'OPEN', balance: 100 }
Savings snapshot: { balance: { cents: 100 } }
Standalone savings preview: { balance: 150 }
```

The Effect runner prints `{ balance: 100 }`.

## The domain

```ts [bank/domain.ts]
export const DepositRules = service('DepositRules', { maximum: Cents })

class Balance extends vo('Balance', integer) {
  get cents() {
    return this.value
  }

  inc(amount: number): Balance {
    return Balance.of(this.cents + parse(Cents, amount))
  }
}

export const Account = aggregate(
  'Account',
  { status: Status.of('PENDING'), balance: 0 },
  ({ state, emit, rules }) => ({
    open() {
      if (state.status !== 'PENDING') return fail(CannotOpen({ status: state.status }))
      state.status = Status.of('OPEN')
      emit(Opened())
      return ok(undefined)
    },

    deposit(amount: number) {
      if (state.status !== 'OPEN') return fail(NotOpen())
      if (amount > rules.maximum) return fail(DepositLimit({ maximum: rules.maximum }))

      const balance = Balance.of(state.balance).inc(amount).cents
      state.balance = balance
      emit(Deposited({ amount, balance }))
      return ok({ balance })
    },
  }),
  { uses: { rules: DepositRules } }
)
```

`SavingsAccount` uses the same value object with a nested `{ balance: { cents } }` state.

## The native runner

```ts [bank/pure.ts]
const bank = wire(Bank, { services: { rules: { maximum: 1_000 } } })

const [, openError] = await bank.account.open('a-1')
if (openError !== null) throw openError

const [receipt, error] = await bank.account.deposit('a-1', 100)
if (error !== null) throw error

const [summary] = await bank.summary.get('a-1', { atLeast: receipt })
console.log('Balance view:', summary) // { balance: 100 }
```

It also seeds `SavingsAccount.create(snapshot)` from stored state and previews a deposit locally.

## Standalone test

```ts
const account = Account.create({ status: 'OPEN', balance: 100 }, { rules: { maximum: 1_000 } })
const [reply, error] = account.deposit(50)

console.log(reply) // { balance: 150 }
console.log(account.pullEvents()) // [{ _tag: 'Deposited', amount: 50, balance: 150 }]
```

## Files

| File | What it does |
| --- | --- |
| [`domain.ts`](examples:bank/domain.ts) | Aggregates, value object, rejections, view, model |
| [`pure.ts`](examples:bank/pure.ts) | Native runner |
| [`with-effect.ts`](examples:bank/with-effect.ts) | Effect runner with `effectify(Bank, 'Bank')` and a rules layer |
