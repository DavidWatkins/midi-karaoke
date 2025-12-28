import { useState, useEffect } from 'react'

interface Display {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  label: string
}

interface ScanProgress {
  total: number
  processed: number
  current: string
  added: number
  skipped: number
  errors: number
}

export default function Controls() {
  const [catalogPath, setCatalogPath] = useState('/Users/david/Music/Karaoke')
  const [midiOutputs, setMidiOutputs] = useState<Array<{ name: string; id: string }>>([])
  const [selectedMidiOutput, setSelectedMidiOutput] = useState<string>('')
  const [displays, setDisplays] = useState<Display[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [songCount, setSongCount] = useState<number>(0)
  const [midiDelay, setMidiDelay] = useState<number>(0)
  const [cleaning, setCleaning] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<{ removed: number; checked: number } | null>(null)
  const [showWifiQR, setShowWifiQR] = useState<boolean>(() => {
    return localStorage.getItem('showWifiQR') === 'true'
  })
  const [wifiSSID, setWifiSSID] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()

    // Listen for scan progress updates
    if (window.electronAPI) {
      // @ts-expect-error - onScanProgress not in types yet
      window.electronAPI.onScanProgress?.((progress: ScanProgress) => {
        setScanProgress(progress)
      })
    }
  }, [])

  const loadSettings = async () => {
    if (!window.electronAPI) return

    try {
      const outputs = await window.electronAPI.getMidiOutputs()
      setMidiOutputs(outputs)

      const displayList = await window.electronAPI.getDisplays()
      setDisplays(displayList)

      const delay = await window.electronAPI.getMidiDelay()
      setMidiDelay(delay)

      const count = await window.electronAPI.getCatalogCount?.() || 0
      setSongCount(count)

      // Check if WiFi credentials are configured
      const ssid = await window.electronAPI.getWifiSSID?.()
      setWifiSSID(ssid)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  const handleWifiQRToggle = (enabled: boolean) => {
    setShowWifiQR(enabled)
    localStorage.setItem('showWifiQR', enabled ? 'true' : 'false')
    // Dispatch event so lyrics window can pick it up
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'showWifiQR',
      newValue: enabled ? 'true' : 'false'
    }))
  }

  const handleScanCatalog = async () => {
    console.log('=== SCAN BUTTON CLICKED ===')
    console.log('electronAPI available:', !!window.electronAPI)
    console.log('Catalog path:', catalogPath)

    if (!window.electronAPI) {
      console.error('electronAPI not available!')
      alert('Error: Electron API not available')
      return
    }

    setScanning(true)
    setScanProgress(null)
    try {
      console.log('Calling scanCatalog...')
      const result = await window.electronAPI.scanCatalog(catalogPath)
      console.log('Scan result:', result)
      // Refresh song count
      // @ts-expect-error - getCatalogCount not in types yet
      const count = await window.electronAPI.getCatalogCount?.() || 0
      setSongCount(count)
      setScanProgress(null)
    } catch (error) {
      console.error('Failed to scan catalog:', error)
      alert('Failed to scan catalog. Check the path and try again.')
    } finally {
      setScanning(false)
    }
  }

  const handleMidiOutputChange = async (output: string) => {
    if (!window.electronAPI) return

    setSelectedMidiOutput(output)
    try {
      await window.electronAPI.setMidiOutput(output)
    } catch (error) {
      console.error('Failed to set MIDI output:', error)
    }
  }

  const handleMidiDelayChange = async (delayMs: number) => {
    if (!window.electronAPI) return

    setMidiDelay(delayMs)
    try {
      await window.electronAPI.setMidiDelay(delayMs)
    } catch (error) {
      console.error('Failed to set MIDI delay:', error)
    }
  }

  const handleCleanupCatalog = async () => {
    if (!window.electronAPI) return

    setCleaning(true)
    setCleanupResult(null)
    try {
      const result = await window.electronAPI.cleanupCatalog()
      setCleanupResult(result)
      // Refresh song count
      const count = await window.electronAPI.getCatalogCount?.() || 0
      setSongCount(count)
    } catch (error) {
      console.error('Failed to cleanup catalog:', error)
      alert('Failed to cleanup catalog.')
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div className="pb-24 max-w-2xl">
      <h2 className="text-xl font-bold text-white mb-6">Settings</h2>

      {/* Catalog Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Song Catalog</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Catalog Folder Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={catalogPath}
                onChange={(e) => setCatalogPath(e.target.value)}
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                placeholder="/path/to/karaoke/files"
              />
              <button
                onClick={handleScanCatalog}
                disabled={scanning}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {scanning ? 'Scanning...' : 'Scan'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Point this to your folder containing .kar and .mid files
            </p>

            {/* Scan Progress */}
            {scanning && scanProgress && (
              <div className="mt-4 p-4 bg-gray-800 rounded-lg">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Scanning...</span>
                  <span className="text-white">
                    {scanProgress.processed} / {scanProgress.total}
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all"
                    style={{ width: `${(scanProgress.processed / scanProgress.total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2 truncate">
                  {scanProgress.current}
                </p>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="text-green-400">Added: {scanProgress.added}</span>
                  <span className="text-yellow-400">Skipped: {scanProgress.skipped}</span>
                  <span className="text-red-400">Errors: {scanProgress.errors}</span>
                </div>
              </div>
            )}

            {/* Song Count */}
            {songCount > 0 && !scanning && (
              <div className="mt-4 p-3 bg-green-900/30 border border-green-800 rounded-lg flex items-center justify-between">
                <span className="text-green-400">{songCount} songs in catalog</span>
                <button
                  onClick={handleCleanupCatalog}
                  disabled={cleaning}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded text-sm transition-colors"
                >
                  {cleaning ? 'Cleaning...' : 'Remove Missing'}
                </button>
              </div>
            )}

            {/* Cleanup Result */}
            {cleanupResult && (
              <div className="mt-2 p-3 bg-blue-900/30 border border-blue-800 rounded-lg">
                <span className="text-blue-400">
                  Checked {cleanupResult.checked} songs, removed {cleanupResult.removed} missing files
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* MIDI Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Disklavier (MIDI)</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              MIDI Output Device
            </label>
            <select
              value={selectedMidiOutput}
              onChange={(e) => handleMidiOutputChange(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">Select MIDI Output...</option>
              {midiOutputs.map((output: { name: string; id: string }) => (
                <option key={output.id || output.name} value={output.name}>
                  {output.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">
              Connect your Disklavier via Network MIDI in Audio MIDI Setup
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Audio Delay (for synchronization)
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="500"
                step="10"
                value={midiDelay}
                onChange={(e) => handleMidiDelayChange(parseInt(e.target.value))}
                className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-white w-16 text-right">{midiDelay}ms</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Delay computer audio to sync with the Disklavier. Increase if the backing track plays before the piano.
            </p>
          </div>

          <button
            onClick={loadSettings}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm"
          >
            Refresh MIDI Devices
          </button>
        </div>
      </section>

      {/* Display Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Display</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Available Displays
            </label>
            <div className="grid gap-2">
              {displays.map((display) => (
                <div
                  key={display.id}
                  className="p-3 bg-gray-800 rounded-lg flex items-center justify-between"
                >
                  <div>
                    <span className="text-white">{display.label}</span>
                    <span className="text-gray-500 text-sm ml-2">
                      ({display.bounds.width} x {display.bounds.height})
                    </span>
                  </div>
                  {display.bounds.x === 0 && display.bounds.y === 0 && (
                    <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded">
                      Primary
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              The lyrics display will open on an external display if available
            </p>
          </div>
        </div>
      </section>

      {/* Web Interface */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Guest Web Interface</h3>

        <div className="p-4 bg-gray-800 rounded-lg space-y-4">
          <div>
            <p className="text-gray-400 mb-2">
              Guests can scan the QR code on the lyrics display to queue songs.
            </p>
            <p className="text-xs text-gray-500">
              The QR code will be displayed on the lyrics screen automatically.
            </p>
          </div>

          {/* WiFi QR Code Toggle */}
          <div className="border-t border-gray-700 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white">Show WiFi QR Code</p>
                <p className="text-xs text-gray-500">
                  {wifiSSID
                    ? `Display QR code for "${wifiSSID}" network`
                    : 'Configure WIFI_SSID in .env file to enable'}
                </p>
              </div>
              <button
                onClick={() => handleWifiQRToggle(!showWifiQR)}
                disabled={!wifiSSID}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  showWifiQR && wifiSSID
                    ? 'bg-indigo-600'
                    : 'bg-gray-600'
                } ${!wifiSSID ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    showWifiQR && wifiSSID ? 'translate-x-6' : ''
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
