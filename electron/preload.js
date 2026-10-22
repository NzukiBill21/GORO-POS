const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_CHANNELS = [
  'app:getVersion',
  'app:getPlatform',
  'app:getDesktopApiSecret',
  'print:receipt',
  'printers:list',
  'printers:getDefault',
  'printers:setDefault',
  'shell:openExternal',
  'storage:get',
  'storage:set',
  'storage:remove',
];

function invoke(channel, ...args) {
  if (!ALLOWED_CHANNELS.includes(channel)) {
    return Promise.reject(new Error(`Unauthorized IPC channel: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => invoke('app:getVersion'),
  getPlatform: () => invoke('app:getPlatform'),
  getDesktopApiSecret: () => invoke('app:getDesktopApiSecret'),
  printReceipt: (htmlOrPayload) => {
    if (typeof htmlOrPayload === 'string' || (htmlOrPayload && typeof htmlOrPayload.html === 'string')) {
      return invoke('print:receipt', htmlOrPayload);
    }
    return Promise.reject(new Error('Invalid argument'));
  },
  listPrinters: () => invoke('printers:list'),
  getDefaultReceiptPrinter: () => invoke('printers:getDefault'),
  setDefaultReceiptPrinter: (deviceName) => invoke('printers:setDefault', deviceName),
  openExternal: (url) => {
    if (typeof url !== 'string') return Promise.reject(new Error('Invalid argument'));
    return invoke('shell:openExternal', url);
  },
  storage: {
    get: (key) => invoke('storage:get', key),
    set: (key, value) => invoke('storage:set', key, value),
    remove: (key) => invoke('storage:remove', key),
  },
});
