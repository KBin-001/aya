/**
 * Pure parsers that turn raw device text into structured metric readings.
 *
 * This module is the single seam between the device and everything that shows
 * device state: the main process only moves bytes here, the renderer only
 * renders what comes out. Nothing in here imports Electron, Node or the DOM, so
 * every parser can be exercised against a captured dump.
 */
export * from './result'
export * from './text'
export * from './cpu'
export * from './thermal'
export * from './memory'
export * from './battery'
export * from './power'
export * from './changelog'
export * from './types'
