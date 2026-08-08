# 🔥 Token Burn Dashboard

Real-time token usage analytics dashboard with cost tracking, built with a MonkeyType-inspired aesthetic.

[![Tests](https://img.shields.io/badge/tests-bun%20test-blue)](./tests)
[![Linting](https://img.shields.io/badge/linting-eslint-green)](./eslint.config.mjs)
[![License](https://img.shields.io/badge/license-MIT-yellow)](./LICENSE)

## Features

### 📊 Real-Time Analytics
- Live token usage tracking from Pi and Claude Code session files
- Server-Sent Events (SSE) for automatic updates every 5 seconds
- Historical trend visualization with sparklines
- Deep insights with AI-powered pattern analysis

### 💰 Cost Analysis
- Per-model cost estimation
- Configurable pricing per 1M tokens for 7 providers
- Total cost breakdown (input, output, cache read, cache write, reasoning)
- Cache efficiency metrics and savings calculation

### 📈 Visualizations
- Interactive donut charts (Plotly.js)
- Bar chart model comparisons
- Sparkline trend graphs
- Timeline view with range selection (1h to 30d)
- Daily usage bar chart and heatmap views
- Model distribution pie charts

### 🧠 Smart Insights
- Automated efficiency analysis
- Cost trajectory projections
- Cache optimization suggestions
- Usage velocity tracking

### 🎨 Themes
- Dark mode (default) - terminal-inspired aesthetic
- Light mode
- Automatic preference persistence

## Quick Start

[Bun](https://bun.sh/) 1.3.11 or newer is required either way. Pick whichever
path matches your setup — both end up running the same server and frontend.

### As a user (plain Bun, no mise)

```bash
# Install dependencies
bun install

# Start the server
bun run start

# Or in development mode
bun run dev

# Dashboard will be available at:
open http://127.0.0.1:7071
```

This binds to `127.0.0.1:7071` by default. Set `HOST`/`PORT` to change that
(see [Configuration](#configuration)).

### As a developer (via mise)

The repo pins its Bun and Node versions in [`.mise.toml`](.mise.toml). If you
use [mise](https://mise.jdx.dev/) it'll install the pinned toolchain and expose
two ready-made tasks that also wire up hot-reload and a Tailnet-reachable URL:

```bash
# Install the pinned toolchain (bun, node)
mise install

# Dev mode: Bun server + Vite (HMR), bound to your Tailnet IPv4
mise run dev

# Prod mode: builds the frontend, then runs the Bun server, bound to your Tailnet IPv4
mise run prod
```

Both `mise run` tasks require the `tailscale` CLI on `PATH` (they call
`tailscale ip -4` to pick a bind address) and poll `/api/health` until the
server is ready, printing the reachable URL once it is. If you don't have
Tailscale set up, use the plain Bun path above instead — `bun run dev` /
`bun run start` bind to `127.0.0.1` and don't need it.

### Either way

The dashboard itself needs nothing else to work. The AI Insights tab is the
one exception: it shells out to the `taskferry` CLI and shows a friendly
"unavailable" state if `taskferry` isn't on `PATH`; see [Configuration](#configuration).

On first boot you may see a line like `Skipping large file: <path> (NNMB)` —
that's the `MAX_SESSION_BYTES` guard working as intended on an oversized
session log, not an error.

## Docker

A pre-built image is published to GHCR on every push to `main` via
[`.github/workflows/build.yml`](.github/workflows/build.yml), tagged both
`:latest` and `:sha-<short-commit>`:

```
ghcr.io/jeremysball/token-burn-dashboard:latest
```

### docker-compose

```bash
docker compose up -d
```

See [`docker-compose.yml`](docker-compose.yml). It mounts `~/.claude/projects`
and `~/.pi` (read-only) so the dashboard can find session data, and binds
`HOST=0.0.0.0` so the container is reachable from outside itself. Set
`DASHBOARD_PROJECT_ROOT` (or just rely on the `${HOME}` default) to point the
"Git Blame for AI" tab at the directory containing the git repos you want it
to shell out against. Uncomment `DASHBOARD_AUTH_TOKEN`/`ALLOWED_ORIGINS` in the
compose file to lock down access before exposing this beyond localhost.

### Plain `docker run`

```bash
docker run -d \
  -p 7071:7071 \
  -e HOST=0.0.0.0 \
  -v ~/.claude/projects:/home/app/.claude/projects:ro \
  -v ~/.pi:/home/app/.pi:ro \
  -v ~/workspace:/home/app/projects:ro \
  -e DASHBOARD_PROJECT_ROOT=/home/app/projects \
  ghcr.io/jeremysball/token-burn-dashboard:latest
```

## Development

### Testing
```bash
# Run all unit tests with coverage
bun test tests/unit --coverage

# Run tests in watch mode
bun run test:watch

# Run linting
bun run lint

# Fix linting issues
bun run lint:fix
```

### Frontend dev server (HMR)

The dashboard frontend can also be served through Vite for hot module
reloading during UI work:

```bash
# Terminal 1: backend API
bun run dev

# Terminal 2: Vite dev server with HMR, proxying /api to the backend
bun run dev:ui
```

Vite serves the dashboard on its own port and proxies `/api` requests to the
backend (`http://127.0.0.1:7071` by default, override with `BACKEND_URL`).

### Building the frontend for production

```bash
bun run build:ui
```

This bundles `dashboard/` into `dist-dashboard/`. When `server.js` is started
with `NODE_ENV=production`, it serves `dist-dashboard/` instead of the raw
`dashboard/` source (talking to Vite at all only happens in dev mode above).

### Testing Stack
- **Bun test** - Bun's built-in test runner with coverage
- **happy-dom** - DOM implementation for unit tests (with `@happy-dom/global-registrator`)
- **Playwright** - E2E testing via `@playwright/test`

### Test Structure
```
tests/
├── unit/                 # Unit tests
│   ├── config.test.js   # Configuration & pricing tests
│   ├── utils.test.js    # Utility function tests
│   ├── state.test.js    # State management tests
│   ├── api.test.js      # API client tests
│   └── lib/             # Server-side tests
├── charts.spec.js       # Chart rendering E2E tests
├── mobile.spec.js       # Mobile responsive E2E tests
└── mock-data.js         # Shared test fixtures
```

## Views

### Dashboard
- Grand totals with animated counters
- Real-time sparkline trends
- Top models grid with mini-charts
- AI-generated insights cards

### Analytics
- **Models Tab**: Sortable, filterable model table
- **Compare Tab**: Side-by-side model comparison with bar charts
- **Timeline Tab**: Time-series with range selection (1h, 24h, 7d, 30d, all)
- **Daily Tab**: Daily usage bar chart
- **Distribution Tab**: Token distribution pie charts
- **Insights Tab**: Deep analytics with pattern detection
- **Scale Tab**: Token scale visualization
- **Code Tab**: Lines of code, languages, and project metrics
- **Heatmaps Tab**: Usage patterns across time and models
- **Git Blame Tab**: AI-associated commit and project analysis
- **Spikes Tab**: Detect and investigate usage spikes

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tokens` | GET | Current cumulative token totals |
| `/api/tokens/historical` | GET | Per-hour token deltas from session files |
| `/api/tokens/stream` | GET | SSE real-time updates |
| `/api/insights/analyze` | POST | AI pattern analysis from summary data; returns 503 if the `taskferry` CLI is unavailable |
| `/api/pricing` | GET | Local model pricing table |
| `/api/git/blame` | GET | AI-associated commit and session analysis |
| `/api/spikes` | GET | Detect recent token-usage spikes |
| `/api/spikes/investigate` | GET | Investigate a spike by timestamp |
| `/api/health` | GET | Health check with uptime |

## Data Sources

The dashboard reads session files from both Pi and Claude Code:

```text
# Pi (one level deep only, not fully recursive)
~/.pi/sessions/*.jsonl
~/.pi/agent/sessions/*/*.jsonl

# Claude Code (recursive, depth-capped)
~/.claude/projects/**/*.jsonl
```

Claude Code discovery can be redirected with `CLAUDE_PROJECTS_DIR`, and
additional Pi session directories can be supplied with `EXTRA_SESSION_DIRS`.
To scan *only* directories you name, rather than adding to the defaults above,
set `PI_SESSION_DIRS` — it replaces the built-in Pi base list outright.

## Configuration

### Environment Variables

Copy [`.env.example`](.env.example) to `.env` to configure the server. All
variables are optional; the defaults shown there are used when a value is
unset.

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `7071`) |
| `HOST` | Bind address (default `127.0.0.1`) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins; empty disables cross-origin access |
| `DASHBOARD_AUTH_TOKEN` | Bearer token required for `/api/*` requests when set |
| `DASHBOARD_PROJECT_ROOT` | Root containing repositories for Git Blame's path restriction (defaults to `$HOME`); does not affect session discovery |
| `TASKFERRY_INSIGHTS_MODEL` | Model passed to taskferry for AI insights (default `opencode/deepseek-v4-flash-free`) |
| `DASHBOARD_INSIGHTS_SCRATCH_DIR` | Isolated scratch directory for taskferry insights jobs |
| `EXTRA_SESSION_DIRS` | Comma- or colon-separated additional Pi session directories (appended to `PI_SESSION_BASES`; does not affect Claude Code discovery) |
| `PI_SESSION_DIRS` | Comma- or colon-separated Pi session directories that *replace* the built-in base list (unlike `EXTRA_SESSION_DIRS`, which appends). Use to scan only named directories; does not affect Claude Code discovery |
| `CLAUDE_PROJECTS_DIR` | Override the Claude Code projects directory (default `~/.claude/projects`) |
| `MAX_SESSION_BYTES` | Maximum session file size in bytes (default `104857600`) |
| `OPENROUTER_MODELS_URL` | OpenRouter models endpoint for live pricing |
| `OPENROUTER_REFRESH_MS` | OpenRouter pricing refresh interval in milliseconds |
| `OPENROUTER_TIMEOUT_MS` | OpenRouter request timeout in milliseconds |
| `OPENROUTER_DISABLE_AUTOFETCH` | Set to `1` to disable background OpenRouter pricing fetches |

The `/api/insights/analyze` endpoint dispatches work through the `taskferry`
CLI. Install `taskferry` and make it available on `PATH`; otherwise this
endpoint returns `503 Service Unavailable`.

### Supported Model Pricing
The local fallback pricing table covers 7 provider families:
- **OpenAI**: GPT-4o, GPT-4o-mini, o1-mini, o3-mini, and o1
- **Claude**: Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku, and other Claude models
- **DeepSeek**: DeepSeek Chat and DeepSeek Reasoner
- **Gemini**: Gemini 1.5 Pro, Gemini 1.5 Flash, and other Gemini models
- **Kimi**: Kimi K2.6, Kimi K2.5, and Kimi K2
- **GLM**: GLM models
- **Minimax**: Minimax M3 (`minimax-m3` in `lib/pricing.js`)
- **Default**: Fallback pricing for unknown models

OpenRouter pricing is fetched dynamically when available and takes precedence
over the local fallback.

### Theme
Toggle between dark/light modes with the ☾ button.

## Architecture

```
token-burn-dashboard/
├── server.js              # HTTP server + API
├── dashboard/
│   ├── index.html         # Main dashboard
│   ├── js/
│   │   ├── main.js        # Entry point & animations
│   │   ├── api.js         # API client & SSE
│   │   ├── state.js       # State management & cache
│   │   ├── config.js      # Constants & pricing
│   │   ├── utils.js       # Formatters & helpers
│   │   └── views/         # View components
│   │       ├── dashboard.js
│   │       └── analytics.js
│   └── styles/            # Styles
├── lib/                   # Server modules
│   ├── config.js          # Server configuration
│   ├── cache.js           # Data caching layer
│   ├── historical-data.js # Historical time-series data extraction
│   ├── token-burn.js      # Token calculation
│   └── routes/            # API route handlers
├── tests/                 # Test suite
├── src/                   # Additional source
└── package.json
```

## Coming Soon
- 🚨 Budget alerts & notifications
- 👥 Team/project support
- 📊 Enhanced export (CSV, PDF)
- 🤖 Model recommendation engine
- 📈 Predictive analytics

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## License

MIT
