const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  list: () => ipcRenderer.invoke('assessees:list'),
  add: (a) => ipcRenderer.invoke('assessees:add', a),
  update: (a) => ipcRenderer.invoke('assessees:update', a),
  remove: (id) => ipcRenderer.invoke('assessees:delete', id),
  importExcel: () => ipcRenderer.invoke('assessees:importExcel'),
  downloadTemplate: () => ipcRenderer.invoke('assessees:downloadTemplate'),
  download: (payload) => ipcRenderer.invoke('download:run', payload),
  downloadBatch: (payload) => ipcRenderer.invoke('download:runBatch', payload),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  onLog: (cb) => ipcRenderer.on('download:log', (_e, data) => cb(data)),
  onProgress: (cb) => ipcRenderer.on('download:progress', (_e, data) => cb(data)),
});
