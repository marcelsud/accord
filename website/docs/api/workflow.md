# Workflow

A workflow runs checkpointed steps with compensation. In v0.1 its checkpoints live **in memory** only.

## Import

```ts
import { fail, integer, ok, string, workflow } from '@marcelsud/accord'
```

## Usage

```ts
const Job = workflow(
  'Job',
  { input: { id: string }, reply: { value: integer }, key: (input) => input.id },
  async (_input, run) => {
    const [value, error] = await run.step('compute', () => ok(42))
    if (error !== null) return fail(error)
    return ok({ value })
  }
)

const bank = wire(model('Bank', { aggregates: { account: Account }, workflows: { job: Job } }))
const [result] = await bank.workflows.job({ id: 'j-1' }) // { value: 42 }
```

A run is identified by `key(input)`. Calls with the same key and input share its result. Conflicting input returns `CommandConflict`.

## Contract

### input

`SchemaInput`.

### reply

`SchemaInput`.

### key

`(input) => string`. The run identity.

### rejects <Badge type="info" text="optional" />

`Rejection[]`.

### uses <Badge type="info" text="optional" />

`Record<string, Dependency>`. Available as `run.services`.

## The run context

### run.step(name, task, { compensate? })

Saves a successful result and reuses it on the next invocation. The task receives a stable `commandId` and `idempotencyKey`. Pass the command ID to contract-based commands and the idempotency key to external adapters.

### run.wait(name, schema)

Waits for a named, validated signal. Send it with:

```ts
await bank.workflows.job.signal('j-1', 'approved', { by: 'ana' })
```

A signal can arrive before the `wait`.

### run.sleep(name, milliseconds)

Records an in-memory deadline and waits for it.

## Failure and resume

- Use distinct names for steps, waits, and timers within one run.
- Put external I/O **inside** steps. Body code outside a step can run again on resume.
- A failure runs registered compensations in reverse order. Failed compensations retry on the next call, without redoing successful steps.
- An abort keeps step checkpoints and doesn't start compensation.
- Compensation callbacks get their own stable operation IDs.

::: warning
Checkpoints, signals, compensation status, and deadlines live in the shared `memory()` store. Reusing it across runtimes preserves them within one process. There's no disk-backed or distributed workflow engine in v0.1, and SQLite-backed models containing workflows are rejected.
:::
