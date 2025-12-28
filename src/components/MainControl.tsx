import { useState, useEffect } from 'react'
import Catalog from './Catalog'
import Queue from './Queue'
import Controls from './Controls'
import AudioPlayer from '../audio/AudioPlayer'

interface MidiStatus {
  connected: boolean
  outputName: string | null
}

interface PlaybackState {
  playing: boolean
  paused: boolean
  currentTime: number
  duration: number
  songName: string
  artist: string
  singer: string
}

interface QueueItem {
  id: number
  song_id: number
  singer_name: string
  status: string
  title?: string
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export default function MainControl() {
  const [activeTab, setActiveTab] = useState<'catalog' | 'queue' | 'settings'>('catalog')
  const [midiStatus, setMidiStatus] = useState<MidiStatus>({
    connected: false,
    outputName: null
  })
  const [lyricsWindowOpen, setLyricsWindowOpen] = useState(false)
  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])

  useEffect(() => {
    // Check MIDI status periodically
    const checkMidi = async () => {
      if (window.electronAPI) {
        try {
          const status = await window.electronAPI.getMidiStatus() as MidiStatus
          setMidiStatus(status)
        } catch {
          // MIDI not available yet
        }
      }
    }

    checkMidi()
    const interval = setInterval(checkMidi, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return

    // Get initial state
    window.electronAPI.getPlaybackState().then((state) => {
      setPlaybackState(state as PlaybackState)
    })
    window.electronAPI.getQueue().then((q) => {
      setQueue(q as QueueItem[])
    })

    // Listen for updates
    const unsubPlayback = window.electronAPI.onPlaybackUpdate((state) => {
      setPlaybackState(state as PlaybackState)
    })
    const unsubQueue = window.electronAPI.onQueueUpdate((q) => {
      setQueue(q as QueueItem[])
    })

    return () => {
      unsubPlayback()
      unsubQueue()
    }
  }, [])

  const toggleLyricsWindow = async () => {
    if (window.electronAPI) {
      if (lyricsWindowOpen) {
        await window.electronAPI.closeLyricsWindow()
        setLyricsWindowOpen(false)
      } else {
        await window.electronAPI.openLyricsWindow()
        setLyricsWindowOpen(true)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-indigo-400">
            Disklavier Karaoke
          </h1>

          <div className="flex items-center gap-4">
            {/* Audio Player */}
            <AudioPlayer />

            {/* MIDI Status */}
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  midiStatus.connected ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <span className="text-sm text-gray-400">
                {midiStatus.connected
                  ? `Disklavier: ${midiStatus.outputName}`
                  : 'Disklavier: Not Connected'}
              </span>
            </div>

            {/* Lyrics Window Toggle */}
            <button
              onClick={toggleLyricsWindow}
              className={`px-4 py-2 rounded-lg transition-colors ${
                lyricsWindowOpen
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {lyricsWindowOpen ? 'Close Lyrics Display' : 'Open Lyrics Display'}
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex gap-1 mt-4">
          {(['catalog', 'queue', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-t-lg capitalize transition-colors ${
                activeTab === tab
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      {/* Main Content */}
      <main className="p-6">
        {activeTab === 'catalog' && <Catalog />}
        {activeTab === 'queue' && <Queue />}
        {activeTab === 'settings' && <Controls />}
      </main>

      {/* Playback Controls Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => window.electronAPI?.play()}
              className="w-12 h-12 flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-700 transition-colors"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <button
              onClick={() => window.electronAPI?.pause()}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            </button>
            <button
              onClick={() => window.electronAPI?.stop()}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
            <button
              onClick={() => window.electronAPI?.skipCurrent()}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          </div>

          <div className="flex-1 mx-8">
            <div className="text-center mb-2">
              <p className="text-gray-400 text-sm">
                {playbackState?.playing ? (playbackState.paused ? 'Paused' : 'Now Playing') : 'Now Playing'}
              </p>
              <p className="text-lg font-medium">
                {playbackState?.playing ? playbackState.songName || 'Unknown Song' : 'No song playing'}
              </p>
              {playbackState?.playing && playbackState.singer && (
                <p className="text-sm text-indigo-400">{playbackState.singer}</p>
              )}
            </div>

            {/* Seek slider */}
            {playbackState?.playing && playbackState.duration > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-12 text-right">
                  {formatTime(playbackState.currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={playbackState.duration}
                  value={playbackState.currentTime}
                  onChange={(e) => {
                    window.electronAPI?.seek(Number(e.target.value))
                  }}
                  className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <span className="text-xs text-gray-400 w-12">
                  {formatTime(playbackState.duration)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <p className="text-sm text-gray-400">Queue: {queue.filter(q => q.status === 'pending').length} songs</p>
            <button
              onClick={() => window.electronAPI?.clearQueue()}
              className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 rounded transition-colors"
            >
              Clear Queue
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
