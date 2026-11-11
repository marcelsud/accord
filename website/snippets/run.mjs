import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(join(here, 'ddd')).filter((name) => name.endsWith('.ts')).sort()

for (const file of files) {
  const path = join(here, 'ddd', file)
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--import', join(here, 'register.mjs'), path], {
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', resolve)
  })
  if (code !== 0) {
    console.error(`${file} exited ${code}`)
    process.exit(code ?? 1)
  }
}
