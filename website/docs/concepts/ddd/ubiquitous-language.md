# Ubiquitous language and bounded contexts

Use the business's words for aggregates, events, and rejections. Those names are the language the code and the stored history share. A [`model()`](/docs/api/model) is a bounded context: its name is part of every stream key, so the same id in two models is two different things.

<<< @/snippets/ddd/language.ts

`catalog.book.get('isbn-1')` returns a title. `lending.copy.get('isbn-1')` returns a holder. The event streams differ because one key starts with `Catalog` and the other with `Lending`, even though both clients share one `memory()` store.

A context does not read another context's state. When Catalog has to tell Lending something, translate it at the boundary. See [Anti-corruption layer](/docs/concepts/ddd/anti-corruption).

## See also

- [Model and wire](/docs/api/model)
- [Domain events](/docs/concepts/ddd/domain-events)
