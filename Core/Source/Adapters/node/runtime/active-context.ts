import { z } from 'zod';
import { join } from 'node:path';
import { id } from '../../../Domain/schema.js';
import { parseDocument, resolveMasteringTarget } from '../../../Domain/domain.js';
import { revisionSnapshot } from '../workspace/layout.js';
import { atomicJson, locked, readJson } from '../workspace/storage.js';
import type { Service } from '../../../Application/service.js';

/** Selection belongs to the listening session, never to the authored document. */
export const activeContextInput = z.object({
  project_id: id.nullable(), song_id: id.optional(), version_id: id.optional(),
  comparison: z.enum(['a', 'b']).optional(), revision: z.number().int().nonnegative().optional(),
}).strict();
type Selection = z.infer<typeof activeContextInput>;
const recordSchema = z.object({selection: activeContextInput, updated_at: z.string().datetime()}).strict();
const contextPath = (service: Service) => service.paths.activeContext;

async function describe(service: Service, selection: Selection) {
  const { project_id, song_id, version_id, comparison, revision } = selection;
  if (project_id === null) {
    if (song_id || version_id || comparison || revision !== undefined) throw Error('Cleared context cannot include a selection');
    return {available: false, project_id: null, reason: 'no_selection'};
  }
  const current = await service.readDocument(project_id);
  const document = revision === undefined ? current : parseDocument(await revisionSnapshot(service.dir(project_id), revision));
  const kind = document.schema_version === 3 ? document.kind : 'composition';
  let target;
  if (song_id || version_id || comparison) {
    if (document.schema_version !== 3 || document.kind !== 'mastering') throw Error('Composition context cannot select a mastering song or version');
    target = resolveMasteringTarget(document, {song_id, version_id, comparison});
  }
  return {
    available: true, project_directory:service.dir(project_id), project_id, project_name: current.name, kind, revision: current.revision,
    selected_revision: revision ?? null, song_id: song_id ?? null,
    song_name: target?.song.name ?? null,
    version_id: target?.selection.kind === 'version' ? target.version.id : null,
    comparison: comparison ?? null, audition_selection: target?.selection ?? null,
  };
}

export async function getActiveContext(service: Service) {
  let record: z.infer<typeof recordSchema>;
  try { record = recordSchema.parse(await readJson(contextPath(service))); }
  catch (error: any) {
    if (error.code === 'ENOENT') return {available: false, project_id: null, reason: 'no_selection', updated_at: null};
    throw error;
  }
  try { return {...await describe(service, record.selection), updated_at: record.updated_at}; }
  catch (error: any) {
    // Do not silently redirect an editing request when a selected work/song was removed.
    return {available: false, project_id: record.selection.project_id, reason: 'selection_unavailable',
      selection: record.selection, error: error.message, updated_at: record.updated_at};
  }
}

export async function setActiveContext(service: Service, input: Selection) {
  const selection = activeContextInput.parse(input);
  return locked(service.paths.activeContextLock, async () => {
    const result = await describe(service, selection);
    const updated_at = new Date().toISOString();
    await atomicJson(contextPath(service), {selection, updated_at});
    return {...result, updated_at};
  });
}
