import { parse, type Infer, type SchemaInput } from './schema.js';

class ValueObject<T> {
  protected readonly value: T;

  constructor(value: T) {
    this.value = structuredClone(value);
  }

  snapshot(): T;
  snapshot<R>(project: (value: T) => R): R;
  snapshot<R>(project?: (value: T) => R): T | R {
    const value = structuredClone(this.value);
    return project ? project(value) : value;
  }
}

interface ValueObjectClass<N extends string, T> {
  new (value: T): ValueObject<T>;
  readonly valueObjectName: N;
  of<V>(this: new (value: T) => V, value: T): V;
}

/** Build a value object base with validated data and typed snapshots. */
export function vo<const N extends string, const S extends SchemaInput>(name: N, schema: S): ValueObjectClass<N, Infer<S>> {
  type Data = Infer<S>;

  return class extends ValueObject<Data> {
    static readonly valueObjectName = name;

    constructor(value: Data) {
      super(parse(schema, value));
    }

    static of<V>(this: new (value: Data) => V, value: Data): V {
      return new this(value);
    }
  };
}
