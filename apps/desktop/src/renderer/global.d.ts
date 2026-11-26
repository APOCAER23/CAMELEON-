type SupportedLanguage = 'en' | 'fr' | 'es' | 'de' | 'it' | 'pt' | 'nl' | 'ru' | 'zh' | 'ja' | 'ko' | 'ar';
interface CameleonSettings { keepEngineRunning: boolean; launchAtLogin: boolean; defaultAgent: string | null; language: SupportedLanguage }
interface Window {
  cameleon: {
    platform: string;
    engine: {
      request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
      ensure(): Promise<{ running: boolean; port?: number; version?: string; error?: string }>;
      restart(): Promise<{ running: boolean; port?: number; version?: string; error?: string }>;
      logs(lines: number): Promise<string[]>;
    };
    settings: {
      get(): Promise<CameleonSettings | null>;
      set(patch: Partial<CameleonSettings>): Promise<CameleonSettings | null>;
    };
    system: { info(): Promise<{ platform: string; dataDir: string; cli: { installed: boolean; path: string | null }; cliBin: string; nodeBin: string; version: string } | null> };
    terminal: {
      open(req:
        | { kind: 'launch'; agentId: string; providerId: string; modelId: string; label?: string; cwd?: string }
        | { kind: 'profile'; name: string; cwd?: string }
        | { kind: 'shell'; cwd?: string }): Promise<{ ok: boolean; manual?: string; error?: string }>;
      startSession(req:
        | { kind: 'launch'; agentId: string; providerId: string; modelId: string; label?: string; cwd?: string }
        | { kind: 'profile'; name: string; cwd?: string }
        | { kind: 'shell'; cwd?: string }): Promise<{ ok: boolean; sessionId?: string; title?: string; cwd?: string; manual?: string; error?: string }>;
      writeSession(sessionId: string, data: string): Promise<boolean>;
      killSession(sessionId: string): Promise<boolean>;
      resizeSession(sessionId: string, cols: number, rows: number): Promise<boolean>;
      onSessionData(cb: (ev: { sessionId: string; text: string }) => void): () => void;
      onSessionExit(cb: (ev: { sessionId: string; code: number | null; signal: string | null }) => void): () => void;
    };
    dialog: { chooseFolder(): Promise<string | null> };
  };
}
