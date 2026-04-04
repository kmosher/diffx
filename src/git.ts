import { execSync } from 'node:child_process'
import { basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function getRepoRoot(): string {
  return execSync('git rev-parse --show-toplevel', {
    encoding: 'utf-8',
  }).trim()
}

export function getRepoName(): string {
  return basename(getRepoRoot())
}

export function getBranchName(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

export function getCustomGitDiff(args: string[]): string {
  const cmd = ['git', 'diff', ...args].join(' ')
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
}

export function getGitDiff(options: { staged?: boolean; untracked?: boolean } = {}): string {
  const parts: string[] = []

  // unstaged changes (always included as the base)
  const unstaged = execSync('git diff', { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  if (unstaged) parts.push(unstaged)

  // staged changes
  if (options.staged) {
    const staged = execSync('git diff --staged', { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
    if (staged) parts.push(staged)
  }

  // untracked files
  if (options.untracked) {
    const untrackedPatch = getUntrackedFilesDiff()
    if (untrackedPatch) parts.push(untrackedPatch)
  }

  return parts.join('\n')
}

function getUntrackedFilesDiff(): string {
  const root = getRepoRoot()
  const output = execSync('git ls-files --others --exclude-standard', {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  }).trim()

  if (!output) return ''

  const files = output.split('\n')
  const patches: string[] = []

  for (const file of files) {
    try {
      const content = readFileSync(join(root, file), 'utf-8')
      const lines = content.split('\n')
      const diffLines = lines.map((line) => `+${line}`)
      const patch = [
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        'index 0000000..0000001',
        '--- /dev/null',
        `+++ b/${file}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...diffLines,
      ].join('\n')
      patches.push(patch)
    } catch {
      // skip binary or unreadable files
    }
  }

  return patches.length > 0 ? '\n' + patches.join('\n') : ''
}
