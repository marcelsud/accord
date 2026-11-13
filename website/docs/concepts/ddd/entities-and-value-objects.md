# Entities and value objects

An entity is identified by an id. Two members with the same email are still two members, because `register` is addressed by `'ada'` and `'bea'`. A value object has no id. `Email.of` validates the string and `snapshot()` returns that value. Two emails with the same string are interchangeable.

[`vo()`](/docs/api/value-object) builds the value object. The aggregate id, passed through [`wire()`](/docs/api/model), is the entity's identity. Accord does not have a separate entity base class.

<<< @/snippets/ddd/values.ts

`Email.of('not-an-email')` throws. [`trycatch`](/docs/api/result) turns that into `Unexpected`. The same throw inside a wired method becomes `Unexpected` on the command result, which is what the `'nope'` call returns. Business refusals use [`rejections`](/docs/concepts/ddd/rejections) instead of throws.

Keep the stored state plain. The member stores `email.snapshot()`, not the class instance.

## See also

- [Value objects](/docs/api/value-object)
- [Aggregates and invariants](/docs/concepts/ddd/aggregates)
