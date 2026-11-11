# Domain events

A domain event is a fact the business records: this copy was borrowed by this member. It is named with the ubiquitous language, validated by a schema, and stored with the aggregate state. It is not a message bus you configure.

[`event()`](/docs/api/events) builds the fact. The aggregate `emit`s it. The runtime wraps each committed fact in an envelope.

<<< @/snippets/ddd/events.ts

The envelope `id` is stable (`stream` plus `seq`). Use it as an idempotency key in [policies](/docs/concepts/ddd/policies) and [projections](/docs/concepts/ddd/read-models). `source` is the aggregate type and id. `events(id, { after })` reads the committed history.

Consumers do not run inside the command. Call `flush()`, or read a view with `atLeast`, to deliver the envelopes. See [Events and delivery](/docs/concepts/delivery).

## See also

- [Events and rejections](/docs/api/events)
- [Events and delivery](/docs/concepts/delivery)
