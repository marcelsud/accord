# Value Objects

Extend `vo(name, schema)` to get a validated value with domain methods.

## Import

```ts
import { integer, vo } from '@marcelsud/accord'
```

## Usage

```ts
class Balance extends vo('Balance', integer) {
  inc(amount: number): Balance {
    return Balance.of(this.value + amount)
  }
}

const balance = Balance.of(100).inc(50)
balance.snapshot() // 150
balance.snapshot((cents) => ({ cents })) // { cents: 150 }
```

## API

### Class.of(value)

Validates `value` against the schema and returns an instance of **your subclass**. Invalid values throw a `TypeError`.

### this.value

The validated raw value (protected). It's a `structuredClone` copy of what you passed in.

### snapshot()

Returns a copy of the raw value.

### snapshot(project)

Copies the raw value and maps it with `project`.

### Class.valueObjectName

The `name` you passed to `vo()`.

## Value objects and state

Keep aggregate state plain. Use value objects for the arithmetic, then write raw values back:

```ts
deposit(amount: number) {
  const balance = Balance.of(state.balance).inc(amount).snapshot()
  state.balance = balance
  // ...
}
```

::: tip
Use raw values that round-trip through `structuredClone`. That's what Accord stores.
:::
