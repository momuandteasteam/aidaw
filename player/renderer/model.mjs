export function startFrame(position, duration) {
  const frame = Math.max(0, Math.floor(Number(position) || 0));
  const end = Math.max(0, Math.floor(Number(duration) || 0));
  return String(end === 0 || frame >= end ? 0 : frame);
}

export function statusBelongsToProject(status, projectId) {
  return Boolean(status && projectId && status.project_id === projectId);
}

export function projectIsPlayable(project) {
  return Boolean(project && project.playable && Number(project.track_count) > 0);
}
