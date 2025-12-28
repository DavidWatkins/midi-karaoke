import { useEffect, useState, useCallback } from 'react'
import { audioSynthesizer } from './synthesizer'

export default function AudioPlayer() {
  const [isInitialized, setIsInitialized] = useState(false)
  const [isMuted, setIsMuted] = useState(false)

  // Initialize audio on first user interaction
  const initializeAudio = useCallback(async () => {
    if (isInitialized) return

    try {
      await audioSynthesizer.initialize()
      setIsInitialized(true)
      console.log('Audio synthesizer initialized')
    } catch (error) {
      console.error('Failed to initialize audio:', error)
    }
  }, [isInitialized])

  useEffect(() => {
    // Add click handler to initialize audio (required by browser autoplay policies)
    const handleClick = () => {
      if (!isInitialized) {
        initializeAudio()
      }
    }
    document.addEventListener('click', handleClick)

    return () => {
      document.removeEventListener('click', handleClick)
    }
  }, [isInitialized, initializeAudio])

  useEffect(() => {
    if (!window.electronAPI) return

    // Subscribe to note events from main process
    const unsubNoteOn = window.electronAPI.onNoteOn((data) => {
      if (isInitialized) {
        audioSynthesizer.noteOn(data.channel, data.note, data.velocity, data.program)
      }
    })

    const unsubNoteOff = window.electronAPI.onNoteOff((data) => {
      if (isInitialized) {
        audioSynthesizer.noteOff(data.channel, data.note)
      }
    })

    const unsubAllNotesOff = window.electronAPI.onAllNotesOff(() => {
      if (isInitialized) {
        audioSynthesizer.allNotesOff()
      }
    })

    return () => {
      unsubNoteOn()
      unsubNoteOff()
      unsubAllNotesOff()
    }
  }, [isInitialized])

  const toggleMute = () => {
    const newMuted = audioSynthesizer.toggleMute()
    setIsMuted(newMuted)
  }

  return (
    <div className="flex items-center gap-2">
      {!isInitialized && (
        <button
          onClick={initializeAudio}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm flex items-center gap-2"
        >
          <span className="text-lg">🔊</span>
          Enable Audio
        </button>
      )}

      {isInitialized && (
        <button
          onClick={toggleMute}
          className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 ${
            isMuted
              ? 'bg-gray-600 hover:bg-gray-500'
              : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          <span className="text-lg">{isMuted ? '🔇' : '🔊'}</span>
          {isMuted ? 'Unmute' : 'Audio On'}
        </button>
      )}
    </div>
  )
}
