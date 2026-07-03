# stampede-mcp

Official [Model Context Protocol](https://modelcontextprotocol.io) server for the **Stampede API** — query [Bitcoin Stamps](https://stampchain.io) data (stamps, creators, collections) from any MCP client such as Claude Desktop or Claude Code.

It's a thin adapter over the public Stampede REST API: each MCP tool maps to a read endpoint. No database, no secrets required — the read surface works anonymously.

## Tools

**Stamps**

| Tool | What it does |
|------|--------------|
| `list_stamps` | Browse/filter stamps (`ident`, `curated`, `creator`, `owner`, `owners`, `sort`, pagination). SRC-20 excluded. |
| `get_stamp` | Full enriched detail for one stamp by its **stamp number**. |
| `search_stamps` | Full-text search over stamps (cpid, creator, number, description). |
| `get_stamp_discussion` | Comments + emoji reactions thread for a stamp. |
| `get_stamp_holders` | Current holders of a stamp (live from stampchain), enriched with known profiles. |
| `get_stamp_dispensers` | Open dispensers (sale listings) for a stamp. |

**Profiles**

| Tool | What it does |
|------|--------------|
| `get_profile` | Public profile by numeric ID. |
| `search_profiles` | Search creator/collector profiles (name, bio, address, tags). |
| `get_profile_stamps` | Stamps created by a profile. |
| `get_profile_favorites` | A profile's public wishlist (favorited stamps). |
| `get_profile_collections` | A profile's public collections. |
| `get_profile_followers` | Followers of a profile. |
| `get_profile_following` | Profiles a profile follows. |

**Collections & directories**

| Tool | What it does |
|------|--------------|
| `list_collections` | Browse public collections, ranked by followers. |
| `get_collection` | One collection by numeric ID, with its full stamp list. |
| `list_directories` | List the official stamp directories. |
| `get_directory_indexes` | Indexes (sub-sections) within a directory. |
| `get_directory_stamps` | Stamps catalogued in a directory (optionally filtered by index). |

**Search**

| Tool | What it does |
|------|--------------|
| `search_all` | Combined stamps + profiles search. |
| `suggest` | Fast autocomplete: ~10 stamps + 6 profiles + 3 collections, plus wallet detection. |

**Write** (require `STAMPEDE_API_KEY` with write scopes — see below)

| Tool | What it does | Scope |
|------|--------------|-------|
| `like_stamp` / `unlike_stamp` | Like / unlike a stamp. | `write:reactions` |
| `favorite_stamp` / `unfavorite_stamp` | Add / remove a stamp from your wishlist. | `write:reactions` |
| `post_comment` | Comment on a stamp or collection (with optional reply). | `write:comments` |
| `add_reaction` / `remove_reaction` | Add / remove an emoji reaction on a discussion post (max 3/post). | `write:reactions` |

The read tools work anonymously. The write tools act as the profile your API key is bound to, and return a clear `NO_API_KEY` error if no key is set.

## Install

Published on npm — no clone required. Any MCP client can launch it with `npx`:

```bash
npx -y stampede-mcp
```

Or install globally:

```bash
npm install -g stampede-mcp
```

## Configuration

Set via environment variables (see [`.env.example`](.env.example)):

| Var | Required | Default |
|-----|----------|---------|
| `STAMPEDE_API_BASE` | No | `https://stampede-liard.vercel.app/api/v1` |
| `STAMPEDE_API_KEY` | No | _none_ (anonymous) — sent as `X-API-Key`. Issue one from the Stampede **Developer** page. Reads need `read:stamps` + `read:profiles`; writes need `write:reactions` and/or `write:comments`. |

## Use with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stampede": {
      "command": "npx",
      "args": ["-y", "stampede-mcp"],
      "env": {
        "STAMPEDE_API_KEY": "optional-key-here"
      }
    }
  }
}
```

Omit the `env` block to run read-only (anonymous).

## Use with Claude Code

```bash
# read-only
claude mcp add stampede -- npx -y stampede-mcp

# with a key (unlocks write tools), available in every project
claude mcp add -s user stampede -e STAMPEDE_API_KEY=your_key -- npx -y stampede-mcp
```

## Develop

Clone the repo, install dev dependencies, then run the MCP Inspector to try the tools interactively:

```bash
git clone https://github.com/ARNLTony/stampede-mcp.git
cd stampede-mcp
npm install
npm run inspect
```

## License

MIT © ARNLTony
