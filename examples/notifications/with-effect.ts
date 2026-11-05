import { Effect } from "effect";
import { effectify } from "@marcelsud/accord/effect";
import {
  aggregate,
  command,
  wire,
  match,
  memory,
  model,
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
  DepositContract,
  ledgerRows,
  OpenContract,
  type LedgerPort,
  type NotificationPort,
} from "./domain.js";

const open = command(
  OpenContract,
  effectify((state) =>
    Effect.gen(function* () {
      if (state.open) return yield* Effect.fail(AlreadyOpen());
      return { events: [Opened()] };
    }),
  ),
);
const deposit = command(
  DepositContract,
  effectify((state, { amount }) =>
    Effect.gen(function* () {
      if (!state.open) return yield* Effect.fail(NotOpen());
      const balance = state.balance + amount;
      return { events: [Deposited({ amount, balance })], reply: { balance } };
    }),
  ),
);
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
  effectify((batch) =>
    Effect.gen(function* () {
      const ledger = yield* effectify(LedgerStore);
      const [, error] = ledger.record(ledgerRows(batch));
      if (error !== null) return yield* Effect.fail(error);
      return undefined;
    }),
  ),
);
const NotifyDeposit = policy(
  "NotifyDeposit",
  { from: Account, on: [Deposited], uses: { notifications: Notifications } },
  effectify((envelope) =>
    Effect.gen(function* () {
      const notifications = yield* effectify(Notifications);
      const [, error] = yield* Effect.promise((signal) =>
        notifications.send(
          {
            eventId: envelope.id,
            accountId: envelope.source.id,
            amount: envelope.event.amount,
            balance: envelope.event.balance,
          },
          { signal },
        ),
      );
      if (error !== null) return yield* Effect.fail(error);
      return undefined;
    }),
  ),
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
  const bank = wire(Bank, { storage, services: { ledger, notifications } });
  return { bank, projection: LedgerProjection };
}
