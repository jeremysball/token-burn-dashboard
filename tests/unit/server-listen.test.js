const fs = require('fs');
const path = require('path');

describe('server listener', () => {
  it('binds to all IPv4 interfaces', () => {
    const serverSource = fs.readFileSync(
      path.resolve(process.cwd(), 'server.js'),
      'utf8'
    );

    expect(serverSource).toMatch(/server\.listen\(currentPort, HOST\)/);
  });
});
