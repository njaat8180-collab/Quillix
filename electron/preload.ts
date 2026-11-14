/**
 * QUILLIX — Electron preload.
 *
 * Bridges the tiny set of desktop-only capabilities (native dialogs) into the
 * hardened sandboxed renderer. Everything else goes through the local HTTP
 * API exactly like the browser build.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('quillixDesktop', {
  /** True when running inside the QUILLIX desktop app. */
  isDesktop: true,
  /**
   * Opens the native OS folder picker and resolves with the selected absolute
   * folder path, or null when the user cancels.
   */
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-folder'),
  minimize: (): Promise<boolean> => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
});
