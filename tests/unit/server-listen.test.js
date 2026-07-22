const fs = require('fs');
const path = require('path');

describe('server listener', () => {
  it('binds to the configured HOST', () => {
    const serverSource = fs.readFileSync(
      path.resolve(process.cwd(), 'server.js'),
      'utf8'
    );

    expect(serverSource).toMatch(/server\.listen\(currentPort, HOST\)/);
  });
});
