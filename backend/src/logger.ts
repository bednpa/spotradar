/** Minimal logger interface (default: console); tests inject silent ones. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}
