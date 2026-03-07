/**
 * API route handlers
 */

const { getTokensData, getHistoricalData } = require('../cache');

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
 * Handle /api/insights/analyze route
 */
async function handleInsightsAnalyzeRoute(req, res, requestTimeout) {
  try {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const summary = JSON.parse(body);
        
        // Generate insights locally (no LLM API call to keep it fast/free)
        const insights = generateInsightsAnalysis(summary);
        
        clearTimeout(requestTimeout);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ insights }));
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
 * Generate insights analysis from summary data
 */
function generateInsightsAnalysis(summary) {
  const insights = [];
  
  // Cost efficiency analysis
  const avgCostPer1M = summary.totalTokens > 0 ? (summary.totalCost / summary.totalTokens) * 1e6 : 0;
  if (avgCostPer1M < 0.30) {
    insights.push(`**Excellent cost efficiency!** Your average of $${avgCostPer1M.toFixed(2)} per 1M tokens is outstanding. You're maximizing cache usage and selecting cost-effective models strategically.`);
  } else if (avgCostPer1M > 1.50) {
    insights.push(`**Premium usage pattern detected.** At $${avgCostPer1M.toFixed(2)} per 1M tokens, you're using high-performance models. Review if all tasks require premium capabilities—some workloads might run well on more cost-effective alternatives.`);
  } else {
    insights.push(`**Balanced cost profile.** Your $${avgCostPer1M.toFixed(2)} per 1M tokens average suggests a good mix of model tiers. Continue monitoring cache hit rates to optimize further.`);
  }
  
  // Model strategy
  if (summary.modelCount === 1) {
    insights.push(`**Single model strategy.** You're using one model exclusively. While this simplifies decision-making, consider experimenting with specialized models for different task types to optimize cost and quality.`);
  } else if (summary.modelCount > 10) {
    insights.push(`**Broad experimentation.** With ${summary.modelCount} models tested, you're exploring widely. Consider consolidating to your top 3-4 performers based on cost-quality ratios for simpler management.`);
  } else if (summary.topModels.length >= 2) {
    const topShare = summary.topModels[0].tokens / summary.totalTokens;
    if (topShare > 0.75) {
      insights.push(`**Concentrated usage.** ${summary.topModels[0].name} handles ${(topShare * 100).toFixed(0)}% of your workload. This is efficient but leaves you exposed to single-model limitations and pricing changes.`);
    } else {
      insights.push(`**Healthy model diversification.** Your top model accounts for only ${(topShare * 100).toFixed(0)}% of usage, suggesting you're matching models to specific tasks effectively.`);
    }
  }
  
  // Cache optimization
  if (summary.cacheRate > 0.5) {
    const savings = summary.totalTokens * summary.cacheRate * 0.00015; // Approximate cache savings
    insights.push(`**Cache champion!** Your ${(summary.cacheRate * 100).toFixed(1)}% cache hit rate is saving approximately $${savings.toFixed(2)}. You're effectively reusing prompts—keep structuring similar requests to maintain this efficiency.`);
  } else if (summary.cacheRate < 0.15) {
    insights.push(`**Cache optimization opportunity.** At ${(summary.cacheRate * 100).toFixed(1)}% cache hits, there's room for improvement. Try reusing similar prompt structures or enabling prompt caching where available.`);
  }
  
  // Workload pattern
  if (summary.inputOutputRatio > 10) {
    insights.push(`**Analysis-heavy workload.** Your ${summary.inputOutputRatio.toFixed(1)}:1 input-to-output ratio indicates primarily analytical tasks (classification, extraction, summarization). These typically benefit from smaller, faster models.`);
  } else if (summary.inputOutputRatio < 0.5) {
    insights.push(`**Generation-heavy workload.** You're generating ${(1/summary.inputOutputRatio).toFixed(1)}x more output than input, indicating creative/code generation tasks. Monitor output costs carefully—they can escalate with verbose generations.`);
  } else {
    insights.push(`**Balanced workload pattern.** Your input/output ratio of ${summary.inputOutputRatio.toFixed(1)}:1 suggests a mix of analytical and generative tasks. This balanced profile is well-suited for versatile mid-tier models.`);
  }
  
  // Top model deep dive
  if (summary.topModels.length > 0) {
    const top = summary.topModels[0];
    const cacheMsg = top.cacheRate > 0.5 ? ` with excellent ${(top.cacheRate * 100).toFixed(0)}% cache utilization` : '';
    insights.push(`**Top performer:** ${top.name} dominates with ${(top.tokens / 1e6).toFixed(2)}M tokens at $${top.cost.toFixed(2)}${cacheMsg}.`);
  }
  
  return insights.join('\n\n') || 'Continue using the system to generate more detailed insights.';
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

module.exports = {
  handleTokensRoute,
  handleHistoricalRoute,
  handleHealthRoute,
  handleInsightsAnalyzeRoute
};
