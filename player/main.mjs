import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from '../dist/service.js';
import { Engine } from '../dist/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
app.setName('AIDAW Player');
app.setPath('userData', join(app.getPath('appData'), 'AIDAW Player'));
let service;
let mainWindow;
let activePlaybackId;
let settings = {};

const message = error => error instanceof Error ? error.message : String(error);
const exists = path => access(path).then(() => true, () => false);
const settingsPath = () => join(app.getPath('userData'), 'player-settings.json');

async function loadSettings() {
  try { settings = JSON.parse(await readFile(settingsPath(), 'utf8')); }
  catch { settings = {}; }
}

async function saveSettings() {
  await mkdir(dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2));
}

async function defaultDataDir() {
  const candidates = [process.env.AIDAW_HOME, settings.dataDir, join(process.cwd(), '.aidaw'), join(repoRoot, '.aidaw')].filter(Boolean);
  let parent = dirname(app.getPath('exe'));
  for (let depth = 0; depth < 8; depth++) { candidates.push(join(parent, '.aidaw')); parent = dirname(parent); }
  for (const candidate of candidates) if (await exists(join(candidate, 'projects'))) return resolve(candidate);
  return resolve(process.env.AIDAW_HOME ?? join(app.getPath('music'), 'AIDAW'));
}

function enginePath() {
  if (process.env.AIDAW_ENGINE) return process.env.AIDAW_ENGINE;
  if (!app.isPackaged) return join(repoRoot, 'build', 'bin', process.platform === 'win32' ? 'aidaw-engine.exe' : 'aidaw-engine');
  return join(process.resourcesPath, process.platform === 'win32' ? 'aidaw-engine.exe' : 'aidaw-engine');
}

async function resetService(dataDir) {
  if (service) await service.close();
  if (app.isPackaged && !process.env.AIDAW_SOUNDFONT) process.env.AIDAW_SOUNDFONT = join(process.resourcesPath, 'starter-assets', 'FluidR3_GM.sf2');
  service = new Service(dataDir, new Engine(enginePath()));
  settings.dataDir = dataDir;
  await saveSettings();
}

function durationFrames(project) {
  if (project.duration_frames) return Number(project.duration_frames);
  return Math.round((project.length_ticks / project.ppq) * (60 / project.bpm) * project.sample_rate);
}

async function projectDetails(projectId) {
  const project = await service.inspect(projectId, false);
  const frames = durationFrames(project);
  return {
    ...project,
    duration_frames: String(frames),
    duration_seconds: frames / project.sample_rate,
    track_count: project.tracks.length,
    note_count: project.tracks.reduce((sum, track) => sum + track.note_count, 0)
  };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, args) => {
    try { return { ok: true, value: await fn(args ?? {}) }; }
    catch (error) { return { ok: false, error: message(error) }; }
  });
}

function registerIpc() {
  handle('player:bootstrap', async () => ({
    data_dir: service.root,
    projects: await service.listProjects(),
    devices: await service.engine.call({ command: 'playback_devices' })
  }));
  handle('player:project', ({ project_id }) => projectDetails(project_id));
  handle('player:start', async ({ project_id, start_frame = '0', output_device }) => {
    if (activePlaybackId) {
      const status = await service.playbackStatus(activePlaybackId).catch(() => null);
      if (status && !['stopped', 'completed', 'failed', 'cancelled'].includes(status.state)) await service.controlPlayback('stop', undefined, activePlaybackId);
    }
    const started = await service.startPlayback({ project_id, start_frame, tail_seconds: 2, loop: false, loop_start_frame: '0', loop_end_frame: '0', output_device });
    activePlaybackId = started.playback_id;
    settings.projectId = project_id;
    settings.outputDevice = output_device;
    await saveSettings();
    return started;
  });
  handle('player:status', async () => activePlaybackId ? service.playbackStatus(activePlaybackId) : null);
  handle('player:control', async ({ action, frame }) => {
    if (!activePlaybackId) throw new Error('再生中の曲がありません');
    return service.controlPlayback(action, frame, activePlaybackId);
  });
  handle('player:choose-data-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'AIDAWデータフォルダを選択', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const dataDir = result.filePaths[0];
    if (!await exists(join(dataDir, 'projects'))) throw new Error('projectsフォルダを含むAIDAWデータフォルダを選んでください');
    await resetService(dataDir);
    activePlaybackId = undefined;
    return { data_dir: service.root, projects: await service.listProjects(), devices: await service.engine.call({ command: 'playback_devices' }) };
  });
  handle('player:preferences', async () => ({ project_id: settings.projectId, output_device: settings.outputDevice }));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 780,
    minHeight: 560,
    title: 'AIDAW Player',
    backgroundColor: '#090b12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  await mainWindow.loadFile(join(here, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    await loadSettings();
    await resetService(await defaultDataDir());
    registerIpc();
    await createWindow();
  }).catch(error => { dialog.showErrorBox('AIDAW Playerを起動できません', message(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!service) return;
    event.preventDefault();
    const closing = service;
    service = undefined;
    void closing.close().finally(() => { app.removeAllListeners('before-quit'); app.quit(); });
  });
}
