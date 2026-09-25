// Puppeteer is only needed to re-capture the app (Linux). Keep its browser
// inside promo/.cache, and skip the download on Windows unless asked for.
const {join} = require('path');
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
  skipDownload: process.platform === 'win32' && !process.env.MG_CAPTURE,
};
