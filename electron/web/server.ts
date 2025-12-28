import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import { networkInterfaces } from 'os'
import QRCode from 'qrcode'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { catalogDb } from '../catalog/database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env file from project root
config({ path: path.join(__dirname, '../../.env') })

const app = express()
app.use(express.json())

// Store WebSocket clients for broadcasting
const wsClients: WebSocket[] = []

// Get local network IP
function getLocalIP(): string {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // Skip internal and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address
      }
    }
  }
  return 'localhost'
}

// API Routes
app.get('/api/songs', (req, res) => {
  const query = (req.query.q as string) || ''
  try {
    const songs = catalogDb.searchSongs(query)
    res.json(songs)
  } catch (error) {
    res.status(500).json({ error: 'Failed to search songs' })
  }
})

app.get('/api/queue', (_req, res) => {
  try {
    const queue = catalogDb.getQueue()
    res.json(queue)
  } catch (error) {
    res.status(500).json({ error: 'Failed to get queue' })
  }
})

app.get('/api/popular', (_req, res) => {
  try {
    const songs = catalogDb.getPopularSongs(20)
    res.json(songs)
  } catch (error) {
    res.status(500).json({ error: 'Failed to get popular songs' })
  }
})

app.get('/api/discover', (_req, res) => {
  try {
    const songs = catalogDb.getRandomSongs(20)
    res.json(songs)
  } catch (error) {
    res.status(500).json({ error: 'Failed to get random songs' })
  }
})

app.post('/api/queue', (req, res) => {
  const { songId, singerName } = req.body
  if (!songId || !singerName) {
    return res.status(400).json({ error: 'songId and singerName are required' })
  }
  try {
    const queueId = catalogDb.addToQueue(songId, singerName)
    const queue = catalogDb.getQueue()
    // Broadcast queue update to all WebSocket clients
    broadcastQueue(queue)
    res.json({ success: true, queueId })
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to queue' })
  }
})

// Preview endpoint - returns first 15 seconds of MIDI notes
app.get('/api/preview/:songId', (req, res) => {
  const songId = parseInt(req.params.songId)
  if (isNaN(songId)) {
    return res.status(400).json({ error: 'Invalid song ID' })
  }

  try {
    const song = catalogDb.getSong(songId)
    if (!song) {
      return res.status(404).json({ error: 'Song not found' })
    }

    // Import parser dynamically to get preview notes
    import('../midi/parser.js').then(({ parseKarFileComplete }) => {
      try {
        const parsed = parseKarFileComplete(song.file_path)
        // Get first 15 seconds of notes
        const previewDuration = 15000 // 15 seconds in ms
        const previewNotes = parsed.tracks
          .flatMap(track => track.notes)
          .filter(note => note.time * 1000 < previewDuration)
          .map(note => ({
            time: Math.round(note.time * 1000), // Convert to ms
            duration: Math.round(note.duration * 1000),
            midi: note.midi,
            // @tonejs/midi stores velocity as 0-1, convert to 0-127
            velocity: Math.round(note.velocity * 127)
          }))
          // Sort by time ascending, then by midi note descending for chords
          .sort((a, b) => a.time - b.time || b.midi - a.midi)

        res.json({
          notes: previewNotes,
          duration: Math.min(previewDuration, parsed.duration * 1000)
        })
      } catch (parseError) {
        console.error('Preview parse error:', parseError)
        res.status(500).json({ error: 'Failed to parse song' })
      }
    }).catch(err => {
      console.error('Import error:', err)
      res.status(500).json({ error: 'Failed to load parser' })
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get preview' })
  }
})

// Serve mobile web app
app.get('/', (_req, res) => {
  res.send(getMobileAppHTML())
})

// Broadcast queue to all WebSocket clients
export function broadcastQueue(queue: unknown) {
  const message = JSON.stringify({ type: 'queue', data: queue })
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })
}

// Start the server
let server: ReturnType<typeof createServer> | null = null
let wss: WebSocketServer | null = null
let serverPort = 3333
let qrCodeDataUrl: string | null = null
let wifiQrCodeDataUrl: string | null = null

// Generate WiFi QR code from environment variables
async function generateWifiQRCode(): Promise<string | null> {
  const ssid = process.env.WIFI_SSID
  const password = process.env.WIFI_PASSWORD
  const security = process.env.WIFI_SECURITY || 'WPA'

  if (!ssid) {
    console.log('WiFi QR code: WIFI_SSID not set in .env')
    return null
  }

  // WiFi QR code format: WIFI:T:WPA;S:ssid;P:password;;
  const wifiString = `WIFI:T:${security};S:${ssid};P:${password || ''};;`

  try {
    return await QRCode.toDataURL(wifiString, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    })
  } catch (error) {
    console.error('Failed to generate WiFi QR code:', error)
    return null
  }
}

