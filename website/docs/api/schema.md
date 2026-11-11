# Schemas

Schemas are runtime values. Use them in event, rejection, service, and contract shapes. Accord validates data at those boundaries and infers TypeScript types from them.

## Import

```ts
import { integer, refine, s, string } from '@marcelsud/accord'
```

Every primitive is exported directly and on the `s` namespace (`s.integer`, `s.string`, ...).

## Usage

```ts
import { array, integer, literal, nullable, optional, refine, string, union } from '@marcelsud/accord'

const Cents = refine(integer, (n) => n > 0, 'positive cents')
const Status = union(literal('PENDING'), literal('OPEN'), literal('CLOSED'))

const Customer = {
  name: string,
  email: nullable(string),
  nickname: optional(string),
  tags: array(string),
  status: Status,
  address: { city: string, zip: string }, // shapes nest
}
```

A plain object of schemas is a **shape**. Shapes reject unknown properties.

## Primitives

| Schema | Accepts |
| --- | --- |
| `string` | Any string |
| `number` | A finite number |
| `integer` (also `s.int`) | A safe integer |
| `boolean` | `true` or `false` |
| `unknown` | Anything, unchecked |

## Combinators

### literal(value)

Exactly `value` (string, number, boolean, or `null`).

### optional(schema)

`schema` or `undefined`. In a shape, the property becomes optional.

### nullable(schema)

`schema` or `null`.

### array(schema)

An array whose items all match `schema`.

### union(...schemas)

The first alternative that parses.

### refine(schema, check, description)

`schema` plus a predicate. On failure the error says `Expected <description>`.

### object(shape)

Turns a shape into a `Schema`. You rarely need it: shapes work anywhere a schema does.

## parse(schema, value)

Validate a value yourself. It throws a `TypeError` on failure.

```ts
import { parse } from '@marcelsud/accord'

parse(Cents, 100) // 100
parse(Cents, -1) // throws TypeError: Expected positive cents
```

## Custom schemas

Any object with a synchronous `parse(value: unknown): T` is a schema.

```ts
import type { Schema } from '@marcelsud/accord'

const Email: Schema<string> = {
  parse(value) {
    if (typeof value === 'string' && value.includes('@')) return value
    throw new TypeError('Expected email')
  },
}
```

## Infer

Get the TypeScript type of a schema with `Infer`.

```ts
import type { Infer } from '@marcelsud/accord'

type Status = Infer<typeof Status> // 'PENDING' | 'OPEN' | 'CLOSED'
```
