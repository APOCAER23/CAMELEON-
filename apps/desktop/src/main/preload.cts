import { contextBridge, ipcRenderer } from 'electron';

// The renderer only ever sees these functions. The engine token never crosses this bridge.
contextBridge.exposeInMainWorld('cameleon', {
  platform: process.platform,
  engine: {
    request: (method: string, path: string, body?: unknown) => ipcRenderer.invoke('engine:request', { method, path, body }),
    ensure: () => ipcRenderer.invoke('engine:ensure'),
    restart: () => ipcRenderer.invoke('engine:restart'),
    logs: (lines: number) => ipcRenderer.invoke('engine:logs', lines),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  },
  system: { info: () => ipcRenderer.invoke('system:info') },
  terminal: {
    open: (req: unknown) => ipcRenderer.invoke('terminal:open', req),
    startSession: (req: unknown) => ipcRenderer.invoke('terminal:session:start', req),
    writeSession: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:session:write', { sessionId, data }),
    killSession: (sessionId: string) => ipcRenderer.invoke('terminal:session:kill', { sessionId }),
    resizeSession: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:session:resize', { sessionId, cols, rows }),
    onSessionData: (cb: (ev: { sessionId: string; text: string }) => void) => {
      const handler = (_e: unknown, payload: { sessionId: string; text: string }) => cb(payload);
      ipcRenderer.on('terminal:session:data', handler);
      return () => { ipcRenderer.removeListener('terminal:session:data', handler); };
    },
    onSessionExit: (cb: (ev: { sessionId: string; code: number | null; signal: string | null }) => void) => {
      const handler = (_e: unknown, payload: { sessionId: string; code: number | null; signal: string | null }) => cb(payload);
      ipcRenderer.on('terminal:session:exit', handler);
      return () => { ipcRenderer.removeListener('terminal:session:exit', handler); };
    },
  },
  dialog: { chooseFolder: () => ipcRenderer.invoke('dialog:folder') },
});
