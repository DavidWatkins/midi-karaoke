import { useState, useEffect } from 'react'

interface Song {
  id: number
  title: string
  artist: string
  duration_ms: number
  has_lyrics: boolean
}

export default function Catalog() {
  const [songs, setSongs] = useState<Song[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [singerName, setSingerName] = useState('')
  const [totalCount, setTotalCount] = useState(0)

  useEffect(() => {
    // Load initial catalog
    loadCatalog()
  }, [])

  const loadCatalog = async () => {
    if (!window.electronAPI) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      // Get count first
      // @ts-expect-error - getCatalogCount type
      const count = await window.electronAPI.getCatalogCount?.() || 0
      setTotalCount(count)

      // Then search
      const results = await window.electronAPI.searchSongs('') as Song[]
      setSongs(results)
    } catch (error) {
      console.error('Failed to load catalog:', error)
    } finally {
      setLoading(false)
    }
  }

  const searchSongs = async (query: string) => {
    if (!window.electronAPI) return

    setLoading(true)
    try {
      const results = await window.electronAPI.searchSongs(query) as Song[]
      setSongs(results)
    } catch (error) {
      console.error('Failed to search songs:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    searchSongs(searchQuery)
  }

  const addToQueue = async (song: Song) => {
    if (!window.electronAPI) return

    const name = singerName.trim() || 'Anonymous'
    try {
      await window.electronAPI.addToQueue(song.id, name)
      // Show feedback
      alert(`Added "${song.title}" to queue for ${name}`)
    } catch (error) {
      console.error('Failed to add to queue:', error)
    }
  }

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="pb-24">
      {/* Header with count and refresh */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-gray-300">
          {totalCount > 0 ? `${totalCount} songs in catalog` : 'Song Catalog'}
        </h2>
        <button
          onClick={loadCatalog}
          className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Search and Singer Name */}
      <div className="mb-6 flex gap-4">
        <form onSubmit={handleSearch} className="flex-1">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search songs by title or artist..."
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded text-sm transition-colors"
            >
              Search
            </button>
          </div>
        </form>

        <div className="w-64">
          <input
            type="text"
            value={singerName}
            onChange={(e) => setSingerName(e.target.value)}
            placeholder="Your name..."
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Song List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="text-gray-400 mt-4">Loading songs...</p>
        </div>
      ) : songs.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">&#127925;</div>
          <p className="text-gray-400 text-lg mb-2">
            {totalCount === 0
              ? "No songs in catalog yet"
              : "No songs match your search"}
          </p>
          {totalCount === 0 && (
            <p className="text-gray-500 text-sm">
              Go to <span className="text-indigo-400">Settings</span> tab and click <span className="text-indigo-400">Scan</span> to import your karaoke files.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          {songs.map((song) => (
            <div
              key={song.id}
              className="flex items-center justify-between p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors"
            >
              <div className="flex-1">
                <h3 className="font-medium text-white">{song.title}</h3>
                <p className="text-sm text-gray-400">{song.artist}</p>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">
                  {formatDuration(song.duration_ms)}
                </span>

                {song.has_lyrics && (
                  <span className="px-2 py-0.5 bg-green-900 text-green-300 text-xs rounded">
                    Lyrics
                  </span>
                )}

                <button
                  onClick={() => addToQueue(song)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded transition-colors text-sm"
                >
                  Add to Queue
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
