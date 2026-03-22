/**
 * API route handlers
 */

const https = require('https');
const { getTokensData, getHistoricalData } = require('../cache');

// Kimi API configuration
const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_BASE_URL = process.env.KIMI_BASE_URL || 'https://api.kimi.com/coding/v1';

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
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * Call Kimi K2.5 API for insights
 */
function callKimiAnalysis(summary) {
  return new Promise((resolve, reject) => {
    if (!KIMI_API_KEY) {
      reject(new Error('KIMI_API_KEY not configured'));
      return;
    }

    const prompt = buildAnalysisPrompt(summary);
    
    const requestData = JSON.stringify({
      model: 'kimi-k2-5-coder',
      messages: [
        {
          role: 'system',
          content: 'You are a data analyst specializing in LLM usage optimization. Provide concise, actionable insights about token usage patterns. Be direct and specific. Format with markdown bold (**text**) for emphasis.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 800
    });

    const url = new URL(KIMI_BASE_URL + '/chat/completions');
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIMI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData)
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.choices && response.choices[0]?.message?.content) {
            resolve(response.choices[0].message.content);
          } else {
            reject(new Error('Invalid response from Kimi API'));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Kimi API timeout'));
    });

    req.write(requestData);
    req.end();
  });
}

/**
 * Build analysis prompt for Kimi
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
 * Handle /api/insights/analyze route
 */
async function handleInsightsAnalyzeRoute(req, res, requestTimeout) {
  try {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const summary = JSON.parse(body);
        
        // Try to get real analysis from Kimi - DO NOT silently fallback
        // If Kimi is not configured or fails, return error so client can show it
        if (!KIMI_API_KEY) {
          clearTimeout(requestTimeout);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'AI analysis service not configured',
            message: 'KIMI_API_KEY environment variable is not set'
          }));
          return;
        }
        
        try {
          const insights = await callKimiAnalysis(summary);
          clearTimeout(requestTimeout);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ insights, source: 'kimi' }));
        } catch (err) {
          console.log('Kimi analysis failed:', err.message);
          clearTimeout(requestTimeout);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'AI analysis service unavailable',
            message: err.message
          }));
        }
      } catch {
        clearTimeout(requestTimeout);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
  } catch {
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
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
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
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const days = parseInt(url.searchParams.get('days')) || 30;
    const cwd = url.searchParams.get('cwd') || process.cwd();
    const commitHash = url.searchParams.get('commit');
    
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
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
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
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
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
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
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
