import {
  boolean, event, integer, refine, rejection, service, string,
  type Envelope, type Infer, type Result, type Unexpected,
} from '@marcelsud/accord';

export const Cents = refine(integer, value => value > 0, 'positive cents');
export const State = { open: boolean, balance: integer };
export const Balance = { balance: integer };
export const Opened = event('Opened');
export const Deposited = event('Deposited', { amount: Cents, balance: integer });
export const AlreadyOpen = rejection('AlreadyOpen');
export const NotOpen = rejection('NotOpen');
export const HttpFailure = rejection('HttpFailure', { status: integer });

export const openContract = { state: State, input: {}, events: [Opened], rejects: [AlreadyOpen] } as const;
export const depositContract = {
  state: State, input: { amount: Cents }, events: [Deposited], rejects: [NotOpen], reply: Balance,
} as const;
export const Notification = { eventId: string, accountId: string, amount: Cents, balance: integer };
export const Acknowledgement = { id: string };
export const httpContract = {
  input: Notification, reply: Acknowledgement, rejects: [HttpFailure],
  uses: { endpoint: service('SqliteHttp/Endpoint', { url: string }) },
} as const;

export const LedgerRow = { eventId: string, accountId: string, seq: integer, amount: Cents, balance: integer };
export type LedgerRow = Infer<typeof LedgerRow>;
export interface LedgerPort {
  record(rows: readonly LedgerRow[]): Result<void, Unexpected>;
}
export const LedgerStore = service('SqliteHttp/LedgerStore', {
  parse(value: unknown): LedgerPort {
    if (!value || typeof value !== 'object' || !('record' in value) || typeof value.record !== 'function') {
      throw new TypeError('Expected a ledger with record(rows)');
    }
    return value as LedgerPort;
  },
});
export function ledgerRows(batch: readonly Envelope<ReturnType<typeof Deposited>>[]): LedgerRow[] {
  return batch.map(({ id, source, seq, event }) => ({
    eventId: id, accountId: source.id, seq, amount: event.amount, balance: event.balance,
  }));
}
