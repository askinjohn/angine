import fs from 'node:fs';
import path from 'node:path';
import { dataDir, eventsDir, snapshotPath } from './paths.js';

export function createBackup(destinationInput: unknown): { destination: string; eventFiles: number } {
  if (typeof destinationInput !== 'string' || !destinationInput.trim()) throw new Error('Choose a destination folder for the backup');
  const destination = path.resolve(destinationInput);
  const source = path.resolve(dataDir());
  const relative = path.relative(source, destination);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Choose a backup destination outside Angine’s data folder');
  }
  if (fs.existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);

  const events = eventsDir();
  const eventFiles = fs.existsSync(events) ? fs.readdirSync(events).filter(name => /^\d{4}-\d{2}\.ndjson$/.test(name)).sort() : [];
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    fs.mkdirSync(path.join(destination, 'state'), { mode: 0o700 });
    fs.mkdirSync(path.join(destination, 'events'), { mode: 0o700 });
    fs.copyFileSync(snapshotPath(), path.join(destination, 'state', 'snapshot.json'), fs.constants.COPYFILE_EXCL);
    for (const name of eventFiles) fs.copyFileSync(path.join(events, name), path.join(destination, 'events', name), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(destination, 'backup-info.json'), JSON.stringify({ formatVersion: 1, backedUpAt: new Date().toISOString(), eventFiles: eventFiles.length }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { destination, eventFiles: eventFiles.length };
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
