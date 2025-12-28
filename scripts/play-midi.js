#!/usr/bin/env node

/**
 * play-midi.js - Play arbitrary MIDI files to a MIDI output device
 *
 * Usage:
 *   node scripts/play-midi.js <midi-file> [options]
 *
 * Options:
 *   --list, -l          List available MIDI outputs and exit
 *   --port, -p <name>   Specify MIDI output port (default: auto-detect Disklavier)
 *   --help, -h          Show this help message
 *
 * Examples:
 *   node scripts/play-midi.js song.mid
 *   node scripts/play-midi.js song.kar --port "YAMAHA USB Device Port1"
 *   node scripts/play-midi.js --list
 */

const JZZ = require('jzz');
const { Midi } = require('@tonejs/midi');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
let midiFile = null;
let portName = null;
let listOnly = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--list' || arg === '-l') {
    listOnly = true;
  } else if (arg === '--port' || arg === '-p') {
    portName = args[++i];
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
play-midi.js - Play arbitrary MIDI files to a MIDI output device

Usage:
  node scripts/play-midi.js <midi-file> [options]

Options:
  --list, -l          List available MIDI outputs and exit
  --port, -p <name>   Specify MIDI output port (default: auto-detect Disklavier)
  --help, -h          Show this help message

Examples:
  node scripts/play-midi.js song.mid
  node scripts/play-midi.js song.kar --port "YAMAHA USB Device Port1"
  node scripts/play-midi.js --list
`);
    process.exit(0);
  } else if (!arg.startsWith('-')) {
    midiFile = arg;
  }
}

// Auto-detect Disklavier patterns
const disklavierPatterns = [
  /disklavier/i,
  /yamaha.*usb/i,
  /yamaha.*network/i,
  /network.*session/i,
  /dkv/i
];

function findDisklavier(outputs) {
  for (const pattern of disklavierPatterns) {
    const match = outputs.find(o => pattern.test(o.name));
    if (match) return match.name;
  }
  return null;
}

// Parse MIDI file and extract note events with absolute timing
function parseMidiFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const midi = new Midi(buffer);

  const events = [];

  for (const track of midi.tracks) {
    for (const note of track.notes) {
      // Note On event
      events.push({
        time: note.time,
        type: 'noteOn',
        channel: track.channel,
        note: note.midi,
        velocity: Math.round(note.velocity * 127)
      });

      // Note Off event
      events.push({
        time: note.time + note.duration,
        type: 'noteOff',
        channel: track.channel,
        note: note.midi,
        velocity: 0
      });
    }

    // Also handle control changes if present
    if (track.controlChanges) {
      for (const [ccNum, changes] of Object.entries(track.controlChanges)) {
        for (const cc of changes) {
          events.push({
            time: cc.time,
            type: 'cc',
            channel: track.channel,
            controller: parseInt(ccNum),
            value: Math.round(cc.value * 127)
          });
        }
      }
    }

    // Handle pitch bends
    if (track.pitchBends && track.pitchBends.length > 0) {
      for (const pb of track.pitchBends) {
        events.push({
          time: pb.time,
          type: 'pitchBend',
          channel: track.channel,
          value: pb.value
        });
      }
    }
  }

  // Sort by time
  events.sort((a, b) => a.time - b.time);

  return {
    events,
    duration: midi.duration,
    name: midi.name || path.basename(filePath),
    tracks: midi.tracks.length,
    bpm: midi.header.tempos.length > 0 ? Math.round(midi.header.tempos[0].bpm) : 120
  };
}

// Send MIDI message
function sendEvent(output, event) {
  const channel = event.channel & 0x0F;

  switch (event.type) {
    case 'noteOn':
      output.send([0x90 | channel, event.note, event.velocity]);
      break;
    case 'noteOff':
      output.send([0x80 | channel, event.note, 0]);
      break;
    case 'cc':
      output.send([0xB0 | channel, event.controller, event.value]);
      break;
    case 'pitchBend':
      // Convert -1 to 1 range to 14-bit value (0-16383, center at 8192)
      const pbValue = Math.round((event.value + 1) * 8191.5);
      const lsb = pbValue & 0x7F;
      const msb = (pbValue >> 7) & 0x7F;
      output.send([0xE0 | channel, lsb, msb]);
      break;
  }
}

// All notes off on all channels
function allNotesOff(output) {
  for (let ch = 0; ch < 16; ch++) {
    // All Notes Off (CC 123)
    output.send([0xB0 | ch, 123, 0]);
    // Reset All Controllers (CC 121)
    output.send([0xB0 | ch, 121, 0]);
  }
}

// Format time as MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Main playback function
async function main() {
  await JZZ().or('Cannot start MIDI engine');

  const info = JZZ().info();
  const outputs = info.outputs;

  // List mode
  if (listOnly) {
    console.log('Available MIDI outputs:\n');
    if (outputs.length === 0) {
      console.log('  (none found)');
    } else {
      outputs.forEach((o, i) => {
        const isDisklavier = disklavierPatterns.some(p => p.test(o.name));
        console.log(`  ${i}: ${o.name}${isDisklavier ? ' [Disklavier]' : ''}`);
      });
    }
    process.exit(0);
  }

  // Validate MIDI file argument
  if (!midiFile) {
    console.error('Error: No MIDI file specified');
    console.error('Usage: node scripts/play-midi.js <midi-file> [--port <name>]');
    console.error('       node scripts/play-midi.js --list');
    process.exit(1);
  }

  // Resolve file path
  const filePath = path.resolve(midiFile);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  // Determine output port
  let selectedPort = portName;
  if (!selectedPort) {
    selectedPort = findDisklavier(outputs);
    if (selectedPort) {
      console.log(`Auto-detected Disklavier: ${selectedPort}`);
    } else if (outputs.length > 0) {
      selectedPort = outputs[0].name;
      console.log(`Using first available output: ${selectedPort}`);
    } else {
      console.error('Error: No MIDI outputs available');
      process.exit(1);
    }
  }

  // Open MIDI output
  const output = JZZ().openMidiOut(selectedPort);
  if (!output) {
    console.error(`Error: Failed to open MIDI output: ${selectedPort}`);
    console.error('\nAvailable outputs:');
    outputs.forEach((o, i) => console.log(`  ${i}: ${o.name}`));
    process.exit(1);
  }

  // Parse MIDI file
  console.log(`\nParsing: ${path.basename(filePath)}`);
  const midiData = parseMidiFile(filePath);
  console.log(`  Name: ${midiData.name}`);
  console.log(`  Tracks: ${midiData.tracks}`);
  console.log(`  Duration: ${formatTime(midiData.duration)}`);
  console.log(`  BPM: ${midiData.bpm}`);
  console.log(`  Events: ${midiData.events.length}`);
  console.log(`\nPlaying to: ${selectedPort}`);
  console.log('Press Ctrl+C to stop\n');

  // Handle graceful shutdown
  let stopped = false;
  process.on('SIGINT', () => {
    if (stopped) return;
    stopped = true;
    console.log('\n\nStopping playback...');
    allNotesOff(output);
    output.close();
    console.log('Done.');
    process.exit(0);
  });

  // Playback loop
  const startTime = Date.now();
  let eventIndex = 0;
  let lastProgressTime = -1;

  const tick = () => {
    if (stopped) return;

    const elapsed = (Date.now() - startTime) / 1000;

    // Send due events
    while (eventIndex < midiData.events.length && midiData.events[eventIndex].time <= elapsed) {
      sendEvent(output, midiData.events[eventIndex]);
      eventIndex++;
    }

    // Progress display (once per second)
    const progressSec = Math.floor(elapsed);
    if (progressSec !== lastProgressTime && progressSec >= 0) {
      lastProgressTime = progressSec;
      const progress = Math.min(100, Math.round((elapsed / midiData.duration) * 100));
      process.stdout.write(`\r  ${formatTime(elapsed)} / ${formatTime(midiData.duration)} [${progress}%] `);
    }

    // Check if done
    if (eventIndex >= midiData.events.length && elapsed >= midiData.duration) {
      console.log('\n\nPlayback complete.');
      allNotesOff(output);
      output.close();
      process.exit(0);
    }

    // Continue at ~100 Hz for accurate timing
    setTimeout(tick, 10);
  };

  tick();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
