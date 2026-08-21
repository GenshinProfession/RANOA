/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen, shell } = require("electron");

const desktopUrl = process.env.RANOA_DESKTOP_URL || "http://127.0.0.1:31141";
const trustedOrigin = new URL(desktopUrl).origin;
let mainWindow = null;
let petWindow = null;
let currentPetState = "idle";
let currentPetTheme = "roxy";
let currentPetMessage = null;
let currentPetActivity = null;
let petWindowExpanded = false;
let petDragSession = null;
const allowedPetStates = new Set(["idle", "working", "thinking", "tool", "done", "error"]);
const allowedPetThemes = new Set(["roxy", "sylphiette", "eris"]);
const compactPetSize = { width: 220, height: 290 };
const expandedPetSize = { width: 560, height: 330 };

app.setName("RANOA");
nativeTheme.themeSource = "dark";

function menuItemsFor(section) {
  if (section === "file") return [
    { label: "关闭窗口", accelerator: "Ctrl+W", role: "close" },
    { type: "separator" },
    { label: "退出 RANOA", accelerator: "Alt+F4", role: "quit" },
  ];
  if (section === "edit") return [
    { label: "撤销", accelerator: "Ctrl+Z", role: "undo" },
    { label: "重做", accelerator: "Ctrl+Y", role: "redo" },
    { type: "separator" },
    { label: "剪切", accelerator: "Ctrl+X", role: "cut" },
    { label: "复制", accelerator: "Ctrl+C", role: "copy" },
    { label: "粘贴", accelerator: "Ctrl+V", role: "paste" },
    { label: "全选", accelerator: "Ctrl+A", role: "selectAll" },
  ];
  if (section === "view") return [
    { label: "重新加载", accelerator: "Ctrl+R", role: "reload" },
    { label: "强制重新加载", accelerator: "Ctrl+Shift+R", role: "forceReload" },
    { type: "separator" },
    { label: "放大", accelerator: "Ctrl+Plus", role: "zoomIn" },
    { label: "缩小", accelerator: "Ctrl+-", role: "zoomOut" },
    { label: "恢复默认缩放", accelerator: "Ctrl+0", role: "resetZoom" },
    { type: "separator" },
    { label: "全屏", accelerator: "F11", role: "togglefullscreen" },
    ...(!app.isPackaged ? [{ label: "开发者工具", accelerator: "Ctrl+Shift+I", role: "toggleDevTools" }] : []),
  ];
  if (section === "window") return [
    { label: "最小化", role: "minimize" },
    { label: "最大化 / 还原", role: "zoom" },
    { label: "关闭", role: "close" },
  ];
  return [];
}

