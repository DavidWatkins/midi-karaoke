import { EventEmitter } from 'events'
import { ParsedSong, NoteEvent, groupLyricsIntoLines } from './parser.js'

export interface PlaybackState {
  playing: boolean
  paused: boolean
  currentTime: number
  duration: number
  songName: string
  artist: string
  singer: string
}

export interface ScheduledNote {
  note: NoteEvent
  noteOnTime: number
  noteOffTime: number
  sent: boolean
  offSent: boolean
}

type MidiOutput = {
  send: (message: number[]) => void
  close: () => void
} | null

export class MidiPlayer extends EventEmitter {
  private song: ParsedSong | null = null
  private midiOutput: MidiOutput = null
  private playing = false
  private paused = false
  private startTime = 0
  private pauseTime = 0
  private scheduledNotes: ScheduledNote[] = []
  private playbackInterval: NodeJS.Timeout | null = null
  private currentSinger = ''
  private lyricsLines: ReturnType<typeof groupLyricsIntoLines> = []
  private pianoChannels: Set<number> = new Set()
  private midiDelayMs = 500  // Delay for computer audio to sync with Disklavier
  private channelPrograms: Map<number, number> = new Map()  // channel -> GM program number

  constructor() {
    super()
  }

  setMidiOutput(output: MidiOutput) {
    this.midiOutput = output
  }

  setMidiDelay(delayMs: number) {
    this.midiDelayMs = Math.max(0, delayMs)
    console.log(`MIDI delay set to ${this.midiDelayMs}ms`)
  }

  getMidiDelay(): number {
    return this.midiDelayMs
  }

  loadSong(song: ParsedSong, singer: string) {
    this.stop()
    this.song = song
    this.currentSinger = singer

    // Set piano channels for MIDI filtering
    this.pianoChannels = new Set(song.pianoChannels || [])
    console.log(`Piano channels for Disklavier: [${Array.from(this.pianoChannels).join(', ')}]`)

    // Build channel-to-program map for audio synthesis
    this.channelPrograms.clear()
    for (const track of song.tracks) {
      if (track.instrumentProgram !== undefined) {
        this.channelPrograms.set(track.channel, track.instrumentProgram)
      }
    }
    console.log('Channel programs:', Object.fromEntries(this.channelPrograms))

    // Debug: show channel distribution
    const channelCounts: Record<number, number> = {}
    let expectedPianoNotes = 0
    for (const track of song.tracks) {
      for (const note of track.notes) {
        const ch = note.channel & 0x0F
        channelCounts[ch] = (channelCounts[ch] || 0) + 1
        if (this.pianoChannels.has(ch)) {
          expectedPianoNotes++
        }
      }
    }
    console.log('Notes per channel:', channelCounts)
    console.log(`Expected piano notes to send to Disklavier: ${expectedPianoNotes}`)

    // Reset MIDI send counter for new song
    this.midiSendCount = 0

    // Pre-process lyrics into lines
    this.lyricsLines = groupLyricsIntoLines(song.lyrics)

    // Schedule all notes
    this.scheduledNotes = []
    for (const track of song.tracks) {
      for (const note of track.notes) {
        this.scheduledNotes.push({
          note,
          noteOnTime: note.time * 1000, // Convert to ms
          noteOffTime: (note.time + note.duration) * 1000,
          sent: false,
          offSent: false
        })
      }
    }

    // Sort by note-on time
    this.scheduledNotes.sort((a, b) => a.noteOnTime - b.noteOnTime)

    this.emit('loaded', this.getState())
  }

  play() {
    if (!this.song) return

    if (this.paused) {
      // Resume from pause
      const pauseDuration = Date.now() - this.pauseTime
      this.startTime += pauseDuration
      this.paused = false
    } else {
      // Start fresh
      this.startTime = Date.now()
      this.resetNotes()
    }

    this.playing = true
    this.startPlaybackLoop()
    this.emit('play', this.getState())
  }

  pause() {
    if (!this.playing || this.paused) return

    this.paused = true
    this.pauseTime = Date.now()
    this.stopPlaybackLoop()

    // Send note-off for any currently playing notes
    this.allNotesOff()

    this.emit('pause', this.getState())
  }

  stop() {
    this.playing = false
    this.paused = false
    this.stopPlaybackLoop()
    this.allNotesOff()
    this.resetNotes()

    this.emit('stop', this.getState())
  }

  seek(timeMs: number) {
    if (!this.song) return

    const wasPlaying = this.playing && !this.paused

    // Stop current playback
    this.stopPlaybackLoop()
    this.allNotesOff()

    // Reset notes that are after the seek position
    for (const scheduled of this.scheduledNotes) {
      if (scheduled.noteOnTime >= timeMs) {
        scheduled.sent = false
        scheduled.offSent = false
      } else if (scheduled.noteOffTime >= timeMs) {
        scheduled.offSent = false
      }
    }

    // Adjust start time
    this.startTime = Date.now() - timeMs

    if (wasPlaying) {
      this.startPlaybackLoop()
    }

    this.emit('seek', this.getState())
  }

  getState(): PlaybackState {
    const currentTime = this.getCurrentTime()

    return {
      playing: this.playing,
      paused: this.paused,
      currentTime,
      duration: this.song ? this.song.duration * 1000 : 0,
      songName: this.song?.name || '',
      artist: '', // Could be extracted from metadata
      singer: this.currentSinger
    }
  }

