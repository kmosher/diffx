#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { isGitRepo } from './git.js'
import { startServer } from './server.js'

const { values } = parseArgs({
  options: {
    staged: { type: 'boolean', short: 's', default: false },
    port: { type: 'string', short: 'p', default: '4277' },
    'no-open': { type: 'boolean', default: false },
  },
})

const port = parseInt(values.port!, 10)

if (!isGitRepo()) {
  console.error('Error: not inside a git repository')
  process.exit(1)
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientDir = resolve(__dirname, 'client')

startServer({ port, clientDir })

console.log(`udiff server running at http://localhost:${port}`)

if (!values['no-open']) {
  const openModule = await import('open')
  const url = `http://localhost:${port}${values.staged ? '?staged=true' : ''}`
  openModule.default(url)
}

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  process.exit(0)
})
