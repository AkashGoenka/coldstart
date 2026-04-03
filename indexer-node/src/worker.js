/**
 * worker.js — Worker thread entry point.
 * Receives parse jobs from the main thread and posts back parsed nodes.
 */

import { parentPort } from 'node:worker_threads';
import { parseFile } from './parser.js';

if (!parentPort) {
  throw new Error('worker.js must be run as a worker thread');
}

parentPort.on('message', (msg) => {
  // null is a sentinel from the main thread signalling no more work
  if (msg === null) {
    process.exit(0);
  }

  const { absPath, relPath, hasReact } = msg;
  try {
    const node = parseFile(absPath, relPath, hasReact);
    parentPort.postMessage({ node });
  } catch (err) {
    parentPort.postMessage({ error: err.message, relPath });
  }
});
