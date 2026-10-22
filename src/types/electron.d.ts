import type { ElectronAPI } from '../../electron/preload-types';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
