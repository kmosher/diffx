import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { getGitDiff, getCustomGitDiff, getRepoName, getBranchName } from './git.js'
import { loadSettings, saveSettings } from './settings.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

export function createApp(clientDir: string, customDiffArgs?: string[]) {
  const app = new Hono()
  const isCustomMode = !!customDiffArgs

  app.get('/api/diff', (c) => {
    let patch: string
    if (isCustomMode) {
      patch = getCustomGitDiff(customDiffArgs)
    } else {
      const staged = c.req.query('staged') === 'true'
      const untracked = c.req.query('untracked') === 'true'
      patch = getGitDiff({ staged, untracked })
    }
    const repoName = getRepoName()
    const branch = getBranchName()
    return c.json({ patch, repoName, branch, customMode: isCustomMode })
  })

  app.get('/api/settings', (c) => {
    return c.json(loadSettings())
  })

  app.put('/api/settings', async (c) => {
    const body = await c.req.json()
    const settings = saveSettings(body)
    return c.json(settings)
  })

  app.get('/*', async (c) => {
    let filePath = c.req.path
    if (filePath === '/') filePath = '/index.html'

    const fullPath = join(clientDir, filePath)
    try {
      const content = await readFile(fullPath)
      const ext = extname(fullPath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      })
    } catch {
      const indexContent = await readFile(join(clientDir, 'index.html'))
      return new Response(indexContent, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  })

  return app
}

export function startServer(options: {
  port: number
  clientDir: string
  customDiffArgs?: string[]
}): Promise<{ port: number }> {
  const app = createApp(options.clientDir, options.customDiffArgs)

  return new Promise((resolve) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port,
    }, (info) => {
      resolve({ port: info.port })
    })
  })
}
