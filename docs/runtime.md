# Runtime and transport reference

All examples are excerpts. The factory bank is defined in
[`examples/bank/domain.ts`](../examples/bank/domain.ts). The HTTP and history
examples below use an event-evolved bank with explicitly declared commands.

## Class aggregates

Extend `aggregate(name, initialState)` and define ordinary prototype methods.
Accord infers the type of protected `this.state` from the initial value. Give
empty collections and nullable fields a type annotation when their defaults
cannot express the full type. Keep persisted data in `this.state` and use values
that round-trip through `structuredClone`.

`Account.create()` copies the defaults. `Account.restore(state)` copies supplied
state and starts with an empty event buffer. Both return an `Account` instance.
`getState()` returns a copy, and `pullEvents()` drains the pending events.
Direct method calls mutate the local instance. The runtime provides the commit
boundary for stored accounts.

Register the class with `model()` and pass the model to `wire()`. The typed client
exposes prototype methods that return an `ok()` or `fail()` tuple, synchronously
or asynchronously. It prepends the instance ID and forwards the remaining
arguments to the method. Input checks belong in the method or its caller.

Calls for an ID run in order. Each call starts from a copy of stored state or the
defaults for a fresh ID. The runtime checks the returned tuple. A successful
call saves state, emitted events, and a receipt together. A rejection, exception,
or failed clone discards the working instance. `bank.account.get(id)` reads
stored state, defaulting to the initial value for a fresh ID.
`bank.account.events(id, { after })` reads committed envelopes after an event
sequence number.

Views, policies, and projections subscribe to a class with
`{ from: Account, on: [Deposited] }`. The event factories in `on` supply the
consumer types and validate matching events before commit. Policies and
projections receive those events when `flush()` delivers them.

A class receipt has two positions. `version` counts successful calls.
`eventCursor` is the last committed event sequence, including earlier events
when a method emits nothing. Pass the receipt to
`bank.summary.get(id, { atLeast: receipt })` to catch up the view to that event
position.

Class methods are available through the in-process client. HTTP exposure uses
explicitly registered `command()` definitions. To seed a standalone instance,
call the aggregate class's `restore(state)` and inspect the resulting state
and pending events directly.

## Factory aggregates

Pass a factory to `aggregate(name, initialState, factory)`. The factory takes
`{ state, emit }` and returns an object of methods. Those methods share one
context and can be called through `wire()`. Use data that round-trips through
`structuredClone` for state. The stored state has the same shape as
`ctx.state`.

```ts
const Account = aggregate(
  "Account",
  { status: Status.of("PENDING"), balance: 0 },
  ({ state, emit }) => ({
    deposit(amount: number) {
      if (state.status !== "OPEN") return fail(NotOpen());

      const balance = Balance.of(state.balance).inc(amount).cents;
      state.balance = balance;
      emit(Deposited({ amount, balance }));
      return ok({ balance });
    },
  }),
);
```

The deposit method constructs a `Balance` for the calculation and writes
the resulting cents back to state. The savings aggregate uses the same value
object with a nested `{ balance: { cents } }` state shape.
[Bank domain](../examples/bank/domain.ts)

`wire()` resolves methods lazily. Each call restores an isolated instance and
runs the factory once, then looks up the requested method. A missing method
returns `Unexpected`. TypeScript infers the method signatures from the factory's
return type. `Object.keys()` lists the client's read helpers, while method names
come from the factory at invocation time.

`Account.create()` copies the defaults, and `Account.create(state)` copies
supplied state. Both give you local methods and a fresh event buffer.
`getState()` and `bank.account.get(id)` return copies of the state.
Successful calls commit state and buffered events together. Rejections,
exceptions, and failed copies discard the working instance.

A factory can declare dependencies with a fourth argument such as
`{ uses: { rules: DepositRules } }`. The factory receives the resolved
`rules` alongside `state` and `emit`. Supply the service map through
`wire(Bank, { services })` for runtime calls or `Account.create(state, services)`
for a standalone instance. Use `undefined` for the seed to start from defaults.

## Event-evolved commands

Declare an aggregate contract as `{ state, commands }`. Each command entry
declares `input`, `events`, and optional `rejects`, `reply`, and `uses`.
`command(AccountContract, "deposit", body)` inherits the aggregate state schema
and infers the handler from the selected command. Child entries cannot override
state. Unknown or inherited command names are rejected at runtime.

