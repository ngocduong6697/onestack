#!/usr/bin/env node
/**
 * Scans tracked files for things that look like credentials.
 *
 * Review does not reliably catch a pasted key — it looks like any other
 * string, and the person who pasted it is the person reading the diff. This
 * is deliberately narrow: patterns with a recognisable prefix and enough
 * entropy to be a real secret, rather than anything resembling a password,
 * which would fire on every fixture and be turned off within a week.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'Google API key', re: /AIza[A-Za-z0-9_-]{35}/ },
  { name: 'AWS access key id', re: /AKIA[A-Z0-9]{16}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Slack token', re: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Postgres URL with a password', re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/]+@/ },
]

/**
 * Placeholders that exist to be read, not used. `.env.example` carries names
 * with empty values on purpose, and the docs quote fake keys to explain what
 * not to commit.
 */
const ALLOWED = [
  /postgres:\/\/(?:user|onestack|\$\{?USER)/,
  /sk-ant-not-a-real-key/,
  /sk-ant-real\b/,
  /sk-secret\b/,
  /password@/,
  // The fixture in domain-exception.filter.test.ts, which exists precisely to
  // assert that a connection string never reaches a response.
  /postgres:\/\/u:pw@db/,
]

const IGNORED_PATHS = [
  /^node_modules\//,
  /^\.git\//,
  /\.(png|jpg|jpeg|gif|ico|pdf|lock)$/,
  /yarn\.lock$/,
]

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((path) => !IGNORED_PATHS.some((re) => re.test(path)))
}

const findings = []

for (const path of trackedFiles()) {
  let contents
  try {
    if (statSync(path).size > 2_000_000) continue
    contents = readFileSync(path, 'utf8')
  } catch {
    continue
  }

  for (const [index, line] of contents.split('\n').entries()) {
    if (ALLOWED.some((re) => re.test(line))) continue

    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        findings.push({ path, line: index + 1, name })
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Possible credentials in tracked files:\n')
  for (const finding of findings) {
    console.error(`  ${finding.path}:${finding.line}  ${finding.name}`)
  }
  console.error('\nIf one of these is a placeholder, add it to ALLOWED in this script.')
  process.exit(1)
}

console.log(`No credentials found in ${trackedFiles().length} tracked files.`)
