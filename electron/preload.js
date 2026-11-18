const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shining', {
  snapshot: () => ipcRenderer.invoke('data:snapshot'),

  createIdea: (content, images) => ipcRenderer.invoke('idea:create', content, images),
  updateIdea: (id, patch) => ipcRenderer.invoke('idea:update', { id, patch }),
  deleteIdea: (id) => ipcRenderer.invoke('idea:delete', id),

  createTask: (content, ideaId, images) => ipcRenderer.invoke('task:create', { content, ideaId, images }),
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', { id, patch }),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),

  saveImage: (data, mime) => ipcRenderer.invoke('image:save', { data, mime }),
  pickImages: () => ipcRenderer.invoke('image:pick'),
  deleteImage: (name) => ipcRenderer.invoke('image:delete', name),
  openImage: (name) => ipcRenderer.invoke('image:open', name),

  hideCapture: () => ipcRenderer.invoke('capture:hide'),
  openMain: () => ipcRenderer.invoke('main:show'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiModels: (baseUrl, apiKey) => ipcRenderer.invoke('ai:models', { baseUrl, apiKey }),
  settingsInfo: () => ipcRenderer.invoke('settings:info'),
  pickDataDir: () => ipcRenderer.invoke('settings:pick-data-dir'),
  openDataDir: () => ipcRenderer.invoke('settings:open-data-dir'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  setApiKey: (key) => ipcRenderer.invoke('ai:set-key', key),
  splitIdea: (text) => ipcRenderer.invoke('ai:split', text),
  scheduleTask: (id) => ipcRenderer.invoke('task:schedule', id),
  commitTasks: (ideaId, contents) => ipcRenderer.invoke('idea:commit-tasks', { ideaId, contents }),

  createLog: (content, images) => ipcRenderer.invoke('log:create', content, images),
  updateLog: (id, patch) => ipcRenderer.invoke('log:update', { id, patch }),
  deleteLog: (id) => ipcRenderer.invoke('log:delete', id),
  updateLog: (id, patch) => ipcRenderer.invoke('log:update', { id, patch }),
  generateReport: (weekLabel, entries) =>
    ipcRenderer.invoke('report:generate', { weekLabel, entries }),

  windowControl: (action) => ipcRenderer.send('win:control', action),

  onChanged: (cb) => {
    const handler = (_e, snap) => cb(snap)
    ipcRenderer.on('data:changed', handler)
    return () => ipcRenderer.removeListener('data:changed', handler)
  },

  onCaptureReset: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('capture:reset', handler)
    return () => ipcRenderer.removeListener('capture:reset', handler)
  },
})
