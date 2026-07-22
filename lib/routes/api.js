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

  // taskferry emits TOON: one `key: value` line per field. String values are
  // only quoted/escaped (JSON.stringify-style) when they contain characters
  // that need it (spaces, quotes, newlines, colons); a plain single-token
  // value prints bare, so both forms must be handled here.
  const messageMatch = resultOut.match(/^message: (.*)$/m);
  if (!messageMatch) {
    throw new Error(`taskferry result for task ${taskId} had no message field`);
  }
  const rawValue = messageMatch[1];
  return rawValue.startsWith('"') ? JSON.parse(rawValue) : rawValue;
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
 * Build the data-analysis portion of the insights prompt. Sends the full dataset (every
 * model, full token/cost/pricing breakdown, and the complete historical time series) rather
 * than a lossy top-N snapshot, plus a schema section so the model doesn't have to guess field
 * semantics — both are needed for it to reason from real numbers instead of inventing them.
 */
function buildAnalysisPrompt(summary) {
  const modelLines = summary.models.map(m => {
    const effectiveRate = m.tokens.total ? (m.cost.total / (m.tokens.total / 1e6)) : 0;
    const list = m.pricePerMillion
      ? `list price ($${m.pricePerMillion.input}/M in, $${m.pricePerMillion.output}/M out, $${m.pricePerMillion.cacheRead}/M cache-read, $${m.pricePerMillion.cacheWrite}/M cache-write, source: ${m.pricePerMillion.source})`
      : 'list price unknown';
    return `- ${m.name}: ${(m.tokens.total / 1e6).toFixed(2)}M tokens total `
      + `(in ${(m.tokens.input / 1e6).toFixed(2)}M, out ${(m.tokens.output / 1e6).toFixed(2)}M, `
      + `cache-read ${(m.tokens.cacheRead / 1e6).toFixed(2)}M, cache-write ${(m.tokens.cacheWrite / 1e6).toFixed(2)}M, `
      + `reasoning ${(m.tokens.reasoning / 1e6).toFixed(2)}M), `
      + `$${m.cost.total.toFixed(2)} actual spend ($${effectiveRate.toFixed(2)}/M effective), `
      + `${(m.cacheRate * 100).toFixed(0)}% cache hit rate, ${list}`;
  }).join('\n');

  const historyJson = JSON.stringify(summary.history);

  return `Analyze this LLM usage data and provide 3-4 specific, actionable insights. Use ONLY the
numbers given below — do not invent model names, rates, dollar figures, or trends that are not
derivable from this data.

**Data schema (read this first):**
- Token categories: "input" (new context read), "output" (generated), "cacheRead" (cheaper reuse
  of previously cached context), "cacheWrite" (cost to populate the cache), "reasoning" (extended
  thinking tokens, usually billed at the output rate).
- Each model's "list price" is its provider's published $/M rate per category (source: "openrouter"
  = live fetched pricing, "local" = static fallback table — prefer openrouter as more authoritative
  when comparing two models that both have it). "Effective $/M" is what was ACTUALLY paid per
  million tokens for that model, blended across its own input/output/cache mix in this data — use
  effective cost, not list price alone, when ranking models by real spend.
- "history" is the complete array of hourly usage buckets covering the full observed window, each
  shaped {time (epoch ms), tokens_by_model (per-model totals that hour), total, input, output,
  cache_read, cache_write, reasoning}. Use it for trend/growth-rate/time-of-day analysis — do not
  extrapolate a trend from only the last one or two buckets.

**Fleet totals:**
- Total tokens: ${(summary.totals.tokens / 1e9).toFixed(2)}B (in ${(summary.totals.input / 1e9).toFixed(2)}B, out ${(summary.totals.output / 1e9).toFixed(2)}B, cache-read ${(summary.totals.cacheRead / 1e9).toFixed(2)}B, cache-write ${(summary.totals.cacheWrite / 1e9).toFixed(2)}B, reasoning ${(summary.totals.reasoning / 1e9).toFixed(2)}B)
- Total cost: $${summary.totals.cost.total.toFixed(2)} (in $${summary.totals.cost.input.toFixed(2)}, out $${summary.totals.cost.output.toFixed(2)}, cache-read $${summary.totals.cost.cache_read.toFixed(2)}, cache-write $${summary.totals.cost.cache_write.toFixed(2)}, reasoning $${summary.totals.cost.reasoning.toFixed(2)})
- Distinct models: ${summary.modelCount} (all ${summary.models.length} listed below, by token volume)
- Fleet-wide cache hit rate: ${(summary.cacheRate * 100).toFixed(1)}%
- Fleet-wide input/output ratio: ${summary.inputOutputRatio.toFixed(1)}:1

**All models (by token volume):**
${modelLines}

**Usage history (${summary.history.length} hourly buckets, oldest to newest, raw JSON):**
${historyJson}

Focus on:
1. Cost optimization opportunities (cite specific dollar savings computed from the numbers above)
2. Model selection strategy (which listed models to use more/less, and why — compare effective
   $/M, not list price alone)
3. Cache utilization improvements (which listed models have low cache hit rates)
4. Workload pattern and trend observations (use the history array — growth/decline over time,
   time-of-day patterns, shifts in model mix)

Keep each insight to 2-3 sentences. Be specific with numbers, and only numbers derived from the
data given above.`;
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
