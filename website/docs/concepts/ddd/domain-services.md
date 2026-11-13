# Domain services

A domain service is a calculation that does not naturally live on one entity. "A member may have at most N open loans" is library policy, not an intrinsic fact about Ada. Declare it with [`service()`](/docs/api/service), name it in `uses`, and supply the value to `wire()`.

The service in this example is data: `{ maximumOpen: 2 }`. Accord checks that value against the schema. It is not an external system. I/O at the boundary belongs in an [`external()`](/docs/api/external) contract.

<<< @/snippets/ddd/services.ts

The third `borrow` returns `LoanLimit` and leaves `openLoans` at 2. The factory receives `rules` next to `state` and `emit`. The same alias has to refer to the same service everywhere in the model. `actor`, `signal`, and `commandId` are reserved and cannot be service aliases.

## See also

- [Service](/docs/api/service)
- [Anti-corruption layer](/docs/concepts/ddd/anti-corruption)
