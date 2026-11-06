import { checkAggregateMethodName, cloneEmittedEvent } from './class-aggregate.js';
import type { Tagged } from './result.js';

export interface AggregateContext<S extends object> {
  readonly state: S;
  emit<E extends Tagged>(event: E): void;
}

export interface AggregateStateCodec<S extends object, P extends object> {
  readonly snapshot: (state: S) => P;
  readonly restore: (state: NoInfer<P>) => S;
}

export type AggregateMethods = Record<string, (...args: any[]) => unknown>;
type FactoryInstance<P, M> = M & { getState(): P; pullEvents(): Tagged[] };

export interface FactoryAggregate<N extends string, P extends object, M extends AggregateMethods> {
  readonly kind: 'factory-aggregate';
  readonly name: N;
  readonly initial: () => P;
  readonly create: () => FactoryInstance<P, M>;
  readonly restore: (snapshot: P) => FactoryInstance<P, M>;
}

export type AnyFactoryAggregate = FactoryAggregate<string, any, AggregateMethods>;

export function createFactoryAggregate<N extends string, S extends object, P extends object, M extends AggregateMethods>(
  name: N, initial: S, factory: (ctx: AggregateContext<S>) => M, codec: AggregateStateCodec<S, P>,
): FactoryAggregate<N, P, M> {
  const defaults = structuredClone(codec.snapshot(initial));
  const restore = (snapshot: P): FactoryInstance<P, M> => {
    const state = codec.restore(structuredClone(snapshot));
    const events: Tagged[] = [];
    const methods = factory({ state, emit: event => events.push(cloneEmittedEvent(event)) });
    const instance = Object.create(null);
    for (const [name, method] of Object.entries(methods)) {
      checkAggregateMethodName(name);
      if (typeof method !== 'function') throw new TypeError(`Expected an aggregate method: ${name}`);
      instance[name] = method;
    }
    return Object.defineProperties(instance, {
      getState: { value: () => structuredClone(codec.snapshot(state)) },
      pullEvents: { value: () => events.splice(0) },
    }) as FactoryInstance<P, M>;
  };
  return {
    kind: 'factory-aggregate', name, initial: () => structuredClone(defaults),
    create: () => restore(defaults), restore,
  };
}
