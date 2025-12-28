import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { catalogDb } from './database.js'
import { getSongMetadata } from '../midi/parser.js'

export interface ScanProgress {
  total: number
  processed: number
  current: string
  added: number
  skipped: number
  errors: number
}

export interface ScanResult {
  total: number
  added: number
  skipped: number
  errors: number
  duration: number
}

/**
 * Scan a directory for KAR and MIDI files
 */
export async function scanCatalogDirectory(
  directoryPath: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
  const startTime = Date.now()

  // Find all .kar and .mid files
  const files = findMidiFiles(directoryPath)

  const result: ScanResult = {
    total: files.length,
    added: 0,
    skipped: 0,
    errors: 0,
    duration: 0
  }

  console.log(`Found ${files.length} MIDI/KAR files to scan`)

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]

    try {
      // Check if file already exists in database
      const existing = catalogDb.getSongByPath(filePath)

      if (existing) {
        // Check if file has been modified
        const stats = fs.statSync(filePath)
        const currentHash = getFileHash(filePath)

        if (existing.file_hash === currentHash) {
          result.skipped++

          if (onProgress) {
            onProgress({
              total: files.length,
              processed: i + 1,
              current: path.basename(filePath),
              added: result.added,
              skipped: result.skipped,
              errors: result.errors
            })
          }
          continue
        }
      }

      // Parse the file
      const metadata = getSongMetadata(filePath)

      // Extract artist from filename if possible (common format: "Artist - Title.kar")
      let artist = ''
      let title = metadata.title

      const filenameMatch = path.basename(filePath, path.extname(filePath)).match(/^(.+?)\s*-\s*(.+)$/)
      if (filenameMatch) {
        artist = filenameMatch[1].trim()
        title = filenameMatch[2].trim()
      }

      // Add to database
      catalogDb.addSong({
        file_path: filePath,
        title,
        artist,
        duration_ms: metadata.duration,
        has_lyrics: metadata.hasLyrics,
        track_count: metadata.trackCount,
        file_hash: getFileHash(filePath)
      })

      result.added++
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error)
      result.errors++
    }

    if (onProgress) {
      onProgress({
        total: files.length,
        processed: i + 1,
        current: path.basename(filePath),
        added: result.added,
        skipped: result.skipped,
        errors: result.errors
      })
    }

    // Yield to event loop occasionally to prevent blocking
    if (i % 50 === 0) {
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  result.duration = Date.now() - startTime

  console.log(`Scan complete: ${result.added} added, ${result.skipped} skipped, ${result.errors} errors in ${result.duration}ms`)

  return result
}

/**
 * Recursively find all MIDI and KAR files in a directory
 */
function findMidiFiles(directoryPath: string): string[] {
  const files: string[] = []
  const extensions = ['.kar', '.mid', '.midi']

  function scan(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          // Skip hidden directories
          if (!entry.name.startsWith('.')) {
            scan(fullPath)
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (extensions.includes(ext)) {
            files.push(fullPath)
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error)
    }
  }

  scan(directoryPath)
  return files
}

/**
 * Calculate MD5 hash of a file for change detection
 */
function getFileHash(filePath: string): string {
  try {
    const buffer = fs.readFileSync(filePath)
    return crypto.createHash('md5').update(buffer).digest('hex')
  } catch {
    return ''
  }
}

/**
 * Validate that a path is a valid directory
 */
export function validateCatalogPath(directoryPath: string): { valid: boolean; error?: string } {
  try {
    if (!fs.existsSync(directoryPath)) {
      return { valid: false, error: 'Directory does not exist' }
    }

    const stats = fs.statSync(directoryPath)
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' }
    }

    // Check if readable
    fs.accessSync(directoryPath, fs.constants.R_OK)

    return { valid: true }
  } catch (error) {
    return { valid: false, error: `Cannot access directory: ${error}` }
  }
}

/**
 * Quick count of MIDI files in a directory (non-recursive for speed)
 */
export function countMidiFiles(directoryPath: string): number {
  return findMidiFiles(directoryPath).length
}
