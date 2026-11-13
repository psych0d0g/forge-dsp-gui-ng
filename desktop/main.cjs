// Forge DSP desktop app: the web GUI in Electron.
//  - the page comes from forge://app/ (a secure origin, so Web Serial works); ./firmware/ is served by
//    firmware.cjs straight from the GitHub releases
//  - serial ports: a single CP2102 (the Forge's USB chip) is taken at once, otherwise a native choice
//  - downloads of the page become a native "Save as" dialog, <input type=file> the native open dialog
const { app, BrowserWindow, dialog, Menu, net, protocol, session, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const firmware = require("./firmware.cjs");

protocol.registerSchemesAsPrivileged([
  { scheme: "forge", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const APP_DIR = path.join(__dirname, "app");

// AppImage: newer distributions (AppArmor, user namespaces) refuse Chromium's sandbox there and the app
// would not start. The app only shows its own page (forge://) and opens other links outside.
if (process.env.APPIMAGE) app.commandLine.appendSwitch("no-sandbox");
const CP210X = "10c4";

function choosePort(win, ports, callback) {
  const forge = ports.filter((p) => (p.vendorId ?? "").toLowerCase() === CP210X);
  if (forge.length === 1) return callback(forge[0].portId);
  if (!ports.length) {
    dialog.showMessageBox(win, { type: "info", title: "Forge DSP", message: "Kein serieller Anschluss gefunden.",
      detail: "Ist der Forge eingeschaltet und per USB verbunden?" });
    return callback("");
  }
  const label = (p) => `${p.displayName || "Serieller Anschluss"} (${p.portName})`;
  const r = dialog.showMessageBoxSync(win, { type: "question", title: "Forge DSP", message: "Mit welchem Anschluss verbinden?",
    buttons: [...ports.map(label), "Abbrechen"], cancelId: ports.length, defaultId: 0 });
  callback(r < ports.length ? ports[r].portId : "");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600, title: "Forge DSP", backgroundColor: "#f4f6fa",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const ses = win.webContents.session;
  ses.on("select-serial-port", (event, ports, _wc, callback) => {
    event.preventDefault();
    choosePort(win, ports, callback);
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === "serial");
  ses.setDevicePermissionHandler((d) => d.deviceType === "serial");
  // links to GitHub etc. open in the system browser, not in the app
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("forge://")) { e.preventDefault(); shell.openExternal(url); } });
  win.loadURL("forge://app/index.html");
}

app.whenReady().then(() => {
  protocol.handle("forge", (req) => {
    const u = new URL(req.url);
    const p = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    if (p.startsWith("firmware/")) return firmware.serve(p.slice("firmware/".length));
    const file = path.normalize(path.join(APP_DIR, p || "index.html"));
    if (!file.startsWith(APP_DIR)) return new Response("forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { label: "Datei", submenu: [{ role: "reload", label: "Neu laden" }, { role: "toggleDevTools", label: "Entwicklerwerkzeuge" }, { type: "separator" }, { role: "quit", label: "Beenden" }] },
    { label: "Ansicht", submenu: [{ role: "resetZoom", label: "Originalgröße" }, { role: "zoomIn", label: "Vergrößern" }, { role: "zoomOut", label: "Verkleinern" }, { type: "separator" }, { role: "togglefullscreen", label: "Vollbild" }] },
  ]));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
