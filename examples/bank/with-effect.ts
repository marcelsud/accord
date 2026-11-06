import { Effect } from "effect";
import { effectify } from "@marcelsud/accord/effect";
import { integer, rejection, service, wire } from "@marcelsud/accord";
import { Bank } from "./domain.js";

const DepositRules = service("DepositRules", { maximum: integer });
const DepositLimit = rejection("DepositLimit");
const bank = wire(Bank);

const program = Effect.gen(function* () {
  const rules = yield* effectify(DepositRules);
  const amount = 100;
  if (amount > rules.maximum) return yield* Effect.fail(DepositLimit());

  const [, openError] = yield* Effect.promise(() => bank.account.open("a-1"));
  if (openError !== null) return yield* Effect.fail(openError);

  const [receipt, error] = yield* Effect.promise(() =>
    bank.account.deposit("a-1", amount),
  );
  if (error !== null) return yield* Effect.fail(error);
  return receipt.reply.balance;
});

const balance = await Effect.runPromise(
  Effect.provideService(program, effectify(DepositRules), { maximum: 1_000 }),
);
console.log(balance); // 100
