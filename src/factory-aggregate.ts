import { cloneEmittedEvent, isReservedAggregateMethod } from './class-aggregate.js';
import { checkUses, validateUses, type ContextArgs, type ContextOf, type Uses } from './definitions.js';
import type { Tagged } from './result.js';

export type AggregateContext<S extends object, U extends Uses = {}> = {
  readonly state: S;
  emit<E extends Tagged>(event: E): void;
} & ContextOf<U>;

export type AggregateMethods = Record<string, (...args: any[]) => unknown>;
type FactoryInstance<S, M> = M & { getState(): S; pullEvents(): Tagged[] };

export interface FactoryAggregate<N extends string, S extends object, M extends AggregateMethods, U extends Uses = {}> {
  readonly kind: 'factory-aggregate';
  readonly name: N;
  readonly initial: () => S;
  readonly uses: U;
  create(state?: S, ...context: ContextArgs<U>): FactoryInstance<S, M>;
}

export type AnyFactoryAggregate = FactoryAggregate<string, any, AggregateMethods, Uses>;

export function isReservedFactoryMethod(name: string): boolean {
  return name === 'toJSON' || isReservedAggregateMethod(name);
}

export function createFactoryAggregate<N extends string, S extends object, M extends AggregateMethods, U extends Uses>(
  name: N, initial: S, factory: (ctx: AggregateContext<S, U>) => M, uses: U,
): FactoryAggregate<N, S, M, U> {
  validateUses(uses);
  for (const name of ['state', 'emit']) {
    if (Object.hasOwn(uses, name)) throw new TypeError(`Invalid dependency alias: ${name}`);
  }
  const defaults = structuredClone(initial);
  const create = (seed: S = defaults, context: ContextOf<U> = {} as ContextOf<U>): FactoryInstance<S, M> => {
    checkUses(uses, context);
    const state = structuredClone(seed);
    const events: Tagged[] = [];
    const methods = factory({ ...context, state, emit: (event: Tagged) => { events.push(cloneEmittedEvent(event)); } });
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
    kind: 'factory-aggregate', name, uses, initial: () => structuredClone(defaults),
    create: create as FactoryAggregate<N, S, M, U>['create'],
  };
}
