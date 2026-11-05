import { Effect } from 'effect';
import { effectify } from '@marcelsud/accord/effect';
import { aggregate, command, external, host, match, memory, model, parse, policy, projection, unexpected } from '@marcelsud/accord';
import {
  Acknowledgement, AlreadyOpen, Deposited, HttpFailure, LedgerStore, NotOpen, Opened, State,
  depositContract, httpContract, ledgerRows, openContract, type LedgerPort,
} from './domain.js';

const open = command(openContract, effectify(state => Effect.gen(function* () {
  if (state.open) return yield* Effect.fail(AlreadyOpen());
  return { events: [Opened()] };
})));
const deposit = command(depositContract, effectify((state, { amount }) => Effect.gen(function* () {
  if (!state.open) return yield* Effect.fail(NotOpen());
  const balance = state.balance + amount;
  return { events: [Deposited({ amount, balance })], reply: { balance } };
})));
const Account = aggregate(
  'Account', { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open, deposit } },
  (state, event) => match(event, {
    Opened: () => ({ ...state, open: true }),
    Deposited: ({ balance }) => ({ ...state, balance }),
  }),
);
const Notify = external('SqliteHttp/Notify', httpContract, effectify(input => Effect.gen(function* () {
  const endpoint = yield* effectify(httpContract.uses.endpoint);
  const response = yield* Effect.tryPromise({
    try: signal => fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': encodeURIComponent(input.eventId) },
      body: JSON.stringify(input),
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    }),
    catch: unexpected,
  });
  if (!response.ok) {
    yield* Effect.tryPromise({ try: () => response.arrayBuffer(), catch: unexpected });
    return yield* Effect.fail(HttpFailure({ status: response.status }));
  }
  const json: unknown = yield* Effect.tryPromise({ try: () => response.json(), catch: unexpected });
  return parse(Acknowledgement, json);
})));
const LedgerProjection = projection(
  'Ledger', { from: Account, on: [Deposited], uses: { ledger: LedgerStore }, batch: { size: 100 } },
  effectify(batch => Effect.gen(function* () {
    const ledger = yield* effectify(LedgerStore);
    const [, error] = ledger.record(ledgerRows(batch));
    if (error !== null) return yield* Effect.fail(error);
    return undefined;
  })),
);
const NotifyDeposit = policy(
  'NotifyDeposit', { from: Account, on: [Deposited], uses: { notify: Notify } },
  effectify(envelope => Effect.gen(function* () {
    const notify = yield* effectify(Notify);
    const [, error] = yield* Effect.promise(signal => notify({
      eventId: envelope.id, accountId: envelope.source.id,
      amount: envelope.event.amount, balance: envelope.event.balance,
    }, { signal }));
    if (error !== null) return yield* Effect.fail(error);
    return undefined;
  })),
);
const Bank = model('SqliteHttpBank', {
  aggregates: { account: Account }, projections: [LedgerProjection], policies: [NotifyDeposit],
});
export function createBank(ledger: LedgerPort, url: string, storage = memory()) {
  const notify = Notify.implement({ endpoint: { url } });
  const bank = host(Bank, { storage, services: { ledger, notify } });
  return { bank, notify, projection: LedgerProjection };
}
