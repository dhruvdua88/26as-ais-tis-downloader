const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  list: () => ipcRenderer.invoke('assessees:list'),
  add: (a) => ipcRenderer.invoke('assessees:add', a),
  update: (a) => ipcRenderer.invoke('assessees:update', a),
  remove: (id) => ipcRenderer.invoke('assessees:delete', id),
  download: (payload) => ipcRenderer.invoke('download:run', payload),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  onLog: (cb) => ipcRenderer.on('download:log', (_e, data) => cb(data)),
  // CompuOffice import
  compuPick:    ()           => ipcRenderer.invoke('compuoffice:pick'),
  compuPreview: (filePath)   => ipcRenderer.invoke('compuoffice:preview', filePath),
  compuImport:  (rows)       => ipcRenderer.invoke('compuoffice:import', rows),
});
