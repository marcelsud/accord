# Frequently Asked Questions

## Is Accord on npm?

Yes. `@marcelsud/accord@0.1.0` is the current release. You need Node.js 24 or newer. See [Getting Started](/docs/getting-started/basic).

## Do I need Effect?

No. The core has zero runtime dependencies. Effect is an optional peer for `@marcelsud/accord/effect`.

## Which Node.js version?

24 or newer. Accord uses `node:sqlite` and other Node 24 features.

## Class, factory, or event-evolved aggregate?

Start with a class. Use a factory when methods need [services](/docs/api/service) or a shared context. Use an [event-evolved aggregate](/docs/api/aggregate#event-evolved-aggregates) when you want state to be a fold of events, declared command contracts, `commandId`/`expectedVersion`, or HTTP exposure.

## Why does my view return `null`?

Views materialize on `flush()`. Read with `{ atLeast: receipt }` to catch up first.

## Why did my policy run twice?

Delivery is at-least-once. Make the action idempotent with the envelope `id`.

## Why did I get `Unexpected` instead of my error?

Something threw, or you returned a rejection that isn't declared in the contract's `rejects`, or event data failed its schema. Check `error.cause`.

## Can I use it in the browser or on the edge?

The core is plain ESM, but it is built and tested for Node.js 24. `serve()` returns a standard `Request => Response` handler. Other runtimes aren't documented yet.
