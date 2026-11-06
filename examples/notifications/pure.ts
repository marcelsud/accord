import { wire, memory, model, policy, projection } from "@marcelsud/accord";
import {
  Account,
  Deposited,
  LedgerStore,
  Notifications,
  ledgerRows,
  type LedgerPort,
  type NotificationPort,
} from "./domain.js";

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
  const bank = wire(Bank, { storage, services: { ledger, notifications } });
  return { bank, projection: LedgerProjection };
}
