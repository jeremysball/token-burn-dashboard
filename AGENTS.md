# Agent Guidelines

## CRITICAL: tmux Requirement

**MUST ALWAYS load and use the tmux skill** for any process that might hang the pi agent:
- Interactive CLI testing or TUI automation
- Long-running servers or daemons
- Commands that wait for user input
- Processes that could block indefinitely
- Any command with unpredictable execution time

**ALWAYS use this pattern:**
```bash
# Load the skill first
read("/workspace/token-burn-dashboard-model-faceoff/.pi/skills/tmux/SKILL.md")

# Then run in tmux
tmux new-session -d -s session_name "your-command"
sleep 2  # Wait for startup
OUTPUT=$(tmux capture-pane -t session_name -p)
tmux kill-session -t session_name
```

**NEVER run interactive or long-running commands directly** - they will hang the agent.

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

The dashboard server runs on port 7071:
```bash
cd /workspace/token-burn-dashboard-model-faceoff
nohup node server.js > nohup.out 2>&1 &
```

Check health:
```bash
curl -s http://localhost:7071/api/health
```

## API Endpoints

- `/api/tokens` - Current cumulative token totals
- `/api/tokens/historical` - Per-hour token deltas from session files
- `/api/tokens/stream` - SSE real-time updates
