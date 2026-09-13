import {validateEncoderAssignments} from '../ControlSurface/encoders.mjs';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { access, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from '../../Build/JS/Application/service.js';
import {defaultWorkspaceRoot,homePaths} from '../../Build/JS/Adapters/node/workspace/home.js';
import {readPlayerPreferences,writePlayerPreferences} from '../../Build/JS/Adapters/node/runtime/player-settings.js';
import {atomicJson} from '../../Build/JS/Adapters/node/workspace/storage.js';
import { Engine } from '../../Build/JS/Adapters/node/engine/engine.js';
import {createLocalApplication,definitions} from '../../Build/JS/Application/local-application.js';
import { call } from '../../Build/JS/Application/api.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = defaultWorkspaceRoot();
app.setName('AIDAW Player');
app.setPath('userData', join(app.getPath('appData'), 'AIDAW Player'));
let service, application;
let mainWindow;
let activePlaybackId;
let settings = {};
const allowedApi = new Set(['project_artwork','separation_start','separation_export','project_waveform','playback_set_volume','active_context_get','active_context_set','project_list','project_create','project_document','project_inspect','project_apply','project_history','project_revision','project_restore','project_save','project_open','asset_import','asset_list','playback_devices','playback_start','playback_status','playback_pause','playback_resume','playback_seek','playback_stop','playback_set_mix','export_start','export_midi','job_status','job_cancel','queue_status','mixer_inspect','catalog_search','plugin_inspect','system_capabilities']);
const knownOutputs = new Set();
allowedApi.add('mastering_add_song');
allowedApi.add('mastering_create_version');

const message = error => error instanceof Error ? error.message : String(error);
const exists = path => access(path).then(() => true, () => false);
const settingsPath = () => join(app.getPath('userData'), 'player-settings.json');

async function loadSettings() {
  try { settings = JSON.parse(await readFile(settingsPath(), 'utf8')); }
  catch { settings = {}; }
}

async function saveSettings() {
  await mkdir(dirname(settingsPath()), { recursive: true });
  if(service)await writePlayerPreferences(service.root,settings);
  await atomicJson(settingsPath(),{schema_version:2,dataDir:settings.dataDir});
}

async function defaultDataDir() {
  if(process.env.AIDAW_HOME)return resolve(process.env.AIDAW_HOME);
  if(typeof settings.dataDir==='string'&&await exists(homePaths(settings.dataDir).workspaceManifest))return resolve(settings.dataDir);
  return repoRoot;
}

async function resetService(dataDir) {
  if (service) await service.close();

  service = new Service(dataDir, new Engine(undefined,{home:dataDir}));
  application = createLocalApplication(service);
  settings = {dataDir,...await readPlayerPreferences(dataDir)};
  await saveSettings();
}

function durationFrames(project) {
  if (project.duration_frames) return Number(project.duration_frames);
  return Math.round((project.length_ticks / project.ppq) * (60 / project.bpm) * project.sample_rate);
}

async function projectDetails(projectId) {
  const project = await call(application,'project_inspect',{project_id:projectId,include_notes:false});
  const frames = durationFrames(project);
  return {
    ...project,
    duration_frames: String(frames),
    duration_seconds: frames / project.sample_rate,
    track_count: project.tracks.length,
    note_count: project.tracks.reduce((sum, track) => sum + track.note_count, 0),
    playable: project.tracks.length > 0
  };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, args) => {
    try { return { ok: true, value: await fn(args ?? {}) }; }
    catch (error) { return { ok: false, error: message(error) }; }
  });
}

