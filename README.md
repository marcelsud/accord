# Accord

**Composable domain modeling**, simplifying DDD for the rest of us.

`@marcelsud/accord` keeps domain modeling simple. Define business rules, record
what happened, and describe what should happen next through a small, explicit
API. Business failures are plain tagged values. Operations return
`[value, null]` or `[null, error]`. Effect is optional.

This first version includes an **in-process runtime**. It is suitable for tests,
prototypes, and exploring the API. Storage, delivery checkpoints, and workflow
steps do not survive process termination. No npm release has been published from
this repository yet.

## Run the examples

Use Node.js 24 or newer. The checks compile the examples and exercise the
notification adapter against a local loopback server.

```sh
git clone https://github.com/marcelsud/accord.git
cd accord
npm ci --ignore-scripts
npm run check
npm run example
npm run example:effect
```

The native bank example prints a stored balance of 100 and a standalone preview
of 150. The Effect example prints 100. Both use the same account factory with
a `Balance` value object.
[Bank walkthrough](examples/bank/README.md)

For a complete integration example, run both versions with a SQLite ledger and
an external notification system after `npm run check`:

```sh
npm run example:sqlite
npm run example:sqlite:effect
```

They project account events into SQLite and send notifications through an
external system contract. SQLite stores the derived ledger. Aggregate state and
delivery checkpoints live in memory.
[Notification walkthrough](examples/notifications/README.md)

To consume a local build, run `npm pack` and install the generated
`marcelsud-accord-0.1.0.tgz` in another project. Import the core from
`@marcelsud/accord`; install `effect@^4.1.2` only when importing
`@marcelsud/accord/effect`.

## Define business rules

For a class aggregate, the initial state supplies the type of `this.state` and
the methods supply the types for runtime calls.

```ts
import { aggregate, event, integer, model, ok, refine, wire } from "@marcelsud/accord";

const Cents = refine(integer, (amount) => amount > 0, "positive cents");
const Deposited = event("Deposited", { amount: Cents, balance: integer });

class Account extends aggregate("Account", { balance: 0 }) {
  deposit(amount: number) {
    const event = Deposited({ amount, balance: this.state.balance + amount });

    this.state.balance = event.balance;
    this.emit(event);

    return ok({ balance: this.state.balance });
  }
}

const Bank = model("Bank", { aggregates: { account: Account } });
const bank = wire(Bank);
const [receipt, error] = await bank.account.deposit("account-123", 100);
if (error !== null) throw error;
console.log(receipt.reply); // { balance: 100 }
```

