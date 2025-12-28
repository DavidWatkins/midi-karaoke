import { useState, useEffect } from 'react'

interface QueueItem {
  id: number
  song_id: number
  title: string
  artist: string
  singer_name: string
  status: 'pending' | 'playing' | 'completed' | 'skipped'
  queued_at: string
}

export default function Queue() {
  const [queue, setQueue] = useState<QueueItem[]>([])

  useEffect(() => {
    loadQueue()

    // Subscribe to queue updates
    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.onQueueUpdate((newQueue) => {
        setQueue(newQueue as QueueItem[])
      })
      return unsubscribe
    }
  }, [])

  const loadQueue = async () => {
    if (!window.electronAPI) return
    try {
      const q = await window.electronAPI.getQueue() as QueueItem[]
      setQueue(q)
    } catch (error) {
      console.error('Failed to load queue:', error)
    }
  }

  const removeFromQueue = async (queueId: number) => {
    if (!window.electronAPI) return
    try {
      await window.electronAPI.removeFromQueue(queueId)
      loadQueue()
    } catch (error) {
      console.error('Failed to remove from queue:', error)
    }
  }

  const currentSong = queue.find((item) => item.status === 'playing')
  const pendingSongs = queue.filter((item) => item.status === 'pending')

  return (
    <div className="pb-24">
      {/* Currently Playing */}
      {currentSong && (
        <div className="mb-8">
          <h2 className="text-lg font-medium text-gray-400 mb-4">Now Playing</h2>
          <div className="p-6 bg-gradient-to-r from-indigo-900 to-purple-900 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-white">{currentSong.title}</h3>
                <p className="text-indigo-200">{currentSong.artist}</p>
                <p className="text-indigo-300 mt-2">
                  Singer: <span className="font-medium">{currentSong.singer_name}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-green-400">Playing</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Up Next */}
      <div>
        <h2 className="text-lg font-medium text-gray-400 mb-4">
          Up Next ({pendingSongs.length} songs)
        </h2>

        {pendingSongs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>Queue is empty</p>
            <p className="text-sm mt-2">Add songs from the Catalog tab</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingSongs.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-4 p-4 bg-gray-800 rounded-lg"
              >
                <span className="w-8 h-8 flex items-center justify-center bg-gray-700 rounded-full text-gray-400 font-medium">
                  {index + 1}
                </span>

                <div className="flex-1">
                  <h3 className="font-medium text-white">{item.title}</h3>
                  <p className="text-sm text-gray-400">{item.artist}</p>
                </div>

                <div className="text-right">
                  <p className="text-sm text-indigo-400">{item.singer_name}</p>
                </div>

                <button
                  onClick={() => removeFromQueue(item.id)}
                  className="p-2 text-gray-500 hover:text-red-400 transition-colors"
                  title="Remove from queue"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
