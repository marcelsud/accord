# Accord

**Composable domain modeling**, simplifying DDD for the rest of us.

`@marcelsud/accord` keeps domain modeling simple. Define business rules, record
what happened, and describe what should happen next through a small, explicit
API. Business failures are plain tagged values. Operations return
`[value, null]` or `[null, error]`. Effect is optional.

This first version includes an **in-process runtime** with a default memory
store and optional SQLite persistence. The SQLite store recovers aggregate
state, event history, views, and consumer checkpoints after restart. Workflow
steps remain memory-only. No npm release has been published from this repository yet.

## Run the examples

Runnable examples live in the [accord-examples repository](https://github.com/marcelsud/accord-examples). They require Node.js 24 or newer and will install `@marcelsud/accord` from npm after version 0.1.0 is published.

To consume a local build, run `npm pack` and install the generated `marcelsud-accord-0.1.0.tgz` in another project. Import the core from `@marcelsud/accord`; install `effect@^4.1.2` only when importing `@marcelsud/accord/effect`.

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

Use a factory aggregate to give a group of methods one context. Factory
aggregates use the same plain state shape in methods and storage. The bank
example stores cents and calls `Balance.of()` inside the deposit method.
`Account.create(state)` seeds a standalone instance from that same shape.
[Factory aggregate reference](docs/runtime.md#factory-aggregates)

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

## Define value objects

Extend `vo(name, schema)` to validate the underlying value and add domain methods.
The inherited `of()` returns the subclass. `snapshot()` returns a copy of the raw
data, and `snapshot(project)` maps that copy to a format chosen by the caller.
Use raw values that round-trip through `structuredClone`.

```ts
import { integer, vo } from "@marcelsud/accord";

class Balance extends vo("Balance", integer) {
  inc(amount: number): Balance {
    return Balance.of(this.value + amount);
  }
}

const balance = Balance.of(100).inc(50);
balance.snapshot(); // 150
balance.snapshot((cents) => ({ cents })); // { cents: 150 }
```

The bank uses `Balance` for arithmetic inside its methods and stores cents
in aggregate state. [Bank domain](https://github.com/marcelsud/accord-examples/blob/main/bank/domain.ts)

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

Add `uses: { rules: DepositRules }` to an operation's contract or pass it in the
fourth argument to a factory aggregate. The body or factory receives the typed
dependency as `ctx.rules`. Supply the implementation through
`wire(Model, { services: { rules: { maximum: 1_000 } } })`.

Service names identify dependencies and must be unique. Each alias must refer
to the same dependency throughout a model. Context metadata names such as
`actor`, `signal`, and `commandId` are reserved. Commands receive trusted metadata
from the runtime; HTTP callers cannot provide an actor or dependency bindings.

## Add optional Effect integration

Install Effect separately. `effectify(BankModel, "Bank")` creates an Effect
service key. Its `layer` resolves the model's declared dependencies and builds
a client whose calls are lazy Effects.

```ts
import { Effect, Layer } from "effect";
import { effectify } from "@marcelsud/accord/effect";
import { Bank as BankModel, DepositRules } from "./domain.js";

const Bank = effectify(BankModel, "Bank");
const RulesLive = Layer.succeed(effectify(DepositRules), { maximum: 1_000 });
const BankLive = Bank.layer.pipe(Layer.provide(RulesLive));

const program = Effect.gen(function* () {
  const bank = yield* Bank;
  const id = "a-1";

  yield* bank.account.open(id);
  const receipt = yield* bank.account.deposit(id, 100);
  return yield* bank.summary.get(id, { atLeast: receipt });
});

const summary = await Effect.runPromise(Effect.provide(program, BankLive));
```

Use `effectify(Dependency)` to get a stable Effect service key. Use
`effectify(body)` for policies, projections, workflows, external adapters, and
commands defined with `command()`. Their `uses` declaration checks the Effect
requirements. See the [Effect bank example](https://github.com/marcelsud/accord-examples/blob/main/bank/with-effect.ts) and the
[Effect notification example](https://github.com/marcelsud/accord-examples/blob/main/notifications/with-effect.ts).

## Build the rest of the model

| Primitive | Handler and behavior |
| --- | --- |
| `aggregate(name, initialState)` | Class base with inferred state, factories, and event collection |
| `aggregate(name, initialState, factory)` | Methods share a context and use one state shape for working and stored data |
| `aggregate(name, contract, evolve)` | `(state, event) => state`; infers events from commands |
| `view(name, { from, initial }, on(Event, handler), ...)` | Folds events into inferred state with optional routing and replay versions |
| `policy(name, { from, uses? }, on(Event, handler), ...)` | `(event, services, envelope) => Result`; handles new events only |
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

Policies receive the event payload first, declared services second, and the
envelope third. Omit unused parameters. Use envelope metadata for source IDs,
timestamps, and stable idempotency keys:

```ts
const NotifyDeposit = policy(
  "NotifyDeposit",
  { from: Account, uses: { notifications: Notifications } },
  on(Deposited, (event, { notifications }, { id, source }) =>
    notifications.send({
      eventId: id,
      accountId: source.id,
      amount: event.amount,
      balance: event.balance,
    }),
  ),
);
```

This excerpt uses the notification example's domain contracts. Add more `on()`
handlers to react to other events from the same source. Effect handlers use
`on(Event, effectify(handler))`. The contract form
`policy(name, { from, on, uses? }, body)` still receives `(envelope, context)`.

Views and projections rebuild from history. Policies skip history, including
events forwarded while rebuilding a view. Bump a view or projection's version
when its calculation changes. View versions cannot decrease within a
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

## Durable SQLite storage

```ts
import { wire } from "@marcelsud/accord";
import { sqlite } from "@marcelsud/accord/sqlite";

using storage = sqlite("app.sqlite");
const bank = wire(Bank, { storage, services });

// Await commands and flush before the storage is disposed.
const [, error] = await bank.flush();
if (error !== null) throw error;
```

The `Bank` model and its services come from your application. Reopen the same
file and use the same model, consumer names, and versions to resume delivery.
Calling `flush()` processes pending events; no background worker is started.

For atomic projection effects, write through `storage.database` inside the
projection handler. The runtime owns the transaction: the batch's SQL changes
and checkpoint either commit together or roll back together. This supports
counter updates without counting a committed batch twice. A separate connection,
database, or external service is outside that transaction and needs idempotency.
See the [storage reference](docs/runtime.md#sqlite-storage) for recovery,
concurrency, and rebuild behavior.

[Read the runtime and transport reference](docs/runtime.md) for workflows,
external adapters, HTTP authorization, testing, and the limits of this release.

## Develop

```sh
npm run typecheck  # Positive assertions and @ts-expect-error inference tests
npm test           # Build, compile tests, and run Node's built-in test runner
npm run build      # ESM and declaration files in dist/
npm run check      # Typecheck and tests
```

No runtime dependencies are installed for the core. Effect is an optional peer.
The package is currently marked `UNLICENSED`; no open-source license has been
selected yet.
