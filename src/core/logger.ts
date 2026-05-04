import type { Logger } from '../types.js';

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
