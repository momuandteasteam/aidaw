const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, args) => {
  const result = await ipcRenderer.invoke(channel, args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld('aidaw', {
  api: (name, args = {}) => call('player:api', { name, args }),
  chooseFile: kind => call('player:choose-file', { kind }),
  reveal: path => call('player:reveal', { path }),
  saveOutput: path => call('player:save-output', { path }),
  bootstrap: () => call('player:bootstrap'),
  saveAudioPreferences: outputDevice => call('player:audio-preferences', {outputDevice}),
  chooseProjectFolder: () => call('player:choose-project-folder'),
  saveSkinPreferences: skin => call('player:skin-preferences', {skin}),
  saveLayoutPreferences: (layouts,encoderAssignments) => call('player:layout-preferences', {layouts,encoderAssignments}),
  saveControllerPreferences: controller => call('player:controller-preferences', {controller}),
  preferences: () => call('player:preferences'),
  project: project_id => call('player:project', { project_id }),
  start: args => call('player:start', args),
  status: () => call('player:status'),
  pause: () => call('player:control', { action: 'pause' }),
  resume: () => call('player:control', { action: 'resume' }),
  seek: frame => call('player:control', { action: 'seek', frame }),
  stop: () => call('player:control', { action: 'stop' }),
  chooseDataDir: () => call('player:choose-data-dir')
});
