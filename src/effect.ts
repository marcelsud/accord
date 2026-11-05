/** Optional Effect v4 integration. No core module imports this entry point. */
import { Cause, Context, Effect, Exit, Result as EffectResult } from 'effect';
import {
  EffectBody, type AdaptedBody, type AnyCommand, type AnyDependency, type CommandDecision,
  type ContextOf, type EventsOf, type InputOf, type RejectionsOf, type ReplyOf, type Requirement,
  type Requirements, type ServiceOf, type StateOf, type Uses,
} from './definitions.js';
import { fail, ok, unexpected, type InvalidInput, type Result, type Tagged, type Unexpected } from './result.js';

const keys = new WeakMap<AnyDependency, Context.Service<any, any>>();
function serviceKey<D extends AnyDependency>(definition: D): Context.Service<Requirement<D>, ServiceOf<D>> {
  let key = keys.get(definition);
  if (!key) {
    key = Context.Service<Requirement<D>, ServiceOf<D>>(`@marcelsud/accord/${definition.name}`);
    keys.set(definition, key);
  }
  return key;
}
export function effectify<D extends AnyDependency>(definition: D): Context.Service<Requirement<D>, ServiceOf<D>>;
export function effectify<C extends AnyCommand>(definition: C): (
  state: StateOf<C>, input: InputOf<C>,
) => Effect.Effect<CommandDecision<EventsOf<C>, ReplyOf<C>>, RejectionsOf<C> | InvalidInput | Unexpected, Requirements<C['uses']>>;
export function effectify<Args extends readonly unknown[], A, E extends Tagged, R>(
  body: (...args: Args) => Effect.Effect<A, E, R>,
): AdaptedBody<Args, A, E, R>;
export function effectify(value: any): any {
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
  if (typeof value !== 'function') throw new TypeError('effectify expects a dependency, command, or Effect-returning lambda');
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
