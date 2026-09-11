const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, args) => {
  const result = await ipcRenderer.invoke(channel, args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld('aidaw', {
  bootstrap: () => call('player:bootstrap'),
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
