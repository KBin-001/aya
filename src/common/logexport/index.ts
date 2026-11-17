/**
 * Pure log-export domain logic, shared between the main and renderer processes.
 *
 * This module is the single seam between a device and everything that decides
 * where to pull its logs from: the main process only reads properties and moves
 * bytes, the renderer only renders. Nothing in here imports Electron, Node or
 * the DOM, so every function can be exercised against a captured property map.
 */
export * from './types'
export * from './defaults'
export * from './platform'
export * from './paths'
export * from './migrate'
