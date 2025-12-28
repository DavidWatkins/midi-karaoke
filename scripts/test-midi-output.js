#!/usr/bin/env node

/**
 * Test MIDI output by playing a simple scale to verify the connection works.
 * This helps isolate whether the issue is with the MIDI connection or the song parsing.
 */

import JZZ from 'jzz'

async function main() {
  console.log('Initializing JZZ...')
  const jzz = await JZZ()

  console.log('\nAvailable MIDI outputs:')
  const info = jzz.info()
  for (const output of info.outputs) {
    console.log(`  - ${output.name}`)
  }

  // Find Yamaha/Disklavier
  const yamahaOutput = info.outputs.find(o =>
    /yamaha|disklavier/i.test(o.name)
  )

  if (!yamahaOutput) {
    console.log('\nNo Yamaha/Disklavier output found!')
    process.exit(1)
  }

  console.log(`\nConnecting to: ${yamahaOutput.name}`)
  const output = jzz.openMidiOut(yamahaOutput.name)

  console.log('Playing C major scale on channel 0...\n')

  // C major scale
  const notes = [60, 62, 64, 65, 67, 69, 71, 72] // C4 to C5

  for (const note of notes) {
    console.log(`  Note ON: ${note}`)
    output.send([0x90, note, 80]) // Note on, channel 0, velocity 80
    await sleep(300)
    output.send([0x80, note, 0]) // Note off
    await sleep(100)
  }

  console.log('\nNow testing channel 2 (like Piano Man)...')

  for (const note of notes) {
    console.log(`  Note ON (ch2): ${note}`)
    output.send([0x92, note, 80]) // Note on, channel 2, velocity 80
    await sleep(300)
    output.send([0x82, note, 0]) // Note off
    await sleep(100)
  }

  console.log('\nNow testing channel 3 (like Piano Man)...')

  for (const note of notes) {
    console.log(`  Note ON (ch3): ${note}`)
    output.send([0x93, note, 80]) // Note on, channel 3, velocity 80
    await sleep(300)
    output.send([0x83, note, 0]) // Note off
    await sleep(100)
  }

  console.log('\nDone! Did you hear the piano playing?')

  // All notes off
  for (let ch = 0; ch < 16; ch++) {
    output.send([0xB0 | ch, 123, 0])
  }

  output.close()
  process.exit(0)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(console.error)
