import { execSync } from 'node:child_process'
import { basename } from 'node:path'

export function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function getRepoName(): string {
  const root = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf-8',
  }).trim()
  return basename(root)
}

export function getGitDiff(options: { staged?: boolean } = {}): string {
  const args = ['git', 'diff']
  if (options.staged) {
    args.push('--staged')
  }
  return execSync(args.join(' '), { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
}
