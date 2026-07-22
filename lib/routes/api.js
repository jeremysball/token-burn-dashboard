/**
 * API route handlers
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
 *
 * `res` is optional — when provided, a 'close' listener is registered as
 * soon as a task id is known so the worker is cancelled if the response
 * ends before the chain returns (client disconnect, outer gateway timeout,
 * etc.). Without that, an abandoned request would leave the worker
 * running and burning quota for up to ~200s after the response ended.
 */
async function runTaskferryAnalysis(summary, res) {
  fs.mkdirSync(TASKFERRY_SCRATCH_DIR, { recursive: true });

  // The full dataset (all models + complete history) can run to ~150KB+,
  // which exceeds Linux's hard per-argv-string cap (MAX_ARG_STRLEN, 128KB)
  // regardless of ARG_MAX — passing it inline via --prompt hits spawn
  // E2BIG. Write it to a scratch file instead and have the worker read
  // that one file; the hard-rule preamble is scoped to permit exactly this.
  //
  // NDJSON, not a single JSON.stringify blob: the worker's file-read tool
  // truncates individual lines at 2000 chars (confirmed empirically — a
  // one-line ~150KB JSON file left the model able to see only its first
  // 2000 characters). One record per line keeps every line under that cap
  // (max observed history-bucket line ~270 chars).
  const dataFilePath = path.join(TASKFERRY_SCRATCH_DIR, `insights-data-${crypto.randomUUID()}.ndjson`);
  const ndjsonLines = [
    JSON.stringify({ type: 'meta', totals: summary.totals, modelCount: summary.modelCount, cacheRate: summary.cacheRate, inputOutputRatio: summary.inputOutputRatio }),
    ...summary.models.map(m => JSON.stringify({ type: 'model', ...m })),
    ...summary.history.map(h => JSON.stringify({ type: 'history', ...h }))
  ];

  // writeSucceeded tracks whether the scratch file was actually written, so
  // the finally block can skip the unlink (and avoid a bogus ENOENT log line)
  // when the write itself failed and never created the file on disk.
  let writeSucceeded = false;
  let taskCompleted = false;
  try {
    fs.writeFileSync(dataFilePath, ndjsonLines.join('\n') + '\n');
    writeSucceeded = true;

    const prompt = buildTaskferryPrompt(summary, dataFilePath);

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

    // Register a one-shot cancel as soon as we have a task id. The previous
    // code only cancelled inside the wait() catch block, which fires when
    // wait() itself times out — but NOT when the *outer* gateway timeout
    // (INSIGHTS_REQUEST_TIMEOUT, 220s) wins the race while wait() is still
    // legitimately pending. Without this, an abandoned client would leave
    // the worker running and burning quota for up to ~200s after the
    // response ended. taskCompleted gates the call so the normal-completion
    // path's eventual 'close' event doesn't issue a pointless cancel.
    if (res) {
      res.once('close', () => {
        if (taskCompleted) return;
        execFile('taskferry', ['cancel', taskId], {}, () => {});
      });
    }

    const waitOut = await execFileP('taskferry', ['wait', taskId], {
      timeout: TASKFERRY_WAIT_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf-8'
    });

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
    const result = rawValue.startsWith('"') ? JSON.parse(rawValue) : rawValue;
    taskCompleted = true;
    return result;
  } finally {
    // Guard the unlink with existsSync: if the writeFileSync above failed
    // (writeSucceeded is false) the file was never created on disk and the
    // unlink would log a spurious ENOENT.
    if (writeSucceeded && fs.existsSync(dataFilePath)) {
      fs.unlink(dataFilePath, err => {
        if (err) console.error(`Failed to clean up insights scratch file ${dataFilePath}:`, err);
      });
    }
  }
}

/**
 * Validate the client-supplied summary shape before it reaches deep property
 * access in buildAnalysisPrompt/runTaskferryAnalysis. Without this, a
 * malformed payload throws a TypeError that gets caught by the taskferry
 * try/catch and misreported as a 503 "AI analysis service unavailable"
 * instead of the 400 it actually is.
 *
 * Each numeric field checked here is one buildAnalysisPrompt interpolates
 * directly via `.toFixed()` or arithmetic — a missing or non-number there
 * would otherwise surface as a TypeError deep inside the taskferry chain.
 * Array entry checks are intentionally lightweight (object shape + a couple
 * of top-level numerics per entry), not a full deep schema: enough to
 * reject obviously malformed entries without duplicating the prompt's own
 * field semantics.
 */
