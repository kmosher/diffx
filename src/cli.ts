#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import getPort from 'get-port'
import { isGitRepo } from './git.js'
import { startServer } from './server.js'

const { values, positionals } = parseArgs({
  options: {
    port: { type: 'string', short: 'p' },
    'no-open': { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

// Everything after -- becomes custom git diff args
const customDiffArgs = positionals.length > 0 ? positionals : undefined

if (!isGitRepo()) {
  console.error('Error: not inside a git repository')
  process.exit(1)
}

const preferredPort = values.port ? parseInt(values.port, 10) : 3433
const port = await getPort({ port: preferredPort })

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientDir = resolve(__dirname, 'client')
const { existsSync } = await import('node:fs')
const resolvedClientDir = existsSync(clientDir)
  ? clientDir
  : resolve(process.cwd(), 'dist/client')

const { port: actualPort } = await startServer({ port, clientDir: resolvedClientDir, customDiffArgs })

console.log(`diffx server running at http://localhost:${actualPort}`)

if (!values['no-open']) {
  const openModule = await import('open')
  const url = `http://localhost:${actualPort}`
  openModule.default(url)
}

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  process.exit(0)
})
