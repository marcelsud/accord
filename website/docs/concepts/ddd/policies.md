# Policies

A policy says: when this happens, issue that command. It handles new events only. It does not replay history.

[`policy()`](/docs/api/policy) subscribes with `on(Event, handler)`. The handler receives the event, the declared services, and the [envelope](/docs/concepts/delivery#the-commit). It returns a result. `flush()` delivers pending events. Delivery is at-least-once, so the command it issues has to tolerate a repeat.

Here, returning a copy releases the member's hold. The command id is the envelope id. A second delivery with that id returns the original receipt instead of releasing twice.

<<< @/snippets/ddd/policy.ts

`wire()` is what creates the client, so the service calls a holder that is assigned immediately after `wire()` returns. The policy itself only sees `members.release`.

On the SQLite store this re-entry is rejected. A consumer runs inside the store transaction, and a handler must not start another runtime operation on that file. Keep the SQLite policy on a port that writes through the same connection, or issue the next command after `flush()` returns. The memory store has no nested transaction, which is what this program uses. See the [SQLite store](/docs/api/sqlite#concurrency).

## See also

- [Policy](/docs/api/policy)
- [Commands](/docs/concepts/ddd/commands)
- [Events and delivery](/docs/concepts/delivery)
