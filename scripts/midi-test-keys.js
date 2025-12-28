#!/usr/bin/env node

const JZZ = require('jzz');

const portName = process.argv[2] || 'YAMAHA USB Device Port1';
const channel = parseInt(process.argv[3]) || 0;
const startNote = parseInt(process.argv[4]) || 36;  // C2
const endNote = parseInt(process.argv[5]) || 96;    // C7
const velocity = parseInt(process.argv[6]) || 80;
const noteDelay = parseInt(process.argv[7]) || 300; // ms between notes

console.log(`MIDI Key Test`);
console.log(`Port: ${portName}`);
console.log(`Channel: ${channel}`);
console.log(`Notes: ${startNote} to ${endNote}`);
console.log(`Velocity: ${velocity}`);
console.log(`Delay: ${noteDelay}ms\n`);

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const note = noteNames[midi % 12];
  return `${note}${octave}`;
}

JZZ().or('Cannot start MIDI').and(function() {
  const output = this.openMidiOut(portName);

  if (!output) {
    console.log('Failed to open MIDI output:', portName);
    console.log('\nAvailable outputs:');
    this.info().outputs.forEach((o, i) => console.log('  ' + i + ': ' + o.name));
    process.exit(1);
  }

  console.log('Connected! Sending notes...\n');

  let currentNote = startNote;

  function playNextNote() {
    if (currentNote > endNote) {
      console.log('\nDone!');
      output.close();
      process.exit(0);
      return;
    }

    const noteOnStatus = 0x90 | (channel & 0x0F);
    const noteOffStatus = 0x80 | (channel & 0x0F);

    console.log(`Playing: ${noteName(currentNote)} (MIDI ${currentNote})`);

    // Note On
    output.send([noteOnStatus, currentNote, velocity]);

    // Note Off after half the delay
    setTimeout(() => {
      output.send([noteOffStatus, currentNote, 0]);
    }, noteDelay / 2);

    currentNote++;

    // Next note
    setTimeout(playNextNote, noteDelay);
  }

  playNextNote();
});