export async function startWebServer(): Promise<{ url: string; qrCode: string }> {
  return new Promise((resolve, reject) => {
    server = createServer(app)

    // Setup WebSocket
    wss = new WebSocketServer({ server })
    wss.on('connection', (ws) => {
      wsClients.push(ws)
      // Send current queue on connect
      try {
        const queue = catalogDb.getQueue()
        ws.send(JSON.stringify({ type: 'queue', data: queue }))
      } catch (e) {
        // Ignore if db not ready
      }
      ws.on('close', () => {
        const index = wsClients.indexOf(ws)
        if (index > -1) wsClients.splice(index, 1)
      })
    })

    server.listen(serverPort, '0.0.0.0', async () => {
      const localIP = getLocalIP()
      const url = `http://${localIP}:${serverPort}`
      console.log(`Guest web app running at ${url}`)

      try {
        qrCodeDataUrl = await QRCode.toDataURL(url, {
          width: 400,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        })
        // Also generate WiFi QR code
        wifiQrCodeDataUrl = await generateWifiQRCode()
        resolve({ url, qrCode: qrCodeDataUrl })
      } catch (error) {
        reject(error)
      }
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        serverPort++
        server?.close()
        startWebServer().then(resolve).catch(reject)
      } else {
        reject(err)
      }
    })
  })
}

export function getQRCode(): string | null {
  return qrCodeDataUrl
}

export function getWifiQRCode(): string | null {
  return wifiQrCodeDataUrl
}

export function getWifiSSID(): string | null {
  return process.env.WIFI_SSID || null
}

export function stopWebServer() {
  wsClients.forEach(client => client.close())
  wsClients.length = 0
  wss?.close()
  server?.close()
}