Use `Account.create()` for a fresh instance or `Account.restore(state)` to
start with known state. `getState()` returns a copy, and `pullEvents()` drains
the instance's pending events. Direct calls mutate that local instance. For stored
state, call methods through `wire()` with the instance ID first. It runs the method
on an isolated instance and commits state and events together on `ok()`. A
`fail()` result or exception discards the working instance.
[Class aggregate reference](docs/runtime.md#class-aggregates)

Use a factory aggregate to give a group of methods one context. Its
`snapshot` and `restore` functions convert between working state and stored
data. The bank example initializes its status with `Status.of("PENDING")`
and its balance with `Balance.of(0)`. Stored state contains the status string
and cents. [Factory aggregate reference](docs/runtime.md#factory-aggregates)

## Use tagged rejections

There are exactly two constructor forms:

```ts
import { integer, refine, rejection } from "@marcelsud/accord";

const Cents = refine(integer, n => n > 0, "positive cents");
const NotOpen = rejection("NotOpen");
const InsufficientFunds = rejection("InsufficientFunds", {
  balance: integer,
  requested: Cents,
});

NotOpen();
InsufficientFunds({ balance: 100, requested: 150 });
```

No shape means no properties. A shape fixes the property types and validates
them at runtime. There is no schema-free property inference. Events use the same
constructor syntax. Tags cannot be overridden.

Schema primitives are runtime values: `number`, `integer`, `string`, and
`boolean` can be imported directly or accessed as `s.number`, `s.integer`,
`s.string`, and `s.boolean`. `integer` means a safe integer. Shapes can be nested;
`optional`, `nullable`, `array`, `literal`, `union`, and `refine` compose them.
Custom synchronous schemas implement `{ parse(value: unknown): T }`.

## Check tuples before using values

```ts
const [receipt, error] = await bank.account.deposit("a-1", 100);

// receipt is unknown until error is narrowed.
if (error !== null) {
  console.error(error._tag);
} else {
  console.log(receipt.reply.balance);
}
```

Always inspect the error slot: a successful operation can return `null` or
`undefined`. `Unexpected` is an `Error` carrying `_tag: "Unexpected"` and the
original thrown value in `cause`. Input validation at a schema boundary
returns `InvalidInput`. A thrown exception or an invalid runtime result becomes
`Unexpected`.

`trycatch(task)` provides the same convention for synchronous functions, async
functions, and promises. Prefer a function when invocation must be deferred.
`trycatch` catches thrown/rejected values; it does not flatten an existing tuple.
Accord operations already return tuples.

## Match exhaustively

```ts
import { match } from "@marcelsud/accord";

(state, event) => match(event, {
  Opened: () => ({ ...state, open: true }),
  Deposited: ({ amount }) => ({
    ...state,
    balance: state.balance + amount,
  }),
});
```

Handlers receive narrowed values. Missing or unknown cases fail type checking.
Adding an event identifies exhaustive matches that need updating. The same
utility works for rejections.

## Declare dependencies with uses

```ts
import { service, integer } from "@marcelsud/accord";

const DepositRules = service("DepositRules", { maximum: integer });
```

Add `uses: { rules: DepositRules }` to an operation's contract. Its native body
receives the typed dependency as `ctx.rules`. Supply the implementation through
`wire(Model, { services: { rules: { maximum: 1_000 } } })`.

Service names identify dependencies and must be unique. Each alias must refer
to the same dependency throughout a model. Context metadata names such as
`actor`, `signal`, and `commandId` are reserved. Commands receive trusted metadata
from the runtime; HTTP callers cannot provide an actor or dependency bindings.

## Add optional Effect integration

Install Effect separately. The core entry point never imports it. A class method
runs through the native runtime and can be called inside `Effect.gen`:

```ts
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const [receipt, error] = yield* Effect.promise(() =>
    bank.account.deposit("a-1", 100),
  );
  if (error !== null) return yield* Effect.fail(error);
  return receipt.reply.balance;
});
```

Use `effectify(Dependency)` to get a stable Effect service key. Use
`effectify(body)` for policies, projections, workflows, external adapters, and
commands defined with `command()`. Their `uses` declaration checks the Effect
requirements. See the [Effect bank example](examples/bank/with-effect.ts) and the
[Effect notification example](examples/notifications/with-effect.ts).

## Build the rest of the model

| Primitive | Handler and behavior |
| --- | --- |
| `aggregate(name, initialState)` | Class base with inferred state, factories, and event collection |
| `aggregate(name, initialState, factory, codec)` | Methods share a context and use an explicit state codec |
| `aggregate(name, contract, evolve)` | `(state, event) => state`; infers events from commands |
| `view(name, contract, evolve)` | `(state, event, envelope) => state`; replays history, supports routing and versions |
| `policy(name, contract, body)` | `(envelope, ctx) => Result`; handles new events only |
| `projection(name, contract, body)` | `(batch, ctx) => Result`; replayable, idempotent writes |
| `external(name, contract, body)` | `(input, ctx) => Result`; `.implement(services)` binds an adapter |
| `workflow(name, contract, body)` | `(input, run) => Result`; checkpointed steps and compensation in memory |
| `stream(name, contract)` | Declares a keyed event stream; append, list, and watch through the runtime |
| `api(name, contract, authorize?)` | `(request, ctx) => Result<{ actor? }, Rejection>`; selects exposed commands and views |
| `story(model, body, options?)` | Test with `bank`, `given`, and `equal`; returns a tuple |

A model registers aggregates and optional views, policies, projections,
workflows, and streams. Make it executable with `wire`:

```ts
import { wire } from "@marcelsud/accord";

const bank = wire(Bank);
```

Pass `{ storage: memory(), services }` as the second argument to share storage
or supply declared dependencies. `bank.flush()` catches consumers up and returns
the first delivery failure. Failed deliveries retain their checkpoint and retry
on the next flush.
No background scheduler or automatic backoff is provided.

Views and projections rebuild from history. Policies skip history, including
events forwarded while rebuilding a view. Bump a view or projection's version
when its calculation changes. View versions cannot decrease within a memory
store. Ordering is per source stream; there is no global ordering between
sources. Projection writes and policy actions must tolerate repeated delivery.

Use `view.get(key, { atLeast: receipt })` to flush and read your own write.
Without `atLeast`, reads return the currently materialized state, which may be
`null`. Native watchers return async generators of snapshot tuples. Supply an
`AbortSignal` to stop a pending watcher.

Contract-based commands accept `commandId` and `expectedVersion` call options.
The ID deduplicates successful commits per instance. Reusing it with a different
command or input returns `CommandConflict`. A stale version returns `Conflict`.
Class methods accept the arguments declared by the method after the instance ID.

[Read the runtime and transport reference](docs/runtime.md) for workflows,
external adapters, HTTP authorization, testing, and the limits of this release.

## Develop

```sh
npm run format:examples  # Format all examples with Prettier
npm run typecheck  # Positive assertions and @ts-expect-error inference tests
npm test           # Build, compile tests, and run Node's built-in test runner
npm run build      # ESM and declaration files in dist/
npm run check      # All of the above
```

No runtime dependencies are installed for the core. Effect is an optional peer.
The package is currently marked `UNLICENSED`; no open-source license has been
selected yet.
