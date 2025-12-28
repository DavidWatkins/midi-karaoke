import JZZ from 'jzz'

export interface MidiOutputDevice {
  name: string
  id: string
}

export interface MidiOutputManager {
  getOutputs(): Promise<MidiOutputDevice[]>
  connect(name: string): Promise<boolean>
  disconnect(): void
  send(message: number[]): void
  isConnected(): boolean
  getConnectedName(): string | null
}

class MidiOutputManagerImpl implements MidiOutputManager {
  private output: ReturnType<typeof JZZ.MIDI.out> | null = null
  private connectedName: string | null = null
  private jzz: ReturnType<typeof JZZ> | null = null
  private isSwitching = false  // Lock to prevent sends during output switch

  async initialize(): Promise<void> {
    if (this.jzz) return

    try {
      this.jzz = await JZZ()
      console.log('JZZ MIDI initialized')
    } catch (error) {
      console.error('Failed to initialize JZZ MIDI:', error)
      throw error
    }
  }

  async getOutputs(): Promise<MidiOutputDevice[]> {
    await this.initialize()

    if (!this.jzz) return []

    const info = this.jzz.info()
    const outputs: MidiOutputDevice[] = []

    for (const output of info.outputs) {
      outputs.push({
        name: output.name,
        id: output.id || output.name
      })
    }

    return outputs
  }

  async connect(name: string): Promise<boolean> {
    await this.initialize()

    if (!this.jzz) {
      console.error('JZZ not initialized!')
      return false
    }

    try {
      // Set switching lock to prevent sends during transition
      this.isSwitching = true

      // Disconnect any existing output
      this.disconnect()

      // Small delay to let any in-flight sends complete
      await new Promise(resolve => setTimeout(resolve, 50))

      console.log(`Attempting to open MIDI output: ${name}`)

      // Try to open the output by name
      this.output = this.jzz.openMidiOut(name)
      this.connectedName = name

      // Clear switching lock
      this.isSwitching = false

      console.log(`Connected to MIDI output: ${name}`)
      console.log(`Output object:`, this.output ? 'exists' : 'null')
      return true
    } catch (error) {
      this.isSwitching = false
      console.error(`Failed to connect to MIDI output ${name}:`, error)
      return false
    }
  }

  disconnect(): void {
    if (this.output) {
      try {
        // Send all notes off before disconnecting
        for (let channel = 0; channel < 16; channel++) {
          this.output.send([0xB0 | channel, 123, 0]) // All Notes Off
          this.output.send([0xB0 | channel, 121, 0]) // Reset All Controllers
        }
        this.output.close()
      } catch (error) {
        console.error('Error closing MIDI output:', error)
      }
      this.output = null
      this.connectedName = null
    }
  }

  private sendCount = 0
  private noOutputWarningLogged = false

  send(message: number[]): void {
    // Skip sends during output switching to prevent crashes
    if (this.isSwitching) {
      return
    }

    if (this.output) {
      try {
        this.sendCount++
        // Log first few and then periodically
        if (this.sendCount <= 3 || this.sendCount % 200 === 0) {
          console.log(`[MidiOutput SEND #${this.sendCount}] to ${this.connectedName}: [${message.join(', ')}]`)
        }
        this.output.send(message)
        this.noOutputWarningLogged = false
      } catch (error) {
        console.error('Error sending MIDI message:', error)
      }
    } else {
      // Only log warning once until reconnected
      if (!this.noOutputWarningLogged) {
        console.warn('MIDI send called but no output connected (further warnings suppressed)')
        this.noOutputWarningLogged = true
      }
    }
  }

  isConnected(): boolean {
    return this.output !== null
  }

  getConnectedName(): string | null {
    return this.connectedName
  }
}

// Singleton instance
export const midiOutputManager = new MidiOutputManagerImpl()

/**
 * List all available MIDI outputs
 */
export async function listMidiOutputs(): Promise<MidiOutputDevice[]> {
  return midiOutputManager.getOutputs()
}

/**
 * Connect to a MIDI output by name
 */
export async function connectMidiOutput(name: string): Promise<boolean> {
  return midiOutputManager.connect(name)
}

/**
 * Disconnect from the current MIDI output
 */
export function disconnectMidiOutput(): void {
  midiOutputManager.disconnect()
}

/**
 * Send a MIDI message
 */
export function sendMidiMessage(message: number[]): void {
  midiOutputManager.send(message)
}

/**
 * Get the current MIDI connection status
 */
export function getMidiStatus(): { connected: boolean; outputName: string | null } {
  return {
    connected: midiOutputManager.isConnected(),
    outputName: midiOutputManager.getConnectedName()
  }
}

/**
 * Auto-detect and connect to a Disklavier
 * Looks for common Disklavier and Yamaha USB/network MIDI names
 */
export async function autoConnectDisklavier(): Promise<boolean> {
  const outputs = await listMidiOutputs()

  // Log available outputs for debugging
  if (outputs.length > 0) {
    console.log('Available MIDI outputs:', outputs.map(o => o.name).join(', '))
  }

  // Common Disklavier/Yamaha MIDI names - ordered by priority
  const disklavierPatterns = [
    /disklavier/i,           // Direct Disklavier match
    /dkv/i,                  // DKV abbreviation
    /yamaha.*piano/i,        // Yamaha Piano
    /clavinova/i,            // Clavinova series
    /yamaha.*usb/i,          // Yamaha USB MIDI
    /yamaha.*network/i,      // Network MIDI
    /network.*session/i,     // Network session MIDI
    /yamaha/i                // Any Yamaha device (last resort)
  ]

  for (const pattern of disklavierPatterns) {
    for (const output of outputs) {
      if (pattern.test(output.name)) {
        console.log(`Auto-detected Disklavier/Yamaha: ${output.name}`)
        return connectMidiOutput(output.name)
      }
    }
  }

  if (outputs.length === 0) {
    console.log('No MIDI outputs available')
  } else {
    console.log('No Disklavier auto-detected among available outputs')
  }
  return false
}
