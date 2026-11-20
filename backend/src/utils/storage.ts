import fs from 'fs';
import path from 'path';
import { env, uploadRoot } from '../config/env';

if (env.STORAGE_DRIVER !== 'local') {
  console.warn(`STORAGE_DRIVER=${env.STORAGE_DRIVER} is not implemented; falling back to local disk.`);
}

export const storage = {
  root: uploadRoot,
  ensure(folder: string) {
    const dir = path.join(uploadRoot, folder);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
  resolve(relPath: string) {
    const full = path.resolve(uploadRoot, relPath);
    if (!full.startsWith(uploadRoot)) throw new Error('Invalid path');
    return full;
  },
  remove(relPath?: string | null) {
    if (!relPath) return;
    try { fs.unlinkSync(this.resolve(relPath.replace(/^\/?uploads\//, ''))); } catch { /* already gone */ }
  },
};
