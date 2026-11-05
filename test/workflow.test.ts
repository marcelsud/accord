import assert from 'node:assert/strict';
import test from 'node:test';
import { fail, host, integer, memory, model, ok, rejection, string, workflow } from '../src/index.js';
import { Account, NotOpen } from './fixtures.js';
import { failure, success } from './helpers.js';

const Failed = rejection('Failed');

test('workflow steps checkpoint results, deduplicate runs, and pass stable operation identities', async () => {
  let executions = 0;
  const ids: string[] = [];
  const Job = workflow('Job', { input: { id: string, amount: integer }, reply: { value: integer }, key: input => input.id }, async (input, run) => {
    const [value, error] = await run.step('compute', meta => {
      executions++;
      ids.push(meta.commandId);
      assert.equal(meta.commandId, meta.idempotencyKey);
      return ok(input.amount * 2);
    });
    if (error !== null) return fail(error);
    return ok({ value });
  });
  const storage = memory();
  const definition = model('Jobs', { aggregates: { account: Account }, workflows: { job: Job } });
  const bank = host(definition, { storage });
  const results = await Promise.all([bank.workflows.job({ id: 'one', amount: 5 }), bank.workflows.job({ id: 'one', amount: 5 })]);
  assert.deepEqual(success(results[0]!), { value: 10 });
  assert.deepEqual(success(results[1]!), { value: 10 });
  assert.equal(executions, 1);
  assert.equal(ids.length, 1);
  assert.equal(failure(await bank.workflows.job({ id: 'one', amount: 6 }))._tag, 'CommandConflict');
  const restarted = host(definition, { storage });
  assert.deepEqual(success(await restarted.workflows.job({ id: 'one', amount: 5 })), { value: 10 });
  assert.equal(executions, 1);
});

test('workflow failures compensate successful steps in reverse order', async () => {
  const trace: string[] = [];
  const Job = workflow('Compensating', { input: { id: string }, reply: {}, key: input => input.id, rejects: [Failed] }, async (_input, run) => {
    const [, firstError] = await run.step('first', () => { trace.push('first'); return ok(1); }, {
      compensate: value => { trace.push(`undo:${value}`); return ok(undefined); },
    });
    if (firstError !== null) return fail(firstError);
    const [, secondError] = await run.step('second', () => { trace.push('second'); return ok(2); }, {
      compensate: value => { trace.push(`undo:${value}`); return ok(undefined); },
    });
    if (secondError !== null) return fail(secondError);
    return fail(Failed());
  });
  const bank = host(model('Compensation', { aggregates: { account: Account }, workflows: { job: Job } }));
  assert.equal(failure(await bank.workflows.job({ id: 'one' }))._tag, 'Failed');
  assert.deepEqual(trace, ['first', 'second', 'undo:2', 'undo:1']);
  assert.equal(failure(await bank.workflows.job({ id: 'one' }))._tag, 'Failed');
  assert.equal(trace.length, 4);
});

test('failed compensations stay pending and retry without rerunning successful steps', async () => {
  let steps = 0;
  let compensations = 0;
  const Job = workflow('RetryUndo', { input: { id: string }, reply: {}, key: input => input.id, rejects: [Failed] }, async (_input, run) => {
    const [, error] = await run.step('charge', () => { steps++; return ok(1); }, {
      compensate: () => { compensations++; return compensations === 1 ? fail(NotOpen()) : ok(undefined); },
    });
    if (error !== null) return fail(error);
    return fail(Failed());
  });
  const bank = host(model('RetryCompensation', { aggregates: { account: Account }, workflows: { job: Job } }));
  assert.equal(failure(await bank.workflows.job({ id: 'one' }))._tag, 'Unexpected');
  assert.equal(failure(await bank.workflows.job({ id: 'one' }))._tag, 'Failed');
  assert.equal(steps, 1);
  assert.equal(compensations, 2);
});

test('workflow signals can arrive before wait and timers use named checkpoints', async () => {
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const Job = workflow('Wait', { input: { id: string }, reply: { approved: string }, key: input => input.id }, async (_input, run) => {
    ready();
    const [approved, error] = await run.wait('approval', string);
    if (error !== null) return fail(error);
    const [, timerError] = await run.sleep('delay', 1);
    if (timerError !== null) return fail(timerError);
    return ok({ approved });
  });
  const bank = host(model('Waiting', { aggregates: { account: Account }, workflows: { job: Job } }));
  const pending = bank.workflows.job({ id: 'one' });
  await started;
  success(await bank.workflows.job.signal('one', 'approval', 'yes'));
  assert.deepEqual(success(await pending), { approved: 'yes' });
});

test('interrupted workflows resume from successful steps', async () => {
  let steps = 0;
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const Job = workflow('Resume', { input: { id: string }, reply: { value: string }, key: input => input.id }, async (_input, run) => {
    const [, stepError] = await run.step('once', () => { steps++; return ok(1); });
    if (stepError !== null) return fail(stepError);
    ready();
    const [value, error] = await run.wait('approval', string);
    if (error !== null) return fail(error);
    return ok({ value });
  });
  const bank = host(model('Resuming', { aggregates: { account: Account }, workflows: { job: Job } }));
  const controller = new AbortController();
  const interrupted = bank.workflows.job({ id: 'one' }, { signal: controller.signal });
  await started;
  controller.abort();
  assert.equal(failure(await interrupted)._tag, 'Unexpected');
  success(await bank.workflows.job.signal('one', 'approval', 'yes'));
  assert.deepEqual(success(await bank.workflows.job({ id: 'one' })), { value: 'yes' });
  assert.equal(steps, 1);
});

test('cached workflow defects retain their Unexpected tag and original cause', async () => {
  const cause = Symbol('original');
  const Job = workflow('Defect', { input: { id: string }, reply: {}, key: input => input.id }, () => { throw cause; });
  const bank = host(model('DefectiveJob', { aggregates: { account: Account }, workflows: { job: Job } }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const error = failure(await bank.workflows.job({ id: 'one' }));
    assert.equal(error._tag, 'Unexpected');
    if (error._tag === 'Unexpected') assert.equal(error.cause, cause);
  }
});
