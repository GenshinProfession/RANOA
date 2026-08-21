/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("ranoaDesktop", {
  platform: process.platform,
  getPathForFile(file) {
    return webUtils.getPathForFile(file);
  },
  menu: {
    open: (section, anchor) => ipcRenderer.invoke("ranoa:menu:open", section, anchor),
  },
  window: {
    minimize: () => ipcRenderer.invoke("ranoa:window:action", "minimize"),
    toggleMaximize: () => ipcRenderer.invoke("ranoa:window:action", "toggle-maximize"),
    close: () => ipcRenderer.invoke("ranoa:window:action", "close"),
  },
  pet: {
    show: () => ipcRenderer.invoke("ranoa:pet:show"),
    hide: () => ipcRenderer.invoke("ranoa:pet:hide"),
    setBubbleOpen: (open) => ipcRenderer.invoke("ranoa:pet:set-bubble-open", open),
    startDrag: (point) => ipcRenderer.invoke("ranoa:pet:drag-start", point),
    moveDrag: () => ipcRenderer.send("ranoa:pet:drag-move"),
    endDrag: () => ipcRenderer.send("ranoa:pet:drag-end"),
    setState: (state) => ipcRenderer.invoke("ranoa:pet:set-state", state),
    setActivity: (activity) => ipcRenderer.invoke("ranoa:pet:set-activity", activity),
    setTheme: (theme) => ipcRenderer.invoke("ranoa:pet:set-theme", theme),
    present: (message) => ipcRenderer.invoke("ranoa:pet:present", message),
    reply: (message) => ipcRenderer.invoke("ranoa:pet:reply", message),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("ranoa:pet:state", handler);
      return () => ipcRenderer.removeListener("ranoa:pet:state", handler);
    },
    onTheme: (listener) => {
      const handler = (_event, theme) => listener(theme);
      ipcRenderer.on("ranoa:pet:theme", handler);
      return () => ipcRenderer.removeListener("ranoa:pet:theme", handler);
    },
    onMessage: (listener) => {
      const handler = (_event, message) => listener(message);
      ipcRenderer.on("ranoa:pet:message", handler);
      return () => ipcRenderer.removeListener("ranoa:pet:message", handler);
    },
    onActivity: (listener) => {
      const handler = (_event, activity) => listener(activity);
      ipcRenderer.on("ranoa:pet:activity", handler);
      return () => ipcRenderer.removeListener("ranoa:pet:activity", handler);
    },
    onReply: (listener) => {
      const handler = (_event, message) => listener(message);
      ipcRenderer.on("ranoa:pet:reply", handler);
      return () => ipcRenderer.removeListener("ranoa:pet:reply", handler);
    },
  },
});
