import { fail, ok, unexpected, type Result, type Tagged, type Unexpected } from './result.js';
import { bindBody, tuple, checkError, checkUses, validateUses, type AggregateDefinition, type AnyAggregate, type AnyCommand, type AnyTaggedFactory, type AnyRejection, type Values, type AnyView, type Body, type ContextOf, type Uses } from './definitions.js';
import { type AnyModel, type Runtime } from './runtime.js';

export interface ApiRequest {
  readonly kind: 'command' | 'view'; readonly operation: string; readonly target: string;
  readonly input?: unknown; readonly headers: Headers;
}
export type Unauthorized = { readonly _tag: 'Unauthorized' };
export type NotFound = { readonly _tag: 'NotFound'; readonly operation: string };
export interface Api<N extends string, M extends AnyModel, C extends readonly AnyCommand[], V extends readonly AnyView[], U extends Uses, E extends Tagged> {
  readonly kind: 'api'; readonly name: N; readonly model: M; readonly commands: C; readonly views: V; readonly uses: U;
  readonly authorize: (request: ApiRequest, context: ContextOf<U>) => Promise<Result<{ readonly actor?: unknown }, E | Unexpected>>;
}
export type AnyApi = Api<string, AnyModel, readonly AnyCommand[], readonly AnyView[], any, Tagged>;
export function api<
  const N extends string, const M extends AnyModel, const C extends readonly AnyCommand[], const V extends readonly AnyView[],
  const U extends Uses = {}, const Re extends readonly AnyRejection[] = readonly [],
