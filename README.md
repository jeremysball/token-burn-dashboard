# 🔥 Token Burn Dashboard

Real-time token usage analytics dashboard with cost tracking, built with a MonkeyType-inspired aesthetic.

[![Tests](https://img.shields.io/badge/tests-jest-blue)](./tests)
[![Linting](https://img.shields.io/badge/linting-eslint-green)](./eslint.config.mjs)
[![License](https://img.shields.io/badge/license-MIT-yellow)](./LICENSE)

## Features

### 📊 Real-Time Analytics
- Live token usage tracking from Pi session files
- Server-Sent Events (SSE) for automatic updates every 5 seconds
- Historical trend visualization with sparklines
- Deep insights with AI-powered pattern analysis

### 💰 Cost Analysis
- Per-model cost estimation
- Configurable pricing per 1M tokens for 10+ providers
- Total cost breakdown (input, output, cache read, cache write)
- Cache efficiency metrics and savings calculation

### 📈 Visualizations
- Interactive donut charts (Plotly.js)
- Stacked bar comparisons
- Sparkline trend graphs
- Timeline view with range selection (1h to 30d)
- Calendar heatmap view
- Model distribution pie charts

### 🧠 Smart Insights
- Automated efficiency analysis
- Model recommendation engine
- Cost trajectory projections
- Cache optimization suggestions
- Usage velocity tracking

### ⌨️ Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `1-5` | Switch views |
| `R` | Refresh data |
| `T` | Toggle theme |
| `/` | Search focus |
| `?` | Show help |
| `Esc` | Close modals |

### 🎨 Themes
- Dark mode (default) - terminal-inspired aesthetic
- Light mode
- Automatic preference persistence

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or in development mode
npm run dev

# Dashboard will be available at:
open http://localhost:7071
```

## Development

### Testing
```bash
# Run all tests with coverage
npm test

# Run tests in watch mode
npm run test:watch

# Run linting
npm run lint

# Fix linting issues
npm run lint:fix
```

### Testing Stack
- **Jest** - Test runner with coverage
- **jsdom** - Browser environment for unit tests
- **Playwright** - E2E testing for UI components
- **Babel** - ES6+ transpilation for tests

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
- **Calendar Tab**: Daily usage heatmap
- **Distribution Tab**: Token distribution pie charts
- **Insights Tab**: Deep analytics with pattern detection

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tokens` | GET | Current cumulative token totals |
| `/api/tokens/historical` | GET | Per-hour token deltas from session files |
| `/api/tokens/stream` | GET | SSE real-time updates |
| `/api/insights/analyze` | POST | AI pattern analysis from summary data |
| `/api/health` | GET | Health check with uptime |

## Data Sources

The dashboard reads from Pi session files:
```
~/.pi/agent/sessions/**/*.jsonl
```

## Configuration

### Supported Model Pricing
The dashboard includes pricing for:
- **OpenAI**: GPT-4o, GPT-4o-mini, o1, o3-mini
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku
- **DeepSeek**: DeepSeek Chat, DeepSeek Reasoner
- **Google**: Gemini 1.5 Pro, Gemini 1.5 Flash
- **Default**: Fallback pricing for unknown models

### Theme
Toggle between dark/light modes with the 🌓 button or press `T`.

## Architecture

```
token-burn-dashboard/
├── server.js              # HTTP server + API
├── api/                   # Alternative API server
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
│   └── css/               # Styles
├── lib/                   # Server modules
│   ├── config.js          # Server configuration
│   ├── cache.js           # Data caching layer
│   ├── historical-data.js # Session file parser
│   ├── token-burn.js      # Token calculation
│   └── routes/            # API route handlers
├── tests/                 # Test suite
├── src/                   # Additional source
└── package.json
```

## Feature Roadmap

See [FEATURES.md](./FEATURES.md) for detailed feature ideas and roadmap.

### Coming Soon
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
