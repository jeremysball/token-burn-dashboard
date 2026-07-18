// The pinned Chromium build (chromium-headless-shell) reliably fails to
// download/extract in this environment, so tests run against the
// system-installed Chrome stable channel instead.
module.exports = {
  use: {
    channel: 'chrome'
  }
};