Calling `deposit(state, input)` directly validates and returns a decision; it
does not save state or apply events. Calling
`bank.account.deposit(id, input)` through `wire(Bank)` loads the current state,
executes the command, applies events, and commits. Both paths isolate the
handler's state with `structuredClone`.

Register implementations with `aggregate(name, { state: AccountContract.state,
initial, commands: { open, deposit } }, evolve)`. Commands created from aggregate
contracts must retain their declared names and state schema when registered.
The two-argument `command({ state, input, events, ... }, body)` form is also
supported for independently declared commands.

## Views, projections, and policies

Use `view()` with a plain initial value and one `on()` handler per event. In
the bank example, `Summary` uses the balance reported by `Deposited`.

```ts
const Summary = view(
  "Summary",
  { from: Account, initial: { balance: 0 } },
  on(Deposited, (_state, { balance }) => ({ balance })),
);
```

Each handler receives the current row state, the event, and its envelope. It
returns the next state synchronously so the same handler can run during replay.
Add `schema` to validate state at runtime. Increment `version` to rebuild
the view from source history.

Views use the source instance ID as the default row key. `keyOf(envelope)`
can return a string, several strings, or `undefined` to skip the event.
When a view listens to multiple events from a class or factory aggregate,
`keyOf` infers their tags. Each `on()` handler still infers its full payload.
Downstream views consume the forwarded source events. The contract form
`view(name, { from, on, state, initial, version?, keyOf? }, evolve)` is also
supported.

`policy(name, { from, on, uses? }, body)` receives one envelope at a time.
Envelopes include `id`, `stream`, `seq`, `at`, `source`, and `event`. Policies are
registered from the current source position and skip historical view rebuilds.
Use the stable envelope `id` as an external idempotency key.

`projection(name, { from, on, uses?, version?, batch?: { size } }, body)` receives
arrays of envelopes, batched per source instance. Versions start at `1`.
Projection handlers should use stable event IDs in destination upserts. A new
projection version replays all source history; migrate or clear the destination
if an upsert cannot replace its old rows.

Consumers run only when `bank.flush()` is called, including the flush performed
by an `atLeast` read. A failed consumer stops that flush; calling it again retries
the unacknowledged delivery. A command receipt reports the aggregate commit,
not successful completion of every consumer. Avoid awaiting `flush()` from a
consumer already executing inside that flush.

## External adapters

An external operation has an input schema, optional reply schema, optional
`rejects`, and optional `uses`. Its body returns a tuple or a promise of a tuple.
Create the callable adapter with `operation.implement(services)`; it validates
inputs, replies, declared rejections, and dependency bindings.

```ts
const Uppercase = external(
  "Uppercase",
  { input: { value: string }, reply: { value: string } },
  input => ok({ value: input.value.toUpperCase() }),
);

const uppercase = Uppercase.implement({});
const [value, error] = await uppercase({ value: "accord" });
```

A real adapter can call an SDK inside `trycatch`. Expected vendor refusals must
be mapped to a declared, schema-backed rejection. SDK exceptions are
`Unexpected`. Pass `ctx.signal` and `ctx.idempotencyKey` to vendors that support
them. A cancellation signal cannot stop a vendor operation that ignores it.

## Workflows

`workflow(name, { input, reply, key, rejects?, uses? }, body)` identifies a run by
`key(input)`. Calls with the same key and input share its result. Conflicting
input returns `CommandConflict`.

The body receives `run.services` and:

- `run.step(name, task, { compensate? })`: saves successful results and reuses
  them on another invocation. The task receives a stable `commandId` and
  `idempotencyKey`. Pass the command ID to contract-based command calls and the
  idempotency key to external adapters.
- `run.wait(name, schema)`: waits for a named, validated signal. Send it through
  `bank.workflows.alias.signal(runKey, name, value)`.
- `run.sleep(name, milliseconds)`: records an in-memory deadline and waits for it.

Use distinct names for steps, waits, and timers within one run. Put external I/O
inside steps; body code outside a step can run again during resume. A failure
runs registered compensations in reverse order. Failed compensations are
retried when the workflow is called again, without redoing successful steps.
An abort leaves step checkpoints available for a later invocation and does not
start compensation. Compensation callbacks get separate stable operation IDs.

```ts
const job = workflow(
  "Job",
  { input: { id: string }, reply: { value: integer }, key: input => input.id },
  async (_input, run) => {
    const [value, error] = await run.step("compute", () => ok(42));
    if (error !== null) return fail(error);
    return ok({ value });
  },
);
```

