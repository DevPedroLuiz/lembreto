const { app, BrowserWindow, Menu, shell, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const isDevServer = Boolean(process.env.ELECTRON_START_URL);
let mainWindow = null;

function debugLog(message, error) {
  if (process.env.LEMBRETO_ELECTRON_DEBUG !== '1') return;

  const details = error ? ` ${error.stack || error.message || String(error)}` : '';
  fs.appendFileSync(
    path.join(os.tmpdir(), 'lembreto-electron-debug.log'),
    `[${new Date().toISOString()}] ${message}${details}\n`,
  );
}

process.on('uncaughtException', (error) => {
  debugLog('uncaughtException', error);
  throw error;
});

process.on('unhandledRejection', (error) => {
  debugLog('unhandledRejection', error instanceof Error ? error : new Error(String(error)));
});

debugLog(`main loaded app=${Boolean(app)} browserWindow=${Boolean(BrowserWindow)}`);

function getAppIconPath() {
  return path.join(__dirname, '..', 'public', 'icon.png');
}

function createMainWindow() {
  debugLog('creating main window');

  mainWindow = new BrowserWindow({
    title: 'Lembreto',
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#f8fafc',
    icon: getAppIconPath(),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });

  if (isDevServer) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL).catch((error) => debugLog('loadURL failed', error));
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch((error) => debugLog('loadFile failed', error));
  }
}

function createApplicationMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'resetZoom', label: 'Tamanho real' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setAppUserModelId('com.lembreto.app');

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

}

app.whenReady().then(() => {
  debugLog('app ready');

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'notifications');
  });

  createApplicationMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
