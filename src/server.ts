import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { getGitDiff, getRepoName } from './git.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

export function createApp(clientDir: string) {
  const app = new Hono()

  app.get('/api/diff', (c) => {
    const staged = c.req.query('staged') === 'true'
    const patch = getGitDiff({ staged })
    const repoName = getRepoName()
    return c.json({ patch, repoName })
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
      // SPA fallback: serve index.html for unmatched routes
      const indexContent = await readFile(join(clientDir, 'index.html'))
      return new Response(indexContent, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  })

  return app
}

export function startServer(options: { port: number; clientDir: string }) {
  const app = createApp(options.clientDir)

  const server = serve({
    fetch: app.fetch,
    port: options.port,
  })

  return server
}
