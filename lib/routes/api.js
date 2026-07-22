/**
 * API route handlers
 */

const { execFile } = require('child_process');
const fs = require('fs');
const { getTokensData, getHistoricalData } = require('../cache');
const {
  MAX_REQUEST_BODY_BYTES,
  TASKFERRY_INSIGHTS_MODEL,
  TASKFERRY_SCRATCH_DIR,
  TASKFERRY_DISPATCH_TIMEOUT_MS,
  TASKFERRY_WAIT_TIMEOUT_MS,
  TASKFERRY_RESULT_TIMEOUT_MS
} = require('../config');

/**
 * Promise wrapper around execFile that keeps its native (err, stdout, stderr)
 * callback shape, so tests can mock 'child_process' directly without relying
 * on util.promisify's execFile-specific custom promisifier.
 */
function execFileP(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Handle /api/tokens route
 */
async function handleTokensRoute(req, res, requestTimeout) {
  try {
    const data = await getTokensData();
    clearTimeout(requestTimeout);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error('handleTokensRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Dispatch the analysis prompt to a taskferry-backed model and wait for its
 * result. Runs in an isolated scratch directory (never PROJECT_ROOT), since
 * the dispatched prompt embeds user-controlled summary data and the worker
 * must not be able to reach real project files even if it ignored its
 * instructions.
 */
async function runTaskferryAnalysis(summary) {
  const prompt = buildTaskferryPrompt(summary);
  fs.mkdirSync(TASKFERRY_SCRATCH_DIR, { recursive: true });

  const dispatchOut = await execFileP('taskferry', [
    'dispatch',
    '--prompt', prompt,
    '--model', TASKFERRY_INSIGHTS_MODEL,
    '--directory', TASKFERRY_SCRATCH_DIR
  ], { timeout: TASKFERRY_DISPATCH_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf-8' });

  const taskId = (dispatchOut.match(/^id: (\S+)/m) || [])[1];
  if (!taskId) {
    throw new Error('taskferry dispatch did not return a task id');
  }

  let waitOut;
  try {
    waitOut = await execFileP('taskferry', ['wait', taskId], {
      timeout: TASKFERRY_WAIT_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf-8'
    });
  } catch (err) {
    // Best-effort: stop the worker rather than leaving it running unbounded
    // after we've given up waiting on it.
    execFile('taskferry', ['cancel', taskId], {}, () => {});
    throw err;
  }

  const status = (waitOut.match(/^status: (\S+)/m) || [])[1];
  if (status !== 'done') {
    throw new Error(`taskferry task ${taskId} did not complete (status: ${status || 'unknown'})`);
  }

  const resultOut = await execFileP('taskferry', ['result', taskId, '--fields', 'message'], {
    timeout: TASKFERRY_RESULT_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf-8'
  });

  // taskferry emits TOON: one `key: value` line per field, with string
  // values quoted and escaped the same way JSON.stringify would.
  const messageMatch = resultOut.match(/^message: (".*)$/m);
  if (!messageMatch) {
    throw new Error(`taskferry result for task ${taskId} had no message field`);
  }
  return JSON.parse(messageMatch[1]);
}

/**
 * Wrap the analysis prompt for the unattended taskferry dispatch. The prompt
 * embeds user-controlled summary data, so the worker is explicitly told not
 * to use any tools and to respond with only the analysis text.
 */
function buildTaskferryPrompt(summary) {
  return `You are a data analyst specializing in LLM usage optimization, running as an UNATTENDED background task. Provide concise, actionable insights about token usage patterns. Be direct and specific. Format with markdown bold (**text**) for emphasis.

HARD RULE: this is a read-only text-generation task. Do not read, write, or modify any file, run any shell command, or use any tool. Respond with ONLY the analysis text described below — no preamble, no markdown fencing around the whole response.

${buildAnalysisPrompt(summary)}`;
}

/**
 * Build the data-analysis portion of the insights prompt
 */
function buildAnalysisPrompt(summary) {
  const topModels = summary.topModels.map(m => 
    `- ${m.name}: ${(m.tokens / 1e6).toFixed(2)}M tokens, $${m.cost.toFixed(2)}, ${(m.cacheRate * 100).toFixed(0)}% cache`
  ).join('\n');

  return `Analyze this LLM usage data and provide 3-4 specific, actionable insights:

**Overview:**
- Total tokens: ${(summary.totalTokens / 1e9).toFixed(2)}B
- Total cost: $${summary.totalCost.toFixed(2)}
- Models used: ${summary.modelCount}
- Cache hit rate: ${(summary.cacheRate * 100).toFixed(1)}%
- Input/output ratio: ${summary.inputOutputRatio.toFixed(1)}:1

**Top Models:**
${topModels}

Focus on:
1. Cost optimization opportunities (specific dollar savings)
2. Model selection strategy (which models to use more/less)
3. Cache utilization improvements
4. Workload pattern observations

Keep each insight to 2-3 sentences. Be specific with numbers.`;
}

/**
 * Read and size-cap the request body. Resolves to the body string, or to
 * null if a 413 was already written (caller should return without writing
 * a second response).
 */
function readInsightsRequestBody(req, res, requestTimeout) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_REQUEST_BODY_BYTES) {
        rejected = true;
        clearTimeout(requestTimeout);
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        req.destroy();
        resolve(null);
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!rejected) resolve(body);
    });
    req.on('error', reject);
  });
}

/**
 * Handle /api/insights/analyze route
 */
async function handleInsightsAnalyzeRoute(req, res, requestTimeout) {
  try {
    const body = await readInsightsRequestBody(req, res, requestTimeout);
    if (body === null) return; // 413 already sent

    let summary;
    try {
      summary = JSON.parse(body);
    } catch {
      clearTimeout(requestTimeout);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }

    // Try to get real analysis from taskferry - DO NOT silently fallback.
    // If the dispatch fails, return an error so the client can show it.
    try {
      const insights = await runTaskferryAnalysis(summary);
      clearTimeout(requestTimeout);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ insights, source: 'taskferry' }));
    } catch (err) {
      console.error('Taskferry insights analysis failed:', err);
      clearTimeout(requestTimeout);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AI analysis service unavailable' }));
    }
  } catch (err) {
    console.error('handleInsightsAnalyzeRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Handle /api/tokens/historical route
 */
async function handleHistoricalRoute(req, res, requestTimeout) {
  try {
    const historical = await getHistoricalData();
    clearTimeout(requestTimeout);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(historical));
  } catch (err) {
    console.error('handleHistoricalRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Handle /api/health route
 */
function handleHealthRoute(req, res, requestTimeout) {
  clearTimeout(requestTimeout);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    status: 'ok', 
    timestamp: Date.now(),
    uptime: process.uptime()
  }));
}

/**
 * Handle /api/git/blame route
 */
async function handleGitBlameRoute(req, res, requestTimeout) {
  try {
    const { getGitBlameRouteData, getGitBlameCommitDetails } = require('../git-blame');
    const { isPathWithinRoot } = require('../security');
    const { PROJECT_ROOT } = require('../config');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const days = parseInt(url.searchParams.get('days')) || 30;
    const cwd = url.searchParams.get('cwd') || process.cwd();
    const commitHash = url.searchParams.get('commit');

    if (!isPathWithinRoot(cwd, PROJECT_ROOT)) {
      clearTimeout(requestTimeout);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid directory' }));
      return;
    }
    
    // If commit hash provided, return session details for that commit
    if (commitHash) {
      const details = getGitBlameCommitDetails(commitHash, days, cwd);
      clearTimeout(requestTimeout);
      if (!details) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Commit not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(details));
      return;
    }
    
    const data = getGitBlameRouteData(days, cwd);
    clearTimeout(requestTimeout);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error('handleGitBlameRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Handle /api/spikes/detect route
 */
async function handleSpikesListRoute(req, res, requestTimeout) {
  try {
    const { findSpikes } = require('../spike-detective');
    const { getHistoricalData } = require('../cache');
    
    const historical = await getHistoricalData();
    const spikes = findSpikes(historical, 2.0);
    
    clearTimeout(requestTimeout);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ spikes }));
  } catch (err) {
    console.error('handleSpikesListRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Handle /api/spikes/investigate route
 */
async function handleSpikeDetectiveRoute(req, res, requestTimeout) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const timestamp = parseInt(url.searchParams.get('timestamp'));
    const window = parseInt(url.searchParams.get('window')) || 30;
    
    if (!timestamp) {
      clearTimeout(requestTimeout);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'timestamp required' }));
      return;
    }
    
    const { investigateSpike } = require('../spike-detective');
    const investigation = investigateSpike(timestamp, window);
    
    clearTimeout(requestTimeout);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(investigation));
  } catch (err) {
    console.error('handleSpikeDetectiveRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

module.exports = {
  handleTokensRoute,
  handleHistoricalRoute,
  handleHealthRoute,
  handleInsightsAnalyzeRoute,
  handleGitBlameRoute,
  handleSpikesListRoute,
  handleSpikeDetectiveRoute
};
