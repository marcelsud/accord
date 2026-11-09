import { sqlite } from '../../src/sqlite.js';
import { durableBank } from './durable-bank.js';
import { success } from '../helpers.js';

const storage = sqlite(process.argv[2]!);
const mode = process.argv[3];
const bank = durableBank(storage, mode === 'during-write' ? () => process.exit(42) : undefined);
if (mode === 'before-flush') {
  success(await bank.account.open('a', {}));
  success(await bank.account.deposit('a', { amount: 100 }));
} else {
  success(await bank.flush());
}
// Deliberately exit without disposing the connection, including an open transaction.
process.exit(42);
