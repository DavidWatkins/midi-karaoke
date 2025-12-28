// Global type declarations for Electron API exposed via preload script

interface ElectronAPI {
  // Window management
  openLyricsWindow: () => Promise<boolean>
  closeLyricsWindow: () => Promise<boolean>
  getDisplays: () => Promise<Array<{ id: number; bounds: { x: number; y: number; width: number; height: number }; label: string }>>

  // Catalog operations
  scanCatalog: (path: string) => Promise<unknown>
  searchSongs: (query: string) => Promise<unknown[]>
  getSong: (id: number) => Promise<unknown>
  getCatalogCount: () => Promise<number>
  cleanupCatalog: () => Promise<{ removed: number; checked: number }>
  onScanProgress: (callback: (progress: unknown) => void) => () => void

  // Queue operations
  addToQueue: (songId: number, singerName: string) => Promise<void>
  removeFromQueue: (queueId: number) => Promise<void>
  getQueue: () => Promise<unknown[]>
  skipCurrent: () => Promise<void>
  clearQueue: () => Promise<void>

  // Playback control
  play: () => Promise<void>
  pause: () => Promise<void>
  stop: () => Promise<void>
  getPlaybackState: () => Promise<unknown>
  seek: (timeMs: number) => Promise<unknown>

  // MIDI operations
  getMidiOutputs: () => Promise<Array<{ name: string; id: string }>>
  setMidiOutput: (name: string) => Promise<void>
  getMidiStatus: () => Promise<unknown>
  setMidiDelay: (delayMs: number) => Promise<number>
  getMidiDelay: () => Promise<number>

  // Events
  onLyricsUpdate: (callback: (lyrics: unknown) => void) => () => void
  onPlaybackUpdate: (callback: (state: unknown) => void) => () => void
  onQueueUpdate: (callback: (queue: unknown) => void) => () => void
  onNoteOn: (callback: (data: { channel: number; note: number; velocity: number; program: number }) => void) => () => void
  onNoteOff: (callback: (data: { channel: number; note: number }) => void) => () => void
  onAllNotesOff: (callback: () => void) => () => void

  // Guest web app
  getQRCode: () => Promise<string | null>
  getWifiQRCode: () => Promise<string | null>
  getWifiSSID: () => Promise<string | null>

  // Settings sync across windows
  updateSetting: (key: string, value: unknown) => Promise<boolean>
  onSettingsChanged: (callback: (data: { key: string; value: unknown }) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