function validateInsightsSummary(summary) {
  if (!summary || typeof summary !== 'object') return 'summary must be an object';
  const { totals, modelCount, cacheRate, inputOutputRatio, models, history } = summary;
  if (!totals || typeof totals !== 'object') return 'summary.totals must be an object';
  if (typeof totals.tokens !== 'number') return 'summary.totals.tokens must be a number';
  if (typeof totals.input !== 'number') return 'summary.totals.input must be a number';
  if (typeof totals.output !== 'number') return 'summary.totals.output must be a number';
  if (typeof totals.cacheRead !== 'number') return 'summary.totals.cacheRead must be a number';
  if (typeof totals.cacheWrite !== 'number') return 'summary.totals.cacheWrite must be a number';
  if (typeof totals.reasoning !== 'number') return 'summary.totals.reasoning must be a number';
  if (!totals.cost || typeof totals.cost !== 'object') return 'summary.totals.cost must be an object';
  if (typeof totals.cost.total !== 'number') return 'summary.totals.cost.total must be a number';
  if (typeof totals.cost.input !== 'number') return 'summary.totals.cost.input must be a number';
  if (typeof totals.cost.output !== 'number') return 'summary.totals.cost.output must be a number';
  if (typeof totals.cost.cache_read !== 'number') return 'summary.totals.cost.cache_read must be a number';
  if (typeof totals.cost.cache_write !== 'number') return 'summary.totals.cost.cache_write must be a number';
  if (typeof totals.cost.reasoning !== 'number') return 'summary.totals.cost.reasoning must be a number';
  if (typeof modelCount !== 'number') return 'summary.modelCount must be a number';
  if (typeof cacheRate !== 'number') return 'summary.cacheRate must be a number';
  if (typeof inputOutputRatio !== 'number') return 'summary.inputOutputRatio must be a number';
  if (!Array.isArray(models)) return 'summary.models must be an array';
  if (!Array.isArray(history)) return 'summary.history must be an array';
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    if (!m || typeof m !== 'object' || Array.isArray(m)) return `summary.models[${i}] must be an object`;
    if (!m.tokens || typeof m.tokens !== 'object') return `summary.models[${i}].tokens must be an object`;
    if (typeof m.tokens.total !== 'number') return `summary.models[${i}].tokens.total must be a number`;
    if (!m.cost || typeof m.cost !== 'object') return `summary.models[${i}].cost must be an object`;
    if (typeof m.cost.total !== 'number') return `summary.models[${i}].cost.total must be a number`;
  }
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (!h || typeof h !== 'object' || Array.isArray(h)) return `summary.history[${i}] must be an object`;
    if (typeof h.total !== 'number') return `summary.history[${i}].total must be a number`;
  }
  return null;
}

/**
 * Wrap the analysis prompt for the unattended taskferry dispatch. The full dataset lives in
 * dataFilePath (see runTaskferryAnalysis) rather than inline, since it can exceed Linux's
 * per-argv-string limit — so the worker is permitted to read exactly that one file, and
 * nothing else.
 */
function buildTaskferryPrompt(summary, dataFilePath) {
  return `You are a data analyst specializing in LLM usage optimization, running as an UNATTENDED background task. Provide concise, actionable insights about token usage patterns. Be direct and specific. Format with markdown bold (**text**) for emphasis.

HARD RULE: this is a read-only analysis task. You may read exactly one file — ${dataFilePath} — and must not read, write, or modify any other file, run any shell command, or use any other tool. Respond with ONLY the analysis text described below — no preamble, no markdown fencing around the whole response.

${buildAnalysisPrompt(summary, dataFilePath)}`;
}

/**
 * Build the data-analysis portion of the insights prompt. The full dataset (every model, full
 * token/cost/pricing breakdown, and the complete historical time series) is written to
 * dataFilePath as NDJSON rather than embedded inline — it can run past 150KB, which exceeds
 * Linux's hard per-argv-string cap (MAX_ARG_STRLEN, 128KB) regardless of ARG_MAX, and a single
 * JSON blob also runs past the worker's own per-line read truncation. This prompt stays small
 * and points at that file, plus a schema section so the model doesn't have to guess field
 * semantics once it reads it.
 */
