import { randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod/v4'
import type { McpRuntimeStatus } from '../../types/api'
import type { Archive, DiaryEntry, Mood, SearchParams } from '../../types/model'
import { archives } from '../database/archives'
import { getDiaryMetadataBatch, readDiaryPlainText, searchDiaries } from '../database/diary'

export interface McpServerConfig {
  enabled: boolean
  host: '127.0.0.1'
  port: number
  authToken: string
  maxSearchResults: number
  maxReadChars: number
  maxBatchMetadata: number
}

const DEFAULT_MCP_CONFIG: McpServerConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 37373,
  authToken: '',
  maxSearchResults: 20,
  maxReadChars: 4000,
  maxBatchMetadata: 30
}

const MOODS = ['happy', 'calm', 'sad', 'excited', 'tired'] as const
const SNIPPET_LENGTH = 50
const MAX_REQUEST_BYTES = 1024 * 1024
const START_TIMEOUT_MS = 5000

let httpServer: Server | null = null
let activeConfig: McpServerConfig = { ...DEFAULT_MCP_CONFIG }
let lastError = ''
const transports = new Map<string, StreamableHTTPServerTransport>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

export function normalizeMcpServerConfig(value: unknown): McpServerConfig {
  if (!isRecord(value)) return { ...DEFAULT_MCP_CONFIG }

  return {
    enabled: value.enabled === true,
    host: '127.0.0.1',
    port: clampInteger(value.port, DEFAULT_MCP_CONFIG.port, 1024, 65535),
    authToken:
      typeof value.authToken === 'string' && value.authToken.trim() ? value.authToken.trim() : '',
    maxSearchResults: clampInteger(
      value.maxSearchResults,
      DEFAULT_MCP_CONFIG.maxSearchResults,
      1,
      100
    ),
    maxReadChars: clampInteger(value.maxReadChars, DEFAULT_MCP_CONFIG.maxReadChars, 500, 20000),
    maxBatchMetadata: clampInteger(
      value.maxBatchMetadata,
      DEFAULT_MCP_CONFIG.maxBatchMetadata,
      1,
      100
    )
  }
}

export function getDefaultMcpServerConfig(): McpServerConfig {
  return { ...DEFAULT_MCP_CONFIG }
}

export function getMcpServerStatus(): McpRuntimeStatus {
  return {
    enabled: activeConfig.enabled,
    running: httpServer !== null,
    url: `http://${activeConfig.host}:${activeConfig.port}/mcp`,
    host: activeConfig.host,
    port: activeConfig.port,
    error: lastError || undefined
  }
}

export async function applyMcpServerConfig(config: McpServerConfig): Promise<McpRuntimeStatus> {
  const normalized = normalizeMcpServerConfig(config)
  const shouldRestart =
    httpServer !== null &&
    (normalized.enabled !== activeConfig.enabled ||
      normalized.port !== activeConfig.port ||
      normalized.authToken !== activeConfig.authToken ||
      normalized.maxSearchResults !== activeConfig.maxSearchResults ||
      normalized.maxReadChars !== activeConfig.maxReadChars ||
      normalized.maxBatchMetadata !== activeConfig.maxBatchMetadata)

  activeConfig = normalized

  if (!normalized.enabled) {
    await stopMcpServer()
    lastError = ''
    return getMcpServerStatus()
  }

  if (httpServer && !shouldRestart) {
    lastError = ''
    return getMcpServerStatus()
  }

  if (httpServer) {
    await stopMcpServer()
  }

  try {
    await startMcpServer(normalized)
    lastError = ''
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    console.error('Failed to start MCP server:', error)
  }

  return getMcpServerStatus()
}

