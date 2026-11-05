import {
  aggregate,
  command,
  event,
  fail,
  host,
  integer,
  match,
  model,
  ok,
  refine,
  rejection,
  s,
  view,
} from "@marcelsud/accord";

export const Cents = refine(integer, (value) => value > 0, "positive cents");
export const State = s.object({ open: s.boolean, balance: integer });
export const Balance = { balance: integer };
export const Opened = event("Opened");
export const Deposited = event("Deposited", { amount: Cents });
export const AlreadyOpen = rejection("AlreadyOpen");
export const NotOpen = rejection("NotOpen");

export const open = command(
  { state: State, input: {}, events: [Opened], rejects: [AlreadyOpen] },
  (state) => {
    if (state.open) return fail(AlreadyOpen());
    return ok({ events: [Opened()] });
  },
);
export const deposit = command(
  {
    state: State,
    input: { amount: Cents },
    events: [Deposited],
    rejects: [NotOpen],
    reply: Balance,
  },
  (state, { amount }) => {
    if (!state.open) return fail(NotOpen());
    return ok({
      events: [Deposited({ amount })],
      reply: { balance: state.balance + amount },
    });
  },
);
export const Account = aggregate(
  "Account",
  {
    state: State,
    initial: () => ({ open: false, balance: 0 }),
    commands: { open, deposit },
  },
  (state, event) =>
    match(event, {
      Opened: () => ({ ...state, open: true }),
      Deposited: ({ amount }) => ({
        ...state,
        balance: state.balance + amount,
      }),
    }),
);
export const Summary = view(
  "Summary",
  {
    from: Account,
    on: [Deposited],
    state: Balance,
    initial: () => ({ balance: 0 }),
  },
  (state, event) => ({ balance: state.balance + event.amount }),
);
export const Bank = model("Bank", {
  aggregates: { account: Account },
  views: { summary: Summary },
});

const bank = host(Bank);
const [, openError] = await bank.account.open("a-1", {});
if (openError !== null) throw openError;
const [receipt, error] = await bank.account.deposit(
  "a-1",
  { amount: 100 },
  { commandId: "first-deposit" },
);
if (error !== null) throw error;
const [summary, readError] = await bank.summary.get("a-1", {
  atLeast: receipt,
});
if (readError !== null) throw readError;
console.log(summary); // { balance: 100 }
