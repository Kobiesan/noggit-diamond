/**
 * Noggit Diamond — Electron main process.
 *
 * Thin desktop shell around the built web app in dist/. No node
 * integration in the renderer; file open/save goes through the same
 * flows as the browser (drag & drop in, downloads out), with downloads
 * routed through the native save dialog.
 */

const { app, BrowserWindow, session, shell, Menu } = require('electron');
const path = require('path');

const devServer =
  process.env.NOGGIT_DEV_SERVER ||
  (process.argv.includes('--dev') ? 'http://localhost:5173' : '');
const isDev = !app.isPackaged && devServer !== '';

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#14161a',
    title: 'Noggit Diamond',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // "Save" in the app triggers downloads; without an explicit savePath
  // Electron shows the native save dialog for each file.
  win.webContents.session.on('will-download', (_event, item) => {
    item.on('done', (_e, state) => {
      if (state === 'completed') {
        win.webContents.executeJavaScript(
          `console.info(${JSON.stringify(`Saved ${item.getFilename()}`)})`,
          true,
        ).catch(() => {});
      }
    });
  });

  // External links (docs, GitHub) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(devServer);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Headless smoke mode (CI): screenshot the loaded app, then exit 0.
  const smokePath = process.env.NOGGIT_SMOKE;
  if (smokePath) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const ok = await win.webContents.executeJavaScript("typeof window.nd === 'object'", true);
          const image = await win.webContents.capturePage();
          require('fs').writeFileSync(smokePath, image.toPNG());
          app.exit(ok ? 0 : 2);
        } catch (err) {
          console.error('smoke failed:', err);
          app.exit(1);
        }
      }, 2500);
    });
  }
  return win;
}

// The in-app top bar owns File/Edit/etc; keep the native menu minimal.
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Window',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Allow software WebGL so the editor still runs on machines/VMs without
// usable GPU drivers (modern Chromium blocks SwiftShader by default).
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

app.whenReady().then(() => {
  // Never talk to the network: the editor is fully local.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      callback({ cancel: !isDev });
    },
  );
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
