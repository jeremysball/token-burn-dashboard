// The pinned Chromium build (chromium-headless-shell) reliably fails to
// download/extract in this environment, so tests run against the
// system-installed Chrome stable channel instead.
module.exports = {
  use: {
    channel: 'chrome'
  },
  webServer: {
    command: 'bunx --bun vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173/dashboard/',
    reuseExistingServer: !process.env.CI
  }
};
