# Sagas, workflows, and process managers

A process manager runs a business process that spans steps: borrow the copy, then label it, and undo the borrow if labeling fails. [`workflow()`](/docs/api/workflow) is that process. Each `run.step` checkpoints its result in memory. A later failure runs the registered compensations in reverse and does not redo the successful steps.

<<< @/snippets/ddd/workflow.ts

The label step returns `CheckoutFailed` on purpose. Compensation was registered on the borrow step, which already succeeded, so `returnCopy` runs with its own command id (`meta.commandId` on the undo). The copy ends `IN` again, and the workflow result is `CheckoutFailed`.

Pass `meta.commandId` into contract-based commands and `meta.idempotencyKey` into external adapters. Code outside a step can run again on resume. Put I/O inside steps.

Checkpoints, signals, and deadlines stay in the memory store. `wire()` rejects a SQLite store when the model contains workflows. There is no distributed process manager in v0.1. See [Limits of v0.1](/docs/guides/limits).

The workflow is declared before `wire()` returns the client, so the steps call `client.copy`, which is assigned immediately after.

## See also

- [Workflow](/docs/api/workflow)
- [Commands](/docs/concepts/ddd/commands)
- [Policies](/docs/concepts/ddd/policies)
