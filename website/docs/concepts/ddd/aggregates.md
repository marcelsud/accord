# Aggregates and invariants

An aggregate is the consistency boundary. Its methods are the only way to change its state, and they protect invariants: a copy on loan cannot be borrowed again. A successful call commits the new state and the emitted events together. A rejection leaves the stored copy untouched.

[`aggregate()`](/docs/api/aggregate) is that boundary. The class form below types `this.state` from the initial value.

<<< @/snippets/ddd/aggregates.ts

`Copy.create()` and `Copy.restore()` run the method on a local instance. That is useful in a unit test. Nothing is saved until a call goes through `wire()`, which loads the id, runs the method on a copy of the stored state, and commits only when the method returns `ok`.

## See also

- [Aggregate](/docs/api/aggregate)
- [Commands](/docs/concepts/ddd/commands)
- [Rejections](/docs/concepts/ddd/rejections)
