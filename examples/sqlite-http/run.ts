import { startDummyEndpoint } from './dummy-http.js';
import { openLedger } from './sqlite.js';

const mode = process.argv[2] ?? 'pure';
if (mode !== 'pure' && mode !== 'effect') throw new Error('Choose pure or effect');
const filename = process.argv[3] ?? ':memory:';
const { createBank } = await import(mode === 'pure' ? './pure.js' : './with-effect.js');

await using endpoint = await startDummyEndpoint();
using ledger = openLedger(filename);
const [existing, readError] = ledger.list();
if (readError !== null) throw readError;
if (existing.length) throw new Error('Choose an empty ledger: this demo starts with fresh in-memory aggregate state');
const { bank } = createBank(ledger, endpoint.url);

const [, openError] = await bank.account.open('a-1', {});
if (openError !== null) throw openError;
const [receipt, error] = await bank.account.deposit('a-1', { amount: 100 }, { commandId: 'first-deposit' });
if (error !== null) throw error;
const [, deliveryError] = await bank.flush();
if (deliveryError !== null) throw deliveryError;
const [rows, queryError] = ledger.list('a-1');
if (queryError !== null) throw queryError;

console.log(`Mode: ${mode}`);
console.log(`SQLite: ${filename}`);
console.log(`Committed balance: ${receipt.reply.balance}`);
console.table(rows);
console.log(`HTTP notifications: ${endpoint.received.size}`);
