// Shared vocabulary for the torn-write test: a payload big enough that a
// non-atomic writeFileSync of it is many syscalls wide, and a classifier that
// can tell a whole payload from a half-written one.
//
// The classifier is what gives that test its power, so run.mjs asserts against
// it directly with a hand-made torn file — a deterministic proof that the
// detector fires, rather than trusting the OS to lose a race on cue.

export const PAYLOAD_SIZE = 256 * 1024;
export const VARIANTS = ["A", "B"];

const CODES = new Set(VARIANTS.map((v) => v.charCodeAt(0)));

export function variantBuffer(variant) {
  return Buffer.alloc(PAYLOAD_SIZE, variant.charCodeAt(0));
}

// A whole payload is exactly PAYLOAD_SIZE bytes of ONE variant byte. Anything
// else — short, long, or mixed — is a torn read. Sampled every 512 bytes plus
// the tail: a partial write always truncates or leaves a seam, and at this
// stride there is no seam a torn file could hide in.
export function classify(buf) {
  if (!buf) return { ok: false, reason: "no bytes" };
  if (buf.length !== PAYLOAD_SIZE) return { ok: false, reason: `length ${buf.length} != ${PAYLOAD_SIZE}` };
  const first = buf[0];
  if (!CODES.has(first)) return { ok: false, reason: `unknown lead byte ${first}` };
  for (let i = 0; i < buf.length; i += 512) {
    if (buf[i] !== first) return { ok: false, reason: `mixed content at byte ${i}` };
  }
  if (buf[buf.length - 1] !== first) return { ok: false, reason: "mixed content at tail" };
  return { ok: true, variant: String.fromCharCode(first) };
}
