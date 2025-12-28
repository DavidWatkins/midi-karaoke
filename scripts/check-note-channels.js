#!/usr/bin/env node

/**
 * Check if notes have their own channel property vs inheriting from track
 */

import pkg from '@tonejs/midi'
const { Midi } = pkg
import * as fs from 'fs'

const filePath = process.argv[2]
if (!filePath) {
  console.log('Usage: node scripts/check-note-channels.js <file.kar>')
  process.exit(1)
}

const buffer = fs.readFileSync(filePath)
const midi = new Midi(buffer)

console.log(`Analyzing: ${filePath}\n`)

for (let i = 0; i < midi.tracks.length; i++) {
  const track = midi.tracks[i]
  if (track.notes.length === 0) continue

  console.log(`Track ${i}: "${track.name || '(unnamed)'}"`)
  console.log(`  track.channel = ${track.channel}`)
  console.log(`  track.instrument.number = ${track.instrument?.number ?? 'undefined'}`)

  // Check first few notes
  const sampleNotes = track.notes.slice(0, 3)
  for (let j = 0; j < sampleNotes.length; j++) {
    const note = sampleNotes[j]
    console.log(`  Note ${j}: midi=${note.midi}, note.channel=${note.channel}, velocity=${note.velocity.toFixed(2)}`)
  }

  // Check if any notes have different channel than track
  const noteChannels = new Set(track.notes.map(n => n.channel).filter(c => c !== undefined))
  if (noteChannels.size > 0) {
    console.log(`  Unique note channels: [${Array.from(noteChannels).join(', ')}]`)
    if (!noteChannels.has(track.channel) || noteChannels.size > 1) {
      console.log(`  ⚠️  MISMATCH: Track channel ${track.channel} vs note channels [${Array.from(noteChannels).join(', ')}]`)
    }
  } else {
    console.log(`  Notes don't have channel property - using track.channel`)
  }
  console.log()
}
