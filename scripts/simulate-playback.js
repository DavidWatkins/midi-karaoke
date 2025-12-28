#!/usr/bin/env node

/**
 * Simulate exactly what the player does - load a song and check which notes
 * would be sent to the Disklavier vs filtered out.
 */

import pkg from '@tonejs/midi'
const { Midi } = pkg
import * as fs from 'fs'
import * as path from 'path'

const PIANO_PROGRAMS = [0, 1, 2, 3, 4, 5, 6, 7]

const filePath = process.argv[2]
if (!filePath) {
  console.log('Usage: node scripts/simulate-playback.js <file.kar>')
  process.exit(1)
}

console.log(`Simulating playback of: ${path.basename(filePath)}\n`)

const buffer = fs.readFileSync(filePath)
const midi = new Midi(buffer)

// Step 1: Parse tracks (like parser.ts does)
const tracks = []
const pianoChannelsSet = new Set()

for (const track of midi.tracks) {
  if (track.notes.length > 0) {
    const instrumentProgram = track.instrument?.number ?? 0
    const isPiano = PIANO_PROGRAMS.includes(instrumentProgram) && track.channel !== 9

    if (isPiano) {
      pianoChannelsSet.add(track.channel)
    }

    tracks.push({
      name: track.name || `Track`,
      channel: track.channel,
      instrumentProgram,
      isPiano,
      notes: track.notes.map(note => ({
        midi: note.midi,
        velocity: note.velocity,
        time: note.time,
        duration: note.duration,
        channel: track.channel  // This is what parser.ts does
      }))
    })
  }
}

const pianoChannels = new Set(Array.from(pianoChannelsSet))
console.log(`Piano channels detected: [${Array.from(pianoChannels).join(', ')}]`)

// Step 2: Simulate scheduling all notes (like player.ts does)
const scheduledNotes = []
for (const track of tracks) {
  for (const note of track.notes) {
    scheduledNotes.push({
      note,
      noteOnTime: note.time * 1000,
      noteOffTime: (note.time + note.duration) * 1000,
    })
  }
}
scheduledNotes.sort((a, b) => a.noteOnTime - b.noteOnTime)

console.log(`Total scheduled notes: ${scheduledNotes.length}`)

// Step 3: Simulate shouldSendToDisklavier (like player.ts does)
function shouldSendToDisklavier(channel) {
  const ch = channel & 0x0F

  // Never send drums (channel 9) to piano
  if (ch === 9) return false

  // If we have detected piano channels, only send those
  if (pianoChannels.size > 0) {
    return pianoChannels.has(ch)
  }

  // If no piano channels detected, send all non-drum channels
  return true
}

// Step 4: Count what would be sent
let sentCount = 0
let filteredCount = 0
const sentByChannel = {}
const filteredByChannel = {}

for (const scheduled of scheduledNotes) {
  const ch = scheduled.note.channel & 0x0F
  const wouldSend = shouldSendToDisklavier(scheduled.note.channel)

  if (wouldSend) {
    sentCount++
    sentByChannel[ch] = (sentByChannel[ch] || 0) + 1
  } else {
    filteredCount++
    filteredByChannel[ch] = (filteredByChannel[ch] || 0) + 1
  }
}

console.log(`\nNotes that WOULD be sent to Disklavier: ${sentCount}`)
for (const [ch, count] of Object.entries(sentByChannel).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  Channel ${ch}: ${count} notes`)
}

console.log(`\nNotes FILTERED OUT: ${filteredCount}`)
for (const [ch, count] of Object.entries(filteredByChannel).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  Channel ${ch}: ${count} notes`)
}

// Step 5: Show first few notes that would be sent
console.log(`\n--- First 10 notes that would be sent ---`)
let shown = 0
for (const scheduled of scheduledNotes) {
  if (shouldSendToDisklavier(scheduled.note.channel)) {
    console.log(`  t=${(scheduled.noteOnTime/1000).toFixed(2)}s ch=${scheduled.note.channel} note=${scheduled.note.midi} vel=${Math.round(scheduled.note.velocity * 127)}`)
    shown++
    if (shown >= 10) break
  }
}

// Step 6: Check for potential issues
console.log(`\n--- Potential Issues ---`)

if (pianoChannels.size === 0) {
  console.log(`⚠️  No piano channels detected - ALL non-drum channels will be sent`)
}

if (sentCount === 0) {
  console.log(`❌ NO NOTES would be sent to Disklavier!`)
}

if (sentCount > 0 && sentCount < 50) {
  console.log(`⚠️  Very few notes (${sentCount}) would be sent - might not sound right`)
}

// Check if any piano tracks have very low velocity
let lowVelocityCount = 0
for (const scheduled of scheduledNotes) {
  if (shouldSendToDisklavier(scheduled.note.channel)) {
    if (scheduled.note.velocity < 0.1) {
      lowVelocityCount++
    }
  }
}
if (lowVelocityCount > 0) {
  console.log(`⚠️  ${lowVelocityCount} notes have very low velocity (<13) and might be inaudible`)
}