function buildAnalysisPrompt(summary, dataFilePath) {
  return `Analyze this LLM usage data and provide 3-4 specific, actionable insights. Use ONLY the
numbers in the data file below — do not invent model names, rates, dollar figures, or trends that
are not derivable from it.

**Complete input data:** ${dataFilePath}
Read this ENTIRE file before analyzing — it has one JSON object per line (NDJSON), tagged by a
"type" field:
- One "meta" line: { type, totals, modelCount, cacheRate, inputOutputRatio }.
- ${summary.modelCount} "model" lines, one per model, each with its full token/cost/pricing breakdown
  (none omitted).
- ${summary.history.length} "history" lines, one per hourly usage bucket, covering the full observed
  window with no downsampling — do not extrapolate a trend from only the last one or two lines.

**Data schema (read this first):**
- Token categories: "input" (new context read), "output" (generated), "cacheRead" (cheaper reuse
  of previously cached context), "cacheWrite" (cost to populate the cache), "reasoning" (extended
  thinking tokens, usually billed at the output rate).
- Each model line's "pricePerMillion" is its provider's published $/M rate per category (source:
  "openrouter" = live fetched pricing, "local" = static fallback table — prefer openrouter as more
  authoritative when comparing two models that both have it). Its "cost" field is what was
  ACTUALLY paid, blended across its own input/output/cache mix in this data — use effective
  cost (cost.total / (tokens.total / 1e6)), not list price alone, when ranking models by real spend.
- Each "history" line is shaped {type, time (epoch ms), tokens_by_model (per-model totals that
  hour), total, input, output, cache_read, cache_write, reasoning}.

**Fleet totals (quick reference — full per-model detail is in the file):**
- Total tokens: ${(summary.totals.tokens / 1e9).toFixed(2)}B (in ${(summary.totals.input / 1e9).toFixed(2)}B, out ${(summary.totals.output / 1e9).toFixed(2)}B, cache-read ${(summary.totals.cacheRead / 1e9).toFixed(2)}B, cache-write ${(summary.totals.cacheWrite / 1e9).toFixed(2)}B, reasoning ${(summary.totals.reasoning / 1e9).toFixed(2)}B)
- Total cost: $${summary.totals.cost.total.toFixed(2)} (in $${summary.totals.cost.input.toFixed(2)}, out $${summary.totals.cost.output.toFixed(2)}, cache-read $${summary.totals.cost.cache_read.toFixed(2)}, cache-write $${summary.totals.cost.cache_write.toFixed(2)}, reasoning $${summary.totals.cost.reasoning.toFixed(2)})
- Distinct models: ${summary.modelCount}
- Fleet-wide cache hit rate: ${(summary.cacheRate * 100).toFixed(1)}%
- Fleet-wide input/output ratio: ${summary.inputOutputRatio.toFixed(1)}:1

Focus on:
1. Cost optimization opportunities (cite specific dollar savings computed from the file's numbers)
2. Model selection strategy (which models to use more/less, and why — compare effective $/M, not
   list price alone)
3. Cache utilization improvements (which models have low cache hit rates)
4. Workload pattern and trend observations (use the history array — growth/decline over time,
   time-of-day patterns, shifts in model mix)

Keep each insight to 2-3 sentences. Be specific with numbers, and only numbers derived from the
file's data.`;
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

    const validationError = validateInsightsSummary(summary);
    if (validationError) {
      clearTimeout(requestTimeout);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Invalid request body: ${validationError}` }));
      return;
    }

    // Try to get real analysis from taskferry - DO NOT silently fallback.
    // If the dispatch fails, return an error so the client can show it.
    try {
      const insights = await runTaskferryAnalysis(summary, res);
      clearTimeout(requestTimeout);
      // The outer gateway timeout (server.js) can fire and end the response
      // while this await was still pending (see INSIGHTS_REQUEST_TIMEOUT vs.
      // the summed inner taskferry timeouts). Writing again after that would
      // throw ERR_HTTP_HEADERS_SENT and crash the whole process.
      if (res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ insights, source: 'taskferry' }));
    } catch (err) {
      console.error('Taskferry insights analysis failed:', err);
      clearTimeout(requestTimeout);
      if (res.writableEnded) return;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AI analysis service unavailable' }));
    }
  } catch (err) {
    console.error('handleInsightsAnalyzeRoute error:', err);
    clearTimeout(requestTimeout);
    if (res.writableEnded) return;
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
