# Tutorial: a lending desk

This file models one aggregate, one invariant, one event, and one read model. The regions below are slices of the same program. Run the whole file with Node.js 24 after building `@marcelsud/accord`.

## 1. Name the facts

A copy is borrowed by a member. Borrowing a copy that is already out is refused.

<<< @/snippets/ddd/tutorial.ts#words

`Borrowed` is a [domain event](/docs/concepts/ddd/domain-events). `NotOnShelf` is a [rejection](/docs/concepts/ddd/rejections). The tag is the name that gets stored.

## 2. Protect the invariant

The copy's status and holder change together. `borrow` is the only method that changes them.

<<< @/snippets/ddd/tutorial.ts#aggregate

That is the [aggregate](/docs/concepts/ddd/aggregates). `fail(NotOnShelf())` discards the working state when the call goes through `wire()`.

## 3. Fold a read model

The desk asks "how many times was this copy borrowed?" The view counts `Borrowed` events. It does not read the aggregate's fields.

<<< @/snippets/ddd/tutorial.ts#read-model

Views rebuild from history. See [Read models](/docs/concepts/ddd/read-models).

## 4. Run it

`model` registers the copy and the view. `wire` is the [repository](/docs/concepts/ddd/repositories).

<<< @/snippets/ddd/tutorial.ts#wire

The second borrow is `NotOnShelf`, and `onLoan` is `1` once the view catches up to the receipt.

## 5. Lock it in a story

[`story()`](/docs/api/story) runs the same model against a fresh in-memory runtime and returns a tuple.

<<< @/snippets/ddd/tutorial.ts#story

`test.bank` is the wired client. `test.equal` throws on a mismatch, which the story reports as `Unexpected`.

## Where to go next

- [Domain services](/docs/concepts/ddd/domain-services) for a loan limit that is not hard-coded.
- [Policies](/docs/concepts/ddd/policies) for "when a copy is returned, release the hold".
- [Workflows](/docs/concepts/ddd/workflows) for a checkout that can undo itself.
- [Repositories](/docs/concepts/ddd/repositories) to reopen the same desk from SQLite.

::: details Full program
<<< @/snippets/ddd/tutorial.ts
:::
