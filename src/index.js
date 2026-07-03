#!/usr/bin/env node
/**
 * Stampede MCP server
 *
 * Exposes the public Stampede API (https://stampede-liard.vercel.app) as MCP
 * tools, so any MCP client (Claude Desktop, Claude Code, etc.) can query and
 * interact with Bitcoin Stamps data in natural language.
 *
 * Auth: read tools work anonymously. Set STAMPEDE_API_KEY to send an X-API-Key
 * header — this gives reads attribution/rate limits and UNLOCKS the write tools
 * (like, favorite, comment, react). Writes act as the profile the key is bound
 * to and require the relevant scope: read:stamps + read:profiles for reads,
 * write:reactions and/or write:comments for writes.
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

/**
 * Send a write request (POST/PUT/DELETE) with an optional JSON body.
 * Write endpoints REQUIRE authentication, so this short-circuits with a clear
 * error if no API key is configured. The action is performed as the profile the
 * key is bound to.
 */
async function apiSend(method, path, body) {
  if (!API_KEY) {
    return {
      status: 401,
      body: {
        success: false,
        error: {
          code: 'NO_API_KEY',
          message: 'This action requires authentication. Set STAMPEDE_API_KEY (issued from the Stampede Developer page, with the write:reactions and/or write:comments scope) to enable write tools.',
        },
      },
    }
  }

  const url = new URL(API_BASE + path)
  const headers = { Accept: 'application/json', 'X-API-Key': API_KEY }
  const init = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  const res = await fetch(url, init)
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { success: false, error: { code: 'NON_JSON_RESPONSE', message: text.slice(0, 500) } }
  }
  return { status: res.status, body: parsed }
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
  version: '0.3.1',
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
// Tier 2: sub-resource reads (discussion, holders, profile activity,
// collections, directories)
// ---------------------------------------------------------------------------

server.tool(
  'get_stamp_discussion',
  'Get the discussion thread (comments and emoji reactions) for a single stamp, by stamp NUMBER. Returns posts in chronological order.',
  {
    id: z.number().int().min(0).describe('The stamp number (integer).'),
  },
  async ({ id }) => toResult(await apiGet(`/stamps/${id}/discussion`))
)

server.tool(
  'get_stamp_holders',
  'List the current holders (addresses) of a stamp, by stamp NUMBER. Known Stampede profiles are enriched onto matching addresses. Sourced live from stampchain.',
  {
    id: z.number().int().min(0).describe('The stamp number (integer).'),
    page: z.number().int().min(1).optional().describe('Page number (1-based). Default 1.'),
    limit: z.number().int().min(1).max(100).optional().describe('Results per page. Default 20, max 100.'),
  },
  async ({ id, page, limit }) => toResult(await apiGet(`/stamps/${id}/holders`, { page, limit }))
)

server.tool(
  'get_stamp_dispensers',
  'List the open dispensers (sale listings) for a stamp, by stamp NUMBER. Sourced live from stampchain.',
  {
    id: z.number().int().min(0).describe('The stamp number (integer).'),
    page: z.number().int().min(1).optional().describe('Page number (1-based). Default 1.'),
    limit: z.number().int().min(1).max(100).optional().describe('Results per page. Default 20, max 100.'),
  },
  async ({ id, page, limit }) => toResult(await apiGet(`/stamps/${id}/dispensers`, { page, limit }))
)

server.tool(
  'get_profile_stamps',
  'List the stamps created by a profile, by numeric profile ID. Newest first.',
  {
    id: z.number().int().min(0).describe('The numeric profile ID.'),
    ...pagination,
  },
  async ({ id, page, limit }) => toResult(await apiGet(`/profiles/${id}/stamps`, { page, limit }))
)

server.tool(
  'get_profile_favorites',
  "List a profile's public wishlist — the stamps they have favorited — by numeric profile ID. Most recently favorited first.",
  {
    id: z.number().int().min(0).describe('The numeric profile ID.'),
    ...pagination,
  },
  async ({ id, page, limit }) => toResult(await apiGet(`/profiles/${id}/favorites`, { page, limit }))
)

server.tool(
  'get_profile_collections',
  "List a profile's public collections, by numeric profile ID, each with a stamp count.",
  {
    id: z.number().int().min(0).describe('The numeric profile ID.'),
    ...pagination,
  },
  async ({ id, page, limit }) => toResult(await apiGet(`/profiles/${id}/collections`, { page, limit }))
)

server.tool(
  'get_profile_followers',
  'List the followers of a profile, by numeric profile ID. Most recent first.',
  {
    id: z.number().int().min(0).describe('The numeric profile ID.'),
    ...pagination,
  },
  async ({ id, page, limit }) => toResult(await apiGet(`/profiles/${id}/followers`, { page, limit }))
)

server.tool(
  'get_profile_following',
  'List the profiles a profile is following, by numeric profile ID. Most recent first.',
  {
    id: z.number().int().min(0).describe('The numeric profile ID.'),
    ...pagination,
  },
  async ({ id, page, limit }) => toResult(await apiGet(`/profiles/${id}/following`, { page, limit }))
)

server.tool(
  'list_collections',
  'Browse public curated collections of stamps, ranked by follower count then recency. Each collection includes owner info, stamp/follower/like counts, and a preview of up to 32 stamps.',
  {
    ...pagination,
  },
  async ({ page, limit }) => toResult(await apiGet('/collections', { page, limit }))
)