function registerIpc() {
  handle('player:api', async ({ name, args = {} }) => {
    if (!allowedApi.has(name)) throw new Error('許可されていない操作です');
    const value = await call(application, name, args);
    if (name === 'playback_start') {
      activePlaybackId = value.playback_id;
      settings.projectId=args.project_id;settings.outputDevice=args.output_device;await saveSettings();
    }
    const collect = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (['output','path','server_path'].includes(key) && typeof item === 'string' && resolve(item).startsWith(resolve(service.root) + sep)) knownOutputs.add(item);
        else if (item && typeof item === 'object') collect(item);
      }
    };
    collect(value);
    return value;
  });
  handle('player:choose-file', async ({ kind }) => {
    const result = await dialog.showOpenDialog(mainWindow, { title:kind==='project'?'プロジェクトをインポート':'音声を読み込む', properties: ['openFile'], filters: kind === 'project' ? [{ name: 'AIDAW project (.aidaw.zip)', extensions: ['aidaw','zip'] }] : [{ name: '48 kHz WAV', extensions: ['wav'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('player:reveal', async ({ path }) => {
    if (!knownOutputs.has(path)) throw new Error('このセッションの成果物だけを開けます');
    shell.showItemInFolder(path); return { opened: true };
  });
  handle('player:save-output', async ({ path }) => {
    if (!knownOutputs.has(path)) throw new Error('このセッションの成果物だけを保存できます');
    const result = await dialog.showSaveDialog(mainWindow, { ...(path.endsWith('.aidaw.zip')?{title:'プロジェクトをエクスポート'}:{}), defaultPath: path.split(/[\\/]/).pop() });
    if (result.canceled || !result.filePath) return null;
    if (resolve(path) !== resolve(result.filePath)) await copyFile(path, result.filePath);
    knownOutputs.add(result.filePath); return { output: result.filePath };
  });
  handle('player:bootstrap', async () => ({
    data_dir: service.root,
    projects: await call(application,'project_list',{}),
    devices: await call(application,'playback_devices',{}),
    api: [...allowedApi].filter(name => Object.hasOwn(definitions, name))
  }));
  handle('player:project', ({ project_id }) => projectDetails(project_id));
  handle('player:start', async ({ project_id, start_frame = '0', output_device }) => {
    if (activePlaybackId) {
      const status = await call(application,'playback_status',{playback_id:activePlaybackId}).catch(() => null);
      if (status && !['stopped', 'completed', 'failed', 'cancelled'].includes(status.state)) await call(application,'playback_stop',{playback_id:activePlaybackId});
    }
    const started = await call(application,'playback_start',{ project_id, start_frame, tail_seconds: 2, loop: false, loop_start_frame: '0', loop_end_frame: '0', output_device });
    activePlaybackId = started.playback_id;
    settings.projectId = project_id;
    settings.outputDevice = output_device;
    await saveSettings();
    return started;
  });
  handle('player:status', async () => activePlaybackId ? call(application,'playback_status',{playback_id:activePlaybackId}) : null);
  handle('player:control', async ({ action, frame }) => {
    if (!activePlaybackId) throw new Error('再生中の曲がありません');
    if(!['pause','resume','stop','seek'].includes(action))throw new Error('Invalid transport action');
    return call(application,`playback_${action}`,{playback_id:activePlaybackId,...(action==='seek'?{frame}:{})});
  });
  handle('player:choose-data-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'AIDAWデータフォルダを選択', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const dataDir = result.filePaths[0];
    if (!await exists(homePaths(dataDir).projects)) throw new Error('Projectsフォルダを含むAIDAWホームを選んでください');
    await resetService(dataDir);
    activePlaybackId = undefined;
    return { data_dir: service.root, projects: await call(application,'project_list',{}), devices: await call(application,'playback_devices',{}) };
  });
  handle('player:audio-preferences',async({outputDevice})=>{
    if(typeof outputDevice!=='string'||outputDevice.length>500)throw new Error('Invalid audio output');
    settings.outputDevice=outputDevice;await saveSettings();return {output_device:outputDevice};
  });
  handle('player:layout-preferences', async ({layouts,encoderAssignments})=>{
    if(!layouts||typeof layouts!=='object'||Array.isArray(layouts)||JSON.stringify(layouts).length>65536)throw new Error('Invalid layouts');
    if(encoderAssignments!==undefined){const problem=validateEncoderAssignments(encoderAssignments);if(problem)throw new Error(problem);settings.encoderAssignments=encoderAssignments;}
    settings.customLayouts=layouts;await saveSettings();return layouts;
  });
  handle('player:choose-project-folder',async()=>{
    const result=await dialog.showOpenDialog(mainWindow,{properties:['openDirectory'],defaultPath:homePaths(service.root).projects,title:'プロジェクトを開く'});
    if(result.canceled)return null;
    const path=resolve(result.filePaths[0]),project_id=basename(path);
    if(path!==resolve(homePaths(service.root).projects,project_id))throw new Error('現在のAIDAW保存先のProjects内から選択してください。別保存先は.aidaw.zip形式で読み込めます。');
    await call(application,'project_document',{project_id});return project_id;
  });
  handle('player:controller-preferences', async ({controller}) => {
    if(!controller||typeof controller!=='object'||JSON.stringify(controller).length>65536)throw new Error('Invalid controller settings');
    if(typeof controller.profile!=='string'||typeof controller.input!=='string'||!Array.isArray(controller.mappings))throw new Error('Invalid controller settings');
    settings.controller={profile:controller.profile,input:controller.input,mappings:controller.mappings};
    await saveSettings();return settings.controller;
  });
  handle('player:skin-preferences', async ({skin}) => {
    if(!['deck','transport'].includes(skin))throw new Error('Unknown skin');
    settings.skin=skin;await saveSettings();return {skin};
  });
  handle('player:preferences', async () => ({ project_id: settings.projectId, output_device: settings.outputDevice, controller: settings.controller??{}, customLayouts: settings.customLayouts??{}, skin: settings.skin??'deck' }));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 540,
    minWidth: 434,
    minHeight: 540,
    title: 'AIDAW Player',
    backgroundColor: '#101112',
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
