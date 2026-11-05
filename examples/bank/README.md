# Bank

A small account model with commands, events, tagged rejections, and a balance
view. Both versions use the same domain contracts.

`AccountContract` declares state once and lists each command's input, events,
rejections, and reply. Handlers use `command(AccountContract, "deposit", body)`;
the running model is created with `wire(Bank)`.

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

You can also call the exported `deposit` directly. Using the definitions from
`pure.ts`, this excerpt makes a decision and applies its events explicitly:

```ts
const state = { open: true, balance: 100 };
const [decision, error] = await deposit(state, { amount: 50 });
if (error !== null) throw error;

const nextState = decision.events.reduce(Account.evolve, state);
console.log(state); // { open: true, balance: 100 }
console.log(nextState); // { open: true, balance: 150 }
```

Direct execution does not commit anything. Through `wire(Bank)`, the runtime
coordinates state loading, ordered execution, event application, and commits.
The Effect example calls the same decision boundary through
`yield* effectify(limitedDeposit)(state, input)`; `uses` supplies its service
requirements.
