export interface ElectronAPI {
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  printReceipt: (html: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
}
