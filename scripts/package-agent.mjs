import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const archive = path.join(releaseDir, 'EasTV-Agent-Bridge.zip')
const publicDownloadDir = path.join(root, 'public', 'downloads')
const publicArchive = path.join(publicDownloadDir, 'EasTV-Agent-Bridge.zip')
mkdirSync(releaseDir, { recursive: true })
rmSync(archive, { force: true })
rmSync(publicArchive, { force: true })

const files = [
  '.codex-plugin', '.mcp.json', 'AGENT-INTEGRATION.md', 'LICENSE',
  'README.md', 'README.en.md', 'assets', 'eastv-agent.bat', 'index.html',
  'install-agent.bat', 'mcp', 'package.json', 'package-lock.json', 'public',
  'scripts', 'skills', 'src', 'start-web.bat', 'vite.config.js'
]
const result = spawnSync('tar.exe', ['-a', '-c', '-f', archive, '--exclude=public/downloads', ...files], {
  cwd: root,
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status || 1)
mkdirSync(publicDownloadDir, { recursive: true })
copyFileSync(archive, publicArchive)
console.log(`[EasTV] Created ${archive}`)
console.log(`[EasTV] Web download ready at ${publicArchive}`)