export async function stopMcpServer(): Promise<void> {
  for (const transport of transports.values()) {
    try {
      await transport.close()
    } catch (error) {
      console.error('Failed to close MCP transport:', error)
    }
  }
  transports.clear()

  const server = httpServer
  httpServer = null
  if (!server) return

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

function startMcpServer(config: McpServerConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleHttpRequest(req, res, config)
    })

    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('MCP server start timed out'))
    }, START_TIMEOUT_MS)

    const handleError = (error: Error): void => {
      clearTimeout(timeout)
      reject(error)
    }

    server.once('error', handleError)

    server.listen(config.port, config.host, () => {
      clearTimeout(timeout)
      server.off('error', handleError)
      httpServer = server
      resolve()
    })
  })
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.trim()) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, MCP-Session-Id, Mcp-Session-Id'
  )
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function isAuthorized(req: IncomingMessage, config: McpServerConfig): boolean {
  if (!config.authToken) return false
  const authorization = req.headers.authorization
  return authorization === `Bearer ${config.authToken}`
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_REQUEST_BYTES) {
      throw new Error('Request body too large')
    }
    chunks.push(buffer)
  }

  if (chunks.length === 0) return undefined
  const body = Buffer.concat(chunks).toString('utf8')
  if (!body.trim()) return undefined
  return JSON.parse(body) as unknown
}

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: McpServerConfig
): Promise<void> {
  setCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${config.host}:${config.port}`)
  if (url.pathname !== '/mcp') {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  if (!isAuthorized(req, config)) {
    res.setHeader('www-authenticate', 'Bearer')
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  try {
    const sessionId = req.headers['mcp-session-id']
    let transport: StreamableHTTPServerTransport | undefined
    let parsedBody: unknown

    if (typeof sessionId === 'string' && sessionId) {
      transport = transports.get(sessionId)
    } else if (req.method === 'POST') {
      parsedBody = await readJsonBody(req)
      if (isInitializeRequest(parsedBody)) {
        transport = createTransport(config)
        const server = createDiaryMcpServer(config)
        await server.connect(transport)
      }
    }

    if (!transport) {
      sendJson(res, 400, {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: initialize first or provide a valid MCP-Session-Id'
        },
        id: null
      })
      return
    }

    await transport.handleRequest(req, res, parsedBody)
  } catch (error) {
    console.error('Error handling MCP request:', error)
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      })
    }
  }
}

function createTransport(config: McpServerConfig): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      transports.set(sessionId, transport)
    }
  })

  transport.onclose = () => {
    const sessionId = transport.sessionId
    if (sessionId) {
      transports.delete(sessionId)
    }
  }
  transport.onerror = (error) => {
    console.error('MCP transport error:', error)
  }

  void config
  return transport
}

function createDiaryMcpServer(config: McpServerConfig): McpServer {
  const server = new McpServer({
    name: 'shadowdiary-local',
    version: '0.3.0'
  })

  server.registerTool(
    'diary_search',
    {
      title: 'Search diary entries',
      description:
        'Search diary entries by keyword, one day, date range, mood, and tags. Returns compact snippets only. Use diary_read for a selected entry.',
      inputSchema: {
        keyword: z.string().optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        mood: z.enum(MOODS).optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional()
      }
    },
    async (args) => {
      const result = searchDiaries(buildSearchParams(args, config))
      const entries = result.entries.map(toSearchItem)
      return textResult({
        total: result.total,
        hasMore: (args.offset ?? 0) + entries.length < result.total,
        limit: Math.min(args.limit ?? 10, config.maxSearchResults),
        offset: args.offset ?? 0,
        expandedKeywords: result.expandedKeywords,
        entries
      })
    }
  )

  server.registerTool(
    'diary_read',
    {
      title: 'Read diary entry text',
      description:
        'Read one diary entry as plain text by id. Content is paginated with offset and maxChars to avoid large responses.',
      inputSchema: {
        id: z.string().min(1),
        offset: z.number().int().min(0).optional(),
        maxChars: z.number().int().min(1).optional()
      }
    },
    async ({ id, offset, maxChars }) => {
      const read = readDiaryPlainText({
        id,
        offset,
        maxChars: Math.min(maxChars ?? config.maxReadChars, config.maxReadChars)
      })
      if (!read) return textResult({ error: 'not_found', id }, true)
      return textResult(read)
    }
  )

  server.registerTool(
    'diary_read_by_date',
    {
      title: 'Read diary entries by date',
      description:
        'Read complete plain-text diary entries by date range. dateFrom is required. dateTo is optional; when omitted, only dateFrom is returned.',
      inputSchema: {
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Start date in YYYY-MM-DD format'),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('End date in YYYY-MM-DD format. Defaults to dateFrom.'),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional()
      }
    },
    async ({ dateFrom, dateTo, limit, offset }) => {
      const range = parseDateRange(dateFrom, dateTo)
      if (!range) {
        return textResult({ error: 'invalid_date_range', dateFrom, dateTo }, true)
      }

      const effectiveLimit = Math.min(limit ?? config.maxSearchResults, config.maxSearchResults)
      const effectiveOffset = offset ?? 0
      const result = searchDiaries({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        limit: effectiveLimit,
        offset: effectiveOffset,
        lightweight: true
      })

      return textResult({
        dateFrom,
        dateTo: dateTo ?? dateFrom,
        range: {
          from: range.from,
          to: range.to
        },
        total: result.total,
        limit: effectiveLimit,
        offset: effectiveOffset,
        hasMore: effectiveOffset + result.entries.length < result.total,
        entries: result.entries.map(toFullDiaryItem)
      })
    }
  )

  server.registerTool(
    'diary_get_metadata_batch',
    {
      title: 'Get diary metadata batch',
      description:
        'Get metadata for one or more diary entries without returning content. The server enforces a batch size limit.',
      inputSchema: {
        ids: z.array(z.string().min(1)).min(1)
      }
    },
    async ({ ids }) => {
      if (ids.length > config.maxBatchMetadata) {
        return textResult(
          {
            error: 'too_many_ids',
            maxBatchMetadata: config.maxBatchMetadata
          },
          true
        )
      }
      return textResult({
        entries: getDiaryMetadataBatch(ids),
        requested: ids.length
      })
    }
  )

  server.registerTool(
    'archive_search_by_name',
    {
      title: 'Search archives by name or alias',
      description:
        'Search archives (people, objects, etc.) by any name, alias, or partial keyword. The query is matched against both the primary name and aliases without distinction. Returns archive content including description and aliases.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe('Name, alias, or any partial keyword to search archives by.'),
        limit: z.number().int().min(1).optional()
      }
    },
    async ({ name, limit }) => {
      const effectiveLimit = Math.min(limit ?? config.maxSearchResults, config.maxSearchResults)
      const matches = archives.searchByName(name, effectiveLimit)
      return textResult({
        query: name,
        total: matches.length,
        limit: effectiveLimit,
        entries: matches.map(toArchiveItem)
      })
    }
  )

  return server
}

function textResult(
  value: unknown,
  isError = false
): {
  isError?: boolean
  content: Array<{ type: 'text'; text: string }>
} {
  return {
    isError,
    content: [
      {
        type: 'text',
        text: JSON.stringify(value)
      }
    ]
  }
}

function buildSearchParams(
  args: {
    keyword?: string
    date?: string
    dateFrom?: string
    dateTo?: string
    mood?: Mood
    tags?: string[]
    limit?: number
    offset?: number
  },
  config: McpServerConfig
): SearchParams {
  const dateFrom = args.date ? parseLocalDayStart(args.date) : parseLocalDayStart(args.dateFrom)
  const dateTo = args.date ? parseLocalDayStart(args.date) : parseLocalDayStart(args.dateTo)

  return {
    keyword: args.keyword?.trim() || undefined,
    mood: args.mood,
    tags: args.tags?.map((tag) => tag.trim()).filter(Boolean),
    dateFrom,
    dateTo,
    limit: Math.min(args.limit ?? 10, config.maxSearchResults),
    offset: args.offset ?? 0,
    lightweight: true
  }
}

function parseLocalDayStart(value: string | undefined): number | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

function parseDateRange(
  dateFrom: string,
  dateTo?: string
): {
  dateFrom: number
  dateTo: number
  from: string
  to: string
} | null {
  const from = parseExactLocalDate(dateFrom)
  const to = parseExactLocalDate(dateTo ?? dateFrom)
  if (!from || !to) return null
  if (from.getTime() > to.getTime()) return null

  return {
    dateFrom: from.getTime(),
    dateTo: to.getTime(),
    from: formatLocalDate(from),
    to: formatLocalDate(to)
  }
}

function parseExactLocalDate(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null

  const date = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function toFullDiaryItem(entry: DiaryEntry): {
  id: string
  title: string
  mood: Mood
  tags: string[]
  weather?: string
  createdAt: number
  updatedAt: number
  content: string
} {
  return {
    id: entry.id,
    title: entry.title,
    mood: entry.mood,
    tags: entry.tags,
    weather: entry.weather,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    content: entry.content
  }
}

function toSearchItem(entry: DiaryEntry): {
  id: string
  title: string
  mood: Mood
  tags: string[]
  weather?: string
  createdAt: number
  updatedAt: number
  snippet: string
} {
  const content = entry.content.replace(/\s+/g, ' ').trim()
  return {
    id: entry.id,
    title: entry.title,
    mood: entry.mood,
    tags: entry.tags,
    weather: entry.weather,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    snippet: content.length > SNIPPET_LENGTH ? `${content.slice(0, SNIPPET_LENGTH)}...` : content
  }
}

function toArchiveItem(archive: Archive): {
  id: string
  name: string
  aliases: string[]
  type: Archive['type']
  description?: string
  createdAt: number
  updatedAt: number
} {
  return {
    id: archive.id,
    name: archive.name,
    aliases: archive.aliases,
    type: archive.type,
    description: archive.description,
    createdAt: archive.createdAt,
    updatedAt: archive.updatedAt
  }
}
