import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregate, event, model, ok, string, wire } from '@marcelsud/accord'
import { sqlite } from '@marcelsud/accord/sqlite'

const Borrowed = event('Borrowed', { memberId: string })

class Copy extends aggregate('Copy', { holder: null as string | null }) {
  borrow(memberId: string) {
    this.state.holder = memberId
    this.emit(Borrowed({ memberId }))
    return ok({ memberId })
  }
}

const Lending = model('Lending', { aggregates: { copy: Copy } })
const dir = mkdtempSync(join(tmpdir(), 'accord-lending-'))
const file = join(dir, 'lending.sqlite')

try {
  {
    using storage = sqlite(file)
    const lending = wire(Lending, { storage })
    const [receipt, error] = await lending.copy.borrow('copy-1', 'ada')
    if (error !== null) throw error
    const [history, historyError] = await lending.copy.events('copy-1')
    if (historyError !== null) throw historyError
    if (history.length !== 1 || history[0]?.id !== receipt.events[0]?.id) throw new Error('history')
  }

  {
    using storage = sqlite(file)
    const lending = wire(Lending, { storage })
    const [state, error] = await lending.copy.get('copy-1')
    if (error !== null) throw error
    if (state.holder !== 'ada') throw new Error('reopen')
    const [missing, missingError] = await lending.copy.get('copy-2')
    if (missingError !== null) throw missingError
    if (missing.holder !== null) throw new Error('default')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
