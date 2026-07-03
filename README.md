# stampede-mcp

Official [Model Context Protocol](https://modelcontextprotocol.io) server for the **Stampede API** — query [Bitcoin Stamps](https://stampchain.io) data (stamps, creators, collections) from any MCP client such as Claude Desktop or Claude Code.

It's a thin adapter over the public Stampede REST API: each MCP tool maps to a read endpoint. No database, no secrets required — the read surface works anonymously.

## Tools

| Tool | What it does |
|------|--------------|
| `list_stamps` | Browse/filter stamps (`ident`, `curated`, `creator`, `owner`, `owners`, `sort`, pagination). SRC-20 excluded. |
| `get_stamp` | Full enriched detail for one stamp by its **stamp number**. |
| `search_stamps` | Full-text search over stamps (cpid, creator, number, description). |
| `search_profiles` | Search creator/collector profiles (name, bio, address, tags). |
| `search_all` | Combined stamps + profiles search. |
| `suggest` | Fast autocomplete: ~10 stamps + 6 profiles + 3 collections, plus wallet detection. |
| `get_profile` | Public profile by numeric ID. |

All tools are **read-only**. Write actions (likes, comments) are planned for a future release — the underlying API already supports them via scoped API keys.

## Install

```bash
npm install
```

## Configuration

Set via environment variables (see [`.env.example`](.env.example)):

| Var | Required | Default |
|-----|----------|---------|
| `STAMPEDE_API_BASE` | No | `https://stampede-liard.vercel.app/api/v1` |
| `STAMPEDE_API_KEY` | No | _none_ (anonymous) — sent as `X-API-Key`; needs `read:stamps` + `read:profiles` scopes |

## Use with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stampede": {
      "command": "node",
      "args": ["/absolute/path/to/stampede-mcp/src/index.js"],
      "env": {
        "STAMPEDE_API_KEY": "optional-key-here"
      }
    }
  }
}
```

## Use with Claude Code

```bash
claude mcp add stampede -- node /absolute/path/to/stampede-mcp/src/index.js
```

## Develop

Run the MCP Inspector to try the tools interactively:

```bash
npm run inspect
```

## License

MIT © ARNLTony
