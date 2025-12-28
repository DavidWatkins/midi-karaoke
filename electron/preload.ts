const { contextBridge, ipcRenderer } = require('electron')

console.log('=== PRELOAD SCRIPT LOADING ===')

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // Window management
    openLyricsWindow: () => ipcRenderer.invoke('open-lyrics-window'),
    closeLyricsWindow: () => ipcRenderer.invoke('close-lyrics-window'),
    getDisplays: () => ipcRenderer.invoke('get-displays'),

    // Catalog operations
    scanCatalog: (path: string) => ipcRenderer.invoke('catalog:scan', path),
    searchSongs: (query: string) => ipcRenderer.invoke('catalog:search', query),
    getSong: (id: number) => ipcRenderer.invoke('catalog:get', id),
    getCatalogCount: () => ipcRenderer.invoke('catalog:count'),
    cleanupCatalog: () => ipcRenderer.invoke('catalog:cleanup'),
    onScanProgress: (callback: (progress: unknown) => void) => {
      ipcRenderer.on('catalog:scanProgress', (_event: unknown, progress: unknown) => callback(progress))
      return () => ipcRenderer.removeAllListeners('catalog:scanProgress')
    },

    // Queue operations
    addToQueue: (songId: number, singerName: string) =>
      ipcRenderer.invoke('queue:add', songId, singerName),
    removeFromQueue: (queueId: number) =>
      ipcRenderer.invoke('queue:remove', queueId),
    getQueue: () => ipcRenderer.invoke('queue:get'),
    skipCurrent: () => ipcRenderer.invoke('queue:skip'),

    // Playback control
    play: () => ipcRenderer.invoke('playback:play'),
    pause: () => ipcRenderer.invoke('playback:pause'),
    stop: () => ipcRenderer.invoke('playback:stop'),
    getPlaybackState: () => ipcRenderer.invoke('playback:state'),

    // MIDI operations
    getMidiOutputs: () => ipcRenderer.invoke('midi:outputs'),
    setMidiOutput: (name: string) => ipcRenderer.invoke('midi:setOutput', name),
    getMidiStatus: () => ipcRenderer.invoke('midi:status'),
    setMidiDelay: (delayMs: number) => ipcRenderer.invoke('midi:setDelay', delayMs),
    getMidiDelay: () => ipcRenderer.invoke('midi:getDelay'),

    // Events - lyrics window receives these
    onLyricsUpdate: (callback: (lyrics: unknown) => void) => {
      ipcRenderer.on('lyrics:update', (_event: unknown, lyrics: unknown) => callback(lyrics))
      return () => ipcRenderer.removeAllListeners('lyrics:update')
    },
    onPlaybackUpdate: (callback: (state: unknown) => void) => {
      ipcRenderer.on('playback:update', (_event: unknown, state: unknown) => callback(state))
      return () => ipcRenderer.removeAllListeners('playback:update')
    },
    onQueueUpdate: (callback: (queue: unknown) => void) => {
      ipcRenderer.on('queue:update', (_event: unknown, queue: unknown) => callback(queue))
      return () => ipcRenderer.removeAllListeners('queue:update')
    },

    // Audio synthesis events - for Tone.js playback in renderer
    onNoteOn: (callback: (data: { channel: number; note: number; velocity: number; program: number }) => void) => {
      ipcRenderer.on('audio:noteOn', (_event: unknown, data: { channel: number; note: number; velocity: number; program: number }) => callback(data))
      return () => ipcRenderer.removeAllListeners('audio:noteOn')
    },
    onNoteOff: (callback: (data: { channel: number; note: number }) => void) => {
      ipcRenderer.on('audio:noteOff', (_event: unknown, data: { channel: number; note: number }) => callback(data))
      return () => ipcRenderer.removeAllListeners('audio:noteOff')
    },
    onAllNotesOff: (callback: () => void) => {
      ipcRenderer.on('audio:allNotesOff', () => callback())
      return () => ipcRenderer.removeAllListeners('audio:allNotesOff')
    },

    // Guest web app
    getQRCode: () => ipcRenderer.invoke('web:getQRCode'),
    getWifiQRCode: () => ipcRenderer.invoke('web:getWifiQRCode'),
    getWifiSSID: () => ipcRenderer.invoke('web:getWifiSSID'),

    // Queue management
    clearQueue: () => ipcRenderer.invoke('queue:clear')
  })
  console.log('=== PRELOAD SCRIPT LOADED SUCCESSFULLY ===')
} catch (error) {
  console.error('=== PRELOAD SCRIPT ERROR ===', error)
}

// Type declaration for the exposed API
declare global {
  interface Window {
    electronAPI: {
      openLyricsWindow: () => Promise<boolean>
      closeLyricsWindow: () => Promise<boolean>
      getDisplays: () => Promise<Array<{ id: number; bounds: { x: number; y: number; width: number; height: number }; label: string }>>
      scanCatalog: (path: string) => Promise<unknown>
      searchSongs: (query: string) => Promise<unknown[]>
      getSong: (id: number) => Promise<unknown>
      getCatalogCount: () => Promise<number>
      cleanupCatalog: () => Promise<{ removed: number; checked: number }>
      onScanProgress: (callback: (progress: unknown) => void) => () => void
      addToQueue: (songId: number, singerName: string) => Promise<void>
      removeFromQueue: (queueId: number) => Promise<void>
      getQueue: () => Promise<unknown[]>
      skipCurrent: () => Promise<void>
      play: () => Promise<void>
      pause: () => Promise<void>
      stop: () => Promise<void>
      getPlaybackState: () => Promise<unknown>
      getMidiOutputs: () => Promise<string[]>
      setMidiOutput: (name: string) => Promise<void>
      getMidiStatus: () => Promise<unknown>
      setMidiDelay: (delayMs: number) => Promise<number>
      getMidiDelay: () => Promise<number>
      onLyricsUpdate: (callback: (lyrics: unknown) => void) => () => void
      onPlaybackUpdate: (callback: (state: unknown) => void) => () => void
      onQueueUpdate: (callback: (queue: unknown) => void) => () => void
      onNoteOn: (callback: (data: { channel: number; note: number; velocity: number; program: number }) => void) => () => void
      onNoteOff: (callback: (data: { channel: number; note: number }) => void) => () => void
      onAllNotesOff: (callback: () => void) => () => void
      getQRCode: () => Promise<string | null>
      getWifiQRCode: () => Promise<string | null>
      getWifiSSID: () => Promise<string | null>
      clearQueue: () => Promise<void>
    }
  }
}
