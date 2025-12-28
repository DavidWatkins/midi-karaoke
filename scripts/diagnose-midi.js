#!/usr/bin/env node

/**
 * Diagnostic script to analyze MIDI/KAR files and understand why some
 * songs play correctly on the Disklavier while others don't.
 *
 * Usage:
 *   node scripts/diagnose-midi.js [file1.kar] [file2.kar] ...
 *   node scripts/diagnose-midi.js --dir /path/to/kar/files
 *   node scripts/diagnose-midi.js --compare working.kar broken.kar
 */

import pkg from '@tonejs/midi'
const { Midi } = pkg
import * as fs from 'fs'
import * as path from 'path'

// GM Piano family programs (0-7)
const PIANO_PROGRAMS = [0, 1, 2, 3, 4, 5, 6, 7]
const GM_INSTRUMENTS = {
  0: 'Acoustic Grand Piano',
  1: 'Bright Acoustic Piano',
  2: 'Electric Grand Piano',
  3: 'Honky-tonk Piano',
  4: 'Electric Piano 1',
  5: 'Electric Piano 2',
  6: 'Harpsichord',
  7: 'Clavinet',
  // Add more as needed
  24: 'Acoustic Guitar (nylon)',
  25: 'Acoustic Guitar (steel)',
  32: 'Acoustic Bass',
  33: 'Electric Bass (finger)',
  40: 'Violin',
  48: 'String Ensemble 1',
  56: 'Trumpet',
  64: 'Soprano Sax',
  73: 'Flute',
  80: 'Synth Lead 1 (square)',
}

function getInstrumentName(program) {
  return GM_INSTRUMENTS[program] || `Program ${program}`
}

function analyzeMidiFile(filePath) {
  const buffer = fs.readFileSync(filePath)
  const midi = new Midi(buffer)

  const analysis = {
    file: path.basename(filePath),
    path: filePath,
    duration: midi.duration,
    bpm: midi.header.tempos.length > 0 ? Math.round(midi.header.tempos[0].bpm) : 120,
    trackCount: midi.tracks.length,
    tracks: [],
    channelSummary: {},
    pianoChannels: [],
    potentialIssues: []
  }

  // Analyze each track
  for (let i = 0; i < midi.tracks.length; i++) {
    const track = midi.tracks[i]
    const instrumentProgram = track.instrument?.number ?? -1
    const isPiano = PIANO_PROGRAMS.includes(instrumentProgram) && track.channel !== 9

    // Count notes per channel within this track
    const noteChannels = {}
    for (const note of track.notes) {
      const ch = note.channel !== undefined ? note.channel : track.channel
      noteChannels[ch] = (noteChannels[ch] || 0) + 1
    }

    const trackInfo = {
      index: i,
      name: track.name || `(unnamed)`,
      channel: track.channel,
      instrumentProgram,
      instrumentName: instrumentProgram >= 0 ? getInstrumentName(instrumentProgram) : '(none)',
      isPiano,
      noteCount: track.notes.length,
      noteChannels, // Channels actually used by notes in this track
      channelMismatch: false
    }

    // Check for channel mismatch (notes on different channel than track)
    const noteChannelKeys = Object.keys(noteChannels).map(Number)
    if (noteChannelKeys.length > 0 && !noteChannelKeys.includes(track.channel)) {
      trackInfo.channelMismatch = true
      analysis.potentialIssues.push(
        `Track ${i} "${track.name}": Track channel is ${track.channel} but notes are on channel(s) ${noteChannelKeys.join(', ')}`
      )
    }

    if (track.notes.length > 0) {
      analysis.tracks.push(trackInfo)

      // Update channel summary
      for (const [ch, count] of Object.entries(noteChannels)) {
        if (!analysis.channelSummary[ch]) {
          analysis.channelSummary[ch] = {
            noteCount: 0,
            instruments: new Set(),
            isPiano: false
          }
        }
        analysis.channelSummary[ch].noteCount += count
        if (instrumentProgram >= 0) {
          analysis.channelSummary[ch].instruments.add(instrumentProgram)
        }
        if (isPiano) {
          analysis.channelSummary[ch].isPiano = true
        }
      }
    }
  }

  // Determine piano channels (channels with piano instruments)
  for (const [ch, info] of Object.entries(analysis.channelSummary)) {
    if (info.isPiano && Number(ch) !== 9) {
      analysis.pianoChannels.push(Number(ch))
    }
  }
  analysis.pianoChannels.sort((a, b) => a - b)

  // Check for potential issues
  if (analysis.pianoChannels.length === 0) {
    analysis.potentialIssues.push('No piano channels detected - all non-drum channels will be sent to Disklavier')
  }

  // Check for tracks with notes but no instrument
  for (const track of analysis.tracks) {
    if (track.instrumentProgram === -1 && track.noteCount > 0) {
      analysis.potentialIssues.push(
        `Track ${track.index} "${track.name}" has ${track.noteCount} notes but no instrument program set`
      )
    }
  }

  // Convert Sets to Arrays for JSON serialization
  for (const ch of Object.keys(analysis.channelSummary)) {
    analysis.channelSummary[ch].instruments = Array.from(analysis.channelSummary[ch].instruments)
  }

  return analysis
}

