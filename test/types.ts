import { Effect } from 'effect';
import { effectify } from '../src/effect.js';
import {
  aggregate, command, event, external, fail, wire, integer, match, model, ok, rejection, service, string, vo,
  type Infer, type ReplyOf, type Requirement, type Result,
} from '../src/index.js';
import { Account, AlreadyOpen, Balance, Bank, Cents, Deposited, InsufficientFunds, NotOpen, Opened, State, deposit } from './fixtures.js';

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
  const bank = wire(Bank);
  // @ts-expect-error Command inputs are inferred through model and wire.
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
const Labelled = event('Labelled', { label: string });
// Plain declarations preserve inference without `as const` or explicit generics.
const AccountContract = {
  state: State,
  commands: {
    open: { input: {}, events: [Opened], rejects: [AlreadyOpen] },
    deposit: { input: { amount: Cents }, events: [Deposited], rejects: [NotOpen], reply: Balance },
    label: { input: { label: string }, events: [Labelled], reply: { label: string } },
    limited: { input: { amount: Cents }, events: [Deposited], rejects: [NotOpen], reply: Balance, uses: { rules: Rules } },
  },
};
const namedDeposit = command(AccountContract, 'deposit', (state, input, ctx) => {
  type StateInference = Expect<Equal<typeof state, Infer<typeof State>>>;
  type InputInference = Expect<Equal<typeof input.amount, number>>;
  type SignalInference = Expect<Equal<typeof ctx.signal, AbortSignal | undefined>>;
  // @ts-expect-error Input comes from the selected command, not its siblings.
  input.label;
  // @ts-expect-error Undeclared services are unavailable.
  ctx.rules;
  if (!state.open) return fail(NotOpen());
  return ok({ events: [Deposited(input)], reply: { balance: state.balance + input.amount } });
});
const namedOpen = command(AccountContract, 'open', () => ok({ events: [Opened()] }));
type NoReply = Expect<Equal<ReplyOf<typeof namedOpen>, undefined>>;
command(AccountContract, 'label', (_state, input) => ok({ events: [Labelled(input)], reply: input }));
command(AccountContract, 'limited', (state, input, ctx) => {
  type NativeService = Expect<Equal<typeof ctx.rules.maximum, number>>;
  if (input.amount > ctx.rules.maximum) return fail(NotOpen());
  return ok({ events: [Deposited(input)], reply: { balance: state.balance + input.amount } });
});
// @ts-expect-error The command name must belong to the aggregate contract.
command(AccountContract, 'missing', () => ok({ events: [] }));
command(AccountContract, 'deposit',
  // @ts-expect-error Reply schemas are inherited from the selected command.
  () => ok({ events: [], reply: { balance: 'wrong' } }),
);
command(AccountContract, 'deposit',
  // @ts-expect-error Events from sibling commands are not allowed.
  () => ok({ events: [Opened()], reply: { balance: 0 } }),
);
command(AccountContract, 'deposit',
  // @ts-expect-error Rejections from sibling commands are not allowed.
  () => fail(AlreadyOpen()),
);
command(AccountContract, 'open',
  // @ts-expect-error A command without a reply schema cannot return a reply.
  () => ok({ events: [], reply: { balance: 0 } }),
);
// @ts-expect-error Child declarations cannot override aggregate state.
command({ state: State, commands: { open: { state: State, input: {}, events: [Opened] } } }, 'open', () => ok({ events: [] }));
const namedLimited = command(AccountContract, 'limited', effectify((state, input) => Effect.gen(function* () {
  type EffectState = Expect<Equal<typeof state.balance, number>>;
  type EffectInput = Expect<Equal<typeof input.amount, number>>;
  const rules = yield* effectify(Rules);
  if (input.amount > rules.maximum) return yield* Effect.fail(NotOpen());
  return { events: [Deposited(input)], reply: { balance: state.balance + input.amount } };
})));
command(AccountContract, 'limited',
  // @ts-expect-error Effect requirements must be declared by the selected command.
  effectify((state, input) => Effect.gen(function* () {
    yield* effectify(Other);
    return { events: [Deposited(input)], reply: { balance: state.balance + input.amount } };
  })),
);
const namedProgram = effectify(namedLimited)({ open: true, balance: 0 }, { amount: 10 });
type NamedRequirements = Expect<Equal<Effect.Services<typeof namedProgram>, Requirement<typeof Rules>>>;
// @ts-expect-error Named commands require the context declared in uses.
namedLimited({ open: true, balance: 0 }, { amount: 10 });
namedLimited({ open: true, balance: 0 }, { amount: 10 }, { rules: { maximum: 100 } });
// @ts-expect-error Native service implementations retain their schema.
namedLimited({ open: true, balance: 0 }, { amount: 10 }, { rules: { maximum: 'wrong' } });
async function namedCommandInference() {
  // @ts-expect-error Named command inputs retain their schema.
  namedDeposit({ open: true, balance: 0 }, { amount: 'wrong' });
  const [decision, error] = await namedDeposit({ open: true, balance: 0 }, { amount: 10 });
  // @ts-expect-error An unchecked decision is unknown.
  decision.reply;
  if (error !== null) {
    type RejectionInference = Expect<Equal<typeof error._tag, 'NotOpen' | 'InvalidInput' | 'Unexpected'>>;
    return;
  }
  type ReplyInference = Expect<Equal<typeof decision.reply.balance, number>>;
}
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
// @ts-expect-error Wiring requires all declared dependencies.
wire(LimitedBank);
wire(LimitedBank, { services: { rules: { maximum: 100 } } });
// @ts-expect-error Wiring validates dependency implementation types.
wire(LimitedBank, { services: { rules: { maximum: 'wrong' } } });

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

