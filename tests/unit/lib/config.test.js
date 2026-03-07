/**
 * Tests for server configuration
 */

const config = require('../../../lib/config');

describe('Server Config', () => {
  it('has required configuration values', () => {
    expect(config.PORT).toBeDefined();
    expect(config.TOKEN_BURN_SCRIPT).toBeDefined();
    expect(config.PYTHON_TIMEOUT).toBeDefined();
    expect(config.SSE_UPDATE_INTERVAL).toBeDefined();
    expect(config.REQUEST_TIMEOUT).toBeDefined();
  });

  it('uses environment PORT or defaults to 7071', () => {
    const originalPort = process.env.PORT;
    
    delete process.env.PORT;
    // Reload to test default
    jest.resetModules();
    const configNoPort = require('../../../lib/config');
    expect(configNoPort.PORT).toBe(7071);
    
    process.env.PORT = '8080';
    jest.resetModules();
    const configWithPort = require('../../../lib/config');
    expect(configWithPort.PORT).toBe('8080');
    
    process.env.PORT = originalPort;
    jest.resetModules();
  });

  it('has reasonable timeout values', () => {
    expect(config.PYTHON_TIMEOUT).toBeGreaterThan(0);
    expect(config.SSE_KEEPALIVE_INTERVAL).toBeGreaterThan(0);
    expect(config.REQUEST_TIMEOUT).toBeGreaterThan(config.PYTHON_TIMEOUT);
  });

  it('includes MIME type mappings', () => {
    expect(config.MIME_TYPES['.html']).toBe('text/html');
    expect(config.MIME_TYPES['.css']).toBe('text/css');
    expect(config.MIME_TYPES['.js']).toBe('application/javascript');
    expect(config.MIME_TYPES['.json']).toBe('application/json');
  });
});
