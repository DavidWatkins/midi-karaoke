#!/usr/bin/env node

/**
 * analyze-midi.js - Analyze MIDI/KAR files to show track and channel info
 */

const { Midi } = require('@tonejs/midi');
const fs = require('fs');
const path = require('path');

// General MIDI instrument names
const GM_INSTRUMENTS = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
  'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ',
  'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
  'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass',
  'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
  'Choir Aahs', 'Voice Oohs', 'Synth Choir', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet',
  'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax',
  'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute',
  'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
  'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
  'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto',
  'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock',
  'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet',
  'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'
];

// Piano instrument programs (0-7 are piano family)
const PIANO_PROGRAMS = [0, 1, 2, 3, 4, 5, 6, 7];

function getInstrumentName(program) {
  if (program >= 0 && program < GM_INSTRUMENTS.length) {
    return GM_INSTRUMENTS[program];
  }
  return `Unknown (${program})`;
}

function isPianoProgram(program) {
  return PIANO_PROGRAMS.includes(program);
}

function analyzeMidiFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const midi = new Midi(buffer);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`File: ${path.basename(filePath)}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Name: ${midi.name || '(none)'}`);
  console.log(`Duration: ${midi.duration.toFixed(2)}s`);
  console.log(`Tracks: ${midi.tracks.length}`);
  console.log(`PPQ: ${midi.header.ppq}`);

  if (midi.header.tempos.length > 0) {
    console.log(`Tempo: ${Math.round(midi.header.tempos[0].bpm)} BPM`);
  }

  console.log(`\nTrack Details:`);
  console.log(`${'─'.repeat(70)}`);

  const channelInfo = {};

  midi.tracks.forEach((track, i) => {
    const noteCount = track.notes.length;
    const channel = track.channel;
    const instrument = track.instrument;

    if (noteCount > 0) {
      console.log(`\nTrack ${i}: "${track.name || '(unnamed)'}"`);
      console.log(`  Channel: ${channel} ${channel === 9 ? '(Drums)' : ''}`);
      console.log(`  Notes: ${noteCount}`);

      if (instrument) {
        const program = instrument.number;
        const name = getInstrumentName(program);
        const isPiano = isPianoProgram(program);
        console.log(`  Instrument: ${program} - ${name}${isPiano ? ' [PIANO]' : ''}`);

        // Track channel info
        if (!channelInfo[channel]) {
          channelInfo[channel] = { program, name, noteCount, isPiano };
        }
      } else {
        console.log(`  Instrument: (not specified)`);
        if (!channelInfo[channel]) {
          channelInfo[channel] = { program: 0, name: 'Default (Piano)', noteCount, isPiano: true };
        }
      }

      // Note range
      const notes = track.notes;
      const minNote = Math.min(...notes.map(n => n.midi));
      const maxNote = Math.max(...notes.map(n => n.midi));
      console.log(`  Note Range: ${minNote} - ${maxNote} (MIDI)`);
    }
  });

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Channel Summary:`);
  console.log(`${'─'.repeat(70)}`);

  const pianoChannels = [];
  const otherChannels = [];

  for (const [ch, info] of Object.entries(channelInfo)) {
    const chNum = parseInt(ch);
    const label = chNum === 9 ? 'Drums' : `Ch ${chNum}`;
    console.log(`  ${label}: ${info.name} (${info.noteCount} notes)${info.isPiano ? ' [PIANO]' : ''}`);

    if (info.isPiano && chNum !== 9) {
      pianoChannels.push(chNum);
    } else {
      otherChannels.push(chNum);
    }
  }

  console.log(`\nRecommendation for Disklavier:`);
  if (pianoChannels.length > 0) {
    console.log(`  Send channels: ${pianoChannels.join(', ')} (Piano instruments)`);
    console.log(`  Mute channels: ${otherChannels.join(', ')} (Non-piano)`);
  } else {
    console.log(`  No piano tracks detected. Consider sending all melodic channels.`);
    const melodicChannels = Object.keys(channelInfo).filter(ch => parseInt(ch) !== 9);
    console.log(`  Melodic channels: ${melodicChannels.join(', ')}`);
  }

  return { channelInfo, pianoChannels, otherChannels };
}

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node scripts/analyze-midi.js <file1.kar> [file2.kar] ...');
  console.log('       node scripts/analyze-midi.js --dir <directory> [--limit N]');
  process.exit(1);
}

if (args[0] === '--dir') {
  const dir = args[1] || '.';
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 5;

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.kar') || f.endsWith('.mid'))
    .slice(0, limit);

  console.log(`Analyzing ${files.length} files from ${dir}...\n`);

  for (const file of files) {
    try {
      analyzeMidiFile(path.join(dir, file));
    } catch (err) {
      console.error(`Error analyzing ${file}: ${err.message}`);
    }
  }
} else {
  for (const file of args) {
    try {
      analyzeMidiFile(file);
    } catch (err) {
      console.error(`Error analyzing ${file}: ${err.message}`);
    }
  }
}
