# Examples

Runnable Accord apps, from a tiny bank to a durable CRM with contract migrations. Each one runs on Node.js 24 with no external accounts. They depend on `@marcelsud/accord@^0.1.0`.

The source lives in the [accord-examples](examples:) repository. Clone it, install, and build before any of the scripts below:

```sh
git clone https://github.com/marcelsud/accord-examples.git
cd accord-examples
npm ci
npm run build
```

`npm ci` installs the published package. `npm run build` compiles the TypeScript into `build/`. The scripts in that repository's `package.json` are:

| Example | What it shows | Command |
| --- | --- | --- |
| [Bank](/examples/bank) | Factory aggregates, value objects, a view, services, and the Effect version | `npm run bank` / `npm run bank:effect` |
| [Notifications + SQLite ledger](/examples/notifications) | Policies, projections, external system contracts, real HTTP adapters | `npm run notifications` / `npm run notifications:effect` |
| [Durable bank](/examples/durable-bank) | Restart recovery and atomic SQL projections across processes | `npm run durable -- <db> deposit 100` then `npm run durable -- <db> drain` |
| [CRM and migrations](/examples/crm) | Several aggregates, policies, a durable pipeline, and contract versioning | `npm run crm -- <db> seed` then `npm run crm -- <db> drain` |
| [CRM migrations](examples:crm/migrations.ts) | Application-owned storage and contract migration experiments | `npm run crm:migrations -- <db>` |
