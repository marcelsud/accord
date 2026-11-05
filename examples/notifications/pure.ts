import {
  aggregate,
  command,
  fail,
  host,
  match,
  memory,
  model,
  ok,
  policy,
  projection,
} from "@marcelsud/accord";
import {
  AlreadyOpen,
  Deposited,
  LedgerStore,
  NotOpen,
  Notifications,
  Opened,
  State,
  depositContract,
  ledgerRows,
  openContract,
  type LedgerPort,
  type NotificationPort,
} from "./domain.js";

const open = command(openContract, (state) => {
  if (state.open) return fail(AlreadyOpen());
  return ok({ events: [Opened()] });
});
const deposit = command(depositContract, (state, { amount }) => {
  if (!state.open) return fail(NotOpen());
  const balance = state.balance + amount;
  return ok({ events: [Deposited({ amount, balance })], reply: { balance } });
});
const Account = aggregate(
  "Account",
  {
    state: State,
    initial: () => ({ open: false, balance: 0 }),
    commands: { open, deposit },
  },
  (state, event) =>
    match(event, {
      Opened: () => ({ ...state, open: true }),
      Deposited: ({ balance }) => ({ ...state, balance }),
    }),
);
const LedgerProjection = projection(
  "Ledger",
  {
    from: Account,
    on: [Deposited],
    uses: { ledger: LedgerStore },
    batch: { size: 100 },
  },
  (batch, { ledger }) => ledger.record(ledgerRows(batch)),
);
const NotifyDeposit = policy(
  "NotifyDeposit",
  { from: Account, on: [Deposited], uses: { notifications: Notifications } },
  ({ id, source, event }, { notifications }) =>
    notifications.send({
      eventId: id,
      accountId: source.id,
      amount: event.amount,
      balance: event.balance,
    }),
);
const Bank = model("Bank", {
  aggregates: { account: Account },
  projections: [LedgerProjection],
  policies: [NotifyDeposit],
});
export function createBank(
  ledger: LedgerPort,
  notifications: NotificationPort,
  storage = memory(),
) {
  const bank = host(Bank, { storage, services: { ledger, notifications } });
  return { bank, projection: LedgerProjection };
}
