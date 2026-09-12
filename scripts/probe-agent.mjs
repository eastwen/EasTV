import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const client = new Client({ name: 'eastv-agent-probe', version: '0.1.0' })
const transport = new StdioClientTransport({ command: process.execPath, args: ['./scripts/start-mcp.mjs'] })
await client.connect(transport)
try {
  const result = await client.listTools()
  const names = result.tools.map((tool) => tool.name)
  for (const required of ['get_cowart_canvas_state', 'save_cowart_canvas_state', 'insert_cowart_image']) {
    if (!names.includes(required)) throw new Error(`Missing MCP tool: ${required}`)
  }
  console.log(`[EasTV] MCP handshake OK (${names.length} tools).`)
} finally {
  await client.close()
}
