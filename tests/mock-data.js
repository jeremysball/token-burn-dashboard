const mockData = {
  files_processed: 10,
  total_lines: 50000,
  total_messages: 2500,
  total_input: 1000000,
  total_output: 200000,
  total_cache_read: 800000,
  total_cache_write: 50000,
  total_tokens: 2050000,
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
