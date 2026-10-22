const { app, BrowserWindow, ipcMain, shell } = require('electron');

const path = require('path');
const fs = require('fs');

const { startApiProcess, waitForHealth } = require('./serverLauncher.js');
const { ensureSecrets } = require('./secrets.js');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const API_PORT = process.env.PORT || '3001';

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'public', 'favicon.ico'),
    path.join(__dirname, '..', 'dist', 'favicon.ico'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'favicon.ico'),
    path.join(process.resourcesPath, 'app', 'dist', 'favicon.ico'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

let apiProcess = null;
let apiRestartTimer = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const ALLOWED_EXTERNAL_PREFIXES = ['https://', 'http://localhost'];



let mainWindow = null;



function sanitizePrintHtml(html) {

  if (typeof html !== 'string') return '';

  return html

    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')

    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')

    .replace(/\bon\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')

    .replace(/javascript:/gi, '')

    .replace(/data:(?!image\/)/gi, 'blocked:');

}



function validateExternalUrl(url) {

  if (typeof url !== 'string') return false;

  return ALLOWED_EXTERNAL_PREFIXES.some((prefix) => url.startsWith(prefix));

}



function validatePrintHtml(html) {

  return typeof html === 'string' && html.length > 0 && html.length < 500000;

}



function hardenWebContents(webContents) {

  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  webContents.on('will-navigate', (event, url) => {

    const allowed = isDev
      ? url.startsWith('http://localhost:5173') || url.startsWith('http://127.0.0.1:5173') || url.startsWith('file://')
      : url.startsWith('http://127.0.0.1:') || url.startsWith('file://');

    if (!allowed) event.preventDefault();

  });

}



function createWindow() {

  const iconPath = resolveAppIconPath();

  mainWindow = new BrowserWindow({

    width: 1400,

    height: 900,

    minWidth: 1024,

    minHeight: 700,

    show: false,

    ...(iconPath ? { icon: iconPath } : {}),

    webPreferences: {

      preload: path.join(__dirname, 'preload.js'),

      contextIsolation: true,

      nodeIntegration: false,

      sandbox: true,

      webSecurity: true,

      allowRunningInsecureContent: false,

      enableRemoteModule: false,

    },

  });



  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {

    callback({

      responseHeaders: {

        ...details.responseHeaders,

        'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:*; frame-src 'none'; object-src 'none'"],

      },

    });

  });



  hardenWebContents(mainWindow.webContents);



  mainWindow.once('ready-to-show', () => {

    mainWindow.show();

    if (isDev) {

      mainWindow.webContents.openDevTools({ mode: 'detach' });

    }

  });



  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${API_PORT}`);
  }



  mainWindow.on('closed', () => {

    mainWindow = null;

  });

}



function launchApi() {
  if (apiProcess && !apiProcess.killed) return;
  apiProcess = startApiProcess(app, (code, signal) => {
    apiProcess = null;
    if (isDev) return;
    console.error('[electron] API exited', code, signal);
    if (apiRestartTimer) clearTimeout(apiRestartTimer);
    apiRestartTimer = setTimeout(() => {
      launchApi();
      waitForHealth(API_PORT).catch((err) => console.error('[electron] API restart failed:', err));
    }, 2000);
  });
}

if (gotLock) {
  app.whenReady().then(async () => {
    if (!isDev) {
      if (process.platform === 'win32') {
        app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
      }
      launchApi();
      try {
        await waitForHealth(API_PORT);
      } catch (err) {
        console.error('[electron] Local API failed to start:', err);
      }
    }
    createWindow();
  });
}

app.on('before-quit', () => {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill();
    apiProcess = null;
  }
});



app.on('window-all-closed', () => {

  if (process.platform !== 'darwin') app.quit();

});



app.on('activate', () => {

  if (BrowserWindow.getAllWindows().length === 0) createWindow();

});



ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('app:getPlatform', () => process.platform);

ipcMain.handle('app:getDesktopApiSecret', () => {
  const secrets = ensureSecrets(app);
  return secrets.desktopApiSecret ?? null;
});



function desktopSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function readDesktopSettings() {
  try {
    const raw = fs.readFileSync(desktopSettingsPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeDesktopSettings(patch) {
  const current = readDesktopSettings();
  fs.writeFileSync(desktopSettingsPath(), JSON.stringify({ ...current, ...patch }, null, 2), 'utf8');
}

ipcMain.handle('printers:list', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!win) return [];
  return win.webContents.getPrintersAsync();
});

ipcMain.handle('printers:getDefault', () => readDesktopSettings().defaultReceiptPrinter ?? null);

ipcMain.handle('printers:setDefault', (_event, deviceName) => {
  if (deviceName != null && typeof deviceName !== 'string') throw new Error('Invalid printer name');
  writeDesktopSettings({ defaultReceiptPrinter: deviceName || null });
  return true;
});

ipcMain.handle('print:receipt', async (_event, payload) => {
  const html = typeof payload === 'string' ? payload : payload?.html;
  const deviceName =
    (typeof payload === 'object' && payload?.deviceName) ||
    readDesktopSettings().defaultReceiptPrinter ||
    undefined;

  if (!validatePrintHtml(html)) throw new Error('Invalid print content');

  const safeHtml = sanitizePrintHtml(html);

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  hardenWebContents(printWindow.webContents);

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(safeHtml)}`);

  return new Promise((resolve, reject) => {
    printWindow.webContents.print(
      { silent: !!deviceName, deviceName, printBackground: true },
      (success, failureReason) => {
        printWindow.close();
        if (!success) reject(new Error(failureReason || 'Print failed'));
        else resolve(true);
      }
    );
  });
});



ipcMain.handle('shell:openExternal', (_event, url) => {

  if (!validateExternalUrl(url)) throw new Error('URL not allowed');

  return shell.openExternal(url);

});



const { safeStorage } = require('electron');

function readSecure(key) {
  if (typeof key !== 'string' || key.length > 100) return null;
  try {
    const file = path.join(app.getPath('userData'), `secure-${key}.bin`);
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf);
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function writeSecure(key, value) {
  if (typeof key !== 'string' || key.length > 100) return false;
  if (typeof value !== 'string' || value.length > 10000) return false;
  try {
    const file = path.join(app.getPath('userData'), `secure-${key}.bin`);
    const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8');
    fs.writeFileSync(file, buf);
    return true;
  } catch {
    return false;
  }
}

ipcMain.handle('storage:get', (_event, key) => readSecure(key));
ipcMain.handle('storage:set', (_event, key, value) => writeSecure(key, value));
ipcMain.handle('storage:remove', (_event, key) => {
  if (typeof key !== 'string') return false;
  try {
    const file = path.join(app.getPath('userData'), `secure-${key}.bin`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
});

