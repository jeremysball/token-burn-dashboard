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

  describe('security defaults', () => {
    it('defaults HOST to loopback', () => {
      const originalHost = process.env.HOST;
      delete process.env.HOST;
      jest.resetModules();
      const cfg = require('../../../lib/config');
      expect(cfg.HOST).toBe('127.0.0.1');
      if (originalHost !== undefined) process.env.HOST = originalHost;
      jest.resetModules();
    });

    it('parses ALLOWED_ORIGINS from a comma-separated env var', () => {
      const original = process.env.ALLOWED_ORIGINS;
      process.env.ALLOWED_ORIGINS = 'https://a.example, https://b.example';
      jest.resetModules();
      const cfg = require('../../../lib/config');
      expect(cfg.ALLOWED_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
      if (original === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = original;
      jest.resetModules();
    });

    it('defaults ALLOWED_ORIGINS to an empty array', () => {
      const original = process.env.ALLOWED_ORIGINS;
      delete process.env.ALLOWED_ORIGINS;
      jest.resetModules();
      const cfg = require('../../../lib/config');
      expect(cfg.ALLOWED_ORIGINS).toEqual([]);
      if (original !== undefined) process.env.ALLOWED_ORIGINS = original;
      jest.resetModules();
    });

    it('defaults AUTH_TOKEN to null', () => {
      const original = process.env.DASHBOARD_AUTH_TOKEN;
      delete process.env.DASHBOARD_AUTH_TOKEN;
      jest.resetModules();
      const cfg = require('../../../lib/config');
      expect(cfg.AUTH_TOKEN).toBeNull();
      if (original !== undefined) process.env.DASHBOARD_AUTH_TOKEN = original;
      jest.resetModules();
    });

    it('defaults PROJECT_ROOT to HOME or cwd', () => {
      const original = process.env.DASHBOARD_PROJECT_ROOT;
      delete process.env.DASHBOARD_PROJECT_ROOT;
      jest.resetModules();
      const cfg = require('../../../lib/config');
      const expected = process.env.HOME || process.cwd();
      expect(cfg.PROJECT_ROOT).toBe(expected);
      if (original === undefined) delete process.env.DASHBOARD_PROJECT_ROOT;
      else process.env.DASHBOARD_PROJECT_ROOT = original;
      jest.resetModules();
    });
  });
});
