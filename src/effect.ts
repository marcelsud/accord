/** Optional Effect v4 integration. No core module imports this entry point. */
import { Cause, Context, Effect, Exit, Result as EffectResult } from 'effect';
import {
  EffectBody, type AdaptedBody, type AnyCommand, type AnyDependency, type CommandDecision,
  type ContextOf, type EventsOf, type InputOf, type RejectionsOf, type ReplyOf, type Requirement,
  type Requirements, type ServiceOf, type StateOf, type Uses,
} from './definitions.js';
import { fail, ok, unexpected, type InvalidInput, type Result, type ResultError, type ResultValue, type Tagged, type Unexpected } from './result.js';
import { modelDependencies, wire, type AnyModel, type ModelUses, type Runtime, type RuntimeOptions } from './runtime.js';

const keys = new WeakMap<AnyDependency, Context.Service<any, any>>();
function serviceKey<D extends AnyDependency>(definition: D): Context.Service<Requirement<D>, ServiceOf<D>> {
  let key = keys.get(definition);
  if (!key) {
    key = Context.Service<Requirement<D>, ServiceOf<D>>(`@marcelsud/accord/${definition.name}`);
    keys.set(definition, key);
  }
  return key;
}
type UsedRequirements<U> = U extends Uses ? Requirements<U> : never;
type EffectMethods<T> = { [K in keyof T]: EffectCalls<T[K]> };
type EffectCalls<T> = T extends (...args: infer Args) => Promise<infer R>
  ? [R] extends [Result<unknown, Tagged>]
    ? ((...args: Args) => Effect.Effect<ResultValue<R>, ResultError<R> | Unexpected>) & EffectMethods<T>
    : T
  : T extends (...args: never[]) => unknown ? T : EffectMethods<T>;
export type EffectRuntime<M extends AnyModel> = EffectMethods<Runtime<M>>;

function liftCall(call: (...args: any[]) => Promise<Result<unknown, Tagged>>) {
  return (...args: unknown[]) => Effect.gen(function* () {
    const [value, error] = yield* Effect.tryPromise({ try: () => call(...args), catch: unexpected });
    if (error !== null) return yield* Effect.fail(error);
    return value;
  });
}

function liftClient(client: object, preserveWatch = false): object {
  return new Proxy(client, {
    get(target, name) {
      const member = Reflect.get(target, name);
      if (typeof member !== 'function' || preserveWatch && name === 'watch') return member;
      return liftCall((...args) => Reflect.apply(member, target, args));
    },
  });
}

function effectifyModel(definition: AnyModel) {
  return Effect.gen(function* () {
    const dependencies = yield* Effect.try({ try: () => modelDependencies(definition), catch: unexpected });
    const services = Object.create(null) as Record<string, unknown>;
    for (const [alias, dependency] of dependencies) services[alias] = yield* serviceKey(dependency);

    const native = yield* Effect.try({
      try: () => wire(definition, { services } as RuntimeOptions<AnyModel>),
      catch: unexpected,
    });
    const runtime: Record<string, unknown> = { flush: liftCall(native.flush) };
    for (const alias of Object.keys(definition.aggregates)) runtime[alias] = liftClient(native[alias] as object);
    for (const alias of Object.keys(definition.views)) runtime[alias] = liftClient(native[alias] as object, true);
    runtime.streams = Object.fromEntries(Object.entries(native.streams).map(([alias, client]) => [alias, liftClient(client, true)]));
    runtime.workflows = Object.fromEntries(Object.entries(native.workflows).map(([alias, workflow]) =>
      [alias, Object.assign(liftCall(workflow), { signal: liftCall(workflow.signal) })],
    ));
    return runtime;
  });
}

export function effectify<M extends AnyModel>(definition: M): Effect.Effect<EffectRuntime<M>, Unexpected, UsedRequirements<ModelUses<M>>>;
export function effectify<D extends AnyDependency>(definition: D): Context.Service<Requirement<D>, ServiceOf<D>>;
export function effectify<C extends AnyCommand>(definition: C): (
  state: StateOf<C>, input: InputOf<C>,
) => Effect.Effect<CommandDecision<EventsOf<C>, ReplyOf<C>>, RejectionsOf<C> | InvalidInput | Unexpected, Requirements<C['uses']>>;
export function effectify<Args extends readonly unknown[], A, E extends Tagged, R>(
  body: (...args: Args) => Effect.Effect<A, E, R>,
): AdaptedBody<Args, A, E, R>;
export function effectify(value: any): any {
  if (value.kind === 'model') return effectifyModel(value);
  if (value.kind === 'service' || value.kind === 'external') return serviceKey(value);
  if (value.kind === 'command') {
    return (...args: unknown[]) => Effect.gen(function* () {
      const services: Record<string, unknown> = {};
      for (const [alias, dependency] of Object.entries(value.uses) as Array<[string, AnyDependency]>) services[alias] = yield* serviceKey(dependency);
      const [output, error] = yield* Effect.tryPromise({
        try: async signal => value(...args, { ...services, signal }),
        catch: unexpected,
      });
      if (error !== null) return yield* Effect.fail(error);
      return output;
    });
  }
  if (typeof value !== 'function') throw new TypeError('effectify expects a model, dependency, command, or Effect-returning function');
  return {
    [EffectBody]: true,
    bind(uses: Uses) {
      return async (...args: unknown[]): Promise<Result<unknown, Tagged>> => {
        const context = args.pop() as ContextOf<any>;
        let environment = Context.empty() as Context.Context<any>;
        for (const [alias, dependency] of Object.entries(uses)) {
          if (!Object.hasOwn(context, alias)) return fail(unexpected(new TypeError(`Missing dependency: ${alias}`)));
          environment = Context.add(environment, serviceKey(dependency), context[alias]);
        }
        // Preserve the full Effect scope until this handler finishes, including finalizers.
        const effect = Effect.provide(Effect.suspend(() => value(...args)), environment);
        const exit = await Effect.runPromiseExit(effect, context.signal ? { signal: context.signal } : undefined);
        if (Exit.isSuccess(exit)) return ok(exit.value);
        if (Cause.hasInterrupts(exit.cause) || Cause.hasDies(exit.cause) && Cause.hasFails(exit.cause)) return fail(unexpected(exit.cause));
        const error = Cause.findError(exit.cause);
        return EffectResult.isSuccess(error) ? fail(error.success as Tagged) : fail(unexpected(Cause.squash(exit.cause)));
      };
    },
  };
}
