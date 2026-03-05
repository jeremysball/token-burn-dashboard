# Agent Guidelines

## Bash Commands

**ALWAYS use `timeout` parameter** when running bash commands, especially:
- Long-running operations
- Server starts/restarts
- API calls
- File processing

Example: When using the bash tool, always specify a timeout (in seconds):
- Quick checks: timeout=5000 (5 seconds)
- Server operations: timeout=10000 (10 seconds)  
- Long operations: timeout=30000 (30 seconds)

## Development Server

The dashboard server runs on port 7070:
```bash
cd /workspace/token-burn-dashboard-model-faceoff
nohup node server.js > nohup.out 2>&1 &
```

Check health:
```bash
curl -s http://localhost:7070/api/health
```

## API Endpoints

- `/api/tokens` - Current cumulative token totals
- `/api/tokens/historical` - Per-hour token deltas from session files
- `/api/tokens/stream` - SSE real-time updates