Checkpoints, signals, compensation status, and deadlines live in the shared
`memory()` object. Reusing it across runtimes preserves them within the same
process. There is no disk-backed or distributed workflow engine in v0.1.

## HTTP APIs

`api(name, { model, commands, views, rejects?, uses? }, authorize?)` exposes only
the listed command and view definitions. An empty list exposes none. An omitted
authorizer allows anonymous access to those selected operations; supply an
authorizer for protected endpoints. Authorization failures must appear in
`rejects`.

```ts
const Unauthorized = rejection("Unauthorized");
const PublicBank = api(
  "PublicBank",
  {
    model: Bank,
    commands: [Account.commands.open, Account.commands.deposit],
    views: [Summary],
    rejects: [Unauthorized],
  },
  request => {
    if (request.headers.get("authorization") !== "Bearer example") {
      return fail(Unauthorized());
    }
    return ok({ actor: "example-user" });
  },
);

const fetchHandler = serve(PublicBank, { runtime: wire(Bank) });
const remote = client<typeof PublicBank>("https://your-server/api", {
  headers: { authorization: "Bearer example" },
});
```

The fixed token illustrates the contract; connect your own authentication
implementation for a real endpoint. The authorizer receives the operation,
target, input, and headers. Apply authorization to the requested target as well
as the operation. Its returned actor is the trusted command actor.

`serve` returns a standard `(request: Request) => Promise<Response>` function;
mount it in your HTTP server. Requests use POST and a JSON body containing
`kind`, `operation` (`alias.method`), `target`, `input`, and `options`.
`client<Api>(url, { fetch?, headers? })` creates typed command and view clients.
A custom fetch implementation makes transport tests possible without a server.

The v0.1 HTTP transport supports commands and view `get`, `snapshot`, and
`events`. Live subscriptions, workflows, and explicit streams are native runtime
APIs, not HTTP endpoints. There is no WebSocket, SSE, OpenAPI, or MCP transport.
Server-side `Unexpected` causes and stacks are omitted from HTTP responses;
the client recreates an `Error` with the sanitized response as its cause.

Command selection is enforced by definition identity at runtime. TypeScript
uses structural types when filtering a client surface: commands with identical
contract types may be indistinguishable to that static filter. The server still
rejects every unlisted command.

## Stories

`story(model, async test => { ... }, options?)` supplies `test.bank`,
`test.given`, and `test.equal`. It converts thrown assertions to `Unexpected`.
`test.given(aggregate, id, events)` seeds an event-evolved aggregate. It validates
and folds the history into a fresh instance and returns a tuple. Seeded events rebuild projections and views but
do not execute policies.

```ts
const [value, error] = await story(Bank, async test => {
  const [, givenError] = await test.given(Account, "a-1", [Opened()]);
  if (givenError !== null) return fail(givenError);

  const [receipt, commandError] = await test.bank.account.deposit(
    "a-1", { amount: 100 },
  );
  if (commandError !== null) return fail(commandError);

  test.equal(receipt.reply.balance, 100);
  return ok(undefined);
});
```

## Version 0.1 boundaries

The runtime provides in-process atomic aggregate commits, keyed concurrency,
receipts, replay, and consumer checkpoints. It does not provide process-crash
durability, cross-process locks, deployment migration orchestration, retention,
or distributed delivery guarantees. The memory store is unbounded.

Stored domain data must support `structuredClone`. HTTP data must additionally
round-trip through JSON. Instance IDs and schema-backed domain values are
strings, numbers, booleans, arrays, and records in the bundled examples.

Effect support targets v4.1.2 or newer in the v4 line.
`effectify(BankModel, "Bank")` returns a named Effect service key with a
`layer`. The layer requires the model's declared dependencies. Supply them
with layers built from `effectify(Dependency)` keys. Effects that yield the
same service from one layer provision share a runtime and its in-memory
store. Use distinct names for distinct model services.

For direct acquisition in a generator, `yield* effectify(BankModel)` resolves
dependencies and builds an in-process client.

Calls that normally return a promise of an Accord tuple become lazy Effects.
The successful tuple value becomes the Effect result, and its error becomes a
typed failure. Watch methods return async generators. A caller interrupted
while waiting on a native call may still see that call finish in the runtime.

The adapter also lifts dependencies, standalone commands, and Effect-returning
handlers. Native dependency shapes retain their tuple results when called from
inside a generator. [Effect bank example](../examples/bank/with-effect.ts)
