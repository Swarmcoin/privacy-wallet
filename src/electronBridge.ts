import type { SwmPriceIpcResult, SwmPriceListing } from "./price/swmPriceTypes";

export const native = window.electronAPI.native;
export const clipboard = window.electronAPI.clipboard;
export const shell = window.electronAPI.shell;
export const ipcRenderer = window.electronAPI.ipcRenderer;
export const fs = window.electronAPI.fs;
export const isSandboxed = window.electronAPI.isSandboxed;

/**
 * The SWM price (specs/PRICE-DISPLAY.md), typed. Both channels are answered
 * by the main process (`public/swmPrice.js` behind `price:swm` and
 * `price:open-listing` in `public/electron.js`); the renderer passes no URL.
 */
export const price = {
  swm: (): Promise<SwmPriceIpcResult> => window.electronAPI.ipcRenderer.invoke("price:swm"),
  openListing: (which: SwmPriceListing): Promise<{ ok: boolean; reason?: string }> =>
    window.electronAPI.ipcRenderer.invoke("price:open-listing", which),
};
