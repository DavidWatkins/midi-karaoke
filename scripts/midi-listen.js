#!/usr/bin/env node

const JZZ = require('jzz');

const portName = process.argv[2] || 'YAMAHA USB Device Port1';
const timeoutSecs = parseInt(process.argv[3]) || 30;

console.log(`Listening for MIDI on "${portName}" for ${timeoutSecs} seconds...`);
console.log('Press keys on the piano to see MIDI data.\n');

JZZ().or('Cannot start MIDI').and(function() {
  const input = this.openMidiIn(portName);

  if (!input) {
    console.log('Failed to open MIDI input:', portName);
    console.log('\nAvailable inputs:');
    this.info().inputs.forEach((o, i) => console.log('  ' + i + ': ' + o.name));
    process.exit(1);
  }

  let received = false;

  input.connect(function(msg) {
    received = true;
    const bytes = Array.from(msg).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
    console.log('RECEIVED:', msg.toString(), '| Raw:', bytes);
  });

  setTimeout(() => {
    input.close();
    if (!received) {
      console.log('\nNo MIDI received from', portName);
    } else {
      console.log('\nDone listening.');
    }
    process.exit(0);
  }, timeoutSecs * 1000);
});
