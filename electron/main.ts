import { app, BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

// Import our modules
import { catalogDb } from './catalog/database.js'
import { scanCatalogDirectory, validateCatalogPath } from './catalog/scanner.js'
import { parseKarFileComplete, groupLyricsIntoLines } from './midi/parser.js'
import { midiPlayer } from './midi/player.js'
import {
  listMidiOutputs,
  connectMidiOutput,
  getMidiStatus,
  midiOutputManager,
  autoConnectDisklavier
} from './midi/output.js'
import { startWebServer, stopWebServer, broadcastQueue, getQRCode, getWifiQRCode, getWifiSSID } from './web/server.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('=== ELECTRON PATHS ===')
console.log('__dirname:', __dirname)
console.log('preload path:', path.join(__dirname, 'preload.js'))

import * as fs from 'fs'
console.log('preload exists:', fs.existsSync(path.join(__dirname, 'preload.js')))

let mainWindow: BrowserWindow | null = null
let lyricsWindow: BrowserWindow | null = null

const isDev = !app.isPackaged

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    title: 'Disklavier Karaoke'
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // DevTools disabled by default - use View menu or Cmd+Option+I to open
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    if (lyricsWindow) {
      lyricsWindow.close()
    }
  })
}

function createLyricsWindow() {
  const displays = screen.getAllDisplays()
  const externalDisplay = displays.find(display => display.bounds.x !== 0 || display.bounds.y !== 0)
  const targetDisplay = externalDisplay || screen.getPrimaryDisplay()

  lyricsWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    title: 'Lyrics Display',
    frame: false,
    alwaysOnTop: false
  })

  if (isDev) {
    lyricsWindow.loadURL('http://localhost:5173/#/lyrics')
  } else {
    lyricsWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: '/lyrics'
    })
  }

  lyricsWindow.on('closed', () => {
    lyricsWindow = null
  })
}

// Send updates to renderer windows
function sendToAllWindows(channel: string, data: unknown) {
  if (mainWindow) {
    mainWindow.webContents.send(channel, data)
  }
  if (lyricsWindow) {
    lyricsWindow.webContents.send(channel, data)
  }
}

// Setup MIDI player event handlers
function setupMidiPlayerEvents() {
  midiPlayer.on('lyrics', (lyricsData) => {
    sendToAllWindows('lyrics:update', lyricsData)
  })

  midiPlayer.on('update', (state) => {
    sendToAllWindows('playback:update', state)
  })

  // Forward play/pause/stop state changes
  midiPlayer.on('play', (state) => {
    sendToAllWindows('playback:update', state)
  })

  midiPlayer.on('pause', (state) => {
    sendToAllWindows('playback:update', state)
  })

  midiPlayer.on('stop', (state) => {
    sendToAllWindows('playback:update', state)
  })

  // Forward note events to renderer for audio synthesis
  midiPlayer.on('noteOn', (data: { channel: number; note: number; velocity: number; program: number }) => {
    sendToAllWindows('audio:noteOn', data)
  })

  midiPlayer.on('noteOff', (data: { channel: number; note: number }) => {
    sendToAllWindows('audio:noteOff', data)
  })

  midiPlayer.on('allNotesOff', () => {
    sendToAllWindows('audio:allNotesOff', null)
  })

  midiPlayer.on('ended', () => {
    // Mark current song as completed and play next
    const queue = catalogDb.getQueue()
    const playing = queue.find(q => q.status === 'playing')

    if (playing) {
      catalogDb.setQueueItemStatus(playing.id, 'completed')
      catalogDb.addToHistory(playing.song_id, playing.singer_name)
    }

    // Play next song
    playNextInQueue()

    const updatedQueue = catalogDb.getQueue()
    sendToAllWindows('queue:update', updatedQueue)
    broadcastQueue(updatedQueue) // Send to web clients
  })
}

