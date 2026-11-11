# Events and Rejections

Events record what happened. Rejections explain why something didn't. Both are **tagged factories** with the same syntax.

## Import

```ts
import { event, integer, refine, rejection } from '@marcelsud/accord'
```

## Usage

There are exactly two forms: with no shape, or with a shape.

```ts
const Cents = refine(integer, (n) => n > 0, 'positive cents')

const Opened = event('Opened')
const Deposited = event('Deposited', { amount: Cents, balance: integer })

const NotOpen = rejection('NotOpen')
const InsufficientFunds = rejection('InsufficientFunds', {
  balance: integer,
  requested: Cents,
})

Opened() // { _tag: 'Opened' }
Deposited({ amount: 100, balance: 100 }) // { amount: 100, balance: 100, _tag: 'Deposited' }
InsufficientFunds({ balance: 100, requested: 150 })
```

- No shape means no properties.
- A shape fixes the property types **and validates them at runtime**. Invalid data throws a `TypeError`.
- There's no schema-free property inference.
- The tag is the name. You can't override `_tag`.

## Using them

Emit events from an [aggregate](/docs/api/aggregate) and return rejections with `fail()`:

```ts
deposit(amount: number) {
  if (!this.state.open) return fail(NotOpen())
  this.emit(Deposited({ amount, balance: this.state.balance + amount }))
  // ...
}
```

Subscribe to events in [views](/docs/api/view), [policies](/docs/api/policy), and [projections](/docs/api/projection) by passing the factory: `on(Deposited, handler)` or `on: [Deposited]`.

## Versioning event tags

The tag is what gets persisted. When a payload changes incompatibly, give the new event a new tag and keep the old factory around for history:

```ts
// v1.ts
export const DealChanged = event('DealChanged', schemaV1)

// v2.ts
export const DealChanged = event('DealChangedV2', schemaV2)
```

See [Versioning and migrations](/docs/guides/migrations).
