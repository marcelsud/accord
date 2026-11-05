# Bank

A small account model with commands, events, tagged rejections, and a balance
view. Both versions use the same domain contracts.

From the repository root, after `npm run check`:

```sh
npm run example
npm run example:effect
```

[`pure.ts`](pure.ts) opens an account, deposits `100`, and reads its balance at
the command receipt. It prints `{ balance: 100 }`.

[`with-effect.ts`](with-effect.ts) imports those definitions and demonstrates an
Effect-backed decision with an injected deposit limit. The import also runs the
native example, so it prints the balance object followed by `100`.
