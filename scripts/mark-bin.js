import { chmodSync } from 'node:fs';

chmodSync(new URL('../dist/bin/angine.js', import.meta.url), 0o755);
