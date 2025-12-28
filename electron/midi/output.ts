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
      // Disconnect any existing output
      this.disconnect()

      console.log(`Attempting to open MIDI output: ${name}`)

      // Try to open the output by name
      this.output = this.jzz.openMidiOut(name)
      this.connectedName = name

      console.log(`Connected to MIDI output: ${name}`)
      console.log(`Output object:`, this.output ? 'exists' : 'null')
      return true
    } catch (error) {
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

  send(message: number[]): void {
    if (this.output) {
      try {
        this.sendCount++
        // Log first few and then periodically
        if (this.sendCount <= 3 || this.sendCount % 200 === 0) {
          console.log(`[MidiOutput SEND #${this.sendCount}] to ${this.connectedName}: [${message.join(', ')}]`)
        }
        this.output.send(message)
      } catch (error) {
        console.error('Error sending MIDI message:', error)
      }
    } else {
      console.warn('MIDI send called but no output connected!')
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
 * Looks for common Disklavier network MIDI names
 */
export async function autoConnectDisklavier(): Promise<boolean> {
  const outputs = await listMidiOutputs()

  // Common Disklavier/Yamaha MIDI names
  const disklavierPatterns = [
    /disklavier/i,
    /yamaha.*usb/i,
    /yamaha.*network/i,
    /network.*session/i,
    /dkv/i
  ]

  for (const output of outputs) {
    for (const pattern of disklavierPatterns) {
      if (pattern.test(output.name)) {
        console.log(`Auto-detected Disklavier: ${output.name}`)
        return connectMidiOutput(output.name)
      }
    }
  }

  console.log('No Disklavier auto-detected')
  return false
}
