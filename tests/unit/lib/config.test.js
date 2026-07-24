import { describe, expect, test } from 'bun:test';

const configModule = require('../../../lib/config');
const { loadConfig } = configModule;

describe('loadConfig', () => {
  test('derives secure defaults and the project root from supplied dependencies', () => {
    const config = loadConfig({}, '/projects/dashboard');

    expect(config).toMatchObject({
      PORT: 7071,
      HOST: '127.0.0.1',
      ALLOWED_ORIGINS: [],
      AUTH_TOKEN: null,
      PROJECT_ROOT: '/projects/dashboard',
      MAX_REQUEST_BODY_BYTES: 1024 * 1024,
      MAX_FILE_BYTES: 100 * 1024 * 1024,
      CLAUDE_MAX_DEPTH: 4
    });
    expect(config.TOKEN_BURN_SCRIPT).toEndWith('/lib/token-burn.js');
    expect(config.MIME_TYPES['.json']).toBe('application/json');
  });

  test('derives port, origins, auth token, and explicit project root from its environment', () => {
    const config = loadConfig({
      PORT: '8080',
      ALLOWED_ORIGINS: 'https://a.example, https://b.example, ,',
      DASHBOARD_AUTH_TOKEN: 'secret-token',
      DASHBOARD_PROJECT_ROOT: '/data/dashboard'
    }, '/projects/dashboard');

    expect(config.PORT).toBe('8080');
    expect(config.ALLOWED_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
    expect(config.AUTH_TOKEN).toBe('secret-token');
    expect(config.PROJECT_ROOT).toBe('/data/dashboard');
  });

  test('falls back to the supplied HOME before cwd for the project root', () => {
    const config = loadConfig({ HOME: '/home/dashboard' }, '/projects/dashboard');

    expect(config.PROJECT_ROOT).toBe('/home/dashboard');
  });

  test('keeps default production values alongside the loader', () => {
    expect(configModule.loadConfig).toBe(loadConfig);
    expect(configModule.PYTHON_TIMEOUT).toBe(30000);
    expect(configModule.REQUEST_TIMEOUT).toBe(35000);
  });
});
