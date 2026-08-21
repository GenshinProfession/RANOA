# RANOA Desktop

## Framework decision

Use Electron for the first production desktop release. Tauri 2 remains a valid
lightweight alternative, but it is not the best fit for this repository:

- RANOA already depends on a live Node/Next server and Pi's in-process Node
  runtime. Electron can host that process directly; Tauri would still need a
  separately packaged Node sidecar.
- Electron ships one Chromium runtime, so the ornate themes, transparency,
  animation timing and font rendering are more consistent across machines.
- `BrowserWindow` already provides the transparent, frameless, always-on-top,
  taskbar-free and click-through behavior required by a future desktop pet.
- Electron's larger installer and memory footprint are accepted here in return
  for lower integration risk. The UI and runtime boundaries stay framework
  neutral so a Tauri shell remains possible later.

## Runtime shape

```text
Electron main process
  ├─ main BrowserWindow: existing RANOA UI
  ├─ local Next/Pi process: loopback-only, ephemeral port
  ├─ `.ranoa`: sessions, attachments, auth, sync and preferences
  └─ pet BrowserWindow: transparent always-on-top companion
```

The desktop shell must bind the local server to loopback only, reject external
navigation, use a context-isolated preload bridge, and shut the local server
down with the app. SSH passwords and provider secrets remain in the existing
local stores and are never exposed through the renderer bridge.

## File import behavior

The browser build cannot see a dropped file's original absolute path, so it
copies documents into `.ranoa/attachments` and inserts only the managed path.
Electron uses `webUtils.getPathForFile()` in the preload bridge and can insert
the original path directly without copying. Images continue through the
existing multimodal attachment path.

## Delivery stages

1. Add a context-isolated Electron development shell and native file-path
   bridge while keeping browser development unchanged.
2. Package the local Next/Pi runtime, choose an ephemeral loopback port, add
   single-instance locking, tray controls and clean shutdown.
3. Add the transparent pet window and a small event bridge (`idle`, `thinking`,
   `tool`, `done`, `error`) fed by the existing chat lifecycle.
4. Add Windows signing, installer and updater; validate macOS/Linux only after
   the Windows release is stable.

The web application remains the source of truth, so browser and desktop builds
share the same UI, data model and cloud-sync behavior.
