# DDD concepts

Domain-Driven Design is a vocabulary for business rules. Accord keeps the vocabulary and implements each idea with one function. The pages below use a lending desk: copies, members, and holds.

| DDD idea | Accord | |
| --- | --- | --- |
| [Ubiquitous language and bounded contexts](/docs/concepts/ddd/ubiquitous-language) | Names of models, aggregates, and events | [`model`](/docs/api/model) |
| [Entities and value objects](/docs/concepts/ddd/entities-and-value-objects) | An id addressed by `wire()`, and `vo()` | [`vo`](/docs/api/value-object) |
| [Aggregates and invariants](/docs/concepts/ddd/aggregates) | State plus the only methods that change it | [`aggregate`](/docs/api/aggregate) |
| [Commands](/docs/concepts/ddd/commands) | `command()`, or a class or factory method | [`aggregate`](/docs/api/aggregate) |
| [Domain events](/docs/concepts/ddd/domain-events) | `event()` values committed with state | [`event`](/docs/api/events) |
| [Rejections](/docs/concepts/ddd/rejections) | `rejection()` values in the error slot | [`rejection`](/docs/api/events) |
| [Repositories](/docs/concepts/ddd/repositories) | `wire()` with `memory()` or `sqlite()` | [`sqlite`](/docs/api/sqlite) |
| [Domain services](/docs/concepts/ddd/domain-services) | A `service()` declared in `uses` | [`service`](/docs/api/service) |
| [Policies](/docs/concepts/ddd/policies) | `policy()` turns a new event into a command | [`policy`](/docs/api/policy) |
| [Read models](/docs/concepts/ddd/read-models) | `view()` in the runtime, `projection()` outside it | [`view`](/docs/api/view), [`projection`](/docs/api/projection) |
| [Sagas and process managers](/docs/concepts/ddd/workflows) | `workflow()` steps, waits, and compensation | [`workflow`](/docs/api/workflow) |
| [Anti-corruption layer](/docs/concepts/ddd/anti-corruption) | `external()` translates another system's contract | [`external`](/docs/api/external) |

Each snippet on those pages is a complete program. [Build a lending desk](/docs/concepts/ddd/tutorial) walks the core loop in one file.
