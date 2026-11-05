import { Effect } from 'effect';
import { effectify } from '../src/effect.js';
import {
  command, event, external, fail, host, integer, match, model, ok, rejection, service, string,
  type Infer, type Requirement, type Result,
} from '../src/index.js';
import { Account, AlreadyOpen, Balance, Bank, Cents, Deposited, InsufficientFunds, NotOpen, State, deposit } from './fixtures.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
const noProperties = NotOpen();
type Tag = Expect<Equal<typeof noProperties._tag, 'NotOpen'>>;
const rejectionWithProperties = InsufficientFunds({ balance: 10, requested: 20 });
type Property = Expect<Equal<typeof rejectionWithProperties.requested, number>>;
// @ts-expect-error No-property rejections reject property arguments.
NotOpen({ reason: 'closed' });
// @ts-expect-error Rejections have fixed schema-backed shapes.
InsufficientFunds({ requested: 20 });
// @ts-expect-error Property types come from the schema.
InsufficientFunds({ balance: '10', requested: 20 });
// @ts-expect-error Extra constructor properties are rejected.
InsufficientFunds({ balance: 10, requested: 20, other: true });
// @ts-expect-error There is no schema-free property inference.
rejection('Freeform')({ anything: true });
// @ts-expect-error Events have typed properties too.
Deposited({ amount: '100' });

function tuples(result: Result<string, ReturnType<typeof NotOpen> | ReturnType<typeof InsufficientFunds>>) {
  const [value, error] = result;
  // @ts-expect-error Unchecked tuple values are unknown.
  value.toUpperCase();
  if (error !== null) {
    if (error._tag === 'InsufficientFunds') {
      type Narrow = Expect<Equal<typeof error.balance, number>>;
    }
    return;
  }
  type Value = Expect<Equal<typeof value, string>>;
  return value.toUpperCase();
}
function matches(value: ReturnType<typeof NotOpen> | ReturnType<typeof InsufficientFunds>) {
  const result = match(value, {
    NotOpen: () => 'closed' as const,
    InsufficientFunds: error => {
      type Narrow = Expect<Equal<typeof error.requested, number>>;
      return error.balance;
    },
  });
  type Return = Expect<Equal<typeof result, 'closed' | number>>;
  // @ts-expect-error match is exhaustive by default.
  match(value, { NotOpen: () => 'closed' });
  // @ts-expect-error Unknown cases are rejected.
  match(value, { NotOpen: () => 0, InsufficientFunds: () => 1, Other: () => 2 });
}
const badReply = command(
  { state: State, input: { amount: Cents }, events: [Deposited], rejects: [NotOpen], reply: Balance },
  // @ts-expect-error Reply shapes are checked against their schema.
  (state, input) => ok({ events: [Deposited(input)], reply: { balance: 'wrong' } }),
);
const badRejection = command(
  { state: State, input: {}, events: [Deposited], rejects: [NotOpen] },
  // @ts-expect-error A command cannot return an undeclared rejection.
  () => fail(AlreadyOpen()),
);
command(
  { state: State, input: { amount: Cents }, events: [Deposited], reply: Balance },
  (state, input) => {
    type StateInference = Expect<Equal<typeof state.balance, number>>;
    type InputInference = Expect<Equal<typeof input.amount, number>>;
    return ok({ events: [Deposited(input)], reply: { balance: state.balance + input.amount } });
  },
);
async function clientInference() {
  const bank = host(Bank);
  // @ts-expect-error Command inputs are inferred through model and host.
  await bank.account.deposit('a', { amount: '100' });
  // @ts-expect-error Unknown commands are rejected.
  bank.account.missing;
  const [receipt, error] = await bank.account.deposit('a', { amount: 100 });
  if (error !== null) return;
  type ReplyInference = Expect<Equal<typeof receipt.reply.balance, number>>;
  const [summary, readError] = await bank.summary.get('a', { atLeast: receipt });
  if (readError !== null || summary === null) return;
  type ViewInference = Expect<Equal<typeof summary.balance, number>>;
}

