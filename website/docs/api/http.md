# HTTP API

`api()` exposes selected commands and views over HTTP. `serve()` turns it into a `fetch`-style handler, and `client()` gives you a typed remote client.

## Import

```ts
import { api, client, fail, ok, rejection, serve, wire } from '@marcelsud/accord'
```

## Usage

```ts
const Unauthorized = rejection('Unauthorized')

const PublicBank = api(
  'PublicBank',
  {
    model: Bank,
    commands: [Account.commands.open, Account.commands.deposit],
    views: [Summary],
    rejects: [Unauthorized],
  },
  (request) => {
    if (request.headers.get('authorization') !== 'Bearer example') {
      return fail(Unauthorized())
    }
    return ok({ actor: 'example-user' })
  }
)

// Server
const fetchHandler = serve(PublicBank, { runtime: wire(Bank) })

// Client
const remote = client<typeof PublicBank>('https://your-server/api', {
  headers: { authorization: 'Bearer example' },
})
const [summary, error] = await remote.summary.get('a-1')
```

`Account` here is an [event-evolved aggregate](/docs/api/aggregate#event-evolved-aggregates): only `command()` definitions can be exposed.

::: warning
The fixed token only illustrates the contract. Plug in your own authentication for a real endpoint.
:::

## api(name, contract, authorize?)

### model

The model to expose.

### commands

`Command[]`. Only these are exposed. An empty list exposes none.

### views

`View[]`.

### rejects <Badge type="info" text="optional" />

`Rejection[]`. Authorization failures must be listed here.

### uses <Badge type="info" text="optional" />

`Record<string, Dependency>`.

### authorize <Badge type="info" text="optional" />

`(request, ctx) => Result<{ actor? }, Rejection>`. Receives the operation, target, input, and headers. The returned `actor` is the trusted command actor. **Omitting it allows anonymous access** to the selected operations.

## serve(api, { runtime })

Returns `(request: Request) => Promise<Response>`. Mount it in any server that speaks `Request`/`Response`.

Requests are `POST` with a JSON body: `{ kind, operation, target, input, options }`, where `operation` is `alias.method`.

## client(url, { fetch?, headers? })

A typed client for commands and views. Pass a custom `fetch` to test without a server:

```ts
const remote = client<typeof PublicBank>('http://test/api', {
  fetch: (input, init) => fetchHandler(new Request(input, init)),
})
```

## What's supported

- Commands, and view `get`, `snapshot`, and `events`.
- Not supported: live subscriptions, workflows, streams, WebSocket, SSE, OpenAPI, or MCP.
- Server-side `Unexpected` causes and stacks are stripped. The client recreates an `Error` with the sanitized response as its cause.
- Command selection is enforced by definition identity on the server. The static client type is structural, so commands with identical contract types may look the same to TypeScript, but the server still rejects every unlisted command.
