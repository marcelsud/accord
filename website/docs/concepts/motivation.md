# Motivation

Domain-Driven Design has good ideas: aggregates that protect invariants, events that record what happened, reactions that describe what happens next. It also has a reputation for ceremony.

Accord keeps the ideas and drops the ceremony.

## What Accord gives you

- **A small, explicit API.** You define business rules with ordinary classes or functions. No base repositories, no buses to configure, no decorators.
- **Failures as values.** A business refusal like `InsufficientFunds` is a tagged value, not an exception. Operations return `[value, null]` or `[null, error]`, so the compiler reminds you to look at the error. See [Tuples, not throws](/docs/concepts/results).
- **One commit boundary.** A successful command saves the new state, the emitted events, and a receipt together. A rejection or exception discards the working copy.
- **Reactions that rebuild.** Views and projections fold events and can replay history. Policies react to new events only. See [Events and delivery](/docs/concepts/delivery).
- **Optional everything else.** The core has no runtime dependencies. SQLite persistence and Effect integration are separate entry points you import only when you need them.

## The building blocks

| Primitive | What it is for |
| --- | --- |
| [`aggregate`](/docs/api/aggregate) | State plus the methods that change it and emit events |
| [`event`, `rejection`](/docs/api/events) | Tagged, schema-validated facts and refusals |
| [`vo`](/docs/api/value-object) | Value objects with validation and domain methods |
| [`view`](/docs/api/view) | Read models folded from events |
| [`policy`](/docs/api/policy) | "When X happens, do Y" |
| [`projection`](/docs/api/projection) | Replayable writes to another store |
| [`service`](/docs/api/service), [`external`](/docs/api/external) | Typed dependencies and adapters |
| [`workflow`](/docs/api/workflow) | Checkpointed steps with compensation (in memory) |
| [`model`, `wire`](/docs/api/model) | Register everything and get a typed runtime |
| [`api`](/docs/api/http) | Expose selected commands and views over HTTP |
| [`story`](/docs/api/story) | Scenario tests |

## When not to use it (yet)

Accord v0.1 is an in-process runtime. There's no background scheduler, no distributed workflow engine, and no automatic migrations. If you need those today, read [Limits of v0.1](/docs/guides/limits) first.