const Rules = service('Rules', { maximum: integer });
const Other = service('Other', { label: string });
const Limited = command(
  { state: State, input: { amount: Cents }, events: [Deposited], rejects: [NotOpen], reply: Balance, uses: { rules: Rules } },
  effectify((state, input) => Effect.gen(function* () {
    type EffectState = Expect<Equal<typeof state.balance, number>>;
    type EffectInput = Expect<Equal<typeof input.amount, number>>;
    const rules = yield* effectify(Rules);
    type ServiceInference = Expect<Equal<typeof rules.maximum, number>>;
    if (!state.open || input.amount > rules.maximum) return yield* Effect.fail(NotOpen());
    return { events: [Deposited(input)], reply: { balance: state.balance + input.amount } };
  })),
);
const undeclaredEffectRequirement = command(
  { state: State, input: { amount: Cents }, events: [Deposited], reply: Balance, uses: { rules: Rules } },
  // @ts-expect-error Effect requirements must be a subset of uses.
  effectify((state, input) => Effect.gen(function* () {
    yield* effectify(Other);
    return { events: [Deposited(input)], reply: { balance: state.balance + input.amount } };
  })),
);
const lifted = effectify(Limited)({ open: true, balance: 0 }, { amount: 10 });
type Requirements = Expect<Equal<Effect.Services<typeof lifted>, Requirement<typeof Rules>>>;
// @ts-expect-error An unresolved Effect requirement cannot be run.
Effect.runPromise(lifted);
Effect.runPromise(Effect.provideService(lifted, effectify(Rules), { maximum: 100 }));
// @ts-expect-error Dependency implementations are type checked.
Effect.provideService(lifted, effectify(Rules), { maximum: 'wrong' });
// @ts-expect-error Command context requires declared services.
Limited({ open: true, balance: 0 }, { amount: 10 });
Limited({ open: true, balance: 0 }, { amount: 10 }, { rules: { maximum: 100 } });
const LimitedAccount = { ...Account, commands: { deposit: Limited } };
const LimitedBank = model('LimitedBank', { aggregates: { account: LimitedAccount } });
// @ts-expect-error Hosting requires all declared dependencies.
host(LimitedBank);
host(LimitedBank, { services: { rules: { maximum: 100 } } });
// @ts-expect-error Hosting validates dependency implementation types.
host(LimitedBank, { services: { rules: { maximum: 'wrong' } } });

const Notify = external('Notify', { input: { text: string }, reply: { id: string } }, input => ok({ id: input.text }));
const notify = Notify.implement({});
notify({ text: 'hello' });
// @ts-expect-error External inputs retain their schemas.
notify({ text: 1 });

import { api, client, workflow } from '../src/index.js';
import { Summary } from './fixtures.js';
const Public = api('Public', { model: Bank, commands: [Account.commands.deposit], views: [Summary] });
const remote = client<typeof Public>('https://example.test/api');
remote.account.deposit('a', { amount: 10 });
// @ts-expect-error Unexposed commands are absent from the client surface.
remote.account.open('a', {});
// @ts-expect-error Aggregate reads are not exposed by listing a command.
remote.account.get('a');
// @ts-expect-error HTTP subscriptions are not part of the v0.1 transport.
remote.summary.watch('a');
// @ts-expect-error HTTP inputs preserve command schemas.
remote.account.deposit('a', { amount: 'wrong' });
const TypedWorkflow = workflow('TypedWorkflow', { input: { id: string }, reply: { value: integer }, key: input => input.id }, async (_input, run) => {
  const [value, error] = await run.step('one', () => ok(1));
  if (error !== null) return fail(error);
  type StepInference = Expect<Equal<typeof value, number>>;
  return ok({ value });
});

// @ts-expect-error Tags are reserved in schema shapes.
rejection('BadTag', { _tag: string });
// @ts-expect-error Events and rejections are distinct declaration kinds.
command({ state: State, input: {}, events: [NotOpen] }, () => ok({ events: [] }));
// @ts-expect-error Event constructors cannot be declared as command rejections.
command({ state: State, input: {}, events: [Deposited], rejects: [Deposited] }, () => ok({ events: [] }));
const noEvents = event('NoEvents');
command({ state: State, input: {}, events: [noEvents] },
  // @ts-expect-error Event outputs must be among the declared events.
  () => ok({ events: [Deposited({ amount: 1 })] }),
);
