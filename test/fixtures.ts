import { aggregate, command, event, fail, integer, match, model, ok, refine, rejection, s, view } from '../src/index.js';

export const Cents = refine(integer, value => value > 0, 'positive cents');
export const State = s.object({ open: s.boolean, balance: integer });
export const Balance = { balance: integer };
export const Opened = event('Opened');
export const Deposited = event('Deposited', { amount: Cents });
export const Withdrawn = event('Withdrawn', { amount: Cents });
export const AlreadyOpen = rejection('AlreadyOpen');
export const NotOpen = rejection('NotOpen');
export const InsufficientFunds = rejection('InsufficientFunds', { balance: integer, requested: Cents });
export const open = command(
  { state: State, input: {}, events: [Opened], rejects: [AlreadyOpen] },
  state => {
    if (state.open) return fail(AlreadyOpen());
    return ok({ events: [Opened()] });
  },
);
export const deposit = command(
  { state: State, input: { amount: Cents }, events: [Deposited], rejects: [NotOpen], reply: Balance },
  (state, { amount }) => {
    if (!state.open) return fail(NotOpen());
    return ok({ events: [Deposited({ amount })], reply: { balance: state.balance + amount } });
  },
);
export const withdraw = command(
  { state: State, input: { amount: Cents }, events: [Withdrawn], rejects: [NotOpen, InsufficientFunds], reply: Balance },
  (state, { amount }) => {
    if (!state.open) return fail(NotOpen());
    if (amount > state.balance) return fail(InsufficientFunds({ balance: state.balance, requested: amount }));
    return ok({ events: [Withdrawn({ amount })], reply: { balance: state.balance - amount } });
  },
);
export const Account = aggregate(
  'Account', { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open, deposit, withdraw } },
  (state, event) => match(event, {
    Opened: () => ({ ...state, open: true }),
    Deposited: ({ amount }) => ({ ...state, balance: state.balance + amount }),
    Withdrawn: ({ amount }) => ({ ...state, balance: state.balance - amount }),
  }),
);
export const Summary = view(
  'Summary', { from: Account, on: [Deposited, Withdrawn], state: Balance, initial: () => ({ balance: 0 }) },
  (state, event) => match(event, {
    Deposited: ({ amount }) => ({ balance: state.balance + amount }),
    Withdrawn: ({ amount }) => ({ balance: state.balance - amount }),
  }),
);
export const Bank = model('Bank', { aggregates: { account: Account }, views: { summary: Summary } });