class ClassAccount extends aggregate('ClassAccount', { open: false, balance: 0 }) {
  open() {
    this.state.open = true;
    return ok(undefined);
  }

  async deposit(amount: number, note?: string) {
    if (!this.state.open) return fail(NotOpen());
    this.state.balance += amount;
    return ok({ balance: this.state.balance, note });
  }

  balance() {
    return this.state.balance;
  }
}
const classBank = wire(model('ClassBank', { aggregates: { account: ClassAccount } }));
const classAccount = ClassAccount.restore({ open: true, balance: 100 });
type ClassState = Expect<Equal<ReturnType<typeof classAccount.getState>, { open: boolean; balance: number }>>;
const freshClassAccount = ClassAccount.create();
type ClassCreate = Expect<Equal<typeof freshClassAccount, ClassAccount>>;
// @ts-expect-error Restoring uses the inferred initial state shape.
ClassAccount.restore({ open: true, balance: '100' });
// @ts-expect-error Base helpers are not runtime commands.
classBank.account.getState('a');
// @ts-expect-error Ordinary return values do not define managed methods.
classBank.account.balance('a');
// @ts-expect-error A runtime call prepends the aggregate ID.
classBank.account.deposit(100);
// @ts-expect-error Method parameters are inferred from the class.
classBank.account.deposit('a', '100');
classBank.account.deposit('a', 100);
async function classInference() {
  const [receipt, error] = await classBank.account.deposit('a', 100, 'test');
  // @ts-expect-error Check the error before using the receipt.
  receipt.reply;
  if (error === null) {
    type ClassReply = Expect<Equal<typeof receipt.reply, { balance: number; note: string | undefined }>>;
  } else {
    type ClassRejections = Expect<Equal<typeof error._tag, 'NotOpen' | 'InvalidInput' | 'Unexpected'>>;
  }
}

async function factoryInference() {
  const { Account, Bank } = await import('../examples/bank/domain.js');
  const bank = wire(Bank);
  const local = Account.create({ status: 'OPEN', balance: 100 });
  type SavedState = Expect<Equal<ReturnType<typeof local.getState>, { status: 'PENDING' | 'OPEN' | 'CLOSED'; balance: number }>>;
  // @ts-expect-error The factory state contains cents.
  Account.create({ status: 'OPEN', balance: { cents: 100 } });
  // @ts-expect-error Status is a literal union.
  Account.create({ status: 'ACTIVE', balance: 100 });
  // @ts-expect-error The deposit argument is inferred from the factory method.
  await bank.account.deposit('a', '100');
  const [receipt, error] = await bank.account.deposit('a', 100);
  if (error === null) {
    type FactoryReply = Expect<Equal<typeof receipt.reply, { balance: number }>>;
  } else {
    type FactoryErrors = Expect<Equal<typeof error._tag, 'NotOpen' | 'InvalidInput' | 'Unexpected'>>;
  }
}

class ValueBalance extends vo('ValueBalance', integer) {
  inc(amount: number): ValueBalance {
    return ValueBalance.of(this.value + amount);
  }
}
const valueBalance = ValueBalance.of(100);
const rawBalance = valueBalance.snapshot();
const projectedBalance = valueBalance.snapshot(cents => ({ cents }));
type ConstructedBalance = Expect<Equal<typeof valueBalance, ValueBalance>>;
type RawBalance = Expect<Equal<typeof rawBalance, number>>;
type ProjectedBalance = Expect<Equal<typeof projectedBalance, { cents: number }>>;
// @ts-expect-error The schema types the input to of().
ValueBalance.of('100');
