# Rejections

A rejection is a business refusal: the copy is not on the shelf. It is a tagged value, returned in the error slot, not an exception. The stored aggregate does not change, and no event is committed.

[`rejection()`](/docs/api/events) uses the same two shapes as `event()`. Return it with [`fail()`](/docs/api/result). [`match()`](/docs/api/result#match-value-cases) checks that every tag the command can return is handled.

<<< @/snippets/ddd/rejections.ts

The second `borrow` returns `NotOnShelf`. History still has one `Borrowed`. Wired calls also include `InvalidInput` (a bad id) and `Unexpected` (a throw) in the error union, so `match` lists them.

A rejection with data uses a shape: `rejection('LoanLimit', { maximum: integer })`. See [Domain services](/docs/concepts/ddd/domain-services).

## See also

- [Events and rejections](/docs/api/events)
- [Results](/docs/api/result)
- [Tuples, not throws](/docs/concepts/results)
