# EasTV Agent Bridge

EasTV 不在网页内嵌聊天框。Agent 通过标准 MCP 在网页外部调用项目能力，因此 Codex、Claude Code、Cursor 等支持 stdio MCP 的客户端都能复用同一套服务。

## Windows 一键安装（Codex）

1. 解压发行包，整个文件夹保留在固定位置。
2. 安装 Node.js 20 或更高版本。
3. 双击 `install-agent.bat`。
4. 重启 Codex。

双击 `start-web.bat` 可启动 EasTV Web UI。首次运行会自动安装依赖。

安装脚本注册的是当前解压目录中的服务，不依赖开发者电脑的绝对路径。移动目录后重新执行一次安装即可。

## 其他支持 MCP 的 Agent

在 Agent 的 MCP 设置中添加 stdio 服务：

```json
{
  "mcpServers": {
    "eastv": {
      "command": "node",
      "args": ["你的EasTV目录/scripts/start-mcp.mjs"]
    }
  }
}
```

也可以将项目根目录的 `.mcp.json` 直接交给支持项目级 MCP 配置的客户端。

## 命令

```bat
eastv-agent.bat doctor
eastv-agent.bat mcp
eastv-agent.bat install codex
```

首次启动如果缺少依赖，启动器会在当前 EasTV 目录执行 `npm install`。因此发行 ZIP 不需要携带庞大的 `node_modules`。

可执行 `npm run probe:agent` 验证 Agent 与 MCP 的 stdio 握手。

## 给 Agent 的 Skill

发行包包含 `skills/`。不支持自动发现项目 Skill 的客户端，可以把所需 Skill 文件夹复制到该客户端的 Skill 目录；MCP 服务本身不依赖 Skill 才能启动。
