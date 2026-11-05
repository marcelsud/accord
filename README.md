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

Use Node.js 24 or newer:

```sh
git clone https://github.com/marcelsud/accord.git
cd accord
npm install
npm run check
npm run example
node .test-build/examples/effect.js
```

The bank example prints `{ balance: 100 }`. The Effect example also runs that
bank example, then prints `100`. [The complete bank](examples/bank.ts) and
[Effect example](examples/effect.ts) are compiled with the tests.

To consume a local build, run `npm pack` and install the generated
`marcelsud-accord-0.1.0.tgz` in another project. Import the core from
`@marcelsud/accord`; install `effect@^4.1.2` only when importing
`@marcelsud/accord/effect`.

## Define business rules

The following excerpt uses the schemas and constructors defined in
[the bank example](examples/bank.ts):

```ts
import { command, fail, ok } from "@marcelsud/accord";

const deposit = command(
  {
    state: State,
    input: { amount: Cents },
    events: [Deposited],
    rejects: [NotOpen],
    reply: Balance,
  },
  (state, { amount }) => {
    if (!state.open) return fail(NotOpen());

    return ok({
      events: [Deposited({ amount })],
      reply: { balance: state.balance + amount },
    });
  },
);
```

A standalone command declares its `state` schema so TypeScript can infer the
handler's state before it is registered with an aggregate. The body is `decide`:
it describes events and a reply. The aggregate's reducer is `evolve`: it applies
those events. Keep decisions and reducers deterministic; external actions belong
in policies or workflows. The reply is supplied by the command body and checked
against its schema; Accord does not compute it from the resulting state.

The host validates the input, decision, reply, and resulting state before
committing. Commands for one instance run in order. Commands for different
instances can run independently. A successful commit stores events, state, and
the command receipt together in memory.

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
const [receipt, error] = await bank.account.deposit(
  "a-1",
  { amount: 100 },
  { commandId: "deposit-123" },
);

// receipt is unknown until error is narrowed.
if (error !== null) {
  if (error._tag === "NotOpen") console.log("Open the account first");
  return;
}

console.log(receipt.reply.balance);
```

Always inspect the error slot: a successful operation can return `null` or
`undefined`. `Unexpected` is an `Error` carrying `_tag: "Unexpected"` and the
original thrown value in `cause`. Invalid boundary inputs return `InvalidInput`;
invalid handler outputs become `Unexpected`.

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
`host(Model, { services: { rules: { maximum: 1_000 } } })`.

Service names identify dependencies and must be unique. Each alias must refer
to the same dependency throughout a model. Context metadata names such as
`actor`, `signal`, and `commandId` are reserved. Commands receive trusted metadata
from the host; HTTP callers cannot provide an actor or dependency bindings.

## Add optional Effect integration

Install Effect separately. The core entry point never imports it.

```ts
import { Effect } from "effect";
import { effectify } from "@marcelsud/accord/effect";

const limitedDeposit = command(
  {
    state: State,
    input: { amount: Cents },
    events: [Deposited],
    rejects: [NotOpen],
    reply: Balance,
    uses: { rules: DepositRules },
  },
  effectify((state, { amount }) => Effect.gen(function* () {
    const rules = yield* effectify(DepositRules);
    if (!state.open || amount > rules.maximum) {
      return yield* Effect.fail(NotOpen());
    }

    return {
      events: [Deposited({ amount })],
      reply: { balance: state.balance + amount },
    };
  })),
);
```

`uses` defines the allowed service requirements. Yielding a service key adds its
requirement to the Effect; undeclared requirements fail type checking. Use
`Effect.fail` and plain return values inside an Effect-backed body. Native
callers still receive tuples. Finalizers finish before the tuple is returned;
an interrupted command does not commit.

`effectify(Dependency)` returns a stable Effect service key.
`effectify(Command)` lifts a standalone command into a lazy Effect-returning
function. This evaluates a **decision**, not a hosted aggregate commit:

```ts
const program = Effect.gen(function* () {
  const decision = yield* effectify(limitedDeposit)(
    { open: true, balance: 0 },
    { amount: 100 },
  );
  return decision.reply.balance;
});

await Effect.runPromise(
  Effect.provideService(program, effectify(DepositRules), { maximum: 1_000 }),
);
```

Dependency keys preserve their native service shape, including tuple-returning
functions. The tuple host executes Effect-backed bodies in their own Effect
execution with declared services and an abort signal. Ambient FiberRefs and
tracing context are not automatically bridged from an outer Effect execution.

## Build the rest of the model

| Primitive | Handler and behavior |
| --- | --- |
| `aggregate(name, contract, evolve)` | `(state, event) => state`; infers events from commands |
| `view(name, contract, evolve)` | `(state, event, envelope) => state`; replays history, supports routing and versions |
| `policy(name, contract, body)` | `(envelope, ctx) => Result`; handles new events only |
| `projection(name, contract, body)` | `(batch, ctx) => Result`; replayable, idempotent writes |
| `external(name, contract, body)` | `(input, ctx) => Result`; `.implement(services)` binds an adapter |
| `workflow(name, contract, body)` | `(input, run) => Result`; checkpointed steps and compensation in memory |
| `stream(name, contract)` | Declares a keyed event stream; append, list, and watch through the host |
| `api(name, contract, authorize?)` | `(request, ctx) => Result<{ actor? }, Rejection>`; selects exposed commands and views |
| `story(model, body, options?)` | Test with `bank`, `given`, and `equal`; returns a tuple |

A model registers aggregates and optional views, policies, projections,
workflows, and streams. `host(model, { storage: memory(), services })` creates
clients. `bank.flush()` catches consumers up and returns the first delivery
failure. Failed deliveries retain their checkpoint and retry on the next flush.
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

Command IDs deduplicate successful commits per instance. Reusing an ID with a
different command or input returns `CommandConflict`. `expectedVersion` enables
optimistic version checks and returns `Conflict` when it differs.

[Read the runtime and transport reference](docs/runtime.md) for workflows,
external adapters, HTTP authorization, testing, and the limits of this release.

## Develop

```sh
npm run typecheck  # Positive assertions and @ts-expect-error inference tests
npm test           # Compile and run Node's built-in test runner
npm run build      # ESM and declaration files in dist/
npm run check      # All of the above
```

No runtime dependencies are installed for the core. Effect is an optional peer.
The package is currently marked `UNLICENSED`; no open-source license has been
selected yet.
