import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const launcher = path.join(root, 'scripts', 'start-mcp.mjs')
const [command = 'help', target = ''] = process.argv.slice(2)

function run(program, args, options = {}) {
  return spawnSync(program, args, { cwd: root, stdio: 'inherit', shell: false, ...options })
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`
}

function doctor() {
  console.log('[EasTV] Agent Bridge doctor')
  console.log(`  Project: ${root}`)
  console.log(`  Node: ${process.version}`)
  console.log(`  MCP server: ${existsSync(launcher) ? 'OK' : 'MISSING'}`)
  console.log(`  Dependencies: ${existsSync(path.join(root, 'node_modules', '@modelcontextprotocol', 'sdk')) ? 'OK' : 'will install on first start'}`)
  return existsSync(launcher) ? 0 : 1
}

function installCodex() {
  const probe = spawnSync('codex', ['--version'], { shell: true, stdio: 'ignore' })
  if (probe.status !== 0) {
    console.error('[EasTV] Codex CLI was not found in PATH.')
    console.error(`Run this command in your Agent MCP settings:\nnode ${quote(launcher)}`)
    return 1
  }
  console.log('[EasTV] Registering the portable MCP server as "eastv"...')
  const result = run('codex', ['mcp', 'add', 'eastv', '--', process.execPath, launcher], { shell: true })
  if (result.status !== 0) {
    console.error('[EasTV] Automatic registration failed. You can still use the bundled .mcp.json.')
    return result.status || 1
  }
  console.log('[EasTV] Registered successfully.')
  return 0
}

let status = 0
if (command === 'mcp') {
  await import(new URL('./start-mcp.mjs', import.meta.url))
} else if (command === 'doctor') {
  status = doctor()
} else if (command === 'install' && target.toLowerCase() === 'codex') {
  status = installCodex()
} else {
  console.log(`EasTV Agent Bridge\n\nUsage:\n  eastv-agent.bat mcp             Start the MCP server\n  eastv-agent.bat doctor          Check this installation\n  eastv-agent.bat install codex   Register with Codex CLI`)
}
process.exitCode = status
