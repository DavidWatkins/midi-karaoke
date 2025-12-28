import { Midi } from '@tonejs/midi'
import * as fs from 'fs'
import * as path from 'path'

export interface LyricEvent {
  text: string
  ticks: number
  time: number // in seconds
}

export interface NoteEvent {
  midi: number
  name: string
  velocity: number
  duration: number // in seconds
  time: number // in seconds
  channel: number
}

export interface TrackInfo {
  name: string
  channel: number
  notes: NoteEvent[]
  instrument?: string
  instrumentProgram: number  // GM program number (0-127)
  isPiano: boolean           // true if program 0-7 (piano family)
}

export interface ParsedSong {
  name: string
  filePath: string
  duration: number // in seconds
  bpm: number
  timeSignature: { numerator: number; denominator: number }
  lyrics: LyricEvent[]
  tracks: TrackInfo[]
  hasLyrics: boolean
  pianoChannels: number[]    // channels with piano instruments
}

/**
 * Parse a KAR or MIDI file and extract lyrics and note data
 */
export function parseKarFile(filePath: string): ParsedSong {
  // Use the complete parser which handles piano detection
  return parseKarFileComplete(filePath)
}

/**
 * Extract lyrics from a MIDI track
 * KAR files typically use text events or lyric meta events
 */
function extractLyricsFromTrack(track: Midi['tracks'][0], midi: Midi): LyricEvent[] {
  const lyrics: LyricEvent[] = []

  // Access the raw MIDI data to get text/lyric events
  // @tonejs/midi may not expose all meta events directly, so we need to check
  // the track's internal data structure

  // The track object from @tonejs/midi has limited meta event access
  // We'll use a workaround by checking if there's a lyrics property
  // or by parsing the raw track data

  // For now, let's try accessing any text that might be in the track name
  // and look for special markers

  // Many KAR files have lyrics embedded - let's check the controlChanges
  // and other events for text data

  // Actually, @tonejs/midi v2.x does support reading text events
  // They should be available in track.meta or similar

  // Let's try a different approach - read the raw buffer and parse text events
  return lyrics
}

/**
 * Parse raw MIDI buffer to extract lyrics (text events)
 * This is needed because @tonejs/midi doesn't expose all meta events
 */
export function extractLyricsFromBuffer(buffer: Buffer): LyricEvent[] {
  const lyrics: LyricEvent[] = []

  // MIDI file structure:
  // Header chunk: "MThd" + length + format + ntrks + division
  // Track chunks: "MTrk" + length + events...

  let pos = 0

  // Skip header chunk
  if (buffer.toString('ascii', 0, 4) !== 'MThd') {
    return lyrics
  }

  const headerLength = buffer.readUInt32BE(4)
  const division = buffer.readUInt16BE(12) // ticks per quarter note
  pos = 8 + headerLength

  // Process each track
  while (pos < buffer.length) {
    if (buffer.toString('ascii', pos, pos + 4) !== 'MTrk') {
      break
    }

    const trackLength = buffer.readUInt32BE(pos + 4)
    const trackEnd = pos + 8 + trackLength
    pos += 8

    let ticks = 0
    let runningStatus = 0

    while (pos < trackEnd) {
      // Read delta time (variable length)
      let deltaTime = 0
      let byte: number
      do {
        byte = buffer[pos++]
        deltaTime = (deltaTime << 7) | (byte & 0x7F)
      } while (byte & 0x80)

      ticks += deltaTime

      // Read event
      let eventType = buffer[pos]

      if (eventType === 0xFF) {
        // Meta event
        pos++
        const metaType = buffer[pos++]

        // Read length (variable length)
        let length = 0
        do {
          byte = buffer[pos++]
          length = (length << 7) | (byte & 0x7F)
        } while (byte & 0x80)

        if (metaType === 0x01 || metaType === 0x05) {
          // 0x01 = Text event, 0x05 = Lyric event
          // Use latin1 encoding to preserve all bytes including spaces
          const text = buffer.toString('latin1', pos, pos + length)

          // Convert ticks to time (approximate, assuming 120 BPM for now)
          // Actual BPM should be read from tempo events
          const time = (ticks / division) * 0.5 // 0.5 seconds per beat at 120 BPM

          // Don't trim - preserve leading spaces as word separators
          if (text.length > 0 && text.trim()) {
            lyrics.push({ text, ticks, time })
          }
        }

        pos += length
      } else if (eventType === 0xF0 || eventType === 0xF7) {
        // SysEx event
        pos++
        let length = 0
        do {
          byte = buffer[pos++]
          length = (length << 7) | (byte & 0x7F)
        } while (byte & 0x80)
        pos += length
      } else {
        // Channel event
        if (eventType & 0x80) {
          runningStatus = eventType
          pos++
        } else {
          eventType = runningStatus
        }

        const command = eventType & 0xF0

        // Skip the appropriate number of data bytes
        if (command === 0xC0 || command === 0xD0) {
          pos++ // 1 data byte
        } else {
          pos += 2 // 2 data bytes
        }
      }
    }
  }

  return lyrics
}

/**
 * Parse a KAR file and extract both structured data and raw lyrics
 */
