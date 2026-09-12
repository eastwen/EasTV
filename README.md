# EasTV

本地优先的 AI 视频无限画布工作台。EasTV 用节点、连线与分组来组织视频创作流程，支持连接本地视频模型和第三方 API 模型，并将生成视频保存到本机。

## 功能

- 无限画布、多项目管理与本地浏览器持久化
- 文本、图片、视频、音频、脚本节点
- 节点端口连线、箭头指向、素材自动传入视频生成节点
- 框选打组、可视化色块、分组命名、整体拖动与拆组
- 文生视频、首帧生视频、首尾帧生视频、参考图生视频
- 本地模型与 API 模型配置、编辑、测试和调用
- API 生成结果保存至 `output/generated-videos/`，支持播放、下载、打开所在文件夹
- 本地角色库：角色图片、描述与音色信息
- 可下载的 Agent 接入包，供 Codex / MCP 工作流读取项目上下文

## 快速启动

1. 安装 Node.js 20 或更新版本。
2. 双击 `start-web.bat`。
3. 浏览器打开 `http://127.0.0.1:4173/`。

首次启动会自动安装依赖，并生成可下载的 Agent 接入包。

## 本地视频输出

生成完成的视频默认保存在：

```text
output/generated-videos/<项目 ID>/<任务 ID>.mp4
```

在视频节点上右键可选择“打开文件夹”；节点内也提供下载入口。

## Agent 接入

画布右上角可下载 `EasTV-Agent-Bridge.zip`。解压后按其中的 `AGENT-INTEGRATION.md` 安装，即可让支持 MCP 的 Agent 读取 EasTV 项目与画布状态。

## 开发

```bash
npm install
npm run dev
npm run build
```

`npm run release:agent` 可单独生成 Agent 接入包。