>(name: N, contract: { readonly model: M; readonly commands: C; readonly views: V; readonly uses?: U; readonly rejects?: Re },
  authorize?: Body<[ApiRequest], U, { readonly actor?: unknown }, Values<Re>>,
): Api<N, M, C, V, U, Values<Re>> {
  const knownCommands = (Object.values(contract.model.aggregates) as AggregateDefinition[])
    .flatMap(aggregate => aggregate.kind === 'aggregate' ? Object.values(aggregate.commands) : []);
  for (const command of contract.commands) if (!knownCommands.includes(command)) throw new TypeError('API contains an unregistered command');
  for (const view of contract.views) if (!Object.values(contract.model.views).includes(view)) throw new TypeError('API contains an unregistered view');
  const uses = (contract.uses ?? {}) as U;
  validateUses(uses);
  const execute = authorize ? bindBody(authorize, uses) : () => ok({});
  return {
    kind: 'api', name, ...contract, uses,
    async authorize(request, context) {
      try {
        checkUses(uses, context);
        const result = await execute(request, context);
        tuple(result);
        if (result[1] !== null) return fail(checkError(contract.rejects ?? [], result[1]));
        if (!result[0] || typeof result[0] !== 'object') throw new TypeError('Authorization must return an actor context');
        return result;
      } catch (cause) { return fail(unexpected(cause)); }
    },
  } as Api<N, M, C, V, U, Values<Re>>;
}
type WithErrors<F, E extends Tagged> = F extends (...args: infer A) => Promise<Result<infer R, infer Existing>> ? (...args: A) => Promise<Result<R, Existing | E>> : never;
type ApiCommands<A> = A extends AnyAggregate ? A['commands'] : {};
export type ApiClient<A extends AnyApi> = {
  [K in keyof A['model']['aggregates'] as keyof {
    [C in keyof ApiCommands<A['model']['aggregates'][K]> as ApiCommands<A['model']['aggregates'][K]>[C] extends A['commands'][number] ? C : never]: unknown
  } extends never ? never : K]: {
    [C in keyof ApiCommands<A['model']['aggregates'][K]> as ApiCommands<A['model']['aggregates'][K]>[C] extends A['commands'][number] ? C : never]:
      WithErrors<Runtime<A['model']>[K & keyof Runtime<A['model']>][C & keyof Runtime<A['model']>[K & keyof Runtime<A['model']>]], A extends Api<any, any, any, any, any, infer E> ? E | NotFound | Unauthorized : never>;
  }
} & {
  [K in keyof A['model']['views'] as A['model']['views'][K] extends A['views'][number] ? K : never]: {
    [R in 'get' | 'snapshot' | 'events']: WithErrors<Runtime<A['model']>[K & keyof Runtime<A['model']>][R & keyof Runtime<A['model']>[K & keyof Runtime<A['model']>]], A extends Api<any, any, any, any, any, infer E> ? E | NotFound | Unauthorized : never>;
  }
};
function json(value: unknown, status = 200): Response {
  // Error causes and stacks remain on the server; they may contain credentials.
  const body = JSON.stringify(value, (_key, value) => value instanceof Error ? { _tag: (value as Unexpected)._tag ?? 'Unexpected', message: value.message } : value);
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}
export function serve<A extends AnyApi>(definition: A, options: { readonly runtime: Runtime<A['model']> } &
  (keyof A['uses'] extends never ? { readonly services?: ContextOf<A['uses']> } : { readonly services: ContextOf<A['uses']> }),
): (request: Request) => Promise<Response> {
  return async request => {
    if (request.method !== 'POST') return json(fail({ _tag: 'InvalidInput', message: 'Use POST' }), 405);
    let body: any;
    try { body = await request.json(); }
    catch { return json(fail({ _tag: 'InvalidInput', message: 'Expected a JSON request' }), 400); }
    if (!body || typeof body.operation !== 'string' || typeof body.target !== 'string' || !['command', 'view'].includes(body.kind)) return json(fail({ _tag: 'InvalidInput', message: 'Invalid API request' }), 400);
    try {
      const [alias, method, ...extra] = body.operation.split('.');
      if (extra.length || !alias || !method) return json(fail({ _tag: 'NotFound', operation: body.operation }), 404);
      let callable: ((...args: any[]) => Promise<Result<unknown, Tagged>>) | undefined;
      if (body.kind === 'command') {
        const aggregate = Object.hasOwn(definition.model.aggregates, alias) ? definition.model.aggregates[alias] : undefined;
        const command = aggregate?.kind === 'aggregate' && Object.hasOwn(aggregate.commands, method) ? aggregate.commands[method] : undefined;
        if (command && definition.commands.includes(command)) callable = (options.runtime as any)[alias][method];
      } else {
        const view = Object.hasOwn(definition.model.views, alias) ? definition.model.views[alias] : undefined;
        if (view && definition.views.includes(view) && ['get', 'snapshot', 'events'].includes(method)) callable = (options.runtime as any)[alias][method];
      }
      if (!callable) return json(fail({ _tag: 'NotFound', operation: body.operation }), 404);
      const [authorization, error] = await definition.authorize({ kind: body.kind, operation: body.operation, target: body.target, input: body.input, headers: request.headers }, { ...(options.services ?? {}), signal: request.signal } as ContextOf<A['uses']>);
      if (error !== null) return json(fail(error), 403);
      const supplied = body.options && typeof body.options === 'object' ? body.options : {};
      // Callers cannot supply actor, timestamp, dependency bindings, or a server signal.
      const callOptions = body.kind === 'command' ? {
        ...(typeof supplied.commandId === 'string' ? { commandId: supplied.commandId } : {}),
        ...(typeof supplied.expectedVersion === 'number' ? { expectedVersion: supplied.expectedVersion } : {}),
        actor: authorization.actor, signal: request.signal,
      } : {
        ...(supplied.atLeast ? { atLeast: supplied.atLeast } : {}),
        ...(typeof supplied.after === 'number' ? { after: supplied.after } : {}),
        signal: request.signal,
      };
      return json(body.kind === 'command' ? await callable(body.target, body.input, callOptions) : await callable(body.target, callOptions));
    } catch (cause) { return json(fail(unexpected(cause)), 500); }
  };
}
export function client<A extends AnyApi>(url: string, options: { readonly fetch?: typeof globalThis.fetch; readonly headers?: HeadersInit } = {}): ApiClient<A> {
  const fetch = options.fetch ?? globalThis.fetch;
  return new Proxy({}, {
    get(_target, alias: string) {
      if (alias === 'then') return undefined;
      return new Proxy({}, {
        get(_target, method: string) {
          if (method === 'then') return undefined;
          return async (target: string, inputOrOptions?: unknown, callOptions?: { signal?: AbortSignal; headers?: HeadersInit }) => {
            try {
              const isRead = ['get', 'snapshot', 'events'].includes(method);
              const settings = (isRead ? inputOrOptions : callOptions) as { signal?: AbortSignal; headers?: HeadersInit } | undefined;
              const headers = new Headers(options.headers);
              for (const [key, value] of new Headers(settings?.headers)) headers.set(key, value);
              headers.set('content-type', 'application/json');
              const response = await fetch(url, {
                method: 'POST', headers,
                ...(settings?.signal ? { signal: settings.signal } : {}),
                body: JSON.stringify({ kind: isRead ? 'view' : 'command', operation: `${alias}.${method}`, target, input: isRead ? undefined : inputOrOptions, options: isRead ? inputOrOptions : callOptions }),
              });
              const result: unknown = await response.json();
              tuple(result);
              const [value, error] = result;
              if (error !== null) return error._tag === 'Unexpected' ? fail(unexpected(error)) : fail(error);
              return ok(value);
            } catch (cause) { return fail(unexpected(cause)); }
          };
        },
      });
    },
  }) as ApiClient<A>;
}
