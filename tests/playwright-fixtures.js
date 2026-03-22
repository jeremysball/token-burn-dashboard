const { mockData } = require('./mock-data');

const now = Date.now();

const historicalData = [
  {
    time: now - 3 * 60 * 60 * 1000,
    total: 850000,
    models: {
      'kimi-coding/k2p5': 500000,
      'claude-3.5-sonnet': 350000
    }
  },
  {
    time: now - 2 * 60 * 60 * 1000,
    total: 1350000,
    models: {
      'kimi-coding/k2p5': 820000,
      'claude-3.5-sonnet': 530000
    }
  },
  {
    time: now - 60 * 60 * 1000,
    total: 1700000,
    models: {
      'kimi-coding/k2p5': 1080000,
      'claude-3.5-sonnet': 620000
    }
  },
  {
    time: now,
    total: mockData.total_tokens,
    models: {
      'kimi-coding/k2p5': 1280000,
      'claude-3.5-sonnet': 770000
    }
  }
];

const gitBlameResponse = {
  commits: [
    {
      hash: 'abc1234',
      message: 'feat: add analytics overview',
      date: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      timestamp: now - 24 * 60 * 60 * 1000,
      tokens: 125000,
      cost: 1.25,
      models: { 'kimi-coding/k2p5': { tokens: 125000, cost: 1.25 } },
      sessions: 2,
      sessionIds: ['session-a', 'session-b'],
      files: ['dashboard/js/main.js', 'dashboard/index.html']
    },
    {
      hash: 'def5678',
      message: 'fix: stabilize charts on mobile',
      date: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
      timestamp: now - 12 * 60 * 60 * 1000,
      tokens: 86000,
      cost: 0.86,
      models: { 'kimi-coding/k2p5': { tokens: 86000, cost: 0.86 } },
      sessions: 1,
      sessionIds: ['session-c'],
      files: ['dashboard/styles/main.css', 'tests/mobile.spec.js']
    }
  ],
  files: [
    { file: 'dashboard/index.html', cost: 1.25, commits: 1 },
    { file: 'dashboard/styles/main.css', cost: 0.86, commits: 1 },
    { file: 'dashboard/js/main.js', cost: 1.25, commits: 1 }
  ],
  directories: [
    { path: '', name: 'Current Directory', isGitRepo: true },
    { path: 'dashboard', name: 'dashboard', isGitRepo: false },
    { path: 'tests', name: 'tests', isGitRepo: false }
  ]
};

const spikesResponse = {
  spikes: [
    {
      time: now - 6 * 60 * 60 * 1000,
      previousAvg: 98000,
      tokens: 245000,
      ratio: 2.5
    },
    {
      time: now - 2 * 60 * 60 * 1000,
      previousAvg: 120000,
      tokens: 310000,
      ratio: 2.6
    }
  ]
};

async function routeDashboardApis(page) {
  await page.route('**/api/tokens', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData)
    });
  });

  await page.route('**/api/tokens/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify(mockData)}\n\n`
    });
  });

  await page.route('**/api/tokens/historical', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(historicalData)
    });
  });

  await page.route('**/api/git/blame*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(gitBlameResponse)
    });
  });

  await page.route('**/api/spikes*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(spikesResponse)
    });
  });
}

module.exports = {
  historicalData,
  gitBlameResponse,
  spikesResponse,
  routeDashboardApis,
  mockData
};