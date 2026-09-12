import {
  Boxes,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Hand,
  HardDrive,
  ImagePlus,
  FileText,
  Film,
  Link2,
  LayoutGrid,
  LoaderCircle,
  Magnet,
  MoreHorizontal,
  Music2,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
  Users,
  Video,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import {
  ArrowShapeUtil,
  BaseBoxShapeUtil,
  DefaultContextMenu,
  DefaultContextMenuContent,
  HTMLContainer,
  T,
  Tldraw,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  createShapeId,
  getSnapshot,
  loadSnapshot,
  toRichText,
  useEditor,
  useValue,
} from 'tldraw'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'eastv.projects.v1'
const CANVAS_PREFIX = 'eastv.canvas.'
const MODELS_KEY = 'eastv.models.v1'
const CHARACTERS_KEY = 'eastv.characters.v1'
const HIDE_CONNECTIONS_KEY = 'eastv.hideConnections'
const GRID_SNAP_KEY = 'eastv.gridSnap'
const AGENT_BRIDGE_DOWNLOAD = '/downloads/EasTV-Agent-Bridge.zip'
const WORKFLOW_NODE_TYPE = 'eastv-node'
const DEFAULT_PROJECT = {
  id: crypto.randomUUID(),
  name: '我的第一个视频项目',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  jobs: [],
}

function loadProjects() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(value) && value.length ? compactProjects(value) : [DEFAULT_PROJECT]
  } catch {
    return [DEFAULT_PROJECT]
  }
}

function compactProjects(projects) {
  return projects.map((project) => ({
    ...project,
    jobs: (project.jobs || []).slice(0, 12).map((job) => ({
      ...job,
      references: (job.references || []).map(({ previewUrl, ...reference }) => reference),
    })),
  }))
}

function normalizeJobs(value) {
  if (!Array.isArray(value)) return []
  return value.filter((job) => job && typeof job === 'object').slice(0, 12)
}

function resolveVideoApiEndpoint(endpoint) {
  const value = String(endpoint || '').trim().replace(/\/+$/, '')
  if (!value) throw new Error('API 地址为空')
  const parsed = new URL(value)
  if (parsed.pathname.replace(/\/+$/, '').endsWith('/v1')) parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/videos`
  return parsed.toString()
}

function localApiProxyUrl(target) {
  return `/__eastv/api-proxy?target=${encodeURIComponent(target)}`
}

function apiVideoSize(aspect, resolution = '720P') {
  const [width, height] = String(aspect).split(':').map(Number)
  return width && height && width < height ? '720x1280' : '1280x720'
}

function apiVideoSeconds(duration) {
  return [4, 8, 12].reduce((closest, value) => Math.abs(value - duration) < Math.abs(closest - duration) ? value : closest, 4)
}

function apiErrorMessage(data, fallback) {
  const code = data?.code || data?.error?.code || data?.output?.code || ''
  const rawMessage = data?.error?.message
    || (typeof data?.error === 'string' ? data.error : '')
    || data?.output?.message
    || data?.message
    || data?.detail
    || fallback
  const message = String(rawMessage || fallback || 'API 请求失败')
  if (/AllocationQuota\.FreeTierOnly|free (?:tier|quota).*exhausted|use free tier only/i.test(`${code} ${message}`)) {
    return '阿里云百炼：当前模型的免费额度已耗尽。若要继续付费调用，请先确认账户已实名认证并有可用余额，再到“免费额度”页面关闭“免费额度用完即停（仅使用免费额度）”；否则请改用仍有额度的模型。'
  }
  return message
}

function readApiVideoResult(data) {
  const item = Array.isArray(data?.data) ? data.data[0] : null
  const output = Array.isArray(data?.output) ? data.output[0] : data?.output
  const videoUrl = data?.video_url || data?.videoUrl || data?.url || data?.result?.video_url || data?.result?.url || data?.data?.video_url || data?.data?.url || item?.video_url || item?.url || (typeof output === 'string' ? output : output?.video_url || output?.url) || ''
  const taskId = data?.id || data?.task_id || data?.taskId || data?.result?.id || data?.result?.task_id || data?.data?.id || data?.data?.task_id || output?.task_id || data?.request_id || ''
  const status = String(data?.status || data?.state || data?.result?.status || data?.data?.status || output?.task_status || '').toLowerCase()
  const statusUrl = data?.status_url || data?.statusUrl || data?.urls?.status || data?.data?.status_url || data?.result?.status_url || ''
  return { videoUrl, taskId, status, statusUrl }
}

async function fetchWithTimeout(url, options, timeoutMs = 45000) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...options, signal: controller.signal }) }
  finally { window.clearTimeout(timer) }
}

async function parseApiResponse(response) {
  const text = await response.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { message: text } }
  if (!response.ok) throw new Error(apiErrorMessage(data, `API 请求失败（HTTP ${response.status}）`))
  return data
}

async function persistGeneratedVideo(sourceUrl, { projectId, jobId }) {
  const source = String(sourceUrl || '').trim()
  if (!source) throw new Error('生成结果没有可保存的视频地址')
  const sourceRequestUrl = /^https?:\/\//i.test(source) ? localApiProxyUrl(source) : source
  const sourceResponse = await fetchWithTimeout(sourceRequestUrl, {}, 5 * 60 * 1000)
  if (!sourceResponse.ok) {
    const contentType = sourceResponse.headers.get('content-type') || ''
    if (contentType.includes('json')) await parseApiResponse(sourceResponse)
    throw new Error(`视频文件下载失败（HTTP ${sourceResponse.status}）`)
  }
  const videoBlob = await sourceResponse.blob()
  if (!videoBlob.size) throw new Error('供应商返回了空视频文件')
  const target = `/__eastv/generated-videos?projectId=${encodeURIComponent(projectId)}&jobId=${encodeURIComponent(jobId)}`
  const savedResponse = await fetchWithTimeout(target, {
    method: 'POST',
    headers: { 'Content-Type': videoBlob.type || 'video/mp4' },
    body: videoBlob,
  }, 5 * 60 * 1000)
  const saved = await parseApiResponse(savedResponse)
  if (!saved?.url || !saved?.absolutePath) throw new Error('本地视频服务没有返回保存路径')
  return {
    videoUrl: saved.url,
    downloadUrl: saved.downloadUrl || `${saved.url}?download=1`,
    localPath: saved.absolutePath,
    filename: saved.filename || '',
  }
}

const ALL_GENERATION_MODES = ['文生视频', '首帧生视频', '首尾帧生视频', '参考图生视频']

function supportedGenerationModes(model) {
  if (!model || model.kind !== 'api') return ALL_GENERATION_MODES
  let hostname = ''
  try { hostname = new URL(model.endpoint).hostname } catch { /* validation happens when submitting */ }
  const modelId = String(model.apiModel || '').toLowerCase()
  const isDashScope = hostname.includes('dashscope') || hostname.endsWith('.maas.aliyuncs.com')
  if (!isDashScope) return ['文生视频', '首帧生视频', '参考图生视频']
  if (/happyhorse.*i2v/.test(modelId)) return ['首帧生视频']
  if (/happyhorse.*t2v/.test(modelId) || /-t2v(?:-|$)/.test(modelId)) return ['文生视频']
  if (/-r2v(?:-|$)/.test(modelId)) return ['参考图生视频']
  if (/-i2v(?:-|$)/.test(modelId)) return ['首帧生视频', '首尾帧生视频']
  return ALL_GENERATION_MODES
}

function isGenerationModeSupported(model, mode) {
  return supportedGenerationModes(model).includes(mode)
}

function defaultGenerationMode(model) {
  return supportedGenerationModes(model)[0] || '文生视频'
}

async function submitOpenAiVideo(model, { prompt, duration, aspect, resolution, references = [], generationMode = '文生视频' }) {
  const endpoint = resolveVideoApiEndpoint(model.endpoint)
  if (!isGenerationModeSupported(model, generationMode)) throw new Error(`当前 API 适配器不支持“${generationMode}”`)
  const headers = {}
  if (model.apiKey) headers.Authorization = `Bearer ${model.apiKey}`
  const form = new FormData()
  form.append('model', model.apiModel)
  form.append('prompt', prompt)
  form.append('seconds', String(apiVideoSeconds(duration)))
  form.append('size', apiVideoSize(aspect, resolution))
  const images = references.filter((reference) => reference.nodeType === 'image' && reference.previewUrl)
  if (generationMode !== '文生视频' && images.length !== 1) throw new Error(`“${generationMode}”需要连接 1 张图片素材`)
  if (generationMode !== '文生视频') {
    const firstImage = images[0]
    const imageResponse = await fetch(firstImage.previewUrl)
    const imageBlob = await imageResponse.blob()
    form.append('input_reference', imageBlob, 'reference.png')
  }
  const response = await fetchWithTimeout(localApiProxyUrl(endpoint), { method: 'POST', headers, body: form })
  return { endpoint, data: await parseApiResponse(response) }
}

function isDashScopeVideoModel(model) {
  try {
    const hostname = new URL(model.endpoint).hostname
    return (hostname.includes('dashscope') || hostname.endsWith('.maas.aliyuncs.com')) && /happyhorse|wan/i.test(model.apiModel || '')
  } catch { return false }
}

async function submitDashScopeVideo(model, { prompt, duration, aspect, resolution, references = [], generationMode = '文生视频' }) {
  const configured = new URL(model.endpoint)
  configured.pathname = '/api/v1/services/aigc/video-generation/video-synthesis'
  configured.search = ''
  const endpoint = configured.toString()
  const images = references.filter((reference) => reference.nodeType === 'image' && reference.previewUrl)
  const videos = references.filter((reference) => reference.nodeType === 'video' && reference.previewUrl)
  const modelId = String(model.apiModel || '').toLowerCase()
  const isReferenceToVideo = /r2v/i.test(modelId)
  if (!isGenerationModeSupported(model, generationMode)) {
    throw new Error(`${model.apiModel} 不支持“${generationMode}”，请选择“${defaultGenerationMode(model)}”或更换对应能力的模型`)
  }
  const input = { prompt }
  if (generationMode === '首帧生视频') {
    if (images.length !== 1) throw new Error('“首帧生视频”需要且只能连接 1 张图片；该图片会作为 first_frame 传入')
    input.media = [{ type: 'first_frame', url: images[0].previewUrl }]
  } else if (generationMode === '首尾帧生视频') {
    if (images.length !== 2) throw new Error('“首尾帧生视频”需要连接 2 张图片；素材 1 是首帧，素材 2 是尾帧')
    input.media = [
      { type: 'first_frame', url: images[0].previewUrl },
      { type: 'last_frame', url: images[1].previewUrl },
    ]
  } else if (generationMode === '参考图生视频') {
    const media = [
      ...images.map((reference) => ({ type: 'reference_image', url: reference.previewUrl })),
      ...videos.map((reference) => ({ type: 'reference_video', url: reference.previewUrl })),
    ]
    if (!media.length || media.length > 5) throw new Error('“参考图生视频”需要连接 1–5 个图片或视频参考素材')
    if (videos.some((reference) => !/^https?:\/\//i.test(reference.previewUrl))) throw new Error('参考视频必须是供应商可访问的 HTTP(S) 地址；本地视频直传将在后续版本支持')
    input.media = media
  }
  const body = {
    model: model.apiModel,
    input,
    parameters: {
      resolution: ['480P', '720P', '1080P'].includes(String(resolution).toUpperCase()) ? String(resolution).toUpperCase() : '720P',
      duration: isReferenceToVideo ? Math.max(2, Math.min(10, Math.round(duration))) : Math.max(3, Math.min(15, Math.round(duration))),
      ...(!input.media?.some((item) => item.type === 'first_frame') ? { ratio: aspect === '智能' ? '16:9' : aspect } : {}),
    },
  }
  const headers = { 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' }
  if (model.apiKey) headers.Authorization = `Bearer ${model.apiKey}`
  const response = await fetchWithTimeout(localApiProxyUrl(endpoint), { method: 'POST', headers, body: JSON.stringify(body) })
  const data = await parseApiResponse(response)
  const taskId = readApiVideoResult(data).taskId
  if (taskId) data.status_url = `${configured.origin}/api/v1/tasks/${taskId}`
  return { endpoint, data }
}

function submitConfiguredVideo(model, options) {
  return isDashScopeVideoModel(model) ? submitDashScopeVideo(model, options) : submitOpenAiVideo(model, options)
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function loadStoredList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function persistStoredList(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true }
  catch (error) { console.warn(`Unable to persist ${key}`, error); return false }
}

async function makeCharacterThumbnail(file) {
  const source = await readFileAsDataUrl(file)
  const image = await new Promise((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = reject
    element.src = source
  })
  const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/webp', 0.8)
}

const CHARACTER_ASSET_DB = 'eastv-character-assets'
function openCharacterAssetDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CHARACTER_ASSET_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('voices')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function storeCharacterVoice(characterId, file) {
  const db = await openCharacterAssetDb()
  await new Promise((resolve, reject) => {
    const request = db.transaction('voices', 'readwrite').objectStore('voices').put(file, characterId)
    request.onsuccess = resolve
    request.onerror = () => reject(request.error)
  })
  db.close()
}

async function removeCharacterVoice(characterId) {
  const db = await openCharacterAssetDb()
  const transaction = db.transaction('voices', 'readwrite')
  transaction.objectStore('voices').delete(characterId)
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function readImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = reject
    image.src = src
  })
}

function fitImageNode(width, height) {
  if (!width || !height) return { w: 360, h: 240 }
  const maxPreviewEdge = 420
  const scale = maxPreviewEdge / Math.max(width, height)
  return {
    w: Math.max(72, Math.round(width * scale)),
    h: Math.max(72, Math.round(height * scale)),
  }
}

function fitVideoNode(aspect = '16:9') {
  const ratios = { '智能': 16 / 9, '21:9': 21 / 9, '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4, '9:16': 9 / 16 }
  const ratio = ratios[aspect] || 16 / 9
  const w = ratio >= 1 ? (ratio > 2 ? 360 : 320) : Math.round(320 * ratio)
  const h = ratio >= 1 ? Math.round(w / ratio) : 320
  return { w, h }
}

function getWorkflowArrowGeometry(editor, fromId, toId) {
  const fromBounds = editor.getShapePageBounds(fromId)
  const toBounds = editor.getShapePageBounds(toId)
  if (!fromBounds || !toBounds) return null
  const start = { x: fromBounds.maxX, y: fromBounds.center.y }
  const end = { x: toBounds.minX, y: toBounds.center.y }
  return {
    x: start.x,
    y: start.y,
    start: { x: 0, y: 0 },
    end: { x: end.x - start.x, y: end.y - start.y },
  }
}

function workflowArrowNeedsGeometryUpdate(shape, geometry) {
  return Math.abs(shape.x - geometry.x) > .01
    || Math.abs(shape.y - geometry.y) > .01
    || Math.abs(shape.props.start.x - geometry.start.x) > .01
    || Math.abs(shape.props.start.y - geometry.start.y) > .01
    || Math.abs(shape.props.end.x - geometry.end.x) > .01
    || Math.abs(shape.props.end.y - geometry.end.y) > .01
}

const workflowArrowHandleDrags = new Map()

function findWorkflowInputTarget(editor, shape, pagePoint, radiusPx = 32) {
  const hitRadius = radiusPx / Math.max(editor.getZoomLevel(), .01)
  let closest = null
  for (const candidate of editor.getCurrentPageShapes()) {
    if (candidate.type !== WORKFLOW_NODE_TYPE || candidate.id === shape.meta?.eastvFromId) continue
    const bounds = editor.getShapePageBounds(candidate.id)
    if (!bounds) continue
    const input = { x: bounds.minX, y: bounds.center.y }
    const distance = Math.hypot(pagePoint.x - input.x, pagePoint.y - input.y)
    if (distance <= hitRadius && (!closest || distance < closest.distance)) {
      closest = { shape: candidate, input, distance }
    }
  }
  return closest
}

function setWorkflowSnapTarget(shapeId = null) {
  document.querySelectorAll('.workflow-port.input-port.is-snap-target').forEach((element) => {
    element.classList.remove('is-snap-target')
    element.closest('.eastv-node-container')?.classList.remove('is-snap-target')
  })
  if (!shapeId) return
  const port = [...document.querySelectorAll('.workflow-port.input-port')]
    .find((element) => element.dataset.shapeId === shapeId)
  port?.classList.add('is-snap-target')
  port?.closest('.eastv-node-container')?.classList.add('is-snap-target')
}

class EasTVArrowShapeUtil extends ArrowShapeUtil {
  static type = 'arrow'

  getHandles(shape) {
    const handles = super.getHandles(shape)
    return shape.meta?.eastvWorkflow === true
      ? handles.filter((handle) => handle.id === 'end')
      : handles
  }

  onTranslateStart(shape) {
    if (shape.meta?.eastvWorkflow === true) return
    return super.onTranslateStart(shape)
  }

  onTranslate(initial, current) {
    if (initial.meta?.eastvWorkflow === true) {
      return {
        id: current.id,
        type: current.type,
        x: initial.x,
        y: initial.y,
        rotation: initial.rotation,
        props: {
          start: initial.props.start,
          end: initial.props.end,
          bend: initial.props.bend,
        },
      }
    }
    return super.onTranslate(initial, current)
  }

  onTranslateEnd(initial, current) {
    if (initial.meta?.eastvWorkflow !== true) return
    return {
      id: current.id,
      type: current.type,
      x: initial.x,
      y: initial.y,
      rotation: initial.rotation,
      props: {
        start: initial.props.start,
        end: initial.props.end,
        bend: initial.props.bend,
      },
    }
  }

  onHandleDragStart(shape, info) {
    if (shape.meta?.eastvWorkflow !== true || info.handle.id !== 'end') return
    setWorkflowSnapTarget()
    workflowArrowHandleDrags.set(shape.id, {
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      start: shape.props.start,
      end: shape.props.end,
      bend: shape.props.bend,
      fromId: shape.meta.eastvFromId,
      toId: shape.meta.eastvToId,
    })
  }

  onHandleDrag(shape, info) {
    if (shape.meta?.eastvWorkflow !== true) return super.onHandleDrag(shape, info)
    if (info.handle.id !== 'end') return
    const initial = workflowArrowHandleDrags.get(shape.id)
    if (!initial) return
    const pagePoint = this.editor.getShapePageTransform(shape.id).applyToPoint(info.handle)
    const target = findWorkflowInputTarget(this.editor, shape, pagePoint, 38)
    setWorkflowSnapTarget(target?.shape.id)
    const end = target
      ? this.editor.getPointInShapeSpace(shape, target.input)
      : { x: info.handle.x, y: info.handle.y }
    return {
      id: shape.id,
      type: shape.type,
      x: initial.x,
      y: initial.y,
      rotation: initial.rotation,
      props: {
        start: initial.start,
        end: { x: end.x, y: end.y },
        bend: initial.bend,
      },
    }
  }

  onHandleDragEnd(shape, info) {
    if (shape.meta?.eastvWorkflow !== true || info.handle.id !== 'end') return
    const initial = workflowArrowHandleDrags.get(shape.id)
    if (!initial) return
    // DraggingHandle passes the initial handle to onHandleDragEnd; the final
    // endpoint is stored on the current shape.
    const pagePoint = this.editor.getShapePageTransform(shape.id).applyToPoint(shape.props.end)
    const target = findWorkflowInputTarget(this.editor, shape, pagePoint, 28)
    const toId = target?.shape.id || initial.toId
    const geometry = getWorkflowArrowGeometry(this.editor, initial.fromId, toId)
    workflowArrowHandleDrags.delete(shape.id)
    setWorkflowSnapTarget()
    if (!geometry) {
      return {
        id: shape.id,
        type: shape.type,
        x: initial.x,
        y: initial.y,
        rotation: initial.rotation,
        props: { start: initial.start, end: initial.end, bend: initial.bend },
      }
    }
    return {
      id: shape.id,
      type: shape.type,
      x: geometry.x,
      y: geometry.y,
      rotation: 0,
      props: {
        start: geometry.start,
        end: geometry.end,
        bend: initial.bend,
        arrowheadEnd: 'arrow',
      },
      meta: { ...shape.meta, eastvWorkflow: true, eastvFromId: initial.fromId, eastvToId: toId },
    }
  }

  onHandleDragCancel(shape, info) {
    if (shape.meta?.eastvWorkflow !== true || info.handle.id !== 'end') return
    workflowArrowHandleDrags.delete(shape.id)
    setWorkflowSnapTarget()
  }
}

function WorkflowNodeContent({ shape }) {
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)
  const icon = shape.props.nodeType === 'video' ? <Film size={16} />
    : shape.props.nodeType === 'image' ? <ImagePlus size={16} />
      : shape.props.nodeType === 'audio' ? <Music2 size={16} />
        : shape.props.nodeType === 'script' ? <Workflow size={16} />
          : <FileText size={16} />
  const emitPort = (terminal, event) => {
    event.preventDefault()
    event.stopPropagation()
    window.dispatchEvent(new CustomEvent('eastv:port-click', { detail: { shapeId: shape.id, terminal } }))
  }
  const beginPortDrag = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    window.dispatchEvent(new CustomEvent('eastv:port-drag-start', { detail: { shapeId: shape.id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } }))
  }
  const movePortDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (Math.hypot(event.clientX - dragRef.current.x, event.clientY - dragRef.current.y) > 4) dragRef.current.moved = true
    window.dispatchEvent(new CustomEvent('eastv:port-drag-move', { detail: { x: event.clientX, y: event.clientY } }))
  }
  const finishPortDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const moved = dragRef.current.moved
    dragRef.current = null
    if (moved) {
      suppressClickRef.current = true
      window.dispatchEvent(new CustomEvent('eastv:port-drag-end', { detail: { x: event.clientX, y: event.clientY } }))
      window.setTimeout(() => { suppressClickRef.current = false }, 0)
    } else {
      window.dispatchEvent(new CustomEvent('eastv:port-drag-cancel'))
    }
  }
  const clickOutputPort = (event) => {
    if (suppressClickRef.current) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    window.dispatchEvent(new CustomEvent('eastv:port-add-menu', {
      detail: { shapeId: shape.id, x: rect.right + 10, y: rect.top + rect.height / 2 },
    }))
  }
  const handleVideoPointerDown = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const controlsHeight = Math.min(48, rect.height * .3)
    if (event.clientY >= rect.bottom - controlsHeight) event.stopPropagation()
  }
  const forwardVideoContextMenu = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const canvas = event.currentTarget.closest('.tl-canvas')
    if (!canvas) return
    const ContextEvent = window.PointerEvent || window.MouseEvent
    canvas.dispatchEvent(new ContextEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      button: 2,
      buttons: 2,
      pointerType: 'mouse',
    }))
  }
  return (
    <HTMLContainer className={`eastv-node-container type-${shape.props.nodeType}`}>
      <div className="eastv-node-title"><span>{icon}</span><strong title={shape.props.title}>{shape.props.title}</strong><small title={shape.props.localPath || undefined}>{shape.props.nodeType === 'video' ? (shape.props.localPath ? '已保存本地' : '生成') : '节点'}</small></div>
      <div className={`eastv-node-preview ${shape.props.previewUrl ? 'has-preview' : ''}`}>
        {shape.props.previewUrl ? (shape.props.nodeType === 'video' ? <video src={shape.props.previewUrl} controls preload="metadata" onPointerDown={handleVideoPointerDown} onClick={(event) => event.stopPropagation()} onContextMenu={forwardVideoContextMenu} /> : <img src={shape.props.previewUrl} alt={shape.props.title} />) : <>
          {shape.props.nodeType === 'video' && <Film size={35} />}
          {shape.props.nodeType === 'image' && <ImagePlus size={32} />}
          {shape.props.nodeType === 'audio' && <Music2 size={32} />}
          {(shape.props.nodeType === 'text' || shape.props.nodeType === 'script') && <p>{shape.props.description}</p>}
        </>}
      </div>
      {shape.props.nodeType === 'video' && shape.props.downloadUrl && <a className="eastv-video-download" href={shape.props.downloadUrl} download={shape.props.fileName || 'eastv-video.mp4'} title={`下载本地视频${shape.props.localPath ? `\n${shape.props.localPath}` : ''}`} aria-label={`下载 ${shape.props.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><Download size={15} /></a>}
      <button className="workflow-port input-port" data-shape-id={shape.id} aria-label={`${shape.props.title} 输入端口`} title="连接输入" onClick={(event) => emitPort('input', event)}><span /></button>
      <button className="workflow-port output-port" data-shape-id={shape.id} aria-label={`${shape.props.title} 输出端口`} title="拖动到目标输入端口" onPointerDown={beginPortDrag} onPointerMove={movePortDrag} onPointerUp={finishPortDrag} onPointerCancel={finishPortDrag} onClick={clickOutputPort}><Plus size={13} /></button>
    </HTMLContainer>
  )
}

