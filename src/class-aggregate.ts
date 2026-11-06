import type { Tagged } from './result.js';

export function cloneEmittedEvent<E extends Tagged>(event: E): E {
  const copy = structuredClone(event);
  if (!copy || typeof copy !== 'object' || typeof copy._tag !== 'string') {
    throw new TypeError('An emitted event must have a string tag');
  }
  return copy;
}

export function checkAggregateMethodName(name: string): void {
  if (['get', 'events', 'getState', 'pullEvents', 'emit', 'constructor', '__proto__', 'prototype', 'then'].includes(name)) {
    throw new TypeError(`Reserved aggregate method name: ${name}`);
  }
}

class AggregateState<S extends object> {
  protected state: S;
  #events: Tagged[] = [];

  constructor(state: S) {
    this.state = structuredClone(state);
  }

  getState(): S {
    return structuredClone(this.state);
  }

  protected emit<E extends Tagged>(event: E): void {
    this.#events.push(cloneEmittedEvent(event));
  }

  pullEvents(): Tagged[] {
    return this.#events.splice(0);
  }
}

export interface AggregateClass<N extends string, S extends object> {
  new (state?: S): AggregateState<S>;
  readonly kind: 'class-aggregate';
  readonly aggregateName: N;
  readonly initial: () => S;
  create<A>(this: new () => A): A;
  restore<A>(this: new (state: S) => A, state: S): A;
}

export type AnyAggregateClass = AggregateClass<string, any>;

export function createAggregateClass<const N extends string, S extends object>(name: N, initial: S): AggregateClass<N, S> {
  const defaults = structuredClone(initial);
  return class extends AggregateState<S> {
    static readonly kind = 'class-aggregate' as const;
    static readonly aggregateName = name;
    static initial() { return structuredClone(defaults); }
    static create<A>(this: new () => A): A { return new this(); }
    static restore<A>(this: new (state: S) => A, state: S): A { return new this(state); }
    constructor(state: S = defaults) { super(state); }
  };
}

export function classMethods(definition: AnyAggregateClass): Map<string, (...args: unknown[]) => unknown> {
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  const seen = new Set(['constructor']);
  for (let prototype = definition.prototype; prototype && prototype !== AggregateState.prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(prototype))) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (typeof descriptor.value !== 'function') continue;
      checkAggregateMethodName(name);
      methods.set(name, descriptor.value);
    }
  }
  return methods;
}
