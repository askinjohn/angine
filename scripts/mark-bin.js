import { chmodSync } from 'node:fs';

chmodSync(new URL('../dist/bin/beacon.js', import.meta.url), 0o755);