class WorkflowNodeShapeUtil extends BaseBoxShapeUtil {
  static type = WORKFLOW_NODE_TYPE
  static props = {
    w: T.number,
    h: T.number,
    nodeType: T.string,
    title: T.string,
    description: T.string,
    previewUrl: T.string,
    promptText: T.optional(T.string),
    aspect: T.optional(T.string),
    downloadUrl: T.optional(T.string),
    localPath: T.optional(T.string),
    fileName: T.optional(T.string),
  }
  getDefaultProps() {
    return { w: 320, h: 180, nodeType: 'video', title: '视频节点', description: '等待输入', previewUrl: '', promptText: '', aspect: '16:9', downloadUrl: '', localPath: '', fileName: '' }
  }
  canEdit() { return false }
  canBind() { return true }
  component(shape) { return <WorkflowNodeContent shape={shape} /> }
  getIndicatorPath(shape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

const workflowShapeUtils = [WorkflowNodeShapeUtil, EasTVArrowShapeUtil]

function EasTVContextMenu() {
  const editor = useEditor()
  const localVideo = useValue('eastv context menu local video', () => {
    const shape = editor.getOnlySelectedShape()
    return shape?.type === WORKFLOW_NODE_TYPE && shape.props.nodeType === 'video' && shape.props.localPath ? shape : null
  }, [editor])
  return <DefaultContextMenu>
    <DefaultContextMenuContent />
    {localVideo && <TldrawUiMenuGroup id="eastv-local-video">
      <TldrawUiMenuItem
        id="eastv-open-video-folder"
        label="打开文件夹"
        onSelect={() => window.dispatchEvent(new CustomEvent('eastv:open-video-folder', { detail: { shapeId: localVideo.id } }))}
      />
    </TldrawUiMenuGroup>}
  </DefaultContextMenu>
}

const tldrawComponents = { ContextMenu: EasTVContextMenu }

function Modal({ title, description, onClose, children, wide = false }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card ${wide ? 'wide' : ''}`}>
        <header><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button onClick={onClose}><X size={19} /></button></header>
        {children}
      </section>
    </div>
  )
}

const EMPTY_MODEL_FORM = { name: '', path: '', runtime: 'Diffusers / PyTorch', endpoint: '', apiModel: '', apiKey: '' }

function ModelManager({ models, activeModelId, onChange, onClose }) {
  const [kind, setKind] = useState('local')
  const [form, setForm] = useState(EMPTY_MODEL_FORM)
  const [editingModelId, setEditingModelId] = useState(null)
  const resetForm = () => {
    setEditingModelId(null)
    setKind('local')
    setForm({ ...EMPTY_MODEL_FORM })
  }
  const editModel = (model) => {
    setEditingModelId(model.id)
    setKind(model.kind === 'api' ? 'api' : 'local')
    setForm({
      name: model.name || '',
      path: model.path || '',
      runtime: model.runtime || 'Diffusers / PyTorch',
      endpoint: model.endpoint || '',
      apiModel: model.apiModel || '',
      apiKey: '',
    })
  }
  const deleteModel = (model) => {
    if (editingModelId === model.id) resetForm()
    onChange(models.filter((item) => item.id !== model.id), model.id === activeModelId ? '' : activeModelId)
  }
  const submitModel = (event) => {
    event.preventDefault()
    if (!form.name.trim()) return
    if (kind === 'local' && !form.path.trim()) return
    if (kind === 'api' && (!form.endpoint.trim() || !form.apiModel.trim())) return
    const normalizedForm = {
      ...form,
      name: form.name.trim(),
      path: form.path.trim(),
      endpoint: form.endpoint.trim(),
      apiModel: form.apiModel.trim(),
      apiKey: form.apiKey.trim(),
    }
    if (editingModelId) {
      const updatedAt = new Date().toISOString()
      onChange(models.map((model) => model.id === editingModelId ? {
        ...model,
        kind,
        ...normalizedForm,
        apiKey: kind === 'api' && !normalizedForm.apiKey ? (model.apiKey || '') : normalizedForm.apiKey,
        id: model.id,
        updatedAt,
      } : model))
    } else {
      onChange([...models, { id: crypto.randomUUID(), kind, ...normalizedForm, createdAt: new Date().toISOString() }], 'last')
    }
    resetForm()
  }
  return (
    <Modal title="视频模型" description="添加本地模型目录，或连接第三方视频模型 API。" onClose={onClose} wide>
      <div className="model-manager-body">
        <div className="model-list">
          <div className="modal-section-title">已添加模型</div>
          {models.length === 0 && <div className="empty-state"><Boxes size={28} /><strong>还没有视频模型</strong><span>可以添加 MiniMax H3 等本地模型，也可以接入视频模型 API。</span></div>}
          {models.map((model) => <div key={model.id} className="saved-model-row"><button className={`saved-model ${model.id === activeModelId ? 'selected' : ''}`} onClick={() => onChange(models, model.id)}>
            <span className="saved-model-icon">{model.kind === 'api' ? <Zap size={18} /> : <HardDrive size={18} />}</span><span><strong>{model.name}</strong><small>{model.kind === 'api' ? `API · ${model.apiModel}` : model.runtime}<br />{model.kind === 'api' ? model.endpoint : model.path}</small></span>{model.id === activeModelId && <Check size={17} />}
          </button><button className={`edit-model ${editingModelId === model.id ? 'active' : ''}`} title="编辑模型配置" onClick={() => editModel(model)}><Pencil size={15} /></button><button className="delete-model" title="删除模型配置" onClick={() => deleteModel(model)}><Trash2 size={15} /></button></div>)}
        </div>
        <form className={`model-form ${editingModelId ? 'editing' : ''}`} onSubmit={submitModel}>
          <div className="model-kind-tabs"><button type="button" disabled={Boolean(editingModelId)} className={kind === 'local' ? 'active' : ''} onClick={() => setKind('local')}><HardDrive size={15} /> 本地模型</button><button type="button" disabled={Boolean(editingModelId)} className={kind === 'api' ? 'active' : ''} onClick={() => setKind('api')}><Zap size={15} /> API 模型</button></div>
          <label>显示名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 MiniMax H3 FL2VA" /></label>
          {kind === 'local' ? <>
            <label>模型目录<input value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })} placeholder="例如 D:\\AIModels\\MiniMax-H3" /></label>
            <label>运行后端<select value={form.runtime} onChange={(event) => setForm({ ...form, runtime: event.target.value })}><option>Diffusers / PyTorch</option><option>SGLang</option><option>自定义本地 Runner</option></select></label>
            <div className="model-form-note"><SlidersHorizontal size={16} /><span>本地 Runner 会校验目录、显存和权重文件。</span></div>
          </> : <>
            <label>API 地址<input value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} placeholder="例如 https://api.example.com/v1" /></label>
            <label>模型 ID<input value={form.apiModel} onChange={(event) => setForm({ ...form, apiModel: event.target.value })} placeholder="例如 video-model-v1" /></label>
            <label>API Key<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editingModelId ? '留空则保持当前密钥不变' : '可稍后配置'} /></label>
            <div className="model-form-note"><Zap size={16} /><span>支持 OpenAI 兼容接口和后续自定义适配器。密钥仅保存在本机。</span></div>
          </>}
          <div className="model-form-actions">
            <button className="primary-button" type="submit">{editingModelId ? <><Check size={17} /> 保存更改</> : <><Plus size={17} /> 添加{kind === 'local' ? '本地' : ' API'}模型</>}</button>
            {editingModelId && <button className="model-edit-cancel" type="button" onClick={resetForm}>取消编辑</button>}
          </div>
        </form>
      </div>
    </Modal>
  )
}

function CharacterLibrary({ characters, onChange, onPlace, onClose }) {
  const [name, setName] = useState('')
  const [editingDraft, setEditingDraft] = useState(null)
  const [draggedCharacterImageId, setDraggedCharacterImageId] = useState(null)
  const [voiceTargetId, setVoiceTargetId] = useState(null)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const referenceInputRef = useRef(null)
  const voiceInputRef = useRef(null)
  const addCharacter = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    try {
      const image = await makeCharacterThumbnail(file)
      const imageItem = { id: crypto.randomUUID(), image, fileName: file.name }
      const character = { id: crypto.randomUUID(), name: name.trim() || file.name.replace(/\.[^.]+$/, ''), description: '', image, fileName: file.name, referenceImages: [], images: [imageItem] }
      setEditingDraft(character)
      setName('')
    } catch {
      setError('角色图片读取失败，请换一张图片重试。')
    }
  }
  const chooseVoice = (id) => { setVoiceTargetId(id); voiceInputRef.current?.click() }
  const addVoice = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !voiceTargetId) return
    if (file.size > 30 * 1024 * 1024) { setError('音色样本请控制在 30 MB 以内。'); return }
    setError('')
    try {
      await storeCharacterVoice(voiceTargetId, file)
      const voicePatch = { voiceName: file.name, voiceType: file.type, voiceSize: file.size, voiceUpdatedAt: Date.now() }
      if (editingDraft?.id === voiceTargetId) setEditingDraft((draft) => ({ ...draft, ...voicePatch }))
      else onChange(characters.map((item) => item.id === voiceTargetId ? { ...item, ...voicePatch } : item))
    } catch { setError('音色样本保存失败，请检查浏览器存储空间。') }
  }
  const deleteCharacter = async (id) => {
    try { await removeCharacterVoice(id) } catch { /* Character metadata can still be removed. */ }
    onChange(characters.filter((item) => item.id !== id))
  }
  const deleteVoice = async (id) => {
    try {
      await removeCharacterVoice(id)
      const clearVoice = ({ voiceName, voiceType, voiceSize, voiceUpdatedAt, ...rest }) => rest
      if (editingDraft?.id === id) setEditingDraft((draft) => clearVoice(draft))
      else onChange(characters.map((item) => item.id === id ? clearVoice(item) : item))
      setError('')
    } catch { setError('音色删除失败，请重试。') }
  }
  const editCharacter = (character) => {
    const images = character.images?.length ? character.images : [{ id: `${character.id}-cover`, image: character.image, fileName: character.fileName }, ...(character.referenceImages || [])]
    setEditingDraft({ ...character, description: character.description || '', images })
  }
  const addReferenceImages = async (event) => {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (!files.length || !editingDraft) return
    const remaining = Math.max(0, 9 - (editingDraft.images?.length || 0))
    if (!remaining) { setError('每个角色最多保存 9 张参考图片。'); return }
    try {
      const images = await Promise.all(files.slice(0, remaining).map(async (file) => ({ id: crypto.randomUUID(), image: await makeCharacterThumbnail(file), fileName: file.name })))
      setEditingDraft((draft) => ({ ...draft, images: [...(draft.images || []), ...images] }))
    } catch { setError('部分参考图读取失败，请重试。') }
  }
  const saveCharacter = () => {
    const [cover, ...references] = editingDraft.images || []
    if (!cover) { setError('请至少保留一张角色图片。'); return }
    const next = { ...editingDraft, name: editingDraft.name.trim(), description: editingDraft.description.trim(), image: cover.image, fileName: cover.fileName, referenceImages: references, updatedAt: Date.now() }
    if (!next.name) { setError('请填写角色名称。'); return }
    const exists = characters.some((item) => item.id === next.id)
    onChange(exists ? characters.map((item) => item.id === next.id ? next : item) : [next, ...characters])
    setEditingDraft(null)
    setError('')
  }
  const removeDraftImage = (id) => {
    if ((editingDraft.images || []).length <= 1) { setError('请至少保留一张角色图片。'); return }
    setEditingDraft({ ...editingDraft, images: editingDraft.images.filter((item) => item.id !== id) })
  }
  const dropDraftImage = (targetId) => {
    if (!draggedCharacterImageId || draggedCharacterImageId === targetId) return
    const images = [...editingDraft.images]
    const from = images.findIndex((item) => item.id === draggedCharacterImageId)
    const to = images.findIndex((item) => item.id === targetId)
    const [moving] = images.splice(from, 1)
    images.splice(to, 0, moving)
    setEditingDraft({ ...editingDraft, images })
    setDraggedCharacterImageId(null)
  }
  if (editingDraft) return (
    <Modal title={characters.some((item) => item.id === editingDraft.id) ? '编辑角色' : '设置角色'} description="建立角色身份、性格和多角度视觉参考，供后续视频生成调用。" onClose={() => setEditingDraft(null)} wide>
      <div className="character-editor">
        <section className="character-editor-visual">
          <div className="character-reference-title unified"><div><strong>角色参考图片 <em>*</em></strong><small>直接上传所需图片；拖动可排序，第一张将作为角色封面</small></div><div className="character-voice-actions"><button className={editingDraft.voiceName ? 'voice-ready' : ''} onClick={() => chooseVoice(editingDraft.id)}><Music2 size={16} /> {editingDraft.voiceName ? '更换音色' : '上传音色'}</button>{editingDraft.voiceName && <button className="delete-voice" title="删除已绑定音色" onClick={() => deleteVoice(editingDraft.id)}><Trash2 size={15} /> 删除音色</button>}</div></div>
          <input ref={referenceInputRef} type="file" accept="image/*" multiple hidden onChange={addReferenceImages} />
          <input ref={voiceInputRef} type="file" accept="audio/*" hidden onChange={addVoice} />
          <div className="character-reference-grid">
            {(editingDraft.images || []).map((reference, index) => <div key={reference.id} className="character-reference-item" draggable onDragStart={() => setDraggedCharacterImageId(reference.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropDraftImage(reference.id)}><img src={reference.image} alt={reference.fileName} /><span className="image-order">{index + 1}</span>{index === 0 && <b>封面</b>}<button title="删除图片" onClick={() => removeDraftImage(reference.id)}><Trash2 size={13} /></button></div>)}
            {(editingDraft.images || []).length < 9 && <button className="add-reference-card" onClick={() => referenceInputRef.current?.click()}><Plus size={20} /><span>添加图片</span></button>}
          </div>
        </section>
        <section className="character-editor-fields">
          <label>名称 <em>*</em><div className="field-with-count"><input maxLength={20} value={editingDraft.name} onChange={(event) => setEditingDraft({ ...editingDraft, name: event.target.value })} placeholder="请输入角色名称" /><span>{editingDraft.name.length}/20</span></div></label>
          <label>角色描述<textarea maxLength={800} value={editingDraft.description} onChange={(event) => setEditingDraft({ ...editingDraft, description: event.target.value })} placeholder="描述角色的性格、身份、语气、说话方式、习惯动作等。例如：沉稳克制的中年侦探，说话简短有力，低沉嗓音，思考时习惯轻敲桌面……" /><span className="textarea-count">{editingDraft.description.length}/800</span></label>
          <div className="description-tips"><Sparkles size={15} /><span>描述会随角色参考一起传给视频模型，用于稳定角色行为、台词语气和表演方式。</span></div>
        </section>
      </div>
      {error && <div className="character-error">{error}</div>}
      <div className="character-editor-actions"><button onClick={() => setEditingDraft(null)}>取消</button><button className="primary-button" onClick={saveCharacter}>保存角色</button></div>
    </Modal>
  )
  return (
    <Modal title="角色库" description="固定角色形象与音色，在不同项目和镜头中保持一致。" onClose={onClose} wide>
      <div className="character-hero"><div><strong>创建可复用角色</strong><span>上传清晰的角色参考图；音色样本建议使用 10–30 秒、无背景音乐的单人声音。</span></div><Users size={28} /></div>
      <div className="character-toolbar"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="角色名称（可选）" /><button className="primary-button" onClick={() => inputRef.current?.click()}><Upload size={16} /> 添加角色</button><input ref={inputRef} type="file" accept="image/*" hidden onChange={addCharacter} /><input ref={voiceInputRef} type="file" accept="audio/*" hidden onChange={addVoice} /></div>
      {error && <div className="character-error">{error}</div>}
      {characters.length === 0 ? <div className="empty-state character-empty"><Users size={30} /><strong>角色库还是空的</strong><span>添加角色形象后，还可以完善描述、表情参考与固定音色。</span></div> : <div className="character-grid">{characters.map((character) => <article key={character.id} className="character-card"><div className="character-portrait"><img src={character.image} alt={character.name} /><span>{1 + (character.referenceImages?.length || 0)} 张参考</span></div><div className="character-info"><strong>{character.name}</strong><small className="character-description-preview">{character.description || '暂未填写角色性格与说话方式'}</small><button className={`voice-sample ${character.voiceName ? 'ready' : ''}`} onClick={() => chooseVoice(character.id)}><Music2 size={16} /><span><b>{character.voiceName ? '固定音色已添加' : '上传固定音色'}</b><small>{character.voiceName || '支持 MP3、WAV、M4A，最大 30 MB'}</small></span><Upload size={14} /></button></div><footer>{onPlace && <button onClick={() => onPlace(character)}>放入画布</button>}<button onClick={() => editCharacter(character)}><Pencil size={13} /> 编辑</button><button className="danger" onClick={() => deleteCharacter(character.id)}><Trash2 size={15} /></button></footer></article>)}</div>}
    </Modal>
  )
}

function ProjectHome({ projects, onCreate, onOpen, onRename, onDelete }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [projectMenuId, setProjectMenuId] = useState(null)
  const [renamingProject, setRenamingProject] = useState(null)
  const [modelManagerOpen, setModelManagerOpen] = useState(false)
  const [characterLibraryOpen, setCharacterLibraryOpen] = useState(false)
  const [models, setModels] = useState(() => loadStoredList(MODELS_KEY))
  const [activeModelId, setActiveModelId] = useState(() => localStorage.getItem('eastv.activeModelId') || '')
  const [characters, setCharacters] = useState(() => loadStoredList(CHARACTERS_KEY))
  const projectMenuRef = useRef(null)
  const activeModel = models.find((item) => item.id === activeModelId)

  useEffect(() => { persistStoredList(MODELS_KEY, models) }, [models])
  useEffect(() => { persistStoredList(CHARACTERS_KEY, characters) }, [characters])
  useEffect(() => localStorage.setItem('eastv.activeModelId', activeModelId), [activeModelId])
  const updateModels = (nextModels, nextActiveId) => {
    setModels(nextModels)
    if (nextActiveId === 'last') setActiveModelId(nextModels.at(-1)?.id || '')
    else if (nextActiveId !== undefined) setActiveModelId(nextActiveId || nextModels[0]?.id || '')
  }

  useEffect(() => {
    if (!projectMenuId) return undefined
    const dismiss = (event) => {
      if (!projectMenuRef.current?.contains(event.target)) setProjectMenuId(null)
    }
    const onKey = (event) => event.key === 'Escape' && setProjectMenuId(null)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onKey)
    }
  }, [projectMenuId])

  const submit = (event) => {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName) return
    onCreate(nextName)
    setName('')
    setCreating(false)
  }

  const submitRename = (event) => {
    event.preventDefault()
    const nextName = renamingProject?.name.trim()
    if (!nextName) return
    onRename(renamingProject.id, nextName)
    setRenamingProject(null)
  }

  const confirmDelete = (project) => {
    setProjectMenuId(null)
    if (window.confirm(`确定删除项目“${project.name}”吗？\n该项目的画布和任务数据也会被删除。`)) onDelete(project.id)
  }

  return (
    <main className="project-home">
      <header className="home-header">
        <div className="brand"><span className="brand-mark"><Video size={18} /></span>EasTV</div>
        <div className="home-actions"><div className={`model-status ${activeModel ? 'ready' : ''}`}><span /> {activeModel ? activeModel.name : '未添加模型'}</div><button className="topbar-button" onClick={() => setModelManagerOpen(true)}><SlidersHorizontal size={16} /> 模型</button><button className="topbar-button" onClick={() => setCharacterLibraryOpen(true)}><Users size={16} /> 角色库</button><a className="ghost-button agent-download-link" href={AGENT_BRIDGE_DOWNLOAD} download="EasTV-Agent-Bridge.zip"><Download size={17} /> Agent 接入包</a></div>
      </header>
      <section className="home-content">
        <div className="home-title-row">
          <div>
            <span className="eyebrow">LOCAL AI VIDEO WORKSPACE</span>
            <h1>今天想创作什么？</h1>
            <p>选择一个项目继续，或者从空白画布开始。</p>
          </div>
          <button className="primary-button" onClick={() => setCreating(true)}><Plus size={18} /> 新建项目</button>
        </div>

        {creating && (
          <form className="new-project-card" onSubmit={submit}>
            <div className="new-project-icon"><Sparkles size={22} /></div>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="输入项目名称" />
            <button className="primary-button" type="submit">创建</button>
            <button className="icon-button" type="button" onClick={() => setCreating(false)}><X size={18} /></button>
          </form>
        )}

        <div className="section-label"><LayoutGrid size={16} /> 全部项目 <span>{projects.length}</span></div>
        <div className="project-grid">
          <button className="project-card create-card" onClick={() => setCreating(true)}>
            <span><Plus size={24} /></span>
            <strong>新建空白项目</strong>
            <small>从无限画布开始</small>
          </button>
          {projects.map((project) => (
            <article key={project.id} className="project-card project-card-with-menu">
              <button className="project-card-open" onClick={() => onOpen(project.id)}>
                <div className="project-preview">
                  <div className="preview-node preview-node-one" />
                  <div className="preview-line" />
                  <div className="preview-node preview-node-two"><Video size={17} /></div>
                </div>
                <div className="project-meta">
                  <strong>{project.name}</strong>
                  <small>更新于 {formatDate(project.updatedAt)}</small>
                </div>
              </button>
              <div className="project-card-menu-wrap" ref={projectMenuId === project.id ? projectMenuRef : null}>
                <button className="project-more-button" aria-label={`${project.name} 更多操作`} title="更多操作" onClick={() => setProjectMenuId((current) => current === project.id ? null : project.id)}><MoreHorizontal size={18} /></button>
                {projectMenuId === project.id && <div className="project-card-menu">
                  <button onClick={() => { setRenamingProject({ id: project.id, name: project.name }); setProjectMenuId(null) }}><Pencil size={15} /> 重命名</button>
                  <button className="danger" onClick={() => confirmDelete(project)}><Trash2 size={15} /> 删除</button>
                </div>}
              </div>
            </article>
          ))}
        </div>
      </section>
      {renamingProject && <Modal title="重命名项目" description="修改项目在首页和画布顶部显示的名称。" onClose={() => setRenamingProject(null)}>
        <form className="rename-project-form" onSubmit={submitRename}>
          <input autoFocus value={renamingProject.name} onChange={(event) => setRenamingProject({ ...renamingProject, name: event.target.value })} placeholder="项目名称" />
          <div><button type="button" onClick={() => setRenamingProject(null)}>取消</button><button className="primary-button" type="submit">保存</button></div>
        </form>
      </Modal>}
      {modelManagerOpen && <ModelManager models={models} activeModelId={activeModelId} onChange={updateModels} onClose={() => setModelManagerOpen(false)} />}
      {characterLibraryOpen && <CharacterLibrary characters={characters} onChange={setCharacters} onClose={() => setCharacterLibraryOpen(false)} />}
    </main>
  )
}

function ToolButton({ label, active, children, onClick }) {
  return <button title={label} className={`tool-button ${active ? 'active' : ''}`} onClick={onClick}>{children}<span>{label}</span></button>
}

function CanvasWorkspace({ project, projects, onProjectChange, onHome, onUpdateProject }) {
  const editorRef = useRef(null)
  const canvasShellRef = useRef(null)
  const fileRef = useRef(null)
  const imageFileRef = useRef(null)
  const audioFileRef = useRef(null)
  const scriptFileRef = useRef(null)
  const saveTimerRef = useRef(null)
  const [prompt, setPrompt] = useState('')
  const [tool, setTool] = useState('select')
  const [nodeMenu, setNodeMenu] = useState(false)
  const [connectionsHidden, setConnectionsHidden] = useState(() => localStorage.getItem(HIDE_CONNECTIONS_KEY) === 'true')
  const [gridSnapEnabled, setGridSnapEnabled] = useState(() => localStorage.getItem(GRID_SNAP_KEY) === 'true')
  const [modelManagerOpen, setModelManagerOpen] = useState(false)
  const [characterLibraryOpen, setCharacterLibraryOpen] = useState(false)
  const [models, setModels] = useState(() => loadStoredList(MODELS_KEY))
  const [activeModelId, setActiveModelId] = useState(() => localStorage.getItem('eastv.activeModelId') || '')
  const [characters, setCharacters] = useState(() => loadStoredList(CHARACTERS_KEY))
  const [generationMode, setGenerationMode] = useState('文生视频')
  const [duration, setDuration] = useState(6)
  const [aspect, setAspect] = useState('16:9')
  const [modeOpen, setModeOpen] = useState(false)
  const [aspectOpen, setAspectOpen] = useState(false)
  const [durationOpen, setDurationOpen] = useState(false)
  const [nodeAspectOpen, setNodeAspectOpen] = useState(false)
  const [nodeDurationOpen, setNodeDurationOpen] = useState(false)
  const [nodeSettingsOpen, setNodeSettingsOpen] = useState(false)
  const [resolution, setResolution] = useState('720P')
  const [promptEnhance, setPromptEnhance] = useState(true)
  const [pendingConnectionSource, setPendingConnectionSource] = useState(null)
  const [dragConnection, setDragConnection] = useState(null)
  const [selectedVideoNodeId, setSelectedVideoNodeId] = useState(null)
  const [nodePromptAnchor, setNodePromptAnchor] = useState(null)
  const [nodePromptDraft, setNodePromptDraft] = useState('')
  const [connectedMaterials, setConnectedMaterials] = useState([])
  const [portNodeMenu, setPortNodeMenu] = useState(null)
  const [selectionGroupToolbar, setSelectionGroupToolbar] = useState(null)
  const [visualGroups, setVisualGroups] = useState([])
  const [groupNameEditor, setGroupNameEditor] = useState(null)
  const modeRef = useRef(null)
  const aspectRef = useRef(null)
  const durationRef = useRef(null)
  const nodePreferencesRef = useRef(null)
  const nodePromptTextareaRef = useRef(null)
  const nodeMenuRef = useRef(null)
  const portNodeMenuRef = useRef(null)
  const dragConnectionRef = useRef(null)
  const groupDragRef = useRef(null)
  const [messages, setMessages] = useState([
    { role: 'agent', text: '我是 EasTV Agent。连接 Codex MCP 后，我可以读取当前项目、整理画布并创建生成任务。' },
  ])
  const [jobs, setJobs] = useState(() => normalizeJobs(project.jobs))
  const jobsRef = useRef(normalizeJobs(project.jobs))
  const localizedVideoProjectsRef = useRef(new Set())
  const [generationNotice, setGenerationNotice] = useState(null)
  const [taskListOpen, setTaskListOpen] = useState(false)
  const activeModel = models.find((item) => item.id === activeModelId)

  useEffect(() => { persistStoredList(MODELS_KEY, models) }, [models])
  useEffect(() => { persistStoredList(CHARACTERS_KEY, characters) }, [characters])
  useEffect(() => localStorage.setItem('eastv.activeModelId', activeModelId), [activeModelId])
  useEffect(() => {
    if (activeModel && !isGenerationModeSupported(activeModel, generationMode)) {
      setGenerationMode(defaultGenerationMode(activeModel))
    }
  }, [activeModel, generationMode])
  useEffect(() => localStorage.setItem(HIDE_CONNECTIONS_KEY, String(connectionsHidden)), [connectionsHidden])
  useEffect(() => {
    localStorage.setItem(GRID_SNAP_KEY, String(gridSnapEnabled))
    const editor = editorRef.current
    if (editor) {
      editor.updateInstanceState({ isGridMode: gridSnapEnabled })
      editor.user.updateUserPreferences({ isSnapMode: gridSnapEnabled })
    }
  }, [gridSnapEnabled])

  useEffect(() => {
    if (!modeOpen && !aspectOpen && !durationOpen) return undefined
    const dismiss = (event) => {
      if (modeOpen && !modeRef.current?.contains(event.target)) setModeOpen(false)
      if (aspectOpen && !aspectRef.current?.contains(event.target)) setAspectOpen(false)
      if (durationOpen && !durationRef.current?.contains(event.target)) setDurationOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [modeOpen, aspectOpen, durationOpen])

  useEffect(() => {
    if (!nodeAspectOpen && !nodeDurationOpen && !nodeSettingsOpen) return undefined
    const dismiss = (event) => {
      if (!nodePreferencesRef.current?.contains(event.target)) {
        setNodeAspectOpen(false)
        setNodeDurationOpen(false)
        setNodeSettingsOpen(false)
      }
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [nodeAspectOpen, nodeDurationOpen, nodeSettingsOpen])

  useEffect(() => {
    if (!nodeMenu) return undefined
    const dismiss = (event) => {
      if (!nodeMenuRef.current?.contains(event.target)) setNodeMenu(false)
    }
    const onKey = (event) => event.key === 'Escape' && setNodeMenu(false)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onKey)
    }
  }, [nodeMenu])

  useEffect(() => {
    setNodeAspectOpen(false)
    setNodeDurationOpen(false)
    setNodeSettingsOpen(false)
  }, [selectedVideoNodeId])

  useEffect(() => {
    if (!selectedVideoNodeId) {
      setNodePromptAnchor(null)
      return undefined
    }
    let animationFrame
    let lastAnchor = null
    const updateAnchor = () => {
      const port = document.querySelector(`.workflow-port[data-shape-id="${selectedVideoNodeId}"]`)
      const node = port?.closest('.eastv-node-container')
      const shell = canvasShellRef.current
      if (node && shell) {
        const nodeRect = node.getBoundingClientRect()
        const shellRect = shell.getBoundingClientRect()
        const panelWidth = Math.min(720, Math.max(520, shellRect.width - 32))
        const rawLeft = nodeRect.left - shellRect.left + nodeRect.width / 2
        const left = Math.max(panelWidth / 2 + 16, Math.min(rawLeft, shellRect.width - panelWidth / 2 - 16))
        const top = Math.max(72, nodeRect.bottom - shellRect.top + 16)
        const nextAnchor = { left, top, width: panelWidth }
        if (!lastAnchor || Math.abs(lastAnchor.left - left) > .5 || Math.abs(lastAnchor.top - top) > .5 || Math.abs(lastAnchor.width - panelWidth) > .5) {
          lastAnchor = nextAnchor
          setNodePromptAnchor(nextAnchor)
        }
      }
      animationFrame = requestAnimationFrame(updateAnchor)
    }
    animationFrame = requestAnimationFrame(updateAnchor)
    return () => cancelAnimationFrame(animationFrame)
  }, [selectedVideoNodeId])

  const saveCanvas = useCallback((editor, projectId = project.id) => {
    if (!editor) return
    try {
      localStorage.setItem(`${CANVAS_PREFIX}${projectId}`, JSON.stringify(getSnapshot(editor.store)))
    } catch (error) {
      console.warn('Unable to save canvas', error)
    }
  }, [project.id])

  const normalizeWorkflowArrows = useCallback((editor) => {
    if (!editor) return
    const arrows = editor.getCurrentPageShapes().filter((shape) => shape.type === 'arrow')
    editor.run(() => {
      for (const shape of arrows) {
        const bindings = editor.getBindingsFromShape(shape, 'arrow')
        const startBinding = bindings.find((binding) => binding.props.terminal === 'start')
        const endBinding = bindings.find((binding) => binding.props.terminal === 'end')
        const fromId = shape.meta?.eastvFromId || startBinding?.toId
        const toId = shape.meta?.eastvToId || endBinding?.toId
        const isWorkflowArrow = shape.meta?.eastvWorkflow === true
        if (!isWorkflowArrow) {
          const danglingBindingIds = bindings.filter((binding) => !editor.getShape(binding.toId)).map((binding) => binding.id)
          if (danglingBindingIds.length) editor.deleteBindings(danglingBindingIds)
          continue
        }
        if (bindings.length) editor.deleteBindings(bindings.map((binding) => binding.id))
        const geometry = fromId && toId ? getWorkflowArrowGeometry(editor, fromId, toId) : null
        editor.updateShape({
          id: shape.id,
          type: 'arrow',
          isLocked: false,
          ...(geometry ? { x: geometry.x, y: geometry.y } : {}),
          props: {
            ...(geometry ? { start: geometry.start, end: geometry.end } : {}),
            arrowheadEnd: 'arrow',
          },
          meta: {
            ...shape.meta,
            eastvWorkflow: Boolean(geometry),
            eastvFromId: geometry ? fromId : null,
            eastvToId: geometry ? toId : null,
          },
        })
      }
    })
  }, [])

  const syncWorkflowArrowGeometry = useCallback((editor) => {
    if (!editor) return
    const updates = []
    const danglingArrowIds = []
    for (const shape of editor.getCurrentPageShapes().filter((item) => item.type === 'arrow' && item.meta?.eastvWorkflow === true)) {
      if (workflowArrowHandleDrags.has(shape.id)) continue
      const geometry = getWorkflowArrowGeometry(editor, shape.meta.eastvFromId, shape.meta.eastvToId)
      if (!geometry) {
        danglingArrowIds.push(shape.id)
        continue
      }
      if (!workflowArrowNeedsGeometryUpdate(shape, geometry)) continue
      updates.push({
        id: shape.id,
        type: 'arrow',
        x: geometry.x,
        y: geometry.y,
        props: { start: geometry.start, end: geometry.end },
      })
    }
    if (danglingArrowIds.length) editor.deleteShapes(danglingArrowIds)
    if (updates.length) editor.updateShapes(updates)
  }, [])

  const normalizeStoredImageNodes = useCallback(async (editor) => {
    if (!editor) return
    const imageNodes = editor.getCurrentPageShapes().filter((shape) => shape.type === WORKFLOW_NODE_TYPE && shape.props.nodeType === 'image' && shape.props.previewUrl)
    const updates = (await Promise.all(imageNodes.map(async (shape) => {
      try {
        const { width, height } = await readImageDimensions(shape.props.previewUrl)
        const dimensions = fitImageNode(width, height)
        if (Math.abs(shape.props.w - dimensions.w) < 1 && Math.abs(shape.props.h - dimensions.h) < 1) return null
        return { id: shape.id, type: WORKFLOW_NODE_TYPE, props: dimensions }
      } catch {
        return null
      }
    }))).filter(Boolean)
    const videoNodes = editor.getCurrentPageShapes().filter((shape) => shape.type === WORKFLOW_NODE_TYPE && shape.props.nodeType === 'video')
    for (const shape of videoNodes) {
      const dimensions = fitVideoNode(shape.props.aspect || '16:9')
      if (Math.abs(shape.props.w - dimensions.w) >= 1 || Math.abs(shape.props.h - dimensions.h) >= 1) {
        updates.push({ id: shape.id, type: WORKFLOW_NODE_TYPE, props: dimensions })
      }
    }
    if (updates.length) editor.updateShapes(updates)
  }, [])

  const loadProjectCanvas = useCallback((editor, projectId) => {
    const raw = localStorage.getItem(`${CANVAS_PREFIX}${projectId}`)
    if (raw) {
      try {
        loadSnapshot(editor.store, JSON.parse(raw))
        requestAnimationFrame(() => editor.zoomToFit({ animation: { duration: 180 } }))
        return
      } catch (error) {
        console.warn('Unable to load canvas', error)
      }
    }
    const ids = [...editor.getCurrentPageShapeIds()]
    if (ids.length) editor.deleteShapes(ids)
    editor.resetZoom()
  }, [])

  const handleMount = useCallback((editor) => {
    editorRef.current = editor
    loadProjectCanvas(editor, project.id)
    editor.updateInstanceState({ isGridMode: gridSnapEnabled })
    editor.user.updateUserPreferences({ isSnapMode: gridSnapEnabled })
    normalizeWorkflowArrows(editor)
    syncWorkflowArrowGeometry(editor)
    void normalizeStoredImageNodes(editor)
    let workflowSyncFrame = null
    const unlisten = editor.store.listen(() => {
      cancelAnimationFrame(workflowSyncFrame)
      workflowSyncFrame = requestAnimationFrame(() => syncWorkflowArrowGeometry(editor))
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveCanvas(editor)
        onUpdateProject(project.id, { updatedAt: new Date().toISOString() })
      }, 500)
    }, { scope: 'document' })
    let lastSelectedVideoId = null
    let lastMaterialsSignature = ''
    let lastGroupToolbarSignature = ''
    let lastVisualGroupsSignature = ''
    const readConnectedMaterials = (nodeId) => {
      if (!nodeId) return []
      const workflowEdges = new Map()
      for (const arrow of editor.getCurrentPageShapes().filter((shape) => shape.type === 'arrow')) {
        if (arrow.meta?.eastvWorkflow === true && arrow.meta?.eastvToId === nodeId) {
          workflowEdges.set(arrow.id, { arrowId: arrow.id, sourceId: arrow.meta.eastvFromId })
        }
      }
      for (const endBinding of editor.getBindingsToShape(nodeId, 'arrow').filter((binding) => binding.props.terminal === 'end')) {
        if (workflowEdges.has(endBinding.fromId)) continue
        const startBinding = editor.getBindingsFromShape(endBinding.fromId, 'arrow').find((binding) => binding.props.terminal === 'start')
        if (startBinding) workflowEdges.set(endBinding.fromId, { arrowId: endBinding.fromId, sourceId: startBinding.toId })
      }
      return [...workflowEdges.values()]
        .map((edge, index) => {
          const source = editor.getShape(edge.sourceId)
          if (!source) return null
          const asset = source.props.assetId ? editor.getAsset(source.props.assetId) : null
          return {
            arrowId: edge.arrowId,
            sourceId: source.id,
            title: source.props.title || source.props.name || `素材 ${index + 1}`,
            nodeType: source.props.nodeType || source.type,
            previewUrl: source.props.previewUrl || source.props.url || asset?.props?.src || '',
            description: source.props.description || '',
          }
        })
        .filter(Boolean)
    }
    const syncSelectedVideo = () => {
      const selected = editor.getOnlySelectedShape()
      const nextId = selected?.type === WORKFLOW_NODE_TYPE && selected.props.nodeType === 'video' ? selected.id : null
      if (nextId !== lastSelectedVideoId) {
        lastSelectedVideoId = nextId
        setSelectedVideoNodeId(nextId)
        setNodePromptAnchor(null)
        setNodePromptDraft(nextId ? (selected.props.promptText || '') : '')
        if (nextId) setAspect(selected.props.aspect || '16:9')
      }
      const nextMaterials = readConnectedMaterials(nextId)
      const nextMaterialsSignature = JSON.stringify(nextMaterials)
      if (nextMaterialsSignature !== lastMaterialsSignature) {
        lastMaterialsSignature = nextMaterialsSignature
        setConnectedMaterials(nextMaterials)
      }

      const selectedShapes = editor.getSelectedShapes()
      const groupIds = selectedShapes.filter((shape) => shape.type === 'group').map((shape) => shape.id)
      const nodeIds = selectedShapes.filter((shape) => shape.type !== 'group' && shape.type !== 'arrow').map((shape) => shape.id)
      const action = groupIds.length > 0 && nodeIds.length === 0 ? 'ungroup' : nodeIds.length >= 2 ? 'group' : null
      const bounds = action ? editor.getSelectionScreenBounds() : null
      const nextToolbar = action && bounds ? {
        action,
        groupIds,
        nodeIds,
        count: action === 'group' ? nodeIds.length : groupIds.length,
        x: Math.max(145, bounds.center.x),
        y: Math.max(72, bounds.minY - 14),
      } : null
      const signature = nextToolbar ? `${nextToolbar.action}:${nextToolbar.groupIds.join(',')}:${nextToolbar.nodeIds.join(',')}:${Math.round(nextToolbar.x)}:${Math.round(nextToolbar.y)}` : ''
      if (signature !== lastGroupToolbarSignature) {
        lastGroupToolbarSignature = signature
        setSelectionGroupToolbar(nextToolbar)
      }

      const nextVisualGroups = editor.getCurrentPageShapes()
        .filter((shape) => shape.type === 'group')
        .map((group) => {
          const bounds = editor.getShapePageBounds(group.id)
          if (!bounds) return null
          const point = editor.pageToScreen(bounds.point)
          const zoom = editor.getZoomLevel()
          return {
            id: group.id,
            x: point.x,
            y: point.y,
            w: bounds.width * zoom,
            h: bounds.height * zoom,
            count: editor.getSortedChildIdsForParent(group.id).length,
            label: group.meta?.eastvGroupName || `分组 ${editor.getSortedChildIdsForParent(group.id).length} 个节点`,
          }
        })
        .filter(Boolean)
      const groupsSignature = JSON.stringify(nextVisualGroups.map((group) => [group.id, Math.round(group.x), Math.round(group.y), Math.round(group.w), Math.round(group.h), group.count, group.label]))
      if (groupsSignature !== lastVisualGroupsSignature) {
        lastVisualGroupsSignature = groupsSignature
        setVisualGroups(nextVisualGroups)
      }
    }
    const unlistenSelection = editor.store.listen(syncSelectedVideo)
    const handleEditorEvent = (info) => {
      if (info.type === 'click' && info.name === 'double_click' && info.phase === 'down' && info.target === 'shape' && info.shape?.type === 'arrow') {
        editor.deleteShape(info.shape.id)
        setMessages((items) => [...items, { role: 'agent', text: '已取消该节点连线。' }])
      }
    }
    editor.on('event', handleEditorEvent)
    syncSelectedVideo()
    editor.__eastvUnlisten = () => {
      cancelAnimationFrame(workflowSyncFrame)
      unlisten()
      unlistenSelection()
      editor.off('event', handleEditorEvent)
    }
  }, [gridSnapEnabled, loadProjectCanvas, normalizeStoredImageNodes, normalizeWorkflowArrows, onUpdateProject, project.id, saveCanvas, syncWorkflowArrowGeometry])

  useEffect(() => () => {
    clearTimeout(saveTimerRef.current)
    editorRef.current?.__eastvUnlisten?.()
  }, [])

  useEffect(() => {
    const nextJobs = normalizeJobs(project.jobs)
    jobsRef.current = nextJobs
    setJobs(nextJobs)
  }, [project.id, project.jobs])

  const switchProject = (nextId) => {
    const editor = editorRef.current
    if (editor) saveCanvas(editor, project.id)
    onProjectChange(nextId)
    if (editor) setTimeout(() => {
      loadProjectCanvas(editor, nextId)
      normalizeWorkflowArrows(editor)
      syncWorkflowArrowGeometry(editor)
      void normalizeStoredImageNodes(editor)
    }, 0)
  }

  const selectTool = (id) => {
    setTool(id)
    editorRef.current?.setCurrentTool(id)
  }

  const applyAspect = (value) => {
    setAspect(value)
    const editor = editorRef.current
    if (!editor || !selectedVideoNodeId) return
    const shape = editor.getShape(selectedVideoNodeId)
    if (!shape || shape.type !== WORKFLOW_NODE_TYPE || shape.props.nodeType !== 'video') return
    const dimensions = fitVideoNode(value)
    editor.updateShape({
      id: selectedVideoNodeId,
      type: WORKFLOW_NODE_TYPE,
      props: { ...dimensions, aspect: value },
    })
  }

  const connectWorkflowShapes = (fromId, toId) => {
    const editor = editorRef.current
    if (!editor || fromId === toId) return false
    const geometry = getWorkflowArrowGeometry(editor, fromId, toId)
    if (!geometry) return false
    const dx = geometry.end.x
    const dy = geometry.end.y
    const arrowId = createShapeId()
    editor.createShape({
      id: arrowId,
      type: 'arrow',
      isLocked: false,
      x: geometry.x,
      y: geometry.y,
      props: {
        start: geometry.start,
        end: geometry.end,
        bend: Math.sign(dy || 1) * Math.min(110, Math.max(34, Math.abs(dx) * .16)),
        color: 'grey',
        size: 'm',
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
      },
      meta: { eastvWorkflow: true, eastvFromId: fromId, eastvToId: toId },
    })
    editor.setSelectedShapes([toId])
    setTool('select')
    return true
  }

  const addWorkflowNode = (type) => {
    const editor = editorRef.current
    if (!editor) return
    const definitions = {
      text: { title: '文本节点', description: '输入文案、提示词或镜头描述' },
      image: { title: '图片节点', description: '导入或生成参考画面' },
      video: { title: '视频节点', description: '连接素材后生成视频' },
      audio: { title: '音频节点', description: '配音、音乐或环境音效' },
      script: { title: '脚本节点', description: '拆解场景、角色和分镜' },
    }
    const definition = definitions[type]
    const dimensions = type === 'video' ? fitVideoNode('16:9') : { w: 320, h: 220 }
    const center = editor.getViewportPageBounds().center
    const workflowCount = editor.getCurrentPageShapes().filter((shape) => shape.type === WORKFLOW_NODE_TYPE).length
    const column = workflowCount % 3
    const row = Math.floor(workflowCount / 3)
    editor.createShape({
      id: createShapeId(),
      type: WORKFLOW_NODE_TYPE,
      x: center.x - 420 + column * 520,
      y: center.y - 110 + row * 300,
      props: { ...dimensions, nodeType: type, title: definition.title, description: definition.description },
    })
    setNodeMenu(false)
    selectTool('select')
  }

  const addConnectedWorkflowNode = (type) => {
    const editor = editorRef.current
    const sourceId = portNodeMenu?.sourceId
    if (!editor || !sourceId) return
    const definitions = {
      text: { title: '文本节点', description: '输入文案、提示词或镜头描述' },
      image: { title: '图片节点', description: '导入或生成参考画面' },
      video: { title: '视频节点', description: '连接素材后生成视频' },
    }
    const definition = definitions[type]
    const sourceBounds = editor.getShapePageBounds(sourceId)
    if (!definition || !sourceBounds) return
    const dimensions = type === 'video' ? fitVideoNode('16:9') : { w: 320, h: 220 }
    const nodeId = createShapeId()
    editor.createShape({
      id: nodeId,
      type: WORKFLOW_NODE_TYPE,
      x: sourceBounds.maxX + 180,
      y: sourceBounds.center.y - 110,
      props: { ...dimensions, nodeType: type, title: definition.title, description: definition.description },
    })
    connectWorkflowShapes(sourceId, nodeId)
    editor.setSelectedShapes([nodeId])
    setPortNodeMenu(null)
    selectTool('select')
  }

  useEffect(() => {
    const open = (event) => {
      const { shapeId, x, y } = event.detail || {}
      if (!shapeId) return
      setPendingConnectionSource(null)
      setPortNodeMenu({
        sourceId: shapeId,
        x: Math.max(12, Math.min(x, window.innerWidth - 218)),
        y: Math.max(76, Math.min(y, window.innerHeight - 174)),
      })
    }
    window.addEventListener('eastv:port-add-menu', open)
    return () => window.removeEventListener('eastv:port-add-menu', open)
  }, [])

  useEffect(() => {
    if (!portNodeMenu) return undefined
    const dismiss = (event) => {
      if (!portNodeMenuRef.current?.contains(event.target)) setPortNodeMenu(null)
    }
    const onKey = (event) => event.key === 'Escape' && setPortNodeMenu(null)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onKey)
    }
  }, [portNodeMenu])

  const openGeneratedVideoFolder = useCallback(async (shapeId) => {
    const editor = editorRef.current
    const shape = editor?.getShape(shapeId)
    const fileName = shape?.props?.fileName || shape?.props?.localPath?.split(/[\\/]/).pop()
    if (!shape?.props?.localPath || !fileName) {
      setGenerationNotice({ type: 'error', text: '该视频尚未保存到本地，无法打开文件夹。' })
      return
    }
    try {
      const response = await fetch(`/__eastv/open-generated-video-folder?projectId=${encodeURIComponent(project.id)}&filename=${encodeURIComponent(fileName)}`, { method: 'POST' })
      const result = await parseApiResponse(response)
      setGenerationNotice({ type: 'success', text: `已在文件夹中选中：${result.absolutePath}` })
    } catch (error) {
      setGenerationNotice({ type: 'error', text: `打开文件夹失败：${error.message}` })
    }
  }, [project.id])

  useEffect(() => {
    const open = (event) => {
      if (event.detail?.shapeId) void openGeneratedVideoFolder(event.detail.shapeId)
    }
    window.addEventListener('eastv:open-video-folder', open)
    return () => window.removeEventListener('eastv:open-video-folder', open)
  }, [openGeneratedVideoFolder])

  const activateConnection = () => {
    const editor = editorRef.current
    if (!editor) return
    const selectedIds = editor.getSelectedShapeIds()
    if (selectedIds.length === 2 && connectWorkflowShapes(selectedIds[0], selectedIds[1])) {
      setMessages((items) => [...items, { role: 'agent', text: '已从右侧输出端口连接到左侧输入端口。移动节点时曲线会自动跟随。' }])
      return
    }
    setTool('select')
    editor.setCurrentTool('select')
    setMessages((items) => [...items, { role: 'agent', text: '请从来源节点右侧端口拖到目标节点左侧端口；点击“+”也可新建节点并自动连接。选中连线按 Delete 或双击连线均可取消，悬空连线不会保留。' }])
  }

  const groupSelectedNodes = () => {
    const editor = editorRef.current
    if (!editor || !selectionGroupToolbar?.nodeIds?.length) return
    editor.setCurrentTool('select')
    editor.groupShapes(selectionGroupToolbar.nodeIds)
    setGenerationNotice({ type: 'success', text: `已将 ${selectionGroupToolbar.nodeIds.length} 个节点打组，可整体移动。` })
  }

  const ungroupSelectedNodes = () => {
    const editor = editorRef.current
    if (!editor || !selectionGroupToolbar?.groupIds?.length) return
    editor.setCurrentTool('select')
    editor.ungroupShapes(selectionGroupToolbar.groupIds)
    setGenerationNotice({ type: 'success', text: '已拆组，节点可分别编辑。' })
  }

  const beginGroupDrag = (event, group) => {
    if (event.button !== 0) return
    const editor = editorRef.current
    const shape = editor?.getShape(group.id)
    if (!shape || shape.type !== 'group') return
    event.preventDefault()
    event.stopPropagation()
    editor.setCurrentTool('select')
    editor.setSelectedShapes([group.id])
    groupDragRef.current = { pointerId: event.pointerId, groupId: group.id, startX: event.clientX, startY: event.clientY, x: shape.x, y: shape.y, zoom: editor.getZoomLevel() }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const moveGroupDrag = (event) => {
    const drag = groupDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const editor = editorRef.current
    event.preventDefault()
    event.stopPropagation()
    editor?.updateShape({ id: drag.groupId, type: 'group', x: drag.x + (event.clientX - drag.startX) / drag.zoom, y: drag.y + (event.clientY - drag.startY) / drag.zoom })
  }

  const finishGroupDrag = (event) => {
    if (!groupDragRef.current || groupDragRef.current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    groupDragRef.current = null
  }

  const startGroupRename = (event, group) => {
    event.preventDefault()
    event.stopPropagation()
    editorRef.current?.setSelectedShapes([group.id])
    setGroupNameEditor({ id: group.id, value: group.label })
  }

  const commitGroupRename = (groupId, value) => {
    const editor = editorRef.current
    const shape = editor?.getShape(groupId)
    const label = value.trim()
    if (shape?.type === 'group' && label) editor.updateShape({ id: groupId, type: 'group', meta: { ...shape.meta, eastvGroupName: label } })
    setGroupNameEditor(null)
  }

  useEffect(() => {
    const handlePortClick = (event) => {
      const { shapeId, terminal } = event.detail || {}
      if (!shapeId) return
      if (terminal === 'output') {
        setPendingConnectionSource(shapeId)
        setMessages((items) => [...items, { role: 'agent', text: '已选择输出端口，请点击目标节点左侧的输入端口。' }])
        return
      }
      if (!pendingConnectionSource) {
        setMessages((items) => [...items, { role: 'agent', text: '请先点击来源节点右侧的“+”输出端口。' }])
        return
      }
      if (connectWorkflowShapes(pendingConnectionSource, shapeId)) {
        setMessages((items) => [...items, { role: 'agent', text: '节点端口连接成功。' }])
      }
      setPendingConnectionSource(null)
    }
    window.addEventListener('eastv:port-click', handlePortClick)
    return () => window.removeEventListener('eastv:port-click', handlePortClick)
  }, [pendingConnectionSource])

  useEffect(() => {
    const start = (event) => {
      const { shapeId, x, y } = event.detail || {}
      if (!shapeId) return
      setPendingConnectionSource(null)
      const next = { sourceId: shapeId, startX: x, startY: y, currentX: x, currentY: y }
      dragConnectionRef.current = next
      setDragConnection(next)
    }
    const move = (event) => {
      const { x, y } = event.detail || {}
      if (!dragConnectionRef.current) return
      const next = { ...dragConnectionRef.current, currentX: x, currentY: y }
      dragConnectionRef.current = next
      setDragConnection(next)
    }
    const end = (event) => {
      const { x, y } = event.detail || {}
      const current = dragConnectionRef.current
      if (!current) return
      const target = document.elementFromPoint(x, y)?.closest?.('.input-port')
      const targetId = target?.dataset?.shapeId
      if (targetId && targetId !== current.sourceId && connectWorkflowShapes(current.sourceId, targetId)) {
        setMessages((items) => [...items, { role: 'agent', text: '拖拽连线成功，移动节点时曲线会自动跟随。' }])
      } else {
        setMessages((items) => [...items, { role: 'agent', text: '未连接：请把线松开在目标节点左侧的紫色输入端口上。' }])
      }
      dragConnectionRef.current = null
      setDragConnection(null)
    }
    const cancel = () => {
      dragConnectionRef.current = null
      setDragConnection(null)
    }
    window.addEventListener('eastv:port-drag-start', start)
    window.addEventListener('eastv:port-drag-move', move)
    window.addEventListener('eastv:port-drag-end', end)
    window.addEventListener('eastv:port-drag-cancel', cancel)
    return () => {
      window.removeEventListener('eastv:port-drag-start', start)
      window.removeEventListener('eastv:port-drag-move', move)
      window.removeEventListener('eastv:port-drag-end', end)
      window.removeEventListener('eastv:port-drag-cancel', cancel)
    }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('eastv-connecting', Boolean(pendingConnectionSource || dragConnection))
    return () => document.body.classList.remove('eastv-connecting')
  }, [pendingConnectionSource, dragConnection])

  const updateModels = (nextModels, nextActiveId) => {
    setModels(nextModels)
    if (nextActiveId === 'last') setActiveModelId(nextModels.at(-1)?.id || '')
    else if (nextActiveId !== undefined) setActiveModelId(nextActiveId || '')
  }

  const insertAssetNode = ({ title, nodeType, description, previewUrl = '', imageWidth = 0, imageHeight = 0, position = null }) => {
    const editor = editorRef.current
    if (!editor) return null
    const center = editor.getViewportPageBounds().center
    const workflowCount = editor.getCurrentPageShapes().filter((shape) => shape.type === WORKFLOW_NODE_TYPE).length
    const column = workflowCount % 3
    const row = Math.floor(workflowCount / 3)
    const id = createShapeId()
    const dimensions = nodeType === 'image' ? fitImageNode(imageWidth, imageHeight) : nodeType === 'video' ? fitVideoNode('16:9') : { w: 360, h: 240 }
    editor.createShape({
      id,
      type: WORKFLOW_NODE_TYPE,
      x: position?.x ?? center.x - 420 + column * 520,
      y: position?.y ?? center.y - 120 + row * 300,
      props: { ...dimensions, nodeType, title, description, previewUrl },
    })
    return id
  }

  const placeCharacter = async (character) => {
    const images = character.images?.length
      ? character.images
      : [{ id: `${character.id}-cover`, image: character.image, fileName: character.fileName }, ...(character.referenceImages || [])]
    const preparedImages = await Promise.all(images.map(async (item) => {
      let size = { width: 0, height: 0 }
      try { size = await readImageDimensions(item.image) } catch { /* use fallback dimensions */ }
      return { ...item, size }
    }))
    const editor = editorRef.current
    if (!editor) return
    const existingBounds = editor.getCurrentPageShapes()
      .filter((shape) => shape.type === WORKFLOW_NODE_TYPE)
      .map((shape) => editor.getShapePageBounds(shape))
      .filter(Boolean)
    const viewport = editor.getViewportPageBounds()
    const startX = existingBounds.length ? Math.max(...existingBounds.map((bounds) => bounds.maxX)) + 100 : viewport.center.x - 210
    const startY = existingBounds.length ? Math.min(...existingBounds.map((bounds) => bounds.minY)) : viewport.center.y - 160
    const columns = Math.min(3, preparedImages.length)
    const cellWidth = 500
    const cellHeight = 500
    preparedImages.forEach((item, index) => insertAssetNode({
      title: preparedImages.length > 1 ? `${character.name} · ${index + 1}/${preparedImages.length}` : character.name,
      nodeType: 'image',
      description: character.description ? `角色参考：${character.description}` : '角色库参考图',
      previewUrl: item.image,
      imageWidth: item.size.width,
      imageHeight: item.size.height,
      position: { x: startX + (index % columns) * cellWidth, y: startY + Math.floor(index / columns) * cellHeight },
    }))
    setCharacterLibraryOpen(false)
    setMessages((items) => [...items, { role: 'agent', text: `角色“${character.name}”的 ${preparedImages.length} 张参考图已全部作为图片节点放入画布。` }])
  }

  const importFiles = async (event, forcedNodeType = '') => {
    const files = [...event.target.files]
    event.target.value = ''
    if (!files.length || !editorRef.current) return
    try {
      for (const file of files) {
        const nodeType = forcedNodeType || (file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image')
        const previewUrl = nodeType === 'image' ? await readFileAsDataUrl(file) : ''
        let imageSize = { width: 0, height: 0 }
        if (previewUrl) {
          try { imageSize = await readImageDimensions(previewUrl) } catch { /* use fallback dimensions */ }
        }
        let description = `本地文件 · ${(file.size / 1024 / 1024).toFixed(1)} MB`
        if (nodeType === 'script') {
          const content = await file.text()
          description = content.trim().slice(0, 180) || '本地脚本文件'
        }
        insertAssetNode({ title: file.name, nodeType, description, previewUrl, imageWidth: imageSize.width, imageHeight: imageSize.height })
      }
      setMessages((items) => [...items, { role: 'agent', text: `已把 ${files.length} 个本地文件作为可连线节点放入画布。` }])
    } catch {
      setMessages((items) => [...items, { role: 'agent', text: '文件导入失败，请先尝试 PNG、JPG、WebP 或 MP4。' }])
    }
  }

  const commitJobs = (nextJobs) => {
    const normalized = normalizeJobs(nextJobs)
    jobsRef.current = normalized
    setJobs(normalized)
    onUpdateProject(project.id, { jobs: normalized, updatedAt: new Date().toISOString() })
  }

  const patchJob = (jobId, patch) => {
    commitJobs(jobsRef.current.map((job) => job.id === jobId ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job))
  }

  const updateVideoGenerationNode = (nodeId, patch) => {
    const editor = editorRef.current
    const shape = nodeId ? editor?.getShape(nodeId) : null
    if (!shape || shape.type !== WORKFLOW_NODE_TYPE) return
    editor.updateShape({ id: nodeId, type: WORKFLOW_NODE_TYPE, props: patch })
  }

  const pollApiVideo = async (model, endpoint, initialData) => {
    let current = readApiVideoResult(initialData)
    if (current.videoUrl) return current
    if (!current.taskId) return current
    const headers = model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}
    const terminalFailures = ['failed', 'error', 'cancelled', 'canceled', 'rejected']
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (terminalFailures.includes(current.status)) throw new Error(apiErrorMessage(initialData, `生成任务${current.status || '失败'}`))
      if (current.status === 'completed' || current.status === 'succeeded' || current.status === 'success') break
      await new Promise((resolve) => window.setTimeout(resolve, 5000))
      const statusEndpoint = isDashScopeVideoModel(model)
        ? `${new URL(endpoint).origin}/api/v1/tasks/${current.taskId}`
        : current.statusUrl
          ? new URL(current.statusUrl, endpoint).toString()
          : `${endpoint.replace(/\/+$/, '')}/${current.taskId}`
      console.info(`[EasTV API] querying ${statusEndpoint}`)
      const response = await fetchWithTimeout(localApiProxyUrl(statusEndpoint), { headers }, 30000)
      const data = await parseApiResponse(response)
      const parsed = readApiVideoResult(data)
      current = {
        ...current,
        taskId: parsed.taskId || current.taskId,
        status: parsed.status || current.status,
        statusUrl: parsed.statusUrl || current.statusUrl,
        videoUrl: parsed.videoUrl || current.videoUrl,
      }
      if (current.videoUrl) return current
      if (terminalFailures.includes(current.status)) throw new Error(apiErrorMessage(data, `生成任务${current.status || '失败'}`))
    }
    if (!current.videoUrl && ['completed', 'succeeded', 'success'].includes(current.status)) {
      if (isDashScopeVideoModel(model)) throw new Error('DashScope 任务已完成，但响应中缺少 output.video_url')
      const contentEndpoint = `${endpoint.replace(/\/+$/, '')}/${current.taskId}/content`
      const response = await fetchWithTimeout(localApiProxyUrl(contentEndpoint), { headers }, 45000)
      if (!response.ok) await parseApiResponse(response)
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('json')) current.videoUrl = URL.createObjectURL(await response.blob())
    }
    if (!current.videoUrl && !['completed', 'succeeded', 'success'].includes(current.status)) throw new Error('API 任务轮询超时，请稍后重试')
    return current
  }

  const completeApiVideo = async ({ jobId, nodeId, sourceUrl, successText = 'API 任务已生成完成' }) => {
    patchJob(jobId, { status: 'saving', remoteVideoUrl: sourceUrl, error: null })
    updateVideoGenerationNode(nodeId, { description: '视频已生成，正在保存到本地…' })
    setGenerationNotice({ type: 'loading', text: '视频已生成，正在保存到本地…' })
    try {
      const saved = await persistGeneratedVideo(sourceUrl, { projectId: project.id, jobId })
      patchJob(jobId, {
        status: 'completed',
        videoUrl: saved.videoUrl,
        remoteVideoUrl: sourceUrl,
        downloadUrl: saved.downloadUrl,
        localPath: saved.localPath,
        fileName: saved.filename,
        storageStatus: 'saved',
        storageError: null,
        completedAt: new Date().toISOString(),
      })
      updateVideoGenerationNode(nodeId, {
        previewUrl: saved.videoUrl,
        downloadUrl: saved.downloadUrl,
        localPath: saved.localPath,
        fileName: saved.filename,
        description: 'API 生成完成 · 已保存到本地',
      })
      if (String(sourceUrl).startsWith('blob:')) window.setTimeout(() => URL.revokeObjectURL(sourceUrl), 0)
      setGenerationNotice({ type: 'success', text: `${successText}：${saved.localPath}` })
      return saved
    } catch (error) {
      const message = error?.name === 'AbortError' ? '保存本地视频超时' : (error?.message || '保存本地视频失败')
      const fallbackDownloadUrl = /^https?:\/\//i.test(String(sourceUrl)) ? localApiProxyUrl(sourceUrl) : sourceUrl
      patchJob(jobId, {
        status: 'completed',
        videoUrl: sourceUrl,
        remoteVideoUrl: sourceUrl,
        downloadUrl: fallbackDownloadUrl,
        localPath: '',
        storageStatus: 'failed',
        storageError: message,
        completedAt: new Date().toISOString(),
      })
      updateVideoGenerationNode(nodeId, {
        previewUrl: sourceUrl,
        downloadUrl: fallbackDownloadUrl,
        localPath: '',
        description: `生成完成 · 本地保存失败：${message}`,
      })
      setGenerationNotice({ type: 'error', text: `视频已生成，但保存到本地失败：${message}` })
      return { videoUrl: sourceUrl, downloadUrl: fallbackDownloadUrl, localPath: '' }
    }
  }

  useEffect(() => {
    if (localizedVideoProjectsRef.current.has(project.id)) return undefined
    const timer = window.setTimeout(() => {
      const editor = editorRef.current
      if (!editor) return
      localizedVideoProjectsRef.current.add(project.id)
      const remoteVideoNodes = editor.getCurrentPageShapes().filter((shape) => (
        shape.type === WORKFLOW_NODE_TYPE
        && shape.props.nodeType === 'video'
        && /^https?:\/\//i.test(shape.props.previewUrl || '')
        && !shape.props.localPath
      ))
      remoteVideoNodes.forEach((shape) => {
        const job = jobsRef.current.find((item) => item.nodeId === shape.id)
        void completeApiVideo({
          jobId: job?.id || crypto.randomUUID(),
          nodeId: shape.id,
          sourceUrl: shape.props.previewUrl,
          successText: '已有视频已保存到本地',
        })
      })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [project.id])

  const runApiGeneration = async ({ jobId, nodeId, model, text, references = [], mode = '文生视频' }) => {
    patchJob(jobId, { status: 'submitting', error: null })
    setGenerationNotice({ type: 'loading', text: `正在提交到 ${model.name}…` })
    updateVideoGenerationNode(nodeId, { description: `正在提交到 ${model.name}…` })
    try {
      const { endpoint, data } = await submitConfiguredVideo(model, { prompt: text, duration, aspect, resolution, references, generationMode: mode })
      const initial = readApiVideoResult(data)
      if (!initial.videoUrl && !initial.taskId) throw new Error('API 返回格式无法识别：缺少视频地址或任务 ID')
      patchJob(jobId, { status: initial.videoUrl ? 'saving' : 'processing', remoteTaskId: initial.taskId || null })
      updateVideoGenerationNode(nodeId, { description: initial.videoUrl ? '视频已生成，正在保存到本地…' : `API 生成中${initial.taskId ? ` · ${initial.taskId}` : ''}` })
      const result = initial.videoUrl ? initial : await pollApiVideo(model, endpoint, data)
      if (result.videoUrl) {
        await completeApiVideo({ jobId, nodeId, sourceUrl: result.videoUrl, successText: `${model.name} 已生成完成` })
      } else {
        patchJob(jobId, { status: 'processing', remoteTaskId: result.taskId || null })
        setGenerationNotice({ type: 'loading', text: result.taskId ? `API 已接受任务：${result.taskId}` : 'API 已接受请求，但未返回视频地址或任务 ID' })
      }
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'API 请求超时' : (error?.message || 'API 调用失败')
      patchJob(jobId, { status: 'failed', error: message })
      updateVideoGenerationNode(nodeId, { description: `生成失败：${message}` })
      setGenerationNotice({ type: 'error', text: message.includes('Failed to fetch') ? 'API 无法访问，请检查地址、服务状态或 CORS 设置' : message })
    }
  }

  const resumeApiJob = async (job) => {
    const model = models.find((item) => item.id === job.modelId)
    if (!model || !job.remoteTaskId) return
    patchJob(job.id, { status: 'processing', error: null })
    setGenerationNotice({ type: 'loading', text: `正在重新查询任务 ${job.remoteTaskId}…` })
    try {
      const endpoint = isDashScopeVideoModel(model) ? (() => { const url = new URL(model.endpoint); url.pathname = '/api/v1/services/aigc/video-generation/video-synthesis'; url.search = ''; return url.toString() })() : resolveVideoApiEndpoint(model.endpoint)
      const statusUrl = isDashScopeVideoModel(model) ? `${new URL(model.endpoint).origin}/api/v1/tasks/${job.remoteTaskId}` : `${endpoint.replace(/\/+$/, '')}/${job.remoteTaskId}`
      const result = await pollApiVideo(model, endpoint, { id: job.remoteTaskId, status: 'processing', status_url: statusUrl })
      if (!result.videoUrl) throw new Error('任务尚未返回视频地址')
      await completeApiVideo({ jobId: job.id, nodeId: job.nodeId, sourceUrl: result.videoUrl })
    } catch (error) {
      const message = error?.message || '任务查询失败'
      patchJob(job.id, { status: 'failed', error: message })
      setGenerationNotice({ type: 'error', text: message })
    }
  }

  const createGeneration = () => {
    const text = prompt.trim()
    if (!text) return
    const editor = editorRef.current
    const nodeId = editor ? createShapeId() : null
    const job = { id: crypto.randomUUID(), nodeId, prompt: text, modelId: activeModelId || null, modelName: activeModel?.name || null, modelKind: activeModel?.kind || null, mode: generationMode, durationSeconds: duration, aspect, resolution, promptEnhance, status: activeModel?.kind === 'api' ? 'queued' : 'blocked', createdAt: new Date().toISOString() }
    commitJobs([job, ...jobsRef.current])
    if (editor) {
      const center = editor.getViewportPageBounds().center
      const dimensions = fitVideoNode(aspect)
      editor.createShape({
        id: nodeId,
        type: WORKFLOW_NODE_TYPE,
        x: center.x - 180,
        y: center.y - 120,
        props: {
          ...dimensions,
          nodeType: 'video',
          title: activeModel ? activeModel.name : '视频生成任务',
          description: `${generationMode} · ${duration} 秒 · ${aspect} · ${resolution} · ${text.slice(0, 54)}`,
        },
      })
    }
    setPrompt('')
    if (activeModel?.kind === 'api') {
      setMessages((items) => [...items, { role: 'agent', text: `任务已提交给 API 模型“${activeModel.name}”。` }])
      void runApiGeneration({ jobId: job.id, nodeId, model: activeModel, text, mode: job.mode })
    } else {
      setMessages((items) => [...items, { role: 'agent', text: activeModel ? `任务已使用“${activeModel.name}”配置并放到画布，等待本地 Runner。` : '任务已经放到画布。请先添加本地模型。' }])
    }
  }

  const closeNodePrompt = () => {
    editorRef.current?.selectNone()
    setSelectedVideoNodeId(null)
  }

  const referenceConnectedMaterial = (material) => {
    const reference = `@${material.title}`
    setNodePromptDraft((current) => current.includes(reference) ? current : `${current}${current && !current.endsWith(' ') ? ' ' : ''}${reference} `)
    requestAnimationFrame(() => nodePromptTextareaRef.current?.focus())
  }

  const removeConnectedMaterial = (material) => {
    const editor = editorRef.current
    if (!editor?.getShape(material.arrowId)) return
    editor.deleteShape(material.arrowId)
    setConnectedMaterials((items) => items.filter((item) => item.arrowId !== material.arrowId))
    setNodePromptDraft((current) => current.replace(`@${material.title}`, '').replace(/\s{2,}/g, ' ').trimStart())
    setMessages((items) => [...items, { role: 'agent', text: `已断开素材“${material.title}”与当前视频节点的连线。` }])
  }

  const submitNodeGeneration = () => {
    const text = nodePromptDraft.trim()
    const editor = editorRef.current
    if (!text || !editor || !selectedVideoNodeId) return
    const shape = editor.getShape(selectedVideoNodeId)
    if (!shape || shape.type !== WORKFLOW_NODE_TYPE) return
    editor.updateShape({
      id: selectedVideoNodeId,
      type: WORKFLOW_NODE_TYPE,
      props: {
        promptText: text,
        description: `${generationMode} · ${duration} 秒 · ${aspect} · ${resolution} · ${text.slice(0, 42)}`,
      },
    })
    const job = { id: crypto.randomUUID(), nodeId: selectedVideoNodeId, prompt: text, references: connectedMaterials.map(({ sourceId, title, nodeType }) => ({ sourceId, title, nodeType })), modelId: activeModelId || null, modelName: activeModel?.name || null, modelKind: activeModel?.kind || null, mode: generationMode, durationSeconds: duration, aspect, resolution, promptEnhance, status: activeModel?.kind === 'api' ? 'queued' : 'blocked', createdAt: new Date().toISOString() }
    commitJobs([job, ...jobsRef.current])
    if (activeModel?.kind === 'api') {
      setMessages((items) => [...items, { role: 'agent', text: `视频节点任务正在调用 API 模型“${activeModel.name}”。` }])
      void runApiGeneration({ jobId: job.id, nodeId: selectedVideoNodeId, model: activeModel, text, references: connectedMaterials, mode: job.mode })
    } else {
      setMessages((items) => [...items, { role: 'agent', text: activeModel ? `视频节点提示词已保存，任务等待“${activeModel.name}”执行。` : '视频节点提示词已保存。添加模型后即可执行任务。' }])
    }
  }

  const dragCurvePath = dragConnection ? (() => {
    const dx = dragConnection.currentX - dragConnection.startX
    const handle = Math.max(70, Math.min(260, Math.abs(dx) * .48))
    return `M ${dragConnection.startX} ${dragConnection.startY} C ${dragConnection.startX + handle} ${dragConnection.startY}, ${dragConnection.currentX - handle} ${dragConnection.currentY}, ${dragConnection.currentX} ${dragConnection.currentY}`
  })() : ''

  return (
    <div className={`workspace ${connectionsHidden ? 'connections-hidden' : ''}`}>
      {dragConnection && <svg className="connection-drag-overlay" aria-hidden="true"><path d={dragCurvePath} /><circle cx={dragConnection.currentX} cy={dragConnection.currentY} r="5" /></svg>}
      <div className="canvas-shell" ref={canvasShellRef}>
        <Tldraw onMount={handleMount} shapeUtils={workflowShapeUtils} components={tldrawComponents} hideUi />

        {visualGroups.map((group) => <div
          className="canvas-group-visual"
          key={group.id}
          style={{ left: group.x - 18, top: group.y - 18, width: group.w + 36, height: group.h + 36 }}
        >
          {groupNameEditor?.id === group.id ? <input
            className="canvas-group-name-input"
            autoFocus
            value={groupNameEditor.value}
            maxLength={32}
            aria-label="分组名称"
            onChange={(event) => setGroupNameEditor((current) => current ? { ...current, value: event.target.value } : current)}
            onBlur={() => commitGroupRename(group.id, groupNameEditor.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitGroupRename(group.id, groupNameEditor.value)
              if (event.key === 'Escape') setGroupNameEditor(null)
            }}
          /> : <button
            className="canvas-group-name"
            title="双击重命名；拖动可移动整个分组"
            onPointerDown={(event) => beginGroupDrag(event, group)}
            onPointerMove={moveGroupDrag}
            onPointerUp={finishGroupDrag}
            onPointerCancel={finishGroupDrag}
            onDoubleClick={(event) => startGroupRename(event, group)}
          >{group.label}</button>}
          {['top', 'right', 'bottom', 'left'].map((side) => <span
            key={side}
            className={`canvas-group-drag-edge ${side}`}
            title="拖动移动整个分组"
            onPointerDown={(event) => beginGroupDrag(event, group)}
            onPointerMove={moveGroupDrag}
            onPointerUp={finishGroupDrag}
            onPointerCancel={finishGroupDrag}
          />)}
        </div>)}

        {portNodeMenu && <div
          ref={portNodeMenuRef}
          className="port-node-menu"
          style={{ left: portNodeMenu.x, top: portNodeMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <strong>引用该节点生成</strong>
          <button onClick={() => addConnectedWorkflowNode('text')}><FileText size={17} /><span>文本</span></button>
          <button onClick={() => addConnectedWorkflowNode('image')}><ImagePlus size={17} /><span>图片</span></button>
          <button onClick={() => addConnectedWorkflowNode('video')}><Film size={17} /><span>视频</span></button>
        </div>}

        {selectionGroupToolbar && <div
          className="selection-group-toolbar"
          style={{ left: selectionGroupToolbar.x, top: selectionGroupToolbar.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {selectionGroupToolbar.action === 'group' ? <>
            <span><Boxes size={15} /> 已框选 {selectionGroupToolbar.count} 个节点</span>
            <button onClick={groupSelectedNodes}><Boxes size={16} /> 打组</button>
          </> : <>
            <span><Boxes size={15} /> 已选中 {selectionGroupToolbar.count} 个分镜组</span>
            <button onClick={ungroupSelectedNodes}><Link2 size={16} /> 拆组</button>
          </>}
        </div>}


        <header className="canvas-topbar">
          <button className="brand compact" onClick={onHome}><span className="brand-mark"><Video size={16} /></span>EasTV</button>
          <span className="topbar-divider" />
          <div className="project-select-wrap">
            <select value={project.id} onChange={(event) => switchProject(event.target.value)}>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown size={15} />
          </div>
          <div className="topbar-spacer" />
          <div className={`model-status ${activeModel ? 'ready' : ''}`}><span /> {activeModel ? activeModel.name : '未添加模型'}</div>
          <button className="topbar-button" onClick={() => setModelManagerOpen(true)}><Settings2 size={17} /> 模型</button>
          <button className="topbar-button" onClick={() => setCharacterLibraryOpen(true)}><Users size={17} /> 角色库</button>
          <a className="mcp-status" href={AGENT_BRIDGE_DOWNLOAD} download="EasTV-Agent-Bridge.zip" title="下载可分发的 EasTV MCP Agent 接入包"><Download size={15} /><span>Agent 接入包</span><small>下载</small></a>
        </header>

        <nav className="canvas-tools">
          <ToolButton label="选择" active={tool === 'select'} onClick={() => selectTool('select')}><MousePointer2 size={20} /></ToolButton>
          <ToolButton label="移动" active={tool === 'hand'} onClick={() => selectTool('hand')}><Hand size={20} /></ToolButton>
          <div className="tool-divider" />
          <ToolButton label="文本" active={tool === 'text'} onClick={() => selectTool('text')}><Type size={20} /></ToolButton>
          <ToolButton label="形状" active={tool === 'geo'} onClick={() => selectTool('geo')}><Square size={20} /></ToolButton>
          <ToolButton label="连线" active={tool === 'arrow'} onClick={activateConnection}><Link2 size={20} /></ToolButton>
          <ToolButton label="本地文件" onClick={() => fileRef.current?.click()}><ImagePlus size={20} /></ToolButton>
          <ToolButton label="角色库" onClick={() => setCharacterLibraryOpen(true)}><Users size={20} /></ToolButton>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" hidden onChange={importFiles} />
          <input ref={imageFileRef} type="file" multiple accept="image/*" hidden onChange={importFiles} />
          <input ref={audioFileRef} type="file" multiple accept="audio/*" hidden onChange={(event) => importFiles(event, 'audio')} />
          <input ref={scriptFileRef} type="file" multiple accept=".txt,.md,.markdown,.json,.srt,.vtt,.ass,.csv,text/*,application/json" hidden onChange={(event) => importFiles(event, 'script')} />
        </nav>

        <div className="zoom-controls">
          <button onClick={() => editorRef.current?.zoomOut()}><Minus size={16} /></button>
          <button onClick={() => editorRef.current?.resetZoom()}>100%</button>
          <button onClick={() => editorRef.current?.zoomIn()}><Plus size={16} /></button>
          <button className={connectionsHidden ? 'active' : ''} title={connectionsHidden ? '显示节点连线' : '隐藏节点连线'} onClick={() => setConnectionsHidden((value) => !value)}>{connectionsHidden ? <Eye size={16} /> : <EyeOff size={16} />}</button>
          <button className={gridSnapEnabled ? 'active' : ''} title={gridSnapEnabled ? '关闭网格吸附' : '开启网格吸附'} onClick={() => setGridSnapEnabled((value) => !value)}><Magnet size={16} /></button>
        </div>

        {jobs.length > 0 && <button className="task-pill" onClick={() => setTaskListOpen((value) => !value)}><LoaderCircle size={14} /> {jobs.length} 个任务 <span>{jobs.filter((job) => ['queued', 'submitting', 'processing', 'saving'].includes(job.status)).length} 个生成中 · {jobs.filter((job) => job.status === 'blocked').length} 个等待本地模型 · {jobs.filter((job) => job.status === 'failed').length} 个失败</span></button>}
        {taskListOpen && <div className="task-list-popover"><header><strong>生成任务</strong><button onClick={() => setTaskListOpen(false)}><X size={14} /></button></header>{jobs.slice(0, 8).map((job) => <article key={job.id}><div><strong>{job.modelName || '未选择模型'}</strong><span>{job.status === 'completed' ? '已完成' : job.status === 'failed' ? '失败' : job.status === 'blocked' ? '等待本地模型' : job.status === 'saving' ? '正在保存本地' : '生成中'}</span></div><p>{job.storageError || job.error || job.prompt}</p>{job.remoteTaskId && <small>任务 ID：{job.remoteTaskId}</small>}{job.localPath && <small className="task-local-path" title={job.localPath}>本地文件：{job.localPath}</small>}<div className="task-actions">{job.status === 'failed' && job.remoteTaskId && <button onClick={() => void resumeApiJob(job)}>重新查询</button>}{job.downloadUrl && <a href={job.downloadUrl} download={job.fileName || 'eastv-video.mp4'}><Download size={12} /> 下载视频</a>}</div></article>)}</div>}
        {generationNotice && <div className={`generation-notice ${generationNotice.type}`}><span>{generationNotice.type === 'loading' && <LoaderCircle size={15} />}{generationNotice.type === 'success' && <Check size={15} />}{generationNotice.type === 'error' && <X size={15} />}{generationNotice.text}</span><button onClick={() => setGenerationNotice(null)}><X size={14} /></button></div>}

        {selectedVideoNodeId && nodePromptAnchor && (
          <section className="node-prompt-panel" style={{ left: nodePromptAnchor.left, top: nodePromptAnchor.top, width: nodePromptAnchor.width }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <header className="node-prompt-toolbar">
              <div><button onClick={() => setCharacterLibraryOpen(true)}><Users size={14} /> 角色库</button></div>
              <button className="node-panel-close" onClick={closeNodePrompt}><X size={17} /></button>
            </header>
            {connectedMaterials.length > 0 && <div className="node-connected-materials">
              {connectedMaterials.map((material, index) => <div className="connected-material" key={material.arrowId}>
                <button className="material-reference" title={`点击引用 ${material.title}`} onClick={() => referenceConnectedMaterial(material)}>
                  {material.previewUrl ? <img src={material.previewUrl} alt={material.title} /> : material.nodeType === 'video' ? <Film size={22} /> : material.nodeType === 'audio' ? <Music2 size={22} /> : <ImagePlus size={22} />}
                  <span className="material-number">{index + 1}</span>
                  <span className="material-at">@</span>
                </button>
                <button className="material-remove" aria-label={`取消素材 ${material.title} 的连线`} title="取消连线" onClick={() => removeConnectedMaterial(material)}><X size={12} /></button>
                <small>{material.title}</small>
              </div>)}
              <span className="material-help">点击缩略图引用到提示词</span>
            </div>}
            <textarea ref={nodePromptTextareaRef} value={nodePromptDraft} onChange={(event) => setNodePromptDraft(event.target.value)} placeholder="描述你想生成的画面内容、角色动作和镜头运动；点击上方素材可插入引用" />
            <footer className="node-prompt-footer" ref={nodePreferencesRef}>
              <button onClick={() => setModelManagerOpen(true)}><Boxes size={14} /> {activeModel?.name || '添加模型'} <ChevronDown size={13} /></button>
              <select value={generationMode} onChange={(event) => setGenerationMode(event.target.value)}>{ALL_GENERATION_MODES.map((mode) => <option key={mode} disabled={!isGenerationModeSupported(activeModel, mode)}>{mode}</option>)}</select>
              <div className="node-control-wrap">
                <button onClick={() => { setNodeAspectOpen(!nodeAspectOpen); setNodeDurationOpen(false); setNodeSettingsOpen(false) }}><span className={`ratio-mini ratio-${aspect.replace(':','-')}`} /> {aspect}</button>
                {nodeAspectOpen && <div className="node-inline-popover node-ratio-picker"><strong>选择生成比例</strong><div>{['21:9','16:9','4:3','1:1','3:4','9:16'].map((value) => <button key={value} className={aspect === value ? 'selected' : ''} onClick={() => { applyAspect(value); setNodeAspectOpen(false) }}><i className={`ratio-shape ratio-${value.replace(':','-')}`} /><span>{value}</span></button>)}</div></div>}
              </div>
              <div className="node-control-wrap">
                <button onClick={() => { setNodeDurationOpen(!nodeDurationOpen); setNodeAspectOpen(false); setNodeSettingsOpen(false) }}>{duration} 秒 <ChevronDown size={12} /></button>
                {nodeDurationOpen && <div className="node-inline-popover node-duration-picker"><strong>选择视频生成时长</strong><div className="duration-row"><div className="slider-wrap"><input aria-label="节点视频生成时长" type="range" min="1" max="15" step="1" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><div className="slider-ticks"><span>1</span><span>5</span><span>10</span><span>15</span></div></div><label><input aria-label="节点视频秒数" type="number" min="1" max="15" value={duration} onChange={(event) => setDuration(Math.max(1, Math.min(15, Number(event.target.value) || 1)))} /><span>s</span></label></div></div>}
              </div>
              <div className="node-control-wrap">
                <button className="node-settings" aria-label="节点生成设置" onClick={() => { setNodeSettingsOpen(!nodeSettingsOpen); setNodeAspectOpen(false); setNodeDurationOpen(false) }}><Settings2 size={15} /></button>
                {nodeSettingsOpen && <div className="node-inline-popover node-settings-picker"><strong>生成设置</strong><label><span>分辨率</span><select value={resolution} onChange={(event) => setResolution(event.target.value)}><option>720P</option><option>1080P</option></select></label><label className="node-toggle"><span>提示词优化</span><input type="checkbox" checked={promptEnhance} onChange={(event) => setPromptEnhance(event.target.checked)} /></label></div>}
              </div>
              <span className="node-cost"><Zap size={12} /> 本地</span>
              <button className="node-submit" disabled={!nodePromptDraft.trim()} onClick={submitNodeGeneration}><Send size={17} /></button>
            </footer>
          </section>
        )}

        <section className="generation-composer">
          <div className="composer-input-row">
            <div className="node-add-wrap" ref={nodeMenuRef}>
              <button className="composer-add" onClick={() => setNodeMenu(!nodeMenu)}><Plus size={19} /></button>
              {nodeMenu && <div className="node-menu">
                <strong>添加画布节点</strong>
                <button onClick={() => addWorkflowNode('text')}><span className="node-icon text"><FileText size={17} /></span><span>文本节点<small>文案、提示词、镜头说明</small></span></button>
                <button onClick={() => { setNodeMenu(false); imageFileRef.current?.click() }}><span className="node-icon image"><ImagePlus size={17} /></span><span>图片节点<small>选择本地图片后创建</small></span></button>
                <button onClick={() => addWorkflowNode('video')}><span className="node-icon video"><Film size={17} /></span><span>视频节点<small>本地模型生成任务</small></span></button>
                <button onClick={() => { setNodeMenu(false); audioFileRef.current?.click() }}><span className="node-icon audio"><Music2 size={17} /></span><span>音频节点<small>选择本地音频后创建</small></span></button>
                <button onClick={() => { setNodeMenu(false); scriptFileRef.current?.click() }}><span className="node-icon script"><Workflow size={17} /></span><span>脚本节点<small>选择本地脚本后创建</small></span></button>
                <button onClick={() => { setNodeMenu(false); fileRef.current?.click() }}><span className="node-icon file"><Upload size={17} /></span><span>导入本地文件<small>图片、视频或音频</small></span></button>
              </div>}
            </div>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); createGeneration() }
            }} placeholder="描述你想生成的视频，例如：晨雾中的森林，镜头缓慢向前推进……" />
            <button className="send-button" disabled={!prompt.trim()} onClick={createGeneration}><Zap size={18} /></button>
          </div>
          <div className="composer-options">
            <button className="add-local-model" onClick={() => setModelManagerOpen(true)}><Boxes size={15} /> {activeModel ? activeModel.name : '添加模型'} <ChevronDown size={14} /></button>
            <div className="preference-control" ref={modeRef}>
              <button onClick={() => { setModeOpen(!modeOpen); setAspectOpen(false); setDurationOpen(false) }}><Film size={13} /> {generationMode} <ChevronDown size={13} /></button>
              {modeOpen && <div className="preference-popover mode-popover"><header><div><strong>视频生成方式</strong><small>选择输入素材的组织方式</small></div><span>视频</span></header><div className="mode-grid">{[
                ['文生视频','T','只使用文字描述生成视频'],
                ['首帧生视频','1','从一张起始画面生成动态'],
                ['首尾帧生视频','2','指定起始与结束画面'],
                ['参考图生视频','R','使用角色或风格参考图'],
              ].map(([value, mark, description]) => {
                const supported = isGenerationModeSupported(activeModel, value)
                return <button key={value} disabled={!supported} className={generationMode === value ? 'selected' : ''} title={supported ? description : `${activeModel?.name || '当前模型'} 不支持该方式`} onClick={() => { setGenerationMode(value); setModeOpen(false) }}><i>{mark}</i><span><strong>{value}</strong><small>{supported ? description : '当前模型不支持'}</small></span>{generationMode === value && <Check size={16} />}</button>
              })}</div><div className="mode-hint"><Sparkles size={14} /><span>{generationMode === '文生视频' ? '只传提示词，不传图片素材。' : generationMode === '首帧生视频' ? '素材 1 会作为 first_frame 传入。' : generationMode === '首尾帧生视频' ? '素材 1 作为 first_frame，素材 2 作为 last_frame。' : '连接的图片/视频会按顺序作为 reference_image / reference_video 传入。'}</span></div></div>}
            </div>
            <div className="preference-control" ref={aspectRef}>
              <button onClick={() => { setAspectOpen(!aspectOpen); setModeOpen(false); setDurationOpen(false) }}><span className={`ratio-mini ratio-${aspect.replace(':','-')}`} /> {aspect} <ChevronDown size={13} /></button>
              {aspectOpen && <div className="preference-popover ratio-popover"><header><strong>生成偏好</strong><span>视频</span></header><small>选择比例</small><div className="ratio-grid">{['智能','21:9','16:9','4:3','1:1','3:4','9:16'].map((value) => <button key={value} className={aspect === value ? 'selected' : ''} onClick={() => { applyAspect(value); setAspectOpen(false) }}><i className={`ratio-shape ratio-${value.replace(':','-')}`} /> <span>{value}</span></button>)}</div><div className="preference-footer"><button onClick={() => setModelManagerOpen(true)}><Boxes size={14} />{activeModel?.name || '选择模型'}<ChevronDown size={13} /></button><span>视频 · 本地优先</span></div></div>}
            </div>
            <div className="preference-control" ref={durationRef}>
              <button onClick={() => { setDurationOpen(!durationOpen); setModeOpen(false); setAspectOpen(false) }}>{duration} 秒 <ChevronDown size={13} /></button>
              {durationOpen && <div className="preference-popover duration-popover"><strong>选择视频生成时长</strong><div className="duration-row"><div className="slider-wrap"><input aria-label="视频生成时长" type="range" min="1" max="15" step="1" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><div className="slider-ticks"><span>1</span><span>5</span><span>10</span><span>15</span></div></div><label><input type="number" min="1" max="15" value={duration} onChange={(event) => setDuration(Math.max(1, Math.min(15, Number(event.target.value) || 1)))} /><span>s</span></label></div></div>}
            </div>
          </div>
        </section>
      </div>

      {modelManagerOpen && <ModelManager models={models} activeModelId={activeModelId} onChange={updateModels} onClose={() => setModelManagerOpen(false)} />}
      {characterLibraryOpen && <CharacterLibrary characters={characters} onChange={setCharacters} onPlace={placeCharacter} onClose={() => setCharacterLibraryOpen(false)} />}
    </div>
  )
}

export default function App() {
  const [projects, setProjects] = useState(loadProjects)
  const [view, setView] = useState('home')
  const [activeId, setActiveId] = useState(projects[0]?.id)

  useEffect(() => { persistStoredList(STORAGE_KEY, compactProjects(projects)) }, [projects])

  const activeProject = useMemo(() => projects.find((item) => item.id === activeId) || projects[0], [activeId, projects])

  const createProject = (name) => {
    const now = new Date().toISOString()
    const project = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, jobs: [] }
    setProjects((items) => [project, ...items])
    setActiveId(project.id)
    setView('canvas')
  }

  const openProject = (id) => { setActiveId(id); setView('canvas') }
  const renameProject = (id, name) => setProjects((items) => items.map((item) => item.id === id ? { ...item, name, updatedAt: new Date().toISOString() } : item))
  const deleteProject = (id) => {
    localStorage.removeItem(`${CANVAS_PREFIX}${id}`)
    setProjects((items) => items.filter((item) => item.id !== id))
    if (activeId === id) setActiveId(projects.find((item) => item.id !== id)?.id || null)
  }
  const updateProject = useCallback((id, patch) => setProjects((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)), [])

  if (view === 'home' || !activeProject) return <ProjectHome projects={projects} onCreate={createProject} onOpen={openProject} onRename={renameProject} onDelete={deleteProject} />

  return <CanvasWorkspace key="workspace" project={activeProject} projects={projects} onProjectChange={setActiveId} onHome={() => setView('home')} onUpdateProject={updateProject} />
}
