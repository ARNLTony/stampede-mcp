#!/usr/bin/env node
/**
 * Stampede MCP server
 *
 * Exposes the read-only surface of the public Stampede API (https://stampede-liard.vercel.app)
 * as MCP tools, so any MCP client (Claude Desktop, Claude Code, etc.) can query
 * Bitcoin Stamps data in natural language.
 *
 * Auth: optional. Set STAMPEDE_API_KEY to send an X-API-Key header. The read
 * endpoints work anonymously, but a key gives you attribution and rate limits.
 * The key must carry the `read:stamps` and `read:profiles` scopes.
 *
 * Config (env vars):
 *   STAMPEDE_API_BASE  Base URL incl. version. Default: https://stampede-liard.vercel.app/api/v1
 *   STAMPEDE_API_KEY   Optional API key sent as X-API-Key.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const API_BASE = (process.env.STAMPEDE_API_BASE || 'https://stampede-liard.vercel.app/api/v1').replace(/\/+$/, '')
const API_KEY = process.env.STAMPEDE_API_KEY || null

/**
 * GET a Stampede API path with query params. Returns the parsed JSON body.
 * Throws on network errors; API-level errors are returned to the caller as JSON
 * so the model can see the `error.code` / `error.message`.
 */
async function apiGet(path, params = {}) {
  const url = new URL(API_BASE + path)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  const headers = { Accept: 'application/json' }
  if (API_KEY) headers['X-API-Key'] = API_KEY

  const res = await fetch(url, { headers })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { success: false, error: { code: 'NON_JSON_RESPONSE', message: text.slice(0, 500) } }
  }
  return { status: res.status, body }
}

/** Wrap an API result as an MCP tool text response. */
function toResult({ status, body }) {
  const isError = status >= 400 || body?.success === false
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
  }
}

const server = new McpServer({
  name: 'stampede-mcp',
  version: '0.1.0',
})

// ---------------------------------------------------------------------------
// Tier 1: read-only tools
// ---------------------------------------------------------------------------

const pagination = {
  page: z.number().int().min(1).max(100000).optional().describe('Page number (1-based). Default 1.'),
  limit: z.number().int().min(1).max(200).optional().describe('Results per page. Default 50, max 200.'),
}

server.tool(
  'list_stamps',
  'List/browse Bitcoin Stamps with filters and sorting. SRC-20 tokens are always excluded. Use this for "show me curated stamps", "stamps by creator X", "newest stamps", etc.',
  {
    ident: z.string().optional().describe("Filter by protocol type, e.g. 'STAMP'."),
    curated: z.boolean().optional().describe('If true, only curated stamps.'),
    wishlisted: z.boolean().optional().describe('If true, only stamps with at least one favorite (sorted by most favorited).'),
    creator: z.string().optional().describe('Bitcoin address of the creator (starts with 1 or bc1q).'),
    owner: z.string().optional().describe('Bitcoin address of the current owner.'),
    owners: z.string().optional().describe('Comma-separated list of addresses; matches creator OR owner.'),
    sort: z.enum(['newest', 'oldest', 'most_liked', 'most_discussed', 'most_favorited', 'file_size', 'random']).optional()
      .describe('Sort order. Default newest.'),
    ...pagination,
  },
  async (args) => toResult(await apiGet('/stamps', {
    ident: args.ident,
    curated: args.curated ? 'true' : undefined,
    wishlisted: args.wishlisted ? 'true' : undefined,
    creator: args.creator,
    owner: args.owner,
    owners: args.owners,
    sort: args.sort,
    page: args.page,
    limit: args.limit,
  }))
)

server.tool(
  'get_stamp',
  'Get full enriched detail for a single stamp by its stamp NUMBER (an integer, not a cpid). Includes creator/owner profile info, like/favorite counts, and directory placement if curated.',
  {
    id: z.number().int().min(0).describe('The stamp number (integer).'),
  },
  async ({ id }) => toResult(await apiGet(`/stamps/${id}`))
)

server.tool(
  'search_stamps',
  'Full-text search over stamps by cpid, creator address, stamp number, or description. Query must be at least 2 characters.',
  {
    q: z.string().min(2).describe('Search query (min 2 characters).'),
    ...pagination,
  },
  async ({ q, page, limit }) => toResult(await apiGet('/search/stamps', { q, page, limit }))
)

server.tool(
  'search_profiles',
  'Search creator/collector profiles by display name, bio, linked Bitcoin address, or interest tag. Query must be at least 2 characters.',
  {
    q: z.string().min(2).describe('Search query (min 2 characters).'),
    ...pagination,
  },
  async ({ q, page, limit }) => toResult(await apiGet('/search/profiles', { q, page, limit }))
)

server.tool(
  'search_all',
  'Combined search returning both stamps and profiles for a query. Good general-purpose entry point. Query must be at least 2 characters. Not paginated.',
  {
    q: z.string().min(2).describe('Search query (min 2 characters).'),
  },
  async ({ q }) => toResult(await apiGet('/search', { q }))
)

server.tool(
  'suggest',
  'Fast autocomplete/overview for a query: returns up to ~10 stamps, 6 profiles, and 3 collections. If the query looks like a Bitcoin address it also returns a wallet result. Query must be at least 2 characters.',
  {
    q: z.string().min(2).describe('Search query (min 2 characters).'),
  },
  async ({ q }) => toResult(await apiGet('/search/suggestions', { q }))
)

server.tool(
  'get_profile',
  'Get a public profile by its numeric profile ID, including follower/following counts and interest tags.',
  {
    id: z.number().int().min(0).describe('The numeric profile ID.'),
  },
  async ({ id }) => toResult(await apiGet(`/profiles/${id}`))
)

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stderr is safe for logging; stdout is the MCP transport.
  console.error(`stampede-mcp connected. API base: ${API_BASE}${API_KEY ? ' (with API key)' : ' (anonymous)'}`)
}

main().catch((err) => {
  console.error('Fatal error starting stampede-mcp:', err)
  process.exit(1)
})