export function parseKarFileComplete(filePath: string): ParsedSong {
  const buffer = fs.readFileSync(filePath)

  // First, use @tonejs/midi for structured data
  const midi = new Midi(buffer)

  // Then extract lyrics from raw buffer (more reliable for KAR files)
  const rawLyrics = extractLyricsFromBuffer(buffer)

  // Get tempo for proper timing calculation
  const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120
  const ppq = midi.header.ppq // pulses (ticks) per quarter note

  // Recalculate lyrics timing with actual tempo
  const secondsPerBeat = 60 / bpm
  const secondsPerTick = secondsPerBeat / ppq

  const lyrics = rawLyrics.map(lyric => ({
    ...lyric,
    time: lyric.ticks * secondsPerTick
  }))

  // Piano program numbers (0-7 are piano family in GM)
  const PIANO_PROGRAMS = [0, 1, 2, 3, 4, 5, 6, 7]

  // Extract tracks
  const tracks: ParsedSong['tracks'] = []
  const pianoChannelsSet = new Set<number>()

  for (const track of midi.tracks) {
    if (track.notes.length > 0) {
      const instrumentProgram = track.instrument?.number ?? 0
      const isPiano = PIANO_PROGRAMS.includes(instrumentProgram) && track.channel !== 9

      if (isPiano) {
        pianoChannelsSet.add(track.channel)
      }

      tracks.push({
        name: track.name || `Track ${tracks.length + 1}`,
        channel: track.channel,
        notes: track.notes.map(note => ({
          midi: note.midi,
          name: note.name,
          velocity: note.velocity,
          duration: note.duration,
          time: note.time,
          channel: track.channel
        })),
        instrument: track.instrument?.name,
        instrumentProgram,
        isPiano
      })
    }
  }

  const pianoChannels = Array.from(pianoChannelsSet).sort((a, b) => a - b)
  console.log(`Parsed ${filePath}: ${tracks.length} tracks, piano channels: [${pianoChannels.join(', ')}]`)

  // Get time signature
  const timeSig = midi.header.timeSignatures.length > 0
    ? midi.header.timeSignatures[0]
    : { timeSignature: [4, 4] }

  return {
    name: path.basename(filePath, path.extname(filePath)),
    filePath,
    duration: midi.duration,
    bpm,
    timeSignature: {
      numerator: timeSig.timeSignature[0],
      denominator: timeSig.timeSignature[1]
    },
    lyrics,
    tracks,
    hasLyrics: lyrics.length > 0,
    pianoChannels
  }
}

/**
 * Group lyrics into lines for display
 * KAR files often have syllable-by-syllable lyrics
 */
export function groupLyricsIntoLines(lyrics: LyricEvent[]): {
  text: string
  startTime: number
  endTime: number
  syllables: LyricEvent[]
}[] {
  const lines: {
    text: string
    startTime: number
    endTime: number
    syllables: LyricEvent[]
  }[] = []

  let currentLine: LyricEvent[] = []
  let lineText = ''

  for (const lyric of lyrics) {
    const text = lyric.text

    // Skip metadata lines (KAR file headers)
    if (text.startsWith('@')) {
      continue
    }

    // Common line break patterns in KAR files:
    // - Newline characters (\n, \r)
    // - Forward slash at start (/)
    // - Backslash at start (\)
    const isLineBreak = text.startsWith('/') ||
                        text.startsWith('\\') ||
                        text.includes('\n') ||
                        text.includes('\r')

    if (isLineBreak && currentLine.length > 0) {
      // Save current line
      lines.push({
        text: lineText.trim(),
        startTime: currentLine[0].time,
        endTime: lyric.time,
        syllables: [...currentLine]
      })
      currentLine = []
      lineText = ''
    }

    // Clean up the text - preserve leading spaces for word boundaries
    let cleanText = text
      .replace(/^[/\\]/, '') // Remove leading slash/backslash
      .replace(/[\r\n]/g, '') // Remove newlines

    if (cleanText) {
      currentLine.push({ ...lyric, text: cleanText })
      // Preserve the text as-is (including leading spaces for word breaks)
      lineText += cleanText
    }
  }

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push({
      text: lineText.trim(),
      startTime: currentLine[0].time,
      endTime: currentLine[currentLine.length - 1].time + 2, // Add 2 seconds buffer
      syllables: currentLine
    })
  }

  return lines
}

/**
 * Get song metadata from a KAR/MIDI file (quick scan)
 */
export function getSongMetadata(filePath: string): {
  title: string
  duration: number
  hasLyrics: boolean
  trackCount: number
} {
  try {
    const buffer = fs.readFileSync(filePath)
    const midi = new Midi(buffer)
    const lyrics = extractLyricsFromBuffer(buffer)

    // Try to extract title from filename or track names
    let title = path.basename(filePath, path.extname(filePath))

    // Some KAR files have the title in the first track name
    if (midi.tracks.length > 0 && midi.tracks[0].name) {
      const trackName = midi.tracks[0].name.trim()
      if (trackName && !trackName.toLowerCase().includes('track')) {
        title = trackName
      }
    }

    return {
      title,
      duration: midi.duration * 1000, // Convert to milliseconds
      hasLyrics: lyrics.length > 0,
      trackCount: midi.tracks.filter(t => t.notes.length > 0).length
    }
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error)
    return {
      title: path.basename(filePath, path.extname(filePath)),
      duration: 0,
      hasLyrics: false,
      trackCount: 0
    }
  }
}
