# Bank

The Account factory receives state and `emit` once and returns the account
methods. `Status.of("PENDING")` and `Balance.of(0)` construct the initial
values. The codec saves a status string and cents and restores a `Balance`
for each call. [Domain definition](domain.ts)

`wire(Bank)` adds the account ID to the methods.
`bank.account.deposit("a-1", 100)` commits the updated snapshot and emitted
events together.

From the repository root, after `npm run check`:

```sh
npm run example
npm run example:effect
```

[`pure.ts`](pure.ts) opens an account, deposits 100, and reads its balance view
at the command receipt. It then restores a standalone account from the stored
state and previews a second deposit. The view shows 100 and the standalone
preview shows 150 with a pending `Deposited` event.
[`with-effect.ts`](with-effect.ts) calls the same runtime in `Effect.gen` with
an injected deposit limit. It prints `100`.

For a standalone test, supply the starting state directly to `Account.restore()`.
Call the method and inspect the resulting state and events.

```ts
import { Account } from "./domain.js";

const account = Account.restore({ status: "OPEN", balance: 100 });
const [reply, error] = account.deposit(50);
if (error !== null) throw error;

console.log(reply); // { balance: 150 }
console.log(account.getState()); // { status: "OPEN", balance: 150 }
console.log(account.pullEvents()); // [{ _tag: "Deposited", amount: 50, balance: 150 }]
```
