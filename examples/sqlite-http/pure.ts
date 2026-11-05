import {
  aggregate, command, external, fail, host, match, memory, model, ok, parse, policy, projection, trycatch,
} from '@marcelsud/accord';
import {
  Acknowledgement, AlreadyOpen, Deposited, HttpFailure, LedgerStore, NotOpen, Opened, State,
  depositContract, httpContract, ledgerRows, openContract, type LedgerPort,
} from './domain.js';

const open = command(openContract, state => {
  if (state.open) return fail(AlreadyOpen());
  return ok({ events: [Opened()] });
});
const deposit = command(depositContract, (state, { amount }) => {
  if (!state.open) return fail(NotOpen());
  const balance = state.balance + amount;
  return ok({ events: [Deposited({ amount, balance })], reply: { balance } });
});
const Account = aggregate(
  'Account', { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open, deposit } },
  (state, event) => match(event, {
    Opened: () => ({ ...state, open: true }),
    Deposited: ({ balance }) => ({ ...state, balance }),
  }),
);
const Notify = external('SqliteHttp/Notify', httpContract, async (input, { endpoint, signal }) => {
  const [response, error] = await trycatch(() => fetch(endpoint.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': encodeURIComponent(input.eventId) },
    body: JSON.stringify(input),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
  }));
  if (error !== null) return fail(error);
  if (!response.ok) {
    const [, bodyError] = await trycatch(() => response.arrayBuffer());
    if (bodyError !== null) return fail(bodyError);
    return fail(HttpFailure({ status: response.status }));
  }
  return trycatch(async () => parse(Acknowledgement, await response.json()));
});
const LedgerProjection = projection(
  'Ledger', { from: Account, on: [Deposited], uses: { ledger: LedgerStore }, batch: { size: 100 } },
  (batch, { ledger }) => ledger.record(ledgerRows(batch)),
);
const NotifyDeposit = policy(
  'NotifyDeposit', { from: Account, on: [Deposited], uses: { notify: Notify } },
  ({ id, source, event }, { notify }) => notify({
    eventId: id, accountId: source.id, amount: event.amount, balance: event.balance,
  }),
);
const Bank = model('SqliteHttpBank', {
  aggregates: { account: Account }, projections: [LedgerProjection], policies: [NotifyDeposit],
});
export function createBank(ledger: LedgerPort, url: string, storage = memory()) {
  const notify = Notify.implement({ endpoint: { url } });
  const bank = host(Bank, { storage, services: { ledger, notify } });
  return { bank, notify, projection: LedgerProjection };
}
