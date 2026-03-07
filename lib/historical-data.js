/**
 * Historical time-series data extraction
 */

const { spawn } = require('child_process');
const path = require('path');
const { PYTHON_TIMEOUT } = require('./config');

/**
 * Extract historical time-series data from session files
 * @returns {Promise<Array>} Time-series data
 */
function extractHistoricalData() {
  return new Promise((resolve, reject) => {
    const sessionsPath = path.join(process.env.HOME, '.pi/agent/sessions');
    
    const pythonScript = `
import json
import sys
from pathlib import Path
from collections import defaultdict

def stream_jsonl_lines(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                yield line.strip()

def extract_historical(sessions_path):
    events = []
    
    base = Path(sessions_path)
    if not base.exists():
        return []
    
    files = []
    for pattern in ['**/*.jsonl']:
        files.extend(base.glob(pattern))
    
    for filepath in files:
        try:
            for line in stream_jsonl_lines(str(filepath)):
                try:
                    data = json.loads(line)
                    msg_type = data.get('type')
                    
                    if msg_type == 'message':
                        msg = data.get('message', {})
                        usage = msg.get('usage', {})
                        timestamp = msg.get('timestamp') or data.get('timestamp')
                        
                        if usage and timestamp:
                            provider = msg.get('provider', 'unknown')
                            model = msg.get('model', 'unknown')
                            model_name = f"{provider}/{model}" if provider != 'unknown' else model
                            
                            events.append({
                                'time': timestamp,
                                'model': model_name,
                                'input': usage.get('input', 0) or usage.get('inputTokens', 0) or 0,
                                'output': usage.get('output', 0) or usage.get('outputTokens', 0) or 0,
                                'cache_read': usage.get('cacheRead', 0) or 0,
                                'cache_write': usage.get('cacheWrite', 0) or 0,
                                'total': usage.get('totalTokens', 0) or 0
                            })
                except:
                    pass
        except:
            pass
    
    events.sort(key=lambda x: x['time'])
    
    # Aggregate into hourly buckets
    buckets = defaultdict(lambda: {'time': 0, 'tokens_by_model': defaultdict(int), 'total': 0, 'input': 0, 'output': 0, 'cache_read': 0})
    
    for event in events:
        hour_bucket = event['time'] // (3600 * 1000) * (3600 * 1000)
        buckets[hour_bucket]['time'] = hour_bucket
        buckets[hour_bucket]['tokens_by_model'][event['model']] += event['total']
        buckets[hour_bucket]['total'] += event['total']
        buckets[hour_bucket]['input'] += event['input']
        buckets[hour_bucket]['output'] += event['output']
        buckets[hour_bucket]['cache_read'] += event['cache_read']
    
    result = list(buckets.values())
    for r in result:
        r['tokens_by_model'] = dict(r['tokens_by_model'])
    
    result.sort(key=lambda x: x['time'])
    return result

print(json.dumps(extract_historical('${sessionsPath}')))
`;
    
    const python = spawn('python3', ['-c', pythonScript]);
    let output = '';
    let error = '';
    
    const timeoutId = setTimeout(() => {
      python.kill('SIGTERM');
      reject(new Error('Historical data extraction timeout'));
    }, PYTHON_TIMEOUT);
    
    python.stdout.on('data', (data) => output += data);
    python.stderr.on('data', (data) => error += data);
    
    python.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new Error(`Failed to extract: ${error}`));
      } else {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          reject(new Error(`Failed to parse: ${e.message}`));
        }
      }
    });
    
    python.on('error', reject);
  });
}

module.exports = { extractHistoricalData };
