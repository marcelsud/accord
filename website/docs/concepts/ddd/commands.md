# Commands

A command is a request to change one aggregate. It either decides the next events and a reply, or it rejects. Callers pass an input object. Accord validates that input and, for this form, can deduplicate a successful commit.

[`command()`](/docs/api/aggregate#event-evolved-aggregates) declares the state, input, events, rejections, and reply. Class and factory methods are commands too; they just don't take `commandId` or `expectedVersion`. Only `command()` definitions can be exposed over [HTTP](/docs/api/http).

<<< @/snippets/ddd/commands.ts

`expectedVersion: opened.version` is optimistic concurrency. A stale version returns `Conflict`. Reusing `commandId: 'dep-1'` with the same input returns the original receipt. The same id with a different amount returns `CommandConflict`. An amount that fails the `Cents` schema returns `InvalidInput` and writes nothing.

The handler returns `ok({ events, reply })` or `fail(rejection)`. `evolve` folds those events into the next state. Calling `deposit(state, input)` directly runs that decision and does not save it.

## See also

- [Aggregate](/docs/api/aggregate)
- [Events and rejections](/docs/api/events)
- [Results](/docs/api/result)