function isTrustedNavigation(rawUrl) {
  try {
    return new URL(rawUrl).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function secureWindowNavigation(window) {
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedNavigation(targetUrl)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#071611",
    frame: false,
    thickFrame: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "ranoa.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  secureWindowNavigation(mainWindow);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.center();
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  void mainWindow.loadURL(desktopUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  petWindowExpanded = false;
  const { width, height } = compactPetSize;
  const workArea = screen.getPrimaryDisplay().workArea;
  petWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 20,
    y: workArea.y + workArea.height - height - 14,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  petWindow.setAlwaysOnTop(true, "floating");
  void petWindow.loadFile(path.join(__dirname, "pet.html"));
  petWindow.webContents.once("did-finish-load", () => {
    petWindow?.webContents.send("ranoa:pet:theme", currentPetTheme);
    petWindow?.webContents.send("ranoa:pet:state", currentPetState);
    if (currentPetMessage) petWindow?.webContents.send("ranoa:pet:message", currentPetMessage);
    if (currentPetActivity) petWindow?.webContents.send("ranoa:pet:activity", currentPetActivity);
  });
  petWindow.on("closed", () => {
    petWindow = null;
    petWindowExpanded = false;
    petDragSession = null;
  });
  return petWindow;
}

function setPetWindowExpanded(expanded) {
  if (!petWindow || petWindow.isDestroyed() || petWindowExpanded === expanded) return true;
  const current = petWindow.getBounds();
  const target = expanded ? expandedPetSize : compactPetSize;
  const workArea = screen.getDisplayMatching(current).workArea;
  const desiredX = current.x + current.width - target.width;
  const desiredY = current.y + current.height - target.height;
  petWindowExpanded = expanded;
  petWindow.setBounds({
    x: Math.max(workArea.x, Math.min(desiredX, workArea.x + workArea.width - target.width)),
    y: Math.max(workArea.y, Math.min(desiredY, workArea.y + workArea.height - target.height)),
    width: target.width,
    height: target.height,
  }, false);
  return true;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // The companion may intentionally outlive a closed workbench window. A
    // second launch must restore the workbench instead of being swallowed by
    // Electron's single-instance lock.
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    ipcMain.handle("ranoa:menu:open", (event, section, anchor) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      const items = menuItemsFor(section);
      if (!owner || owner.isDestroyed() || items.length === 0) return false;
      Menu.buildFromTemplate(items).popup({
        window: owner,
        x: Math.max(0, Math.round(Number(anchor?.x) || 0)),
        y: Math.max(34, Math.round(Number(anchor?.y) || 34)),
      });
      return true;
    });
    ipcMain.handle("ranoa:window:action", (event, action) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || owner.isDestroyed()) return false;
      if (action === "minimize") owner.minimize();
      else if (action === "toggle-maximize") {
        if (owner.isMaximized()) owner.unmaximize();
        else owner.maximize();
      }
      else if (action === "close") owner.close();
      else return false;
      return true;
    });
    ipcMain.handle("ranoa:pet:show", () => {
      createPetWindow().showInactive();
    });
    ipcMain.handle("ranoa:pet:hide", () => petWindow?.hide());
    ipcMain.handle("ranoa:pet:set-bubble-open", (_event, open) => {
      createPetWindow();
      return setPetWindowExpanded(open === true);
    });
    ipcMain.handle("ranoa:pet:set-state", (_event, state) => {
      if (!allowedPetStates.has(state)) return false;
      currentPetState = state;
      createPetWindow().webContents.send("ranoa:pet:state", state);
      return true;
    });
    ipcMain.handle("ranoa:pet:set-activity", (_event, activity) => {
      const text = typeof activity?.text === "string" ? activity.text.trim().slice(0, 2400) : "";
      if (!text) return false;
      currentPetActivity = {
        sessionId: typeof activity?.sessionId === "string" ? activity.sessionId : null,
        text,
      };
      currentPetMessage = null;
      createPetWindow().webContents.send("ranoa:pet:activity", currentPetActivity);
      return true;
    });
    ipcMain.handle("ranoa:pet:set-theme", (_event, theme) => {
      if (!allowedPetThemes.has(theme)) return false;
      currentPetTheme = theme;
      createPetWindow().webContents.send("ranoa:pet:theme", theme);
      return true;
    });
    ipcMain.handle("ranoa:pet:present", (_event, message) => {
      const text = typeof message?.text === "string" ? message.text.trim().slice(0, 2400) : "";
      if (!text) return false;
      currentPetMessage = {
        sessionId: typeof message?.sessionId === "string" ? message.sessionId : null,
        text,
      };
      currentPetActivity = null;
      createPetWindow().webContents.send("ranoa:pet:message", currentPetMessage);
      return true;
    });
    ipcMain.handle("ranoa:pet:reply", (_event, message) => {
      const text = typeof message?.text === "string" ? message.text.trim().slice(0, 8000) : "";
      if (!text || !mainWindow || mainWindow.isDestroyed()) return false;
      const payload = {
        sessionId: typeof message?.sessionId === "string" ? message.sessionId : null,
        text,
      };
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("ranoa:pet:reply", payload);
      return true;
    });
    ipcMain.handle("ranoa:pet:drag-start", (event, point) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || owner !== petWindow || owner.isDestroyed()) return false;
      const fallbackCursor = screen.getCursorScreenPoint();
      const requestedX = Number(point?.x);
      const requestedY = Number(point?.y);
      const cursor = {
        x: Number.isFinite(requestedX) ? Math.round(requestedX) : fallbackCursor.x,
        y: Number.isFinite(requestedY) ? Math.round(requestedY) : fallbackCursor.y,
      };
      petDragSession = {
        senderId: event.sender.id,
        cursorX: cursor.x,
        cursorY: cursor.y,
        bounds: owner.getBounds(),
      };
      return true;
    });
    ipcMain.on("ranoa:pet:drag-move", (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || owner !== petWindow || owner.isDestroyed() || petDragSession?.senderId !== event.sender.id) return;
      const cursor = screen.getCursorScreenPoint();
      const { bounds: originBounds, cursorX, cursorY } = petDragSession;
      const currentBounds = owner.getBounds();
      const nextBounds = {
        ...currentBounds,
        x: originBounds.x + cursor.x - cursorX,
        y: originBounds.y + cursor.y - cursorY,
      };
      const workArea = screen.getDisplayMatching(nextBounds).workArea;
      const nextX = Math.max(workArea.x, Math.min(nextBounds.x, workArea.x + workArea.width - currentBounds.width));
      const nextY = Math.max(workArea.y, Math.min(nextBounds.y, workArea.y + workArea.height - currentBounds.height));
      owner.setPosition(nextX, nextY, false);
    });
    ipcMain.on("ranoa:pet:drag-end", (event) => {
      if (petDragSession?.senderId === event.sender.id) petDragSession = null;
    });

    createMainWindow();
    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
