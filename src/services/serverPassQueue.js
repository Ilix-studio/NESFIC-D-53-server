// In-process background queue for server passes, one clip at a time. The queued state lives
// on the Clip itself, so resumePending() picks up anything left over after a restart.
import { Clip } from '../models/Clip.js';
import { runServerPass } from './serverPass.service.js';

const pending = [];
let running = null;

async function work() {
  while (pending.length) {
    const clipId = pending.shift();
    try {
      await runServerPass(clipId);
    } catch (err) {
      console.error(`server pass failed for one clip: ${err.name}`);
    }
  }
  running = null;
}

export function enqueue(clipId) {
  pending.push(String(clipId));
  // Start after the current request has been answered.
  running ??= new Promise((resolve) => setImmediate(resolve)).then(work);
}

export async function resumePending() {
  const clips = await Clip.find({ 'serverPass.status': 'queued' }).select('_id').lean();
  for (const clip of clips) enqueue(clip._id);
  return clips.length;
}

/** Resolves when the queue is empty (used by tests). */
export async function idle() {
  while (running) await running;
}
