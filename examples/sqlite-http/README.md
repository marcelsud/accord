# SQLite and HTTP: native tuples and Effect

This example opens a bank account, deposits money, writes a ledger row to
SQLite, and sends a notification to a dummy HTTP service. Both versions use the
same contracts, SQLite adapter, and dummy endpoint:

- [`pure.ts`](pure.ts) uses native tuples and `trycatch`.
- [`with-effect.ts`](with-effect.ts) uses `effectify`, `Effect.gen`, and `yield*`
  for commands, the projection, the policy, and the external HTTP operation.

Node.js 24 or newer supplies `node:sqlite`, `fetch`, and the HTTP server. No
additional database or HTTP packages are needed. The dummy endpoint binds an
available loopback port; it does not require an account or a public service.

## Run both versions

From the repository root:

```sh
npm ci --ignore-scripts
npm run check
npm run example:sqlite
npm run example:sqlite:effect
```

Each prints the selected mode, a committed balance of `100`, one SQLite ledger
row, and `HTTP notifications: 1`. The dummy server shuts down and the SQLite
connection closes when the command finishes. The default database is SQLite's
in-memory `:memory:` database.

To inspect a database file afterward, pass a new filename:

```sh
npm run example:sqlite -- /tmp/accord-pure.sqlite
npm run example:sqlite:effect -- /tmp/accord-effect.sqlite
```

The file remains after the process exits. Choose an empty ledger file for each
run. The runner refuses to reuse a nonempty ledger because the example starts
with fresh in-memory aggregate state and event sequence numbers.

## Follow the flow

1. A command decides an `Opened` or `Deposited` event. It commits through the
   existing in-memory Accord host.
2. `bank.flush()` runs the consumers. The ledger projection receives batches;
   the notification policy calls an external operation.
3. The projection uses the `LedgerStore` dependency to write a SQLite transaction.
   The event ID is the primary key. Replaying a batch upserts the same rows.
4. The policy supplies the stable event ID to the notification operation, which
   URL-encodes it in the HTTP `Idempotency-Key` header. The endpoint returns the same
   acknowledgement for repeated requests with the same body.

The consumers are independent. A committed receipt does not mean both consumers
have completed. `flush()` reports the first failed delivery; call it again to
retry that delivery. This example does not impose an atomic transaction across
SQLite and HTTP.

The external adapter checks HTTP status explicitly. Non-success responses
become `HttpFailure({ status })`; network and decoding failures become
`Unexpected`. Responses are checked against the acknowledgement schema. Both
versions impose a five-second request timeout and forward cancellation signals.

## Read the files

| File | Responsibility |
| --- | --- |
| [`domain.ts`](domain.ts) | Shared command, event, rejection, notification, and ledger contracts |
| [`sqlite.ts`](sqlite.ts) | SQLite transactions, prepared upserts, queries, and connection cleanup |
| [`dummy-http.ts`](dummy-http.ts) | Actual HTTP receiver with idempotency and a failed-response mode |
| [`pure.ts`](pure.ts) | Native command and consumer bodies; `createBank` binds the adapters |
| [`with-effect.ts`](with-effect.ts) | Equivalent Effect-backed bodies with declared requirements |
| [`run.ts`](run.ts) | Starts the receiver, hosts the model, sends commands, and queries SQLite |

## Exercise failures and replay

[`test/sqlite-http.test.ts`](../../test/sqlite-http.test.ts) runs both versions
against real SQLite files and loopback HTTP requests. It verifies:

- Ledger rows persist after closing and reopening the database.
- Replaying a projection upserts the same row.
- Retrying the same command ID does not send another notification.
- A failed HTTP response after acceptance retries with the same idempotency key
  and produces one accepted notification.
- Reusing a key with a different payload returns a tagged HTTP conflict.
- Cancelled requests are not accepted by the endpoint.
- A failed SQL statement rolls back the entire projection batch.

The dummy endpoint's failure mode is enabled with
`startDummyEndpoint({ failFirstAfterAccept: true })`. It accepts the first
notification but returns HTTP 503. The next flush retries the request and gets
the original acknowledgement. Deduplication belongs to the receiver; the
client's idempotency header alone cannot guarantee it.

## Persistence boundary

SQLite persists the **derived ledger only**. Aggregate state, event history,
command receipts, and delivery checkpoints use Accord's in-memory runtime.
Keeping the ledger file does not restore an account or pending deliveries after
a process restart. The endpoint's deduplication map is also in memory. A
production system would need persistent domain storage and a receiver with a
durable idempotency contract.
