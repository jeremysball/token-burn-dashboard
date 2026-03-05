# 🔥 Token Burn Dashboard

Real-time token usage analytics dashboard with cost tracking, built with a MonkeyType-inspired aesthetic.

## Features

### 📊 Real-Time Analytics
- Live token usage tracking from Pi session files
- Server-Sent Events (SSE) for automatic updates every 5 seconds
- Historical trend visualization with sparklines

### 💰 Cost Analysis
- Per-model cost estimation
- Configurable pricing per 1M tokens
- Total cost breakdown (input, output, cache)
- Cache savings calculation

### 📈 Visualizations
- Interactive donut charts
- Stacked bar comparisons
- Sparkline trend graphs
- Model comparison tools

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
- Dark mode (default)
- Light mode
- Automatic preference persistence

## Quick Start

```bash
# Start the server
npm start

# Or directly
node server.js

# Dashboard will be available at:
open http://localhost:7071
```

## Views

### Overview
- Grand totals with sparkline trends
- Sortable model table
- Real-time search/filter

### Costs
- Estimated cost breakdown
- Per-model pricing configuration
- Cache efficiency metrics

### Charts
- Token distribution (donut chart)
- Usage breakdown by model
- Cache vs input comparison

### Compare
- Side-by-side model comparison
- Animated progress bars
- Relative performance metrics

### History
- Timeline of snapshots
- Usage trends over time
- Session comparison

## API Endpoints

- `GET /api/tokens` - Current token data (JSON)
- `GET /api/tokens/stream` - Real-time SSE stream
- `GET /api/health` - Health check

## Data Sources

The dashboard reads from Pi session files:
```
~/.pi/agent/sessions/**/*.jsonl
```

## Configuration

### Pricing
Edit pricing per model in the Costs view. Prices are stored per 1M tokens.

Default pricing:
- Input: $1.00 per 1M
- Output: $3.00 per 1M
- Cache read: $0.20 per 1M
- Cache write: $1.00 per 1M

### Theme
Toggle between dark/light modes with the 🌓 button or press `T`.

## Architecture

```
token-burn-dashboard/
├── server.js           # HTTP server + API
├── dashboard/
│   └── index.html      # Single-page dashboard
├── src/
│   └── mono-dashboard.css  # Base styles
└── package.json
```

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## License

MIT
