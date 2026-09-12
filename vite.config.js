import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const GENERATED_VIDEO_ROUTE = '/__eastv/generated-videos'
const OPEN_GENERATED_VIDEO_FOLDER_ROUTE = '/__eastv/open-generated-video-folder'
const GENERATED_VIDEO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), 'output', 'generated-videos')
const MAX_GENERATED_VIDEO_BYTES = 512 * 1024 * 1024
const VIDEO_FORMATS = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
}
const VIDEO_EXTENSIONS_BY_MIME = {
  'video/mp4': '.mp4',
  'application/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-quicktime': '.mov',
  'video/x-matroska': '.mkv',
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode })
}

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value)
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

function isSafeStorageId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

function assertContainedPath(root, target) {
  const relativePath = relative(root, target)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw httpError(400, 'Invalid generated video path')
  }
}

function normalizeMimeType(value) {
  return String(Array.isArray(value) ? value[0] : value || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
}

function uploadVideoFormat(req, requestUrl) {
  const contentType = normalizeMimeType(req.headers['content-type'])
  const requestedExtension = String(requestUrl.searchParams.get('extension') || '').trim().toLowerCase()
  const normalizedExtension = requestedExtension
    ? (requestedExtension.startsWith('.') ? requestedExtension : `.${requestedExtension}`)
    : ''

  if (VIDEO_EXTENSIONS_BY_MIME[contentType]) {
    const extension = VIDEO_EXTENSIONS_BY_MIME[contentType]
    if (normalizedExtension && normalizedExtension !== extension) {
      throw httpError(415, `Content-Type ${contentType} does not match extension ${normalizedExtension}`)
    }
    return { extension, mimeType: VIDEO_FORMATS[extension] }
  }

  if (contentType === 'application/octet-stream' || contentType === 'binary/octet-stream') {
    const extension = normalizedExtension || '.mp4'
    const mimeType = VIDEO_FORMATS[extension]
    if (!mimeType) throw httpError(415, 'Unsupported video extension')
    return { extension, mimeType }
  }

  throw httpError(415, 'Unsupported video Content-Type')
}

async function projectVideoDirectory(projectId) {
  await mkdir(GENERATED_VIDEO_ROOT, { recursive: true })
  const root = await realpath(GENERATED_VIDEO_ROOT)
  const candidate = resolve(root, projectId)
  assertContainedPath(root, candidate)
  await mkdir(candidate, { recursive: true })
  const directory = await realpath(candidate)
  assertContainedPath(root, directory)
  return { root, directory }
}

async function replaceFile(source, destination) {
  try {
    await rename(source, destination)
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error
    await rm(destination, { force: true })
    await rename(source, destination)
  }
}

function generatedVideoUrl(projectId, filename) {
  return `${GENERATED_VIDEO_ROUTE}/${encodeURIComponent(projectId)}/${encodeURIComponent(filename)}`
}

async function storeGeneratedVideo(req, res, requestUrl) {
  const projectId = requestUrl.searchParams.get('projectId') || ''
  const jobId = requestUrl.searchParams.get('jobId') || ''
  if (!isSafeStorageId(projectId) || !isSafeStorageId(jobId)) {
    throw httpError(400, 'projectId and jobId must use only letters, numbers, dots, underscores, or hyphens')
  }

  const declaredLength = Number(req.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GENERATED_VIDEO_BYTES) {
    throw httpError(413, 'Video exceeds the 512 MB upload limit')
  }
  if (Number.isFinite(declaredLength) && declaredLength < 1) throw httpError(400, 'Video body is empty')

  const { extension, mimeType } = uploadVideoFormat(req, requestUrl)
  const filename = `${jobId}${extension}`
  const { root, directory } = await projectVideoDirectory(projectId)
  const destination = resolve(directory, filename)
  assertContainedPath(root, destination)
  const temporary = join(directory, `.${jobId}.${randomUUID()}.part`)
  let receivedBytes = 0
  const limitStream = new Transform({
    transform(chunk, encoding, callback) {
      receivedBytes += chunk.length
      if (receivedBytes > MAX_GENERATED_VIDEO_BYTES) {
        callback(httpError(413, 'Video exceeds the 512 MB upload limit'))
      } else {
        callback(null, chunk)
      }
    },
  })

  try {
    await pipeline(req, limitStream, createWriteStream(temporary, { flags: 'wx' }))
    if (!receivedBytes) throw httpError(400, 'Video body is empty')
    await replaceFile(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }

  const url = generatedVideoUrl(projectId, filename)
  sendJson(res, 201, {
    projectId,
    jobId,
    filename,
    size: receivedBytes,
    mimeType,
    url,
    downloadUrl: `${url}?download=1`,
    absolutePath: destination,
  })
}

function parseByteRange(value, size) {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim())
  if (!match || (!match[1] && !match[2])) return false

  let start
  let end
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return false
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return false
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

function parseGeneratedVideoPath(pathname) {
  const suffix = pathname.slice(`${GENERATED_VIDEO_ROUTE}/`.length)
  const parts = suffix.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw httpError(404, 'Generated video not found')

  let projectId
  let filename
  try {
    projectId = decodeURIComponent(parts[0])
    filename = decodeURIComponent(parts[1])
  } catch {
    throw httpError(400, 'Invalid generated video URL')
  }
  const extension = extname(filename).toLowerCase()
  const jobId = filename.slice(0, -extension.length)
  if (!isSafeStorageId(projectId) || !isSafeStorageId(jobId) || !VIDEO_FORMATS[extension]) {
    throw httpError(400, 'Invalid generated video URL')
  }
  return { projectId, filename }
}

async function serveGeneratedVideo(req, res, requestUrl) {
  const { projectId, filename } = parseGeneratedVideoPath(requestUrl.pathname)
  const { root, directory } = await projectVideoDirectory(projectId)
  const candidate = resolve(directory, filename)
  assertContainedPath(root, candidate)

  let filePath
  let fileStats
  try {
    filePath = await realpath(candidate)
    assertContainedPath(root, filePath)
    fileStats = await stat(filePath)
    if (!fileStats.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' })
  } catch (error) {
    if (error?.statusCode) throw error
    if (error?.code === 'ENOENT') throw httpError(404, 'Generated video not found')
    throw error
  }

  const mimeType = VIDEO_FORMATS[extname(filename).toLowerCase()]
  const range = parseByteRange(req.headers.range, fileStats.size)
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('content-type', mimeType)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('cache-control', 'private, max-age=0, must-revalidate')
  res.setHeader('last-modified', fileStats.mtime.toUTCString())
  if (requestUrl.searchParams.get('download') === '1') {
    res.setHeader('content-disposition', `attachment; filename="${filename}"`)
  }

  let streamOptions
  if (range === false) {
    res.statusCode = 416
    res.setHeader('content-range', `bytes */${fileStats.size}`)
    res.setHeader('content-length', '0')
    return res.end()
  }
  if (range) {
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${range.start}-${range.end}/${fileStats.size}`)
    res.setHeader('content-length', String(range.end - range.start + 1))
    streamOptions = range
  } else {
    res.statusCode = 200
    res.setHeader('content-length', String(fileStats.size))
  }

  if (req.method === 'HEAD') return res.end()
  const stream = createReadStream(filePath, streamOptions)
  stream.on('error', (error) => {
    if (!res.headersSent) sendJson(res, 500, { error: { message: 'Unable to read generated video' } })
    else res.destroy(error)
  })
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

async function openGeneratedVideoFolder(res, requestUrl) {
  if (process.platform !== 'win32') throw httpError(501, 'Opening the file manager is currently supported on Windows only')
  const projectId = requestUrl.searchParams.get('projectId') || ''
  const filename = requestUrl.searchParams.get('filename') || ''
  if (!isSafeStorageId(projectId) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(mp4|webm|mov|mkv)$/i.test(filename)) {
    throw httpError(400, 'Invalid generated video file')
  }
  const { root, directory } = await projectVideoDirectory(projectId)
  const candidate = resolve(directory, filename)
  assertContainedPath(root, candidate)
  let filePath
  try {
    filePath = await realpath(candidate)
    assertContainedPath(root, filePath)
    const fileStats = await stat(filePath)
    if (!fileStats.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' })
  } catch (error) {
    if (error?.statusCode) throw error
    if (error?.code === 'ENOENT') throw httpError(404, 'Generated video not found')
    throw error
  }
  const explorer = spawn('explorer.exe', ['/select,', filePath], { detached: true, stdio: 'ignore' })
  explorer.unref()
  sendJson(res, 200, { ok: true, absolutePath: filePath })
}

function eastvGeneratedVideoStorage() {
  const middleware = async (req, res, next) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1')
    const isCollection = requestUrl.pathname === GENERATED_VIDEO_ROUTE
    const isStoredVideo = requestUrl.pathname.startsWith(`${GENERATED_VIDEO_ROUTE}/`)
    const isOpenFolder = requestUrl.pathname === OPEN_GENERATED_VIDEO_FOLDER_ROUTE
    if (!isCollection && !isStoredVideo && !isOpenFolder) return next()

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('allow', isCollection || isOpenFolder ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS')
      return res.end()
    }

    try {
      if (isCollection && req.method === 'POST') return await storeGeneratedVideo(req, res, requestUrl)
      if (isStoredVideo && ['GET', 'HEAD'].includes(req.method || 'GET')) return await serveGeneratedVideo(req, res, requestUrl)
      if (isOpenFolder && req.method === 'POST') return await openGeneratedVideoFolder(res, requestUrl)
      res.setHeader('allow', isCollection || isOpenFolder ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS')
      throw httpError(405, 'Method not allowed')
    } catch (error) {
      if (res.destroyed || res.headersSent) return
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
      sendJson(res, statusCode, { error: { message: statusCode === 500 ? 'Generated video storage failed' : error.message } })
    }
  }
  return {
    name: 'eastv-generated-video-storage',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}

function eastvApiProxy() {
  const middleware = async (req, res, next) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1')
    if (requestUrl.pathname !== '/__eastv/api-proxy') return next()
    const target = requestUrl.searchParams.get('target')
    try {
      const parsed = new URL(target)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) API endpoints are supported')
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (value == null || ['host', 'origin', 'referer', 'content-length', 'connection'].includes(name.toLowerCase())) continue
        headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const method = req.method || 'GET'
      const upstream = await fetch(parsed, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : req,
        duplex: ['GET', 'HEAD'].includes(method) ? undefined : 'half',
        redirect: 'follow',
      })
      res.statusCode = upstream.status
      upstream.headers.forEach((value, name) => {
        if (!['content-encoding', 'transfer-encoding', 'connection'].includes(name.toLowerCase())) res.setHeader(name, value)
      })
      if (!upstream.body) return res.end()
      Readable.fromWeb(upstream.body).pipe(res)
    } catch (error) {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { message: error?.message || 'API proxy failed' } }))
    }
  }
  return {
    name: 'eastv-api-proxy',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}

export default defineConfig({
  plugins: [react(), eastvGeneratedVideoStorage(), eastvApiProxy()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
})
