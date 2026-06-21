import { onUnmounted, type Ref } from "vue";
import { usePubSub } from "./usePubSub";

interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
}
interface ActivityState {
  working: boolean;
  waiting: boolean;
}
const isActivityMsg = (d: unknown): d is ActivityMsg => typeof d === "object" && d !== null && "id" in d;

// True when this activity push means the session now needs you: it just finished a
// turn (working true→false — Claude's Stop, published for every session) or it set
// `waiting` (a prompt/permission, published for background sessions). First sight is
// baseline only (no beep). Mutates `prev` to the latest state.
export function needsAttention(prev: Map<string, ActivityState>, msg: ActivityMsg): boolean {
  const now: ActivityState = { working: msg.working ?? false, waiting: msg.waiting ?? false };
  const was = prev.get(msg.id);
  prev.set(msg.id, now);
  if (!was) return false;
  const finishedTurn = was.working && !now.working;
  const becameWaiting = !was.waiting && now.waiting;
  return finishedTurn || becameWaiting;
}

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    audioCtx = audioCtx ?? new AudioContext();
    return audioCtx;
  } catch {
    return null;
  }
}

// Autoplay policy: an AudioContext starts suspended until a user gesture, so a beep
// fired from an event (not a gesture) would be silent. Arm a one-shot listener that
// resumes the context on the first click/keypress anywhere; after that, beeps play.
let unlockArmed = false;
function armUnlock() {
  if (unlockArmed) return;
  unlockArmed = true;
  const unlock = () => {
    const ctx = getCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

// A short two-note attention chime via Web Audio (no asset). Exported so a toolbar
// "test" button can preview it (and, being a user gesture, unlock the context).
export function playAttentionSound() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const tone = (freq: number, start: number, dur: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + start;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  try {
    tone(784, 0, 0.16); // G5
    tone(1047, 0.14, 0.22); // C6
  } catch {
    // no Web Audio — stay silent
  }
}

// Beep when any session transitions into `waiting` (needs attention), across every
// page/view, by listening to the same "sessions" activity stream the cells use — so
// the beep tracks the amber header exactly. `enabled` gates it (the 🔔 toggle).
export function useAttentionSound(enabled: Ref<boolean>) {
  armUnlock();
  const prev = new Map<string, ActivityState>();
  const { subscribe } = usePubSub();
  const unsubscribe = subscribe("sessions", (d) => {
    if (isActivityMsg(d) && needsAttention(prev, d) && enabled.value) playAttentionSound();
  });
  onUnmounted(unsubscribe);
}
