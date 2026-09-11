const $ = id => document.getElementById(id);
const ui = { list: $('projectList'), search: $('search'), title: $('title'), details: $('details'), state: $('stateLabel'), seek: $('seek'), current: $('currentTime'), duration: $('duration'), play: $('playButton'), stop: $('stopButton'), device: $('device'), latency: $('latency'), xruns: $('xruns'), revision: $('revision'), message: $('message'), dataDir: $('dataDirButton') };
let projects = [], selected, details, playback, dragging = false, timer;
const terminal = new Set(['stopped', 'completed', 'failed', 'cancelled']);

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function showError(error) { ui.message.textContent = error?.message ?? String(error); }
function clearError() { ui.message.textContent = ''; }
function isActive() { return playback && !terminal.has(playback.state); }

function renderProjects() {
  const query = ui.search.value.trim().toLocaleLowerCase();
  const visible = projects.filter(project => `${project.name} ${project.project_id}`.toLocaleLowerCase().includes(query));
  ui.list.replaceChildren();
  if (!visible.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'プロジェクトがありません'; ui.list.append(empty); return; }
  for (const project of visible) {
    const button = document.createElement('button');
    button.className = `project${selected === project.project_id ? ' active' : ''}`;
    const name = document.createElement('strong'); name.textContent = project.name;
    const sub = document.createElement('small'); sub.textContent = `rev ${project.revision} · ${project.project_id}`;
    button.append(name, sub); button.addEventListener('click', () => selectProject(project.project_id)); ui.list.append(button);
  }
}

async function selectProject(projectId) {
  clearError(); selected = projectId; renderProjects(); ui.state.textContent = 'LOADING';
  try {
    details = await window.aidaw.project(projectId);
    ui.title.textContent = details.name;
    ui.details.textContent = `${details.track_count} tracks · ${details.note_count} notes · ${details.bpm} BPM`;
    ui.seek.max = details.duration_frames; ui.seek.value = 0;
    ui.current.textContent = '0:00'; ui.duration.textContent = formatTime(details.duration_seconds);
    ui.revision.textContent = `REV ${details.revision}`; ui.state.textContent = 'READY';
    ui.play.disabled = false; ui.stop.disabled = true;
  } catch (error) { ui.state.textContent = 'ERROR'; showError(error); }
}

async function togglePlay() {
  if (!selected) return;
  clearError(); ui.play.disabled = true;
  try {
    if (playback?.state === 'playing' || playback?.state === 'starting' || playback?.state === 'queued') playback = await window.aidaw.pause();
    else if (playback?.state === 'paused') playback = await window.aidaw.resume();
    else playback = await window.aidaw.start({ project_id: selected, start_frame: ui.seek.value, output_device: ui.device.value || undefined });
    updateStatus(playback);
  } catch (error) { showError(error); }
  finally { ui.play.disabled = false; }
}

async function stop() {
  if (!isActive()) return;
  try { playback = await window.aidaw.stop(); updateStatus(playback); }
  catch (error) { showError(error); }
}

function updateStatus(status) {
  if (!status) return;
  playback = status;
  ui.state.textContent = String(status.state ?? 'ready').toUpperCase();
  ui.play.textContent = ['playing', 'starting', 'queued'].includes(status.state) ? '❚❚' : '▶';
  ui.stop.disabled = !isActive();
  if (!dragging && status.position_frame !== undefined) ui.seek.value = status.position_frame;
  const rate = details?.sample_rate ?? 48000;
  ui.current.textContent = formatTime(Number(ui.seek.value) / rate);
  if (status.duration_seconds !== undefined) { ui.duration.textContent = formatTime(status.duration_seconds); ui.seek.max = status.duration_frames; }
  ui.latency.textContent = `LATENCY ${status.processing_latency_samples ?? '—'} SAMPLES`;
  ui.xruns.textContent = `XRUN ${status.xruns ?? '—'}`;
  if (status.error) showError(status.error);
}

async function poll() {
  try { const status = await window.aidaw.status(); if (status) updateStatus(status); }
  catch (error) { showError(error); }
  timer = setTimeout(poll, 250);
}

function applyBootstrap(data, preferences = {}) {
  projects = data.projects.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  ui.dataDir.title = data.data_dir;
  ui.device.replaceChildren();
  const devices = data.devices.devices ?? data.devices.output_devices ?? data.devices.device_types?.flatMap(type => type.outputs.map(name => ({ name, default: name === type.default_output }))) ?? [];
  for (const item of devices) {
    const name = typeof item === 'string' ? item : item.name;
    const option = document.createElement('option'); option.value = name; option.textContent = name;
    if (preferences.output_device === name || (!preferences.output_device && (item.default || name === data.devices.default_output_device || name === data.devices.default_output))) option.selected = true;
    ui.device.append(option);
  }
  renderProjects();
  const preferred = projects.find(project => project.project_id === preferences.project_id)?.project_id ?? projects[0]?.project_id;
  if (preferred) void selectProject(preferred);
}

ui.search.addEventListener('input', renderProjects);
ui.play.addEventListener('click', togglePlay);
ui.stop.addEventListener('click', stop);
ui.seek.addEventListener('pointerdown', () => { dragging = true; });
ui.seek.addEventListener('input', () => { ui.current.textContent = formatTime(Number(ui.seek.value) / (details?.sample_rate ?? 48000)); });
ui.seek.addEventListener('change', async () => { dragging = false; if (isActive()) { try { playback = await window.aidaw.seek(ui.seek.value); updateStatus(playback); } catch (error) { showError(error); } } });
ui.dataDir.addEventListener('click', async () => { try { const data = await window.aidaw.chooseDataDir(); if (data) applyBootstrap(data); } catch (error) { showError(error); } });

Promise.all([window.aidaw.bootstrap(), window.aidaw.preferences()])
  .then(([data, preferences]) => { applyBootstrap(data, preferences); poll(); })
  .catch(showError);
window.addEventListener('beforeunload', () => clearTimeout(timer));
