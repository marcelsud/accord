# Examples

Runnable Accord apps, from a tiny bank to a durable CRM with contract migrations. Each one runs on Node.js 24 with no external accounts.

The source lives in the [accord-examples](examples:) repository.

| Example | What it shows |
| --- | --- |
| [Bank](/examples/bank) | Factory aggregates, value objects, a view, services, and the Effect version |
| [Notifications + SQLite ledger](/examples/notifications) | Policies, projections, external system contracts, real HTTP adapters |
| [Durable bank](/examples/durable-bank) | Restart recovery and atomic SQL projections across processes |
| [CRM and migrations](/examples/crm) | Several aggregates, policies, a durable pipeline, and contract versioning |

## Run them

```sh
git clone https://github.com/marcelsud/accord-examples.git
cd accord-examples
npm ci
npm run build
npm run bank
```

::: info Moving to a separate repository
The examples are being moved out of the main repository. Until that happens, run them from [`accord/examples`](https://github.com/marcelsud/accord/tree/main/examples): `npm ci --ignore-scripts && npm run check`, then `npm run example`, `npm run example:effect`, `npm run example:sqlite`, `npm run example:sqlite:effect`, `npm run example:durable`, and `npm run example:crm`.
:::
