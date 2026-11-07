// Kyro Neo Board — programa de escritorio (Electron).
// Arranca el servidor de la mesa en un puerto libre de esta compu (127.0.0.1) y lo muestra en una ventana.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const SELFTEST = process.argv.includes('--selftest');

// una sola ventana: si se abre un .neo con el programa ya abierto, va a esa misma
if (!SELFTEST && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// los proyectos recientes se guardan en la carpeta del usuario (la del programa es de solo lectura)
process.env.MESA_REG = path.join(app.getPath('userData'), 'proyectos.json');
process.env.MESA_CACHE = path.join(app.getPath('userData'), 'vistas-previas'); // fotos achicadas / convertidas (TIFF, HEIC, RAW)
const server = require('./web/_app/server.js');

let win = null, port = 0;
const neoArg = argv => argv.slice(1).find(a => /\.neo$/i.test(a) && fs.existsSync(a));

function urlFor(neo) {
  if (!neo) return `http://127.0.0.1:${port}/`;
  server.allowPath(neo);
  return `http://127.0.0.1:${port}/?neo=${encodeURIComponent(path.resolve(neo))}`;
}

// el explorador de Windows, con la ventana del programa como dueña
server.setDialog(async (kind, { name, start }) => {
  const def = start && fs.existsSync(start) ? start : app.getPath('documents');
  const neo = [{ name: 'Proyecto Neo', extensions: ['neo'] }];
  if (kind === 'folder') {
    const r = await dialog.showOpenDialog(win, { title: 'Elegí una carpeta', defaultPath: def, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? '' : r.filePaths[0];
  }
  if (kind === 'save') {
    const r = await dialog.showSaveDialog(win, { title: 'Guardar proyecto', defaultPath: path.join(def, name || 'Proyecto.neo'), filters: neo });
    return r.canceled || !r.filePath ? '' : r.filePath;
  }
  if (kind === 'open') {
    const r = await dialog.showOpenDialog(win, { title: 'Abrir proyecto', defaultPath: def, filters: neo, properties: ['openFile'] });
    return r.canceled ? '' : r.filePaths[0];
  }
  return '';
});
server.setReveal(p => shell.openPath(p));

function createWindow(neo) {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'Kyro Neo Board', backgroundColor: '#2f6b57', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  const own = u => u.startsWith(`http://127.0.0.1:${port}/`);
  // links de afuera: en el navegador de siempre; nunca ventanas nuevas dentro del programa
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url) && !own(url)) shell.openExternal(url); return { action: 'deny' }; });
  // soltar un archivo fuera de la mesa no tiene que "navegar" hacia él
  win.webContents.on('will-navigate', (e, url) => { if (!own(url)) e.preventDefault(); });
  win.webContents.on('will-redirect', (e, url) => { if (!own(url)) e.preventDefault(); });
  // el título lo pone la mesa (nombre del proyecto · Kyro Neo Board)
  win.webContents.setVisualZoomLevelLimits(1, 1); // pellizcar el trackpad hace zoom en la mesa, no en toda la ventana
  win.once('ready-to-show', () => { if (!SELFTEST) { win.maximize(); win.show(); } });
  win.on('closed', () => { win = null; });

  if (SELFTEST) { // prueba automática: carga sin mostrar, junta errores y sale
    const errs = [];
    win.webContents.on('console-message', (...a) => { const lvl = typeof a[1] === 'number' ? a[1] : a[0]?.level, msg = typeof a[2] === 'string' ? a[2] : a[0]?.message; if (lvl === 3 || lvl === 'error') errs.push(msg); });
    win.webContents.on('did-fail-load', (_e, c, d) => errs.push('no cargó: ' + c + ' ' + d));
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      let t = '';
      try { t = await win.webContents.executeJavaScript('document.title + " | " + (document.querySelector("#stats")?.textContent || "")'); } catch (e) { errs.push(String(e)); }
      console.log('SELFTEST titulo: ' + t);
      try { // gestos: dos dedos (mover), pellizcar (zoom) y ruedita del mouse
        const r = await win.webContents.executeJavaScript(`(() => { const c = document.getElementById('mesa'), ev = o => c.dispatchEvent(new WheelEvent('wheel', { clientX: 600, clientY: 400, bubbles: true, cancelable: true, ...o }));
          const before = c.toDataURL().length; ev({ deltaX: 3.5, deltaY: 12.25 }); ev({ deltaY: -6.5, ctrlKey: true }); ev({ deltaY: 100 }); return 'gestos ok'; })()`);
        console.log('SELFTEST ' + r);
      } catch (e) { errs.push('gestos: ' + e.message); }
      if (process.env.KNB_TEST_SHOT) { // capturas para revisar a ojo (prueba)
        fs.writeFileSync(process.env.KNB_TEST_SHOT + '-mesa.png', (await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('document.getElementById("cfgBtn").click()');
        await new Promise(r => setTimeout(r, 400));
        fs.writeFileSync(process.env.KNB_TEST_SHOT + '-config.png', (await win.webContents.capturePage()).toPNG());
      }
      console.log(errs.length ? 'SELFTEST ERRORES:\n' + errs.join('\n') : 'SELFTEST OK');
      app.exit(errs.length ? 1 : 0);
    }, Number(process.env.KNB_TEST_WAIT) || 2500));
  }
  if (SELFTEST && process.env.KNB_TEST_DIR) { server.allowPath(process.env.KNB_TEST_DIR); return win.loadURL(`http://127.0.0.1:${port}/?p=${encodeURIComponent(process.env.KNB_TEST_DIR)}`); }
  win.loadURL(urlFor(neo));
}

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const neo = neoArg(argv);
  if (neo) win.loadURL(urlFor(neo));
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // sin la barra de menú (Archivo, Editar…): la mesa tiene la suya
  // siempre el mismo puerto (si se puede): así la configuración y las preferencias se recuerdan entre aperturas
  try { port = await server.start(SELFTEST ? 0 : 47821).catch(() => server.start(0)); }
  catch (e) { dialog.showErrorBox('Kyro Neo Board', 'No se pudo arrancar la mesa: ' + e.message); return app.quit(); }
  createWindow(neoArg(process.argv));
});
app.on('window-all-closed', () => app.quit());
