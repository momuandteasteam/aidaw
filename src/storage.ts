import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readJson<T = any>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')); }
export async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, JSON.stringify(value, null, 2), { flag: 'wx' }); await rename(tmp, path); }
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
