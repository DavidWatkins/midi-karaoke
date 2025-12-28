import { useState, useEffect, useRef } from 'react'

interface LyricLine {
  text: string
  startTime: number
  endTime: number
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
  singer_name: string
  title: string
}

export default function LyricsDisplay() {
  const [lyrics, setLyrics] = useState<LyricLine[]>([])
  const [currentLineIndex, setCurrentLineIndex] = useState(-1)
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    playing: false,
    paused: false,
    currentTime: 0,
    duration: 0,
    songName: '',
    artist: '',
    singer: ''
  })
  const [nextUp, setNextUp] = useState<QueueItem | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [wifiQrCode, setWifiQrCode] = useState<string | null>(null)
  const [showWifiQR, setShowWifiQR] = useState<boolean>(() => {
    return localStorage.getItem('showWifiQR') === 'true'
  })
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch QR codes on mount
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.getQRCode().then(setQrCode)
    window.electronAPI.getWifiQRCode().then(setWifiQrCode)
  }, [])

  // Listen for WiFi QR toggle changes from settings
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'showWifiQR') {
        setShowWifiQR(e.newValue === 'true')
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!window.electronAPI) return

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          if (playbackState.playing && !playbackState.paused) {
            await window.electronAPI.pause()
          } else {
            await window.electronAPI.play()
          }
          break
        case 'KeyN': // N for Next
        case 'ArrowRight':
          e.preventDefault()
          await window.electronAPI.skipCurrent()
          break
        case 'Escape':
          e.preventDefault()
          await window.electronAPI.stop()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [playbackState.playing, playbackState.paused])

  useEffect(() => {
    if (!window.electronAPI) return

    // Subscribe to lyrics updates
    const unsubLyrics = window.electronAPI.onLyricsUpdate((data) => {
      const { lines, currentLineIndex } = data as {
        lines: LyricLine[]
        currentTime: number
        currentLineIndex: number
      }
      setLyrics(lines)
      setCurrentLineIndex(currentLineIndex)
    })

    // Subscribe to playback updates
    const unsubPlayback = window.electronAPI.onPlaybackUpdate((state) => {
      setPlaybackState(state as PlaybackState)
    })

    // Subscribe to queue updates for "up next"
    const unsubQueue = window.electronAPI.onQueueUpdate((queue) => {
      const q = queue as QueueItem[]
      const pending = q.filter((item) => item.singer_name)
      setNextUp(pending[0] || null)
    })

    return () => {
      unsubLyrics()
      unsubPlayback()
      unsubQueue()
    }
  }, [])

  // Scroll to keep current line centered
  useEffect(() => {
    if (containerRef.current && currentLineIndex >= 0) {
      const lineElements = containerRef.current.querySelectorAll('.lyrics-line')
      if (lineElements[currentLineIndex]) {
        lineElements[currentLineIndex].scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      }
    }
  }, [currentLineIndex])

  const getLineClass = (index: number) => {
    if (index < currentLineIndex) return 'lyrics-line sung'
    if (index === currentLineIndex) return 'lyrics-line current'
    return 'lyrics-line upcoming'
  }

  return (
    <div className="lyrics-container bg-karaoke-bg text-white overflow-hidden h-screen relative">
      {/* Header with song info */}
      <div className="absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-black/80 to-transparent z-10">
        <div className="flex items-center justify-between">
          <div>
            {playbackState.songName ? (
              <>
                <h1 className="text-3xl font-bold">{playbackState.songName}</h1>
                {playbackState.artist && (
                  <p className="text-xl text-gray-300">{playbackState.artist}</p>
                )}
                <p className="text-lg text-indigo-400 mt-1">
                  Singing: {playbackState.singer}
                </p>
              </>
            ) : (
              <h1 className="text-3xl font-bold text-gray-500">
                Waiting for song...
              </h1>
            )}
          </div>

          {/* QR Codes */}
          <div className="flex gap-4">
            {/* WiFi QR Code */}
            {showWifiQR && wifiQrCode && (
              <div className="bg-white p-3 rounded-lg">
                <img src={wifiQrCode} alt="WiFi QR Code" className="w-48 h-48" />
                <p className="text-sm text-gray-800 text-center mt-2">Scan for WiFi</p>
              </div>
            )}
            {/* Song Queue QR Code */}
            {qrCode && (
              <div className="bg-white p-3 rounded-lg">
                <img src={qrCode} alt="QR Code" className="w-48 h-48" />
                <p className="text-sm text-gray-800 text-center mt-2">Scan to add songs</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lyrics area */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col items-center justify-center py-32 px-8"
      >
        {lyrics.length > 0 ? (
          // Show only 5 lines: 2 previous, current, 2 next
          lyrics
            .map((line, index) => ({ line, index }))
            .filter(({ index }) => {
              const current = currentLineIndex >= 0 ? currentLineIndex : 0
              return index >= current - 2 && index <= current + 2
            })
            .map(({ line, index }) => (
              <p key={index} className={getLineClass(index)}>
                {line.text}
              </p>
            ))
        ) : (
          <div className="text-center">
            <div className="text-6xl mb-8">&#127926;</div>
            <p className="text-2xl text-gray-500">No lyrics available</p>
          </div>
        )}
      </div>

      {/* Footer with next up */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-between">
          <div>
            {nextUp && (
              <div className="text-lg">
                <span className="text-gray-400">Up Next: </span>
                <span className="text-white font-medium">{nextUp.title}</span>
                <span className="text-indigo-400"> - {nextUp.singer_name}</span>
              </div>
            )}
          </div>

          {/* Playback status and keyboard hints */}
          <div className="flex items-center gap-6">
            <div className="text-xs text-gray-500">
              <span className="text-gray-400">Space</span> Play/Pause
              <span className="mx-2">|</span>
              <span className="text-gray-400">N</span> Skip
              <span className="mx-2">|</span>
              <span className="text-gray-400">Esc</span> Stop
            </div>
            {playbackState.playing && !playbackState.paused && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-green-400 text-sm">Playing</span>
              </div>
            )}
            {playbackState.paused && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <span className="text-yellow-400 text-sm">Paused</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