  getCurrentTime(): number {
    if (!this.playing) return 0
    if (this.paused) return this.pauseTime - this.startTime
    return Date.now() - this.startTime
  }

  getCurrentLyrics() {
    const currentTime = this.getCurrentTime() / 1000 // Convert to seconds

    return {
      lines: this.lyricsLines,
      currentTime,
      currentLineIndex: this.lyricsLines.findIndex(
        line => currentTime >= line.startTime && currentTime < line.endTime
      )
    }
  }

  private startPlaybackLoop() {
    // Run at ~60fps for smooth playback
    this.playbackInterval = setInterval(() => this.tick(), 16)
  }

  private stopPlaybackLoop() {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval)
      this.playbackInterval = null
    }
  }

  private tick() {
    if (!this.song || !this.playing || this.paused) return

    const currentTime = this.getCurrentTime()

    // Check if song is finished
    if (currentTime >= this.song.duration * 1000) {
      this.stop()
      this.emit('ended')
      return
    }

    // Process scheduled notes
    for (const scheduled of this.scheduledNotes) {
      // Send note-on
      if (!scheduled.sent && currentTime >= scheduled.noteOnTime) {
        this.sendNoteOn(
          scheduled.note.channel,
          scheduled.note.midi,
          Math.round(scheduled.note.velocity * 127)
        )
        scheduled.sent = true
      }

      // Send note-off
      if (!scheduled.offSent && scheduled.sent && currentTime >= scheduled.noteOffTime) {
        this.sendNoteOff(scheduled.note.channel, scheduled.note.midi)
        scheduled.offSent = true
      }
    }

    // Emit current lyrics state (delayed to sync with audio)
    const lyricsData = this.getCurrentLyrics()
    if (this.midiDelayMs > 0) {
      setTimeout(() => {
        this.emit('lyrics', lyricsData)
      }, this.midiDelayMs)
    } else {
      this.emit('lyrics', lyricsData)
    }

    // Emit playback update periodically (every ~100ms)
    if (Math.floor(currentTime / 100) !== Math.floor((currentTime - 16) / 100)) {
      this.emit('update', this.getState())
    }
  }

  private resetNotes() {
    for (const scheduled of this.scheduledNotes) {
      scheduled.sent = false
      scheduled.offSent = false
    }
  }

  private shouldSendToDisklavier(channel: number): boolean {
    const ch = channel & 0x0F

    // Never send drums (channel 9) to piano
    if (ch === 9) return false

    // If we have detected piano channels, only send those
    if (this.pianoChannels.size > 0) {
      const shouldSend = this.pianoChannels.has(ch)
      return shouldSend
    }

    // If no piano channels detected, send all non-drum channels
    // (allows songs without explicit piano to still play)
    return true
  }

  private midiSendCount = 0

  private sendNoteOn(channel: number, note: number, velocity: number) {
    // Send to MIDI output (Disklavier) - only piano channels, remapped to channel 0
    const shouldSend = this.shouldSendToDisklavier(channel)

    if (this.midiOutput && shouldSend) {
      // Always use channel 0 for Disklavier - many Disklaviers only listen on channel 0
      const status = 0x90 // Note on, channel 0
      this.midiSendCount++

      // Log first few sends and then periodically
      if (this.midiSendCount <= 5 || this.midiSendCount % 100 === 0) {
        console.log(`[MIDI SEND #${this.midiSendCount}] NoteOn ch=0 (was ${channel & 0x0F}) note=${note} vel=${velocity}`)
      }

      // Send to Disklavier immediately
      this.midiOutput.send([status, note, velocity])
    }

    // Emit for audio synthesis in renderer (delayed to sync with physical piano)
    const program = this.channelPrograms.get(channel & 0x0F) ?? 0
    if (this.midiDelayMs > 0) {
      setTimeout(() => {
        this.emit('noteOn', { channel, note, velocity, program })
      }, this.midiDelayMs)
    } else {
      this.emit('noteOn', { channel, note, velocity, program })
    }
  }

  hasMidiOutput(): boolean {
    return this.midiOutput !== null
  }

  private sendNoteOff(channel: number, note: number) {
    // Send to MIDI output (Disklavier) - only piano channels, remapped to channel 0
    if (this.midiOutput && this.shouldSendToDisklavier(channel)) {
      // Always use channel 0 for Disklavier - send immediately
      const status = 0x80 // Note off, channel 0
      this.midiOutput.send([status, note, 0])
    }

    // Emit for audio synthesis in renderer (delayed to sync with physical piano)
    if (this.midiDelayMs > 0) {
      setTimeout(() => {
        this.emit('noteOff', { channel, note })
      }, this.midiDelayMs)
    } else {
      this.emit('noteOff', { channel, note })
    }
  }

  private allNotesOff() {
    // Send to MIDI output (Disklavier)
    if (this.midiOutput) {
      for (let channel = 0; channel < 16; channel++) {
        const status = 0xB0 | channel
        this.midiOutput.send([status, 123, 0])
      }
    }

    // Emit for audio synthesis in renderer
    this.emit('allNotesOff')
  }
}

// Singleton instance
export const midiPlayer = new MidiPlayer()
