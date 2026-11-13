# External

An external operation is a typed adapter contract for another system: an SDK, an HTTP API, a queue.

## Import

```ts
import { external, ok, string } from '@marcelsud/accord'
```

## Usage

```ts
const Uppercase = external(
  'Uppercase',
  { input: { value: string }, reply: { value: string } },
  (input) => ok({ value: input.value.toUpperCase() })
)

const uppercase = Uppercase.implement({})
const [value, error] = await uppercase({ value: 'accord' }) // [{ value: 'ACCORD' }, null]
```

`operation.implement(services)` creates the callable adapter. It validates input, reply, declared rejections, and dependency bindings.

## Contract

### input

`SchemaInput`.

### reply <Badge type="info" text="optional" />

`SchemaInput`.

### rejects <Badge type="info" text="optional" />

`Rejection[]`. Expected vendor refusals must map to one of these.

### uses <Badge type="info" text="optional" />

`Record<string, Dependency>`.

An external operation can itself be listed in another definition's `uses`.

## Calling a real SDK

This excerpt assumes a `sdk` client and a `Bounced` rejection from your app. Wrap the call in `trycatch`. SDK exceptions become `Unexpected`; map expected refusals to declared rejections.

```ts
const SendEmail = external(
  'SendEmail',
  { input: { to: string }, rejects: [Bounced] },
  async (input, ctx) => {
    const [res, error] = await trycatch(() =>
      sdk.send(input, { signal: ctx.signal, idempotencyKey: ctx.idempotencyKey })
    )
    if (error !== null) return fail(error)
    if (res.bounced) return fail(Bounced())
    return ok(undefined)
  }
)
```

Returning a rejection that isn't listed in `rejects` becomes `Unexpected`.

Pass `ctx.signal` and `ctx.idempotencyKey` to vendors that support them. A signal can't stop a vendor call that ignores it.