// Play the next song in queue
function playNextInQueue() {
  const next = catalogDb.getNextInQueue()

  if (!next) {
    console.log('Queue is empty')
    sendToAllWindows('playback:update', midiPlayer.getState())
    return
  }

  const song = catalogDb.getSong(next.song_id)
  if (!song) {
    console.error('Song not found:', next.song_id)
    catalogDb.setQueueItemStatus(next.id, 'skipped')
    playNextInQueue()
    return
  }

  try {
    const parsedSong = parseKarFileComplete(song.file_path)

    // Connect MIDI output to player
    const midiStatus = getMidiStatus()
    console.log('MIDI Status:', midiStatus)

    midiPlayer.setMidiOutput({
      send: (message: number[]) => {
        midiOutputManager.send(message)
      },
      close: () => {}
    })

    console.log('MIDI output connected to player:', midiPlayer.hasMidiOutput())

    // Load and play
    catalogDb.setQueueItemStatus(next.id, 'playing')
    midiPlayer.loadSong(parsedSong, next.singer_name)
    midiPlayer.play()

    catalogDb.updateLastPlayed(song.id)

    const queue = catalogDb.getQueue()
    sendToAllWindows('queue:update', queue)
    broadcastQueue(queue) // Send to web clients
    sendToAllWindows('playback:update', midiPlayer.getState())
  } catch (error) {
    console.error('Error playing song:', error)
    catalogDb.setQueueItemStatus(next.id, 'skipped')
    playNextInQueue()
  }
}

