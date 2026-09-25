// Scans the captures for anything private (see scripts/privacy.mjs).
import path from 'node:path';
import { PROMO } from './lib.mjs';
import { scanPrivacy } from '../scripts/privacy.mjs';

const findings = scanPrivacy([path.join(PROMO, 'assets'), path.join(PROMO, 'public')]);
for (const f of findings.slice(0, 40)) console.log(f);
console.log(findings.length ? `privacy scan: ${findings.length} finding(s)` : 'privacy scan: clean');
process.exitCode = findings.length ? 1 : 0;
