# Limits of v0.1

Accord's first version is deliberately small. Here's what it does and doesn't do.

## Included

- In-process runtime with a default memory store: atomic aggregate commits, keyed concurrency, receipts, replay, and consumer checkpoints.
- Optional SQLite store with restart recovery and database transactions for commands and consumer batches.
- HTTP transport for commands and view reads.
- Optional Effect integration (Effect v4.1.2+).

## Not included (yet)

- **npm release.** Install from a local `npm pack` tarball for now.
- **Durable workflows.** Workflow state is memory-only; SQLite models with workflows are rejected.
- **Background scheduling.** No automatic flush, retry backoff, or timers outside a running process.
- **Migrations and retention.** No migration orchestration, upcaster registry, or retention policy. Histories grow forever.
- **Distributed transactions.** Nothing spans external systems.
- **Global ordering.** Ordering is per source stream only.
- **Transports.** No WebSocket, SSE, OpenAPI, or MCP. Live subscriptions, workflows, and streams aren't on HTTP.
- **License.** The package is marked `UNLICENSED`; no open-source license has been selected yet.

## Data rules

- Stored domain data must support `structuredClone` (and V8 serialization on SQLite).
- HTTP data must also round-trip through JSON.
