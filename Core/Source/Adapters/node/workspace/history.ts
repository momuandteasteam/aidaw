import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, readJson } from './storage.js';

export interface HistoryHead { head_revision: number; head_hash: string }
export interface RevisionMetadata { request_id: string; summary?: string; kind?: string; restored_from_revision?: number; created_at?: string }
interface Change { op: 'set' | 'remove'; path: string[]; value?: any }
interface Commit extends RevisionMetadata { schema_version: 1; revision: number; parent_revision: number | null; parent_hash: string | null; created_at: string; changes: Change[]; state_hash: string }
const marker = '$aidaw_history';
const own = (object: any, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const historyDir = (dir: string) => join(dir, 'state', 'history');
const revisionPath = (dir: string, revision: number) => join(historyDir(dir), 'revisions', `${revision}.json`);
const stateHash = (value: any) => hash(canonical(value));
function validRevision(revision: number) { if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid history revision'); }

async function normalize(dir: string, value: any): Promise<any> {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (value.length && value.every(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string') && new Set(value.map(item => item.id)).size === value.length) {
      const items = Object.create(null);
      for (const item of value) items[item.id] = await normalize(dir, item);
      return { [marker]: 'id-array', order: value.map(item => item.id), items };
    }
    return Promise.all(value.map(item => normalize(dir, item)));
  }
  const result: Record<string, any> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (key === 'state_base64' && typeof item === 'string') {
      // Preserve the exact representation, including valid padding, without interpreting vendor state.
      const bytes = Buffer.from(item, 'utf8'), digest = hash(bytes), path = join(historyDir(dir), 'objects', digest);
      await mkdir(join(historyDir(dir), 'objects'), { recursive: true });
      try { await writeFile(path, bytes, { flag: 'wx' }); }
      catch (error: any) { if (error.code !== 'EEXIST') throw error; if (hash(await readFile(path)) !== digest) throw new Error('History object hash mismatch'); }
      result[key] = { [marker]: 'blob', sha256: digest };
    } else result[key] = await normalize(dir, item);
  }
  return result;
}
async function hydrate(dir: string, value: any): Promise<any> {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Promise.all(value.map(item => hydrate(dir, item)));
  if (value[marker] === 'blob') {
    if (!/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid history object hash');
    const bytes = await readFile(join(historyDir(dir), 'objects', value.sha256));
    if (hash(bytes) !== value.sha256) throw new Error('History object hash mismatch');
    return bytes.toString('utf8');
  }
  if (value[marker] === 'id-array') {
    if (!Array.isArray(value.order) || !value.items || new Set(value.order).size !== value.order.length || value.order.some((id: any) => typeof id !== 'string' || !own(value.items, id))) throw new Error('Invalid history array');
    return Promise.all(value.order.map((id: string) => hydrate(dir, value.items[id])));
  }
  const result: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: await hydrate(dir, item), enumerable: true, configurable: true, writable: true });
  return result;
}
const isRecord = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);
function diff(before: any, after: any, path: string[] = [], changes: Change[] = []): Change[] {
  if (canonical(before) === canonical(after)) return changes;
  if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before)) if (!own(after, key)) changes.push({ op: 'remove', path: [...path, key] });
    for (const key of Object.keys(after)) {
      if (!own(before, key)) changes.push({ op: 'set', path: [...path, key], value: after[key] });
      else diff(before[key], after[key], [...path, key], changes);
    }
  } else changes.push({ op: 'set', path, value: after });
  return changes;
}
function applyChanges(input: any, changes: Change[]): any {
  let result = structuredClone(input);
  if (!Array.isArray(changes)) throw new Error('Invalid revision changes');
  for (const change of changes) {
    if (!change || !['set', 'remove'].includes(change.op) || !Array.isArray(change.path) || change.path.some(key => typeof key !== 'string')) throw new Error('Invalid revision change');
    if (!change.path.length) { if (change.op !== 'set') throw new Error('Cannot remove revision root'); result = structuredClone(change.value); continue; }
    let parent = result;
    for (const key of change.path.slice(0, -1)) {
      if (!isRecord(parent) || !own(parent, key)) throw new Error('Invalid revision path');
      parent = parent[key];
    }
    if (!isRecord(parent)) throw new Error('Invalid revision destination');
    const key = change.path.at(-1)!;
    if (change.op === 'remove') { if (!own(parent, key)) throw new Error('Missing removed revision field'); delete parent[key]; }
    else Object.defineProperty(parent, key, { value: structuredClone(change.value), enumerable: true, configurable: true, writable: true });
  }
  return result;
}
async function commitAt(dir: string, revision: number): Promise<Commit> {
  const commit = await readJson<Commit>(revisionPath(dir, revision));
  if (commit.schema_version !== 1 || commit.revision !== revision || !/^[a-f0-9]{64}$/.test(commit.state_hash)) throw new Error('Invalid history commit');
  return commit;
}
async function publishedHead(dir: string): Promise<HistoryHead> {
  const envelope = await readJson(join(dir, 'project.json'));
  const head = envelope.history ?? { head_revision: envelope.project.revision, head_hash: stateHash(await commitAt(dir, envelope.project.revision)) };
  validRevision(head.head_revision);
  if (head.head_revision !== envelope.project.revision) throw new Error('History head does not match project revision');
  if (stateHash(await commitAt(dir, head.head_revision)) !== head.head_hash) throw new Error('History head hash mismatch');
  return head;
}
export async function initializeHistory(dir: string, state: any, metadata?: RevisionMetadata): Promise<HistoryHead> {
  validRevision(state.revision);
  const normalized = await normalize(dir, state);
  const commit: Commit = { schema_version: 1, revision: state.revision, parent_revision: null, parent_hash: null, created_at: metadata?.created_at ?? new Date().toISOString(), request_id: metadata?.request_id ?? `initial-${state.revision}`, kind: metadata?.kind ?? 'initial', ...(metadata?.summary ? { summary: metadata.summary } : {}), changes: [], state_hash: stateHash(normalized) };
  await atomicJson(join(historyDir(dir), 'checkpoints', `${state.revision}.json`), { schema_version: 1, revision: state.revision, state_hash: commit.state_hash, state: normalized });
  await atomicJson(revisionPath(dir, state.revision), commit);
  return { head_revision: state.revision, head_hash: stateHash(commit) };
}
/** Import the retained contiguous legacy snapshots before the first new commit. */
export async function ensureHistory(dir: string, current: any): Promise<HistoryHead> {
  try { const commit = await commitAt(dir, current.revision); return { head_revision: current.revision, head_hash: stateHash(commit) }; }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  const states = new Map<number, any>([[current.revision, current]]);
  let envelope: any = {}; try { envelope = await readJson(join(dir, 'project.json')); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  const acceptedJobs = new Set(Object.values(envelope.receipts ?? {}).map((receipt: any) => receipt.job_id));
  const retain = (value: any) => { if (value && Number.isSafeInteger(value.revision) && value.revision >= 0 && value.revision < current.revision && !states.has(value.revision)) states.set(value.revision, value); };
  let jobs: string[] = []; try { jobs = await readdir(join(dir, 'jobs')); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  for (const job of jobs) {
    try {
      const status = await readJson(join(dir, 'jobs', job, 'status.json'));
      if (status.state !== 'succeeded' && !acceptedJobs.has(job)) continue;
      for (const name of ['before', 'after']) try { retain(await readJson(join(dir, 'jobs', job, 'snapshots', `${name}.json`))); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  let legacy: string[] = []; try { legacy = await readdir(join(dir, 'revisions')); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  for (const name of legacy) if (/^\d+\.json$/.test(name)) retain(await readJson(join(dir, 'revisions', name)));
  let first = current.revision; while (states.has(first - 1)) --first;
  let head = await initializeHistory(dir, states.get(first), { request_id: `legacy-${first}`, kind: 'legacy_import', summary: first ? `Available legacy history begins at revision ${first}` : 'Imported legacy history' });
  for (let revision = first + 1; revision <= current.revision; ++revision) head = await writeRevision(dir, states.get(revision - 1), states.get(revision), { request_id: `legacy-${revision}`, kind: 'legacy_import' });
  return head;
}
export async function writeRevision(dir: string, before: any, after: any, metadata: RevisionMetadata): Promise<HistoryHead> {
  validRevision(before.revision); validRevision(after.revision);
  if (after.revision !== before.revision + 1) throw new Error('History revision must increase by one');
  let parent: Commit;
  try { parent = await commitAt(dir, before.revision); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; await ensureHistory(dir, before); parent = await commitAt(dir, before.revision); }
  const [previous, next] = await Promise.all([normalize(dir, before), normalize(dir, after)]);
  if (parent.state_hash !== stateHash(previous)) throw new Error('History parent state mismatch');
  const commit: Commit = { schema_version: 1, revision: after.revision, parent_revision: before.revision, parent_hash: stateHash(parent), ...metadata, created_at: metadata.created_at ?? new Date().toISOString(), kind: metadata.kind ?? 'edit', changes: diff(previous, next), state_hash: stateHash(next) };
  await atomicJson(revisionPath(dir, after.revision), commit);
  if (after.revision % 50 === 0) await atomicJson(join(historyDir(dir), 'checkpoints', `${after.revision}.json`), { schema_version: 1, revision: after.revision, state_hash: commit.state_hash, state: next });
  return { head_revision: after.revision, head_hash: stateHash(commit) };
}
export async function readRevision<T = any>(dir: string, revision: number): Promise<T> {
  validRevision(revision);
  const head = await publishedHead(dir);
  if (revision > head.head_revision) throw new Error('Cannot read an unpublished revision');
  let ancestorRevision: number | null = head.head_revision, ancestorHash: string | null = head.head_hash;
  while (ancestorRevision !== null && ancestorRevision >= revision) {
    const ancestor = await commitAt(dir, ancestorRevision);
    if (stateHash(ancestor) !== ancestorHash || (ancestor.parent_revision !== null && ancestor.parent_revision !== ancestorRevision - 1)) throw new Error('Broken history chain');
    if (ancestorRevision === revision) break;
    ancestorRevision = ancestor.parent_revision; ancestorHash = ancestor.parent_hash;
  }
  if (ancestorRevision !== revision) throw new Error('Revision predates the retained history');
  const names = await readdir(join(historyDir(dir), 'checkpoints'));
  const checkpointRevision = names.filter(name => /^\d+\.json$/.test(name)).map(name => Number(name.slice(0, -5))).filter(n => n <= revision).sort((a, b) => b - a)[0];
  if (checkpointRevision === undefined) throw new Error('Missing history checkpoint');
  const checkpoint = await readJson(join(historyDir(dir), 'checkpoints', `${checkpointRevision}.json`));
  let current = checkpoint.state, previousCommit = await commitAt(dir, checkpointRevision);
  if (checkpoint.schema_version !== 1 || checkpoint.revision !== checkpointRevision || stateHash(current) !== checkpoint.state_hash || checkpoint.state_hash !== previousCommit.state_hash) throw new Error('History checkpoint hash mismatch');
  for (let next = checkpointRevision + 1; next <= revision; ++next) {
    const commit = await commitAt(dir, next);
    if (commit.parent_revision !== next - 1 || commit.parent_hash !== stateHash(previousCommit)) throw new Error('Broken history chain');
    current = applyChanges(current, commit.changes);
    if (stateHash(current) !== commit.state_hash) throw new Error('History state hash mismatch');
    previousCommit = commit;
  }
  return hydrate(dir, current);
}
export async function listHistory(dir: string, offset = 0, limit = 50) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid history pagination');
  const head = await publishedHead(dir), revisions: Commit[] = [];
  let revision: number | null = head.head_revision, expectedHash: string | null = head.head_hash;
  while (revision !== null) {
    const commit = await commitAt(dir, revision);
    if (stateHash(commit) !== expectedHash || (commit.parent_revision !== null && commit.parent_revision !== revision - 1)) throw new Error('Broken history chain');
    revisions.push(commit); revision = commit.parent_revision; expectedHash = commit.parent_hash;
  }
  return { head_revision: head.head_revision, total: revisions.length, entries: revisions.slice(offset, offset + limit).map(({ changes, state_hash, parent_hash, ...entry }) => ({ ...entry, state_hash, change_count: changes.length })) };
}

/** Return only files reachable from the published history; never include unfinished writes. */
export async function historyFiles(dir: string): Promise<string[]> {
  const head = await publishedHead(dir), files: string[] = [], objects = new Set<string>();
  const collect = (value: any) => { if (!value || typeof value !== 'object') return; if (value[marker] === 'blob') { if (!/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid history object'); objects.add(value.sha256); } for (const item of Object.values(value)) collect(item); };
  let revision: number | null = head.head_revision, expectedHash: string | null = head.head_hash;
  while (revision !== null) {
    const commit = await commitAt(dir, revision);
    if (stateHash(commit) !== expectedHash) throw new Error('Broken history chain');
    files.push(`state/history/revisions/${revision}.json`); collect(commit);
    try {
      const checkpoint = await readJson(join(historyDir(dir), 'checkpoints', `${revision}.json`));
      if (stateHash(checkpoint.state) !== commit.state_hash) throw new Error('History checkpoint hash mismatch');
      files.push(`state/history/checkpoints/${revision}.json`); collect(checkpoint);
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    revision = commit.parent_revision; expectedHash = commit.parent_hash;
  }
  for (const digest of objects) { const relative = `state/history/objects/${digest}`; if (hash(await readFile(join(dir, relative))) !== digest) throw new Error('History object hash mismatch'); files.push(relative); }
  return files;
}
