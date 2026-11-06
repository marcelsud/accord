import { Effect, Layer } from "effect";
import { effectify } from "@marcelsud/accord/effect";
import { Bank, DepositRules } from "./domain.js";

const RulesLive = Layer.succeed(effectify(DepositRules), { maximum: 1_000 });

const program = Effect.gen(function* () {
  const bank = yield* effectify(Bank);
  const id = "a-1";

  yield* bank.account.open(id);
  const receipt = yield* bank.account.deposit(id, 100);
  return yield* bank.summary.get(id, { atLeast: receipt });
});

const summary = await Effect.runPromise(Effect.provide(program, RulesLive));
console.log(summary); // { balance: 100 }
