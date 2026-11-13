# SQLite

The default store lives in memory. Swap in SQLite to recover state, event history, views, and consumer checkpoints after a restart.

It uses Node.js 24's built-in `node:sqlite` driver. No extra npm dependency. These imports are from `@marcelsud/accord@0.1.0`, the current release.

## Usage

```ts
import { wire } from '@marcelsud/accord'
import { sqlite } from '@marcelsud/accord/sqlite'
import { Bank } from './domain.ts'

using storage = sqlite('app.sqlite')
const bank = wire(Bank, { storage, services: { rules: { maximum: 1_000 } } })

const [, openError] = await bank.account.open('a-1')
if (openError !== null) throw openError

// Await commands and flush before the storage is disposed.
const [, error] = await bank.flush()
if (error !== null) throw error
```

- `Bank` and its services come from your application (here, the [Bank example](/examples/bank) domain).
- `sqlite(filename)` opens or creates the file. `':memory:'` works too, but doesn't survive the process.
- `using` closes the store when the scope ends. You can also call `storage.close()`.
- Reopen the same file with the same model, consumer names, and versions to resume delivery.

::: warning
Await every operation before closing. Closing with pending operations is rejected.
:::

## Try the restart demo

From the [accord-examples](examples:) repository, after `npm ci` and `npm run build`:

```sh
npm run durable -- /tmp/accord-runtime.sqlite deposit 100
npm run durable -- /tmp/accord-runtime.sqlite drain
npm run durable -- /tmp/accord-runtime.sqlite drain
```

The first process commits a deposit and exits without flushing. The next process delivers it. Both drains print a projected total of `100`: the projection's SQL write and its checkpoint commit together, so the second drain doesn't count the deposit again.

## Next

- [SQLite store reference](/docs/api/sqlite): transactions, recovery, and concurrency.
- [Durable bank example](/examples/durable-bank).
