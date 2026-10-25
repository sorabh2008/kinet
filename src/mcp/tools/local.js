// Project-aware tools added on top of the 9 core tools. Each module exports
// `definition` (name, description, inputSchema) and `async run(args, ctx)`.
import * as gitStatus from './git-status.js';
import * as gitDiff from './git-diff.js';

export const localTools = [gitStatus, gitDiff];