// Register IPC handlers
function registerIpcHandlers() {
  // Window management
  ipcMain.handle('open-lyrics-window', () => {
    if (!lyricsWindow) {
      createLyricsWindow()
    }
    return true
  })

  ipcMain.handle('close-lyrics-window', () => {
    if (lyricsWindow) {
      lyricsWindow.close()
    }
    return true
  })

  ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      bounds: d.bounds,
      label: d.label || `Display ${d.id}`
    }))
  })

  // Catalog operations
  ipcMain.handle('catalog:scan', async (_event, catalogPath: string) => {
    console.log('=== SCAN STARTED ===')
    console.log('Catalog path:', catalogPath)

    const validation = validateCatalogPath(catalogPath)
    if (!validation.valid) {
      console.error('Invalid path:', validation.error)
      throw new Error(validation.error)
    }

    console.log('Path validated, starting scan...')

    try {
      const result = await scanCatalogDirectory(catalogPath, (progress) => {
        console.log(`Scan progress: ${progress.processed}/${progress.total}`)
        if (mainWindow) {
          mainWindow.webContents.send('catalog:scanProgress', progress)
        }
      })

      console.log('=== SCAN COMPLETE ===')
      console.log('Result:', result)
      return result
    } catch (error) {
      console.error('Scan error:', error)
      throw error
    }
  })

  ipcMain.handle('catalog:search', (_event, query: string) => {
    return catalogDb.searchSongs(query)
  })

  ipcMain.handle('catalog:get', (_event, id: number) => {
    return catalogDb.getSong(id)
  })

  ipcMain.handle('catalog:count', () => {
    return catalogDb.getSongCount()
  })

  ipcMain.handle('catalog:cleanup', () => {
    console.log('Starting catalog cleanup...')
    const result = catalogDb.cleanupMissingSongs()
    console.log(`Cleanup complete: removed ${result.removed} of ${result.checked} songs`)
    return result
  })

  // Queue operations
  ipcMain.handle('queue:add', (_event, songId: number, singerName: string) => {
    const queueId = catalogDb.addToQueue(songId, singerName)
    const queue = catalogDb.getQueue()
    sendToAllWindows('queue:update', queue)
    broadcastQueue(queue) // Send to web clients

    // If nothing is playing, start playing
    const state = midiPlayer.getState()
    if (!state.playing) {
      playNextInQueue()
    }

    return queueId
  })

  ipcMain.handle('queue:remove', (_event, queueId: number) => {
    catalogDb.removeFromQueue(queueId)
    const queue = catalogDb.getQueue()
    sendToAllWindows('queue:update', queue)
    broadcastQueue(queue) // Send to web clients
  })

  ipcMain.handle('queue:get', () => {
    return catalogDb.getQueue()
  })

  ipcMain.handle('queue:skip', () => {
    midiPlayer.stop()

    const queue = catalogDb.getQueue()
    const playing = queue.find(q => q.status === 'playing')

    if (playing) {
      catalogDb.setQueueItemStatus(playing.id, 'skipped')
    }

    playNextInQueue()
    const updatedQueue = catalogDb.getQueue()
    sendToAllWindows('queue:update', updatedQueue)
    broadcastQueue(updatedQueue) // Send to web clients
  })

  ipcMain.handle('queue:clear', () => {
    midiPlayer.stop()
    catalogDb.clearQueue()
    const queue = catalogDb.getQueue()
    sendToAllWindows('queue:update', queue)
    broadcastQueue(queue) // Send to web clients
  })

  // Playback control
  ipcMain.handle('playback:play', () => {
    const state = midiPlayer.getState()
    if (state.paused) {
      midiPlayer.play()
    } else if (!state.playing) {
      playNextInQueue()
    }
    return midiPlayer.getState()
  })

  ipcMain.handle('playback:pause', () => {
    midiPlayer.pause()
    return midiPlayer.getState()
  })

  ipcMain.handle('playback:stop', () => {
    midiPlayer.stop()
    return midiPlayer.getState()
  })

  ipcMain.handle('playback:state', () => {
    return midiPlayer.getState()
  })

  ipcMain.handle('playback:seek', (_event, timeMs: number) => {
    midiPlayer.seek(timeMs)
    return midiPlayer.getState()
  })

  // MIDI operations
  ipcMain.handle('midi:outputs', async () => {
    return listMidiOutputs()
  })

  ipcMain.handle('midi:setOutput', async (_event, name: string) => {
    return connectMidiOutput(name)
  })

  ipcMain.handle('midi:status', () => {
    return getMidiStatus()
  })

  ipcMain.handle('midi:setDelay', (_event, delayMs: number) => {
    midiPlayer.setMidiDelay(delayMs)
    return midiPlayer.getMidiDelay()
  })

  ipcMain.handle('midi:getDelay', () => {
    return midiPlayer.getMidiDelay()
  })

  // Settings sync across windows
  ipcMain.handle('settings:update', (_event, key: string, value: unknown) => {
    sendToAllWindows('settings:changed', { key, value })
    return true
  })

  // Guest web app
  ipcMain.handle('web:getQRCode', () => {
    return getQRCode()
  })

  ipcMain.handle('web:getWifiQRCode', () => {
    return getWifiQRCode()
  })

  ipcMain.handle('web:getWifiSSID', () => {
    return getWifiSSID()
  })
}

// App lifecycle
app.whenReady().then(async () => {
  // Initialize database
  catalogDb.initialize()

  // Reset any stale queue items from previous session
  catalogDb.resetStaleQueue()

  // Register IPC handlers
  registerIpcHandlers()

  // Setup MIDI player events
  setupMidiPlayerEvents()

  // Auto-connect to Disklavier/Yamaha MIDI
  const connected = await autoConnectDisklavier()
  if (connected) {
    console.log('Auto-connected to Disklavier!')
  }

  // Start guest web server
  try {
    const { url, qrCode } = await startWebServer()
    console.log('Guest web app available at:', url)
  } catch (error) {
    console.error('Failed to start web server:', error)
  }

  // Create main window
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Cleanup
  midiPlayer.stop()
  midiOutputManager.disconnect()
  stopWebServer()
  catalogDb.close()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  midiPlayer.stop()
  midiOutputManager.disconnect()
  stopWebServer()
  catalogDb.close()
})
