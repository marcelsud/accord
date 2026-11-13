# Repositories

A repository loads an entity and saves a successful change. Accord does not ask you to write a repository class. [`wire()`](/docs/api/model) is the repository, and the store behind it is `memory()` or [`sqlite()`](/docs/api/sqlite).

`copy.borrow(id, ...)` loads that id (or the initial state), runs the method, and commits state, events, and a receipt in one transaction. `get(id)` returns a copy of the stored state. `events(id)` returns the envelopes. A fresh id reads back the initial state.

<<< @/snippets/ddd/repository.ts

The first block borrows a copy and closes the file. The second block opens the same file, with the same model, and reads the holder back. `@marcelsud/accord/sqlite` uses Node.js's built-in `node:sqlite`. Await commands before the `using` block disposes the connection.

Workflow checkpoints are not in this store. See [Workflows](/docs/concepts/ddd/workflows) and the [SQLite store](/docs/api/sqlite).

## See also

- [Model and wire](/docs/api/model)
- [SQLite store](/docs/api/sqlite)
- [Getting started: SQLite](/docs/getting-started/sqlite)