// Mobile-friendly HTML app
function getMobileAppHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Karaoke Queue</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: white;
      min-height: 100vh;
      padding: 16px;
      padding-bottom: 80px;
    }
    .header {
      text-align: center;
      padding: 20px 0;
    }
    .header h1 {
      font-size: 24px;
      margin-bottom: 8px;
    }
    .header p {
      color: #888;
      font-size: 14px;
    }
    .search-box {
      position: sticky;
      top: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      padding: 12px 0;
      z-index: 10;
    }
    .search-input {
      width: 100%;
      padding: 14px 16px;
      font-size: 16px;
      border: none;
      border-radius: 12px;
      background: #2a2a4e;
      color: white;
      outline: none;
    }
    .search-input::placeholder { color: #666; }
    .section-title {
      font-size: 14px;
      color: #888;
      margin: 20px 0 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title .icon { font-size: 16px; }
    .song-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .song-item {
      background: #2a2a4e;
      padding: 12px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .song-item-info {
      flex: 1;
      min-width: 0;
    }
    .song-title {
      font-size: 15px;
      font-weight: 500;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .song-artist {
      font-size: 12px;
      color: #888;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .preview-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: #3a3a6e;
      color: white;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .preview-btn:active {
      background: #4a4a8e;
    }
    .preview-btn.playing {
      background: #e74c3c;
    }
    .queue-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: #4CAF50;
      color: white;
      font-size: 20px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .queue-btn:active {
      background: #45a049;
    }
    .queue-item {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #2a2a4e;
      padding: 12px 16px;
      border-radius: 12px;
    }
    .queue-item.playing {
      background: #1e3a5f;
      border-left: 3px solid #4CAF50;
    }
    .queue-number {
      font-size: 16px;
      font-weight: bold;
      color: #666;
      min-width: 24px;
      text-align: center;
    }
    .queue-info { flex: 1; min-width: 0; }
    .queue-singer {
      font-size: 12px;
      color: #4dabf7;
    }
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: #2a2a4e;
      border-radius: 16px;
      padding: 24px;
      width: 100%;
      max-width: 320px;
    }
    .modal h2 {
      font-size: 18px;
      margin-bottom: 8px;
    }
    .modal p {
      color: #888;
      font-size: 14px;
      margin-bottom: 20px;
    }
    .modal input {
      width: 100%;
      padding: 14px 16px;
      font-size: 16px;
      border: none;
      border-radius: 12px;
      background: #1a1a2e;
      color: white;
      margin-bottom: 16px;
    }
    .modal-buttons {
      display: flex;
      gap: 12px;
    }
    .modal-buttons button {
      flex: 1;
      padding: 14px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
    }
    .btn-cancel {
      background: #444;
      color: white;
    }
    .btn-confirm {
      background: #4CAF50;
      color: white;
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #666;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #4CAF50;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      transition: transform 0.3s;
      z-index: 200;
    }
    .toast.show { transform: translateX(-50%) translateY(0); }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .tab {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 8px;
      background: #2a2a4e;
      color: #888;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab.active {
      background: #4a4a8e;
      color: white;
    }
    .horizontal-scroll {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      padding: 4px 0 16px;
      -webkit-overflow-scrolling: touch;
    }
    .horizontal-scroll::-webkit-scrollbar { display: none; }
    .song-card {
      flex-shrink: 0;
      width: 140px;
      background: #2a2a4e;
      border-radius: 12px;
      padding: 12px;
      cursor: pointer;
    }
    .song-card:active { opacity: 0.8; }
    .song-card .song-title {
      font-size: 13px;
      margin-bottom: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      white-space: normal;
    }
    .song-card .song-artist {
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎤 Karaoke Queue</h1>
    <p>Search for a song and add it to the queue</p>
  </div>

  <div class="search-box">
    <input type="text" class="search-input" id="searchInput" placeholder="Search songs..." autocomplete="off">
  </div>

  <div id="homeSection">
    <!-- Queue Section -->
    <div id="queueSection">
      <div class="section-title"><span class="icon">📋</span> Queue</div>
      <div class="song-list" id="queueList">
        <div class="empty-state">Queue is empty - add some songs!</div>
      </div>
    </div>

    <!-- Popular Section -->
    <div id="popularSection">
      <div class="section-title"><span class="icon">🔥</span> Most Popular</div>
      <div class="horizontal-scroll" id="popularList"></div>
    </div>

    <!-- Discover Section -->
    <div id="discoverSection">
      <div class="section-title"><span class="icon">✨</span> Discover</div>
      <div class="horizontal-scroll" id="discoverList"></div>
    </div>
  </div>

  <div id="resultsSection" style="display: none;">
    <div class="section-title"><span class="icon">🔍</span> Search Results</div>
    <div class="song-list" id="resultsList"></div>
  </div>

  <div class="modal-overlay" id="modal">
    <div class="modal">
      <h2 id="modalTitle">Add to Queue</h2>
      <p id="modalSong">Song name here</p>
      <input type="text" id="singerInput" placeholder="Your name">
      <div class="modal-buttons">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-confirm" onclick="confirmAdd()">Add to Queue</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">Added to queue!</div>

  <script>
    let selectedSong = null;
    let ws = null;

    // WebSocket connection
    function connectWS() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'queue') {
          renderQueue(msg.data);
        }
      };
      ws.onclose = () => setTimeout(connectWS, 2000);
    }
    connectWS();

    // Search functionality
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const query = searchInput.value.trim();
      if (query.length < 2) {
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('homeSection').style.display = 'block';
        return;
      }
      searchTimeout = setTimeout(() => searchSongs(query), 300);
    });

    async function searchSongs(query) {
      try {
        const res = await fetch('/api/songs?q=' + encodeURIComponent(query));
        const songs = await res.json();
        renderResults(songs);
      } catch (e) {
        console.error('Search failed:', e);
      }
    }

    function renderSongItem(song) {
      return '<div class="song-item">' +
        '<button class="preview-btn" id="preview-' + song.id + '" onclick="togglePreview(' + song.id + ', event)" title="Preview">▶</button>' +
        '<div class="song-item-info">' +
          '<div class="song-title">' + escapeHtml(song.title) + '</div>' +
          '<div class="song-artist">' + escapeHtml(song.artist || 'Unknown Artist') + '</div>' +
        '</div>' +
        '<button class="queue-btn" onclick="selectSong(' + song.id + ', \\'' + escapeHtml(song.title).replace(/'/g, "\\\\'") + '\\')" title="Add to Queue">+</button>' +
      '</div>';
    }

    function renderSongCard(song) {
      return '<div class="song-card" onclick="selectSong(' + song.id + ', \\'' + escapeHtml(song.title).replace(/'/g, "\\\\'") + '\\')">' +
        '<div class="song-title">' + escapeHtml(song.title) + '</div>' +
        '<div class="song-artist">' + escapeHtml(song.artist || 'Unknown') + '</div>' +
      '</div>';
    }

    function renderResults(songs) {
      const list = document.getElementById('resultsList');
      document.getElementById('homeSection').style.display = 'none';
      document.getElementById('resultsSection').style.display = 'block';

      if (songs.length === 0) {
        list.innerHTML = '<div class="empty-state">No songs found</div>';
        return;
      }

      list.innerHTML = songs.slice(0, 50).map(renderSongItem).join('');
    }

    function renderQueue(queue) {
      const list = document.getElementById('queueList');
      const activeItems = queue.filter(q => q.status === 'playing' || q.status === 'pending');

      if (activeItems.length === 0) {
        list.innerHTML = '<div class="empty-state">Queue is empty - add some songs!</div>';
        return;
      }

      list.innerHTML = activeItems.map((item, i) =>
        '<div class="queue-item ' + (item.status === 'playing' ? 'playing' : '') + '">' +
          '<div class="queue-number">' + (item.status === 'playing' ? '▶' : (i + 1)) + '</div>' +
          '<div class="queue-info">' +
            '<div class="song-title">' + escapeHtml(item.title) + '</div>' +
            '<div class="queue-singer">' + escapeHtml(item.singer_name) + '</div>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    function renderPopular(songs) {
      const list = document.getElementById('popularList');
      if (songs.length === 0) {
        list.innerHTML = '<div class="empty-state" style="width:100%">No play history yet</div>';
        return;
      }
      list.innerHTML = songs.map(renderSongCard).join('');
    }

    function renderDiscover(songs) {
      const list = document.getElementById('discoverList');
      if (songs.length === 0) {
        list.innerHTML = '<div class="empty-state" style="width:100%">No songs available</div>';
        return;
      }
      list.innerHTML = songs.map(renderSongCard).join('');
    }

    function selectSong(id, title) {
      selectedSong = { id, title };
      document.getElementById('modalSong').textContent = title;
      // Load cached name from localStorage
      const cachedName = localStorage.getItem('singerName') || '';
      document.getElementById('singerInput').value = cachedName;
      document.getElementById('modal').classList.add('active');
      if (!cachedName) {
        document.getElementById('singerInput').focus();
      }
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('active');
      selectedSong = null;
    }

    async function confirmAdd() {
      const singerName = document.getElementById('singerInput').value.trim();
      if (!singerName || !selectedSong) return;

      // Cache the name for next time
      localStorage.setItem('singerName', singerName);

      try {
        await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songId: selectedSong.id, singerName })
        });
        closeModal();
        searchInput.value = '';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('homeSection').style.display = 'block';
        showToast('Added to queue!');
      } catch (e) {
        console.error('Failed to add:', e);
      }
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    // Load initial data
    fetch('/api/queue').then(r => r.json()).then(renderQueue).catch(() => {});
    fetch('/api/popular').then(r => r.json()).then(renderPopular).catch(() => {});
    fetch('/api/discover').then(r => r.json()).then(renderDiscover).catch(() => {});

    // Audio Preview System
    let audioContext = null;
    let currentPreviewId = null;
    let previewTimeouts = [];

    function getAudioContext() {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      return audioContext;
    }

    function midiToFreq(midi) {
      return 440 * Math.pow(2, (midi - 69) / 12);
    }

    function playNoteAtTime(midi, duration, velocity, startTime) {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Use sine wave for cleaner sound
      osc.type = 'sine';
      osc.frequency.value = midiToFreq(midi);

      const vol = (velocity / 127) * 0.5;
      const noteDuration = Math.min(duration / 1000, 1.5);

      // Simple piano-like envelope: instant attack, exponential decay
      gain.gain.setValueAtTime(vol, startTime);
      gain.gain.setTargetAtTime(0.001, startTime, noteDuration / 3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + noteDuration + 0.5);
    }

    function stopPreview() {
      previewTimeouts.forEach(t => clearTimeout(t));
      previewTimeouts = [];
      // Close and recreate audio context to stop all scheduled notes
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
      if (currentPreviewId) {
        const btn = document.getElementById('preview-' + currentPreviewId);
        if (btn) {
          btn.classList.remove('playing');
          btn.textContent = '▶';
        }
        currentPreviewId = null;
      }
    }

    async function togglePreview(songId, event) {
      event.stopPropagation();

      // If already playing this song, stop it
      if (currentPreviewId === songId) {
        stopPreview();
        return;
      }

      // Stop any current preview
      stopPreview();

      const btn = document.getElementById('preview-' + songId);
      btn.classList.add('playing');
      btn.textContent = '⏹';
      currentPreviewId = songId;

      try {
        const res = await fetch('/api/preview/' + songId);
        if (!res.ok) throw new Error('Failed to load preview');

        const data = await res.json();

        // Schedule notes using AudioContext time for precise timing
        const ctx = getAudioContext();
        const audioStartTime = ctx.currentTime;

        data.notes.forEach(note => {
          const noteStartTime = audioStartTime + (note.time / 1000);
          playNoteAtTime(note.midi, note.duration, note.velocity, noteStartTime);
        });

        // Track that we're playing
        previewTimeouts.push(setTimeout(() => {}, data.duration + 500));

        // Auto-stop after preview duration
        const stopTimeout = setTimeout(() => {
          if (currentPreviewId === songId) {
            stopPreview();
          }
        }, data.duration + 500);
        previewTimeouts.push(stopTimeout);

      } catch (e) {
        console.error('Preview failed:', e);
        stopPreview();
        showToast('Preview unavailable');
      }
    }
  </script>
</body>
</html>`
}
