/**
 * Token burn script execution
 */

const { spawn } = require('child_process');
const path = require('path');
const { TOKEN_BURN_SCRIPT, PYTHON_TIMEOUT } = require('./config');

/**
 * Run the token burn Python script
 * @returns {Promise<object>} Token usage data
 */
function runTokenBurn() {
  return new Promise((resolve, reject) => {
    const sessionsPath = path.join(process.env.HOME, '.pi/agent/sessions');
    const python = spawn('python3', [TOKEN_BURN_SCRIPT, sessionsPath, '--recursive', '--json']);
    
    let output = '';
    let error = '';
    let timeoutId;
    let isSettled = false;
    
    timeoutId = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        python.kill('SIGTERM');
        reject(new Error(`Token burn timeout after ${PYTHON_TIMEOUT}ms`));
      }
    }, PYTHON_TIMEOUT);
    
    python.stdout.on('data', (data) => output += data);
    python.stderr.on('data', (data) => error += data);
    
    python.on('close', (code) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutId);
      
      if (code !== 0) {
        reject(new Error(`Token burn failed (code ${code}): ${error || 'Unknown error'}`));
      } else {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      }
    });
    
    python.on('error', (err) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutId);
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

module.exports = { runTokenBurn };