function printAnalysis(analysis, verbose = true) {
  console.log('\n' + '='.repeat(80))
  console.log(`FILE: ${analysis.file}`)
  console.log('='.repeat(80))
  console.log(`Duration: ${Math.round(analysis.duration)}s | BPM: ${analysis.bpm} | Tracks with notes: ${analysis.tracks.length}`)
  console.log(`Piano channels detected: [${analysis.pianoChannels.join(', ')}]`)

  if (verbose) {
    console.log('\n--- Channel Summary ---')
    for (const [ch, info] of Object.entries(analysis.channelSummary).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const instrumentNames = info.instruments.map(p => getInstrumentName(p)).join(', ')
      const pianoMarker = info.isPiano ? ' [PIANO]' : ''
      const drumMarker = Number(ch) === 9 ? ' [DRUMS]' : ''
      console.log(`  Ch ${ch.padStart(2)}: ${String(info.noteCount).padStart(5)} notes | Instruments: ${instrumentNames || '(none)'}${pianoMarker}${drumMarker}`)
    }

    console.log('\n--- Track Details ---')
    for (const track of analysis.tracks) {
      const pianoMarker = track.isPiano ? ' [PIANO]' : ''
      const mismatchMarker = track.channelMismatch ? ' [CHANNEL MISMATCH!]' : ''
      console.log(`  Track ${track.index}: "${track.name}"`)
      console.log(`    Channel: ${track.channel} | Program: ${track.instrumentProgram} (${track.instrumentName})${pianoMarker}${mismatchMarker}`)
      console.log(`    Notes: ${track.noteCount} | Note channels: ${JSON.stringify(track.noteChannels)}`)
    }
  }

  if (analysis.potentialIssues.length > 0) {
    console.log('\n--- POTENTIAL ISSUES ---')
    for (const issue of analysis.potentialIssues) {
      console.log(`  ! ${issue}`)
    }
  }
}

function compareFiles(file1, file2) {
  const analysis1 = analyzeMidiFile(file1)
  const analysis2 = analyzeMidiFile(file2)

  console.log('\n' + '='.repeat(80))
  console.log('COMPARISON')
  console.log('='.repeat(80))

  console.log(`\nFile 1 (working?): ${analysis1.file}`)
  console.log(`  Piano channels: [${analysis1.pianoChannels.join(', ')}]`)
  console.log(`  Issues: ${analysis1.potentialIssues.length}`)

  console.log(`\nFile 2 (broken?): ${analysis2.file}`)
  console.log(`  Piano channels: [${analysis2.pianoChannels.join(', ')}]`)
  console.log(`  Issues: ${analysis2.potentialIssues.length}`)

  // Look for key differences
  console.log('\n--- Key Differences ---')

  // Compare channel structures
  const channels1 = Object.keys(analysis1.channelSummary).sort()
  const channels2 = Object.keys(analysis2.channelSummary).sort()

  if (JSON.stringify(channels1) !== JSON.stringify(channels2)) {
    console.log(`  Channels used: [${channels1.join(',')}] vs [${channels2.join(',')}]`)
  }

  // Check if notes have channel mismatches
  const mismatches1 = analysis1.tracks.filter(t => t.channelMismatch).length
  const mismatches2 = analysis2.tracks.filter(t => t.channelMismatch).length

  if (mismatches1 !== mismatches2) {
    console.log(`  Channel mismatches: ${mismatches1} vs ${mismatches2}`)
  }

  // Check instrument assignments
  const trackInstruments1 = analysis1.tracks.filter(t => t.instrumentProgram === -1).length
  const trackInstruments2 = analysis2.tracks.filter(t => t.instrumentProgram === -1).length

  if (trackInstruments1 !== trackInstruments2) {
    console.log(`  Tracks without instruments: ${trackInstruments1} vs ${trackInstruments2}`)
  }

  printAnalysis(analysis1)
  printAnalysis(analysis2)
}

function scanDirectory(dirPath, limit = 10) {
  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.kar') || f.endsWith('.mid'))
    .slice(0, limit)
    .map(f => path.join(dirPath, f))

  const results = []

  for (const file of files) {
    try {
      const analysis = analyzeMidiFile(file)
      results.push(analysis)
      printAnalysis(analysis, false)
    } catch (error) {
      console.error(`Error analyzing ${file}: ${error.message}`)
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))

  const withPiano = results.filter(r => r.pianoChannels.length > 0)
  const withoutPiano = results.filter(r => r.pianoChannels.length === 0)
  const withMismatches = results.filter(r => r.tracks.some(t => t.channelMismatch))

  console.log(`\nAnalyzed: ${results.length} files`)
  console.log(`  With piano channels detected: ${withPiano.length}`)
  console.log(`  Without piano channels (will send all): ${withoutPiano.length}`)
  console.log(`  With channel mismatches: ${withMismatches.length}`)

  if (withMismatches.length > 0) {
    console.log('\nFiles with channel mismatches (potential issues):')
    for (const r of withMismatches) {
      console.log(`  - ${r.file}`)
    }
  }
}

// Main
const args = process.argv.slice(2)

if (args.length === 0) {
  console.log('Usage:')
  console.log('  node scripts/diagnose-midi.js <file.kar>')
  console.log('  node scripts/diagnose-midi.js --dir <path> [--limit N]')
  console.log('  node scripts/diagnose-midi.js --compare <working.kar> <broken.kar>')
  process.exit(1)
}

if (args[0] === '--compare' && args.length >= 3) {
  compareFiles(args[1], args[2])
} else if (args[0] === '--dir' && args.length >= 2) {
  const limit = args.indexOf('--limit') >= 0 ? parseInt(args[args.indexOf('--limit') + 1]) : 10
  scanDirectory(args[1], limit)
} else {
  // Analyze individual files
  for (const file of args) {
    if (fs.existsSync(file)) {
      try {
        const analysis = analyzeMidiFile(file)
        printAnalysis(analysis)
      } catch (error) {
        console.error(`Error analyzing ${file}: ${error.message}`)
      }
    } else {
      console.error(`File not found: ${file}`)
    }
  }
}
