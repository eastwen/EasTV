import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const rootElement = document.getElementById('root')

function showStartupError(error) {
  console.error(error)
  rootElement.innerHTML = `
    <main style="display:grid;width:100%;height:100%;place-items:center;background:#f5f5f3;font-family:system-ui">
      <section style="width:min(620px,calc(100% - 40px));padding:28px;background:white;border:1px solid #ddd;border-radius:18px;box-shadow:0 18px 50px rgb(0 0 0 / 10%)">
        <h1 style="margin:0 0 10px;font-size:20px">EasTV 启动失败</h1>
        <p style="margin:0 0 14px;color:#777">请把下面的错误信息发给开发者：</p>
        <pre style="padding:14px;overflow:auto;white-space:pre-wrap;color:#8a2929;background:#fff1f1;border-radius:10px">${String(error?.stack || error)}</pre>
      </section>
    </main>`
}

import('./App.jsx')
  .then(({ default: App }) => {
    createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  })
  .catch(showStartupError)
