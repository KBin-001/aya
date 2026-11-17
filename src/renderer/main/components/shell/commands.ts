export function isShellCommand(value: unknown): value is string {
  // The PTY treats control characters as keystrokes, including Enter.
  return typeof value === 'string' && Boolean(value.trim()) &&
    Array.from(value).every((char) => char >= ' ' && char !== '\x7f')
}
