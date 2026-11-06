import { wire } from "@marcelsud/accord";
import { Account, Bank } from "./domain.js";

const bank = wire(Bank);
const id = "a-1";
const [, openError] = await bank.account.open(id);
if (openError !== null) throw openError;
const [receipt, error] = await bank.account.deposit(id, 100);
if (error !== null) throw error;
const [summary, readError] = await bank.summary.get(id, {
  atLeast: receipt,
});
if (readError !== null) throw readError;
console.log("Balance view:", summary); // { balance: 100 }

const [state, stateError] = await bank.account.get(id);
if (stateError !== null) throw stateError;

const preview = Account.restore(state);
const [reply, previewError] = preview.deposit(50);
if (previewError !== null) throw previewError;
console.log("Standalone preview:", reply); // { balance: 150 }
console.log("Pending events:", preview.pullEvents());
