import { cloneEmittedEvent, isReservedAggregateMethod } from './class-aggregate.js';
import type { Tagged } from './result.js';

export interface AggregateContext<S extends object> {
  readonly state: S;
  emit<E extends Tagged>(event: E): void;
}

export type AggregateMethods = Record<string, (...args: any[]) => unknown>;
type FactoryInstance<S, M> = M & { getState(): S; pullEvents(): Tagged[] };

export interface FactoryAggregate<N extends string, S extends object, M extends AggregateMethods> {
  readonly kind: 'factory-aggregate';
  readonly name: N;
  readonly initial: () => S;
  readonly create: (state?: S) => FactoryInstance<S, M>;
}

export type AnyFactoryAggregate = FactoryAggregate<string, any, AggregateMethods>;

export function isReservedFactoryMethod(name: string): boolean {
  return name === 'toJSON' || isReservedAggregateMethod(name);
}

export function createFactoryAggregate<N extends string, S extends object, M extends AggregateMethods>(
  name: N, initial: S, factory: (ctx: AggregateContext<S>) => M,
): FactoryAggregate<N, S, M> {
  const defaults = structuredClone(initial);
  const create = (seed: S = defaults): FactoryInstance<S, M> => {
    const state = structuredClone(seed);
    const events: Tagged[] = [];
    const methods = factory({ state, emit: event => events.push(cloneEmittedEvent(event)) });
    const instance = Object.create(null);
    for (const [name, method] of Object.entries(methods)) {
      if (isReservedFactoryMethod(name)) throw new TypeError(`Reserved aggregate method name: ${name}`);
      if (typeof method !== 'function') throw new TypeError(`Expected an aggregate method: ${name}`);
      instance[name] = method;
    }
    return Object.defineProperties(instance, {
      getState: { value: () => structuredClone(state) },
      pullEvents: { value: () => events.splice(0) },
    }) as FactoryInstance<S, M>;
  };
  return {
    kind: 'factory-aggregate', name, initial: () => structuredClone(defaults),
    create,
  };
}
