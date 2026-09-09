import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const windowsReplaceErrors = new Set(['EACCES', 'EBUSY', 'EPERM']);

async function replaceFile(source: string, destination: string) {
  const deadline = Date.now() + 2000;
  let delay = 5;
  for (;;) {
    try {
      await rename(source, destination);
      return;
    } catch (error: any) {
      if (process.platform !== 'win32' || !windowsReplaceErrors.has(error.code) || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 100);
    }
  }
}

export async function readJson<T = any>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')); }
export async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, JSON.stringify(value, null, 2), { flag: 'wx' }); await replaceFile(tmp, path); }
  finally { await rm(tmp, { force: true }); }
}
export async function locked<T>(path: string, work: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + 5000;
  for (;;) {
    try { await mkdir(path); break; }
    catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() > deadline) throw new Error(`Storage locked: ${path}. If the previous process crashed, remove this lock after checking no writer is active.`);
      await new Promise(r => setTimeout(r, 25));
    }
  }
  try { return await work(); } finally { await rm(path, { recursive: true, force: true }); }
}
