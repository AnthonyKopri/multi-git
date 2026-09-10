#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const entry = path.join(__dirname, '../out/node/server/agent-cli.js');
if (!fs.existsSync(entry)) {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, success: false, error: { code: 'BUILD_REQUIRED', message: 'Run npm ci and npm run compile in the Multi-Git source checkout first.' } }) + '\n');
  process.exitCode = 2;
} else require(entry);
