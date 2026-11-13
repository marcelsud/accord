# Anti-corruption layer

An anti-corruption layer keeps another system's contract out of yours. The vendor speaks `sku`. The catalog speaks `isbn` and `title`. The translation happens in one adapter, and the aggregate never sees a SKU.

[`external()`](/docs/api/external) is that contract. `implement()` binds the adapter. A command lists it in `uses` the same way it lists a [domain service](/docs/concepts/ddd/domain-services). Expected vendor refusals are rejections. Anything else becomes `Unexpected`.

<<< @/snippets/ddd/anticorruption.ts

`UnknownSku` is declared on the external and on the command, so `fail(error)` stays a typed rejection. The stored book has `isbn` and `title`. A missing SKU does not register a book.

Pass `ctx.signal` and `ctx.idempotencyKey` through when the vendor supports them. This adapter has neither; the call is an in-memory translation.

## See also

- [External](/docs/api/external)
- [Ubiquitous language and bounded contexts](/docs/concepts/ddd/ubiquitous-language)
- [HTTP API](/docs/api/http)
