const mockData = {
  files_processed: 10,
  total_lines: 50000,
  total_messages: 2500,
  total_input: 1000000,
  total_output: 200000,
  total_cache_read: 800000,
  total_cache_write: 50000,
  total_tokens: 2050000,
  total_cost: {
    total: 3.21,
    input: 1.15,
    output: 0.48,
    cache_read: 1.36,
    cache_write: 0.22
  },
  costs_by_model: {
    "kimi-coding/k2p5": {
      total: 1.98,
      input: 0.82,
      output: 0.39,
      cache_read: 0.62,
      cache_write: 0.15
    },
    "claude-3.5-sonnet": {
      total: 1.23,
      input: 0.33,
      output: 0.09,
      cache_read: 0.74,
      cache_write: 0.07
    }
  },
  tokens_by_model: {
    "kimi-coding/k2p5": {
      input: 600000,
      output: 150000,
      cache_read: 500000,
      cache_write: 30000,
      total: 1280000
    },
    "claude-3.5-sonnet": {
      input: 400000,
      output: 50000,
      cache_read: 300000,
      cache_write: 20000,
      total: 770000
    }
  }
};

module.exports = { mockData };