server.tool(
  'get_collection',
  'Get a single public collection by its numeric ID, including owner info, counts, and the full list of stamps in the collection.',
  {
    id: z.number().int().min(0).describe('The numeric collection ID.'),
  },
  async ({ id }) => toResult(await apiGet(`/collections/${id}`))
)

server.tool(
  'list_directories',
  'List the official stamp directories (curated catalogues such as named indexes). No parameters. Use get_directory_stamps to browse the stamps inside one.',
  {},
  async () => toResult(await apiGet('/directories'))
)

server.tool(
  'get_directory_indexes',
  'List the indexes (sub-sections/releases) within a directory, by numeric directory ID. Use an index ID to filter get_directory_stamps.',
  {
    id: z.number().int().min(0).describe('The numeric directory ID.'),
  },
  async ({ id }) => toResult(await apiGet(`/directories/${id}/indexes`))
)

server.tool(
  'get_directory_stamps',
  'List the stamps catalogued in a directory, by numeric directory ID. Optionally filter to a single index. Most recently added first.',
  {
    id: z.number().int().min(0).describe('The numeric directory ID.'),
    indexId: z.number().int().min(0).optional().describe('Optional numeric directory index ID to filter by.'),
    ...pagination,
  },
  async ({ id, indexId, page, limit }) => toResult(await apiGet(`/directories/${id}/stamps`, { indexId, page, limit }))
)

// ---------------------------------------------------------------------------
// Tier 3: write tools (require STAMPEDE_API_KEY with write scopes).
// Actions are performed as the profile the key is bound to.
// ---------------------------------------------------------------------------

server.tool(
  'like_stamp',
  'Like a stamp on behalf of the authenticated profile, by stamp NUMBER. Requires an API key with the write:reactions scope. Idempotent — liking twice is a no-op.',
  {
    id: z.number().int().min(0).describe('The stamp number (integer).'),
  },
  async ({ id }) => toResult(await apiSend('POST', `/stamps/${id}/like`))
)

server.tool(
  'unlike_stamp',
  'Remove the authenticated profile\'s like from a stamp, by stamp NUMBER. Requires an API key with the write:reactions scope.',
  {
    id: z.number().int().min(0).describe('The stamp number (integer).'),
  },
  async ({ id }) => toResult(await apiSend('DELETE', `/stamps/${id}/like`))
)

server.tool(
  'favorite_stamp',
  'Add a stamp to the authenticated profile\'s wishlist/favorites, by stamp NUMBER. Requires an API key with the write:reactions scope. Idempotent.',
  {
    id: z.number().int().min(0).describe('The stamp number (integer).'),
  },
  async ({ id }) => toResult(await apiSend('POST', `/stamps/${id}/favorite`))
)

server.tool(
  'unfavorite_stamp',
  'Remove a stamp from the authenticated profile\'s wishlist/favorites, by stamp NUMBER. Requires an API key with the write:reactions scope.',
  {
    id: z.number().int().min(0).describe('The stamp number (integer).'),
  },
  async ({ id }) => toResult(await apiSend('DELETE', `/stamps/${id}/favorite`))
)

server.tool(
  'post_comment',
  'Post a comment in a stamp or collection discussion, as the authenticated profile. Provide EXACTLY ONE of stampId or collectionId. Optionally set parentPostId to reply to an existing post. Requires an API key with the write:comments scope.',
  {
    content: z.string().min(1).max(10000).describe('The comment text (1–10,000 characters).'),
    stampId: z.number().int().min(0).optional().describe('Stamp number to comment on. Provide this OR collectionId, not both.'),
    collectionId: z.number().int().min(0).optional().describe('Collection ID to comment on. Provide this OR stampId, not both.'),
    parentPostId: z.number().int().min(0).optional().describe('ID of the post being replied to (must belong to the same stamp/collection).'),
  },
  async ({ content, stampId, collectionId, parentPostId }) => {
    if ((stampId == null && collectionId == null) || (stampId != null && collectionId != null)) {
      return toResult({
        status: 400,
        body: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Provide exactly one of stampId or collectionId.' } },
      })
    }
    return toResult(await apiSend('POST', '/discussions', { content, stampId, collectionId, parentPostId }))
  }
)

server.tool(
  'add_reaction',
  'Add an emoji reaction to a discussion post, as the authenticated profile. Max 3 distinct emoji per post per profile. Requires an API key with the write:reactions scope.',
  {
    postId: z.number().int().min(0).describe('The discussion post ID.'),
    emoji: z.string().min(1).max(10).describe('A single emoji (max 10 chars; no < > " \' & characters).'),
  },
  async ({ postId, emoji }) => toResult(await apiSend('POST', `/discussions/${postId}/reactions`, { emoji }))
)

server.tool(
  'remove_reaction',
  'Remove the authenticated profile\'s emoji reaction from a discussion post. Requires an API key with the write:reactions scope.',
  {
    postId: z.number().int().min(0).describe('The discussion post ID.'),
    emoji: z.string().min(1).max(10).describe('The emoji reaction to remove.'),
  },
  async ({ postId, emoji }) => toResult(await apiSend('DELETE', `/discussions/${postId}/reactions/${encodeURIComponent(emoji)}`))
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
