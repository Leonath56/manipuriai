// Client-side audio preprocessing for better STT accuracy (esp. Manipuri).
// Steps: decode → mono downmix → downsample to 16kHz → high-pass (rumble)
// → peak-normalize to ~-1 dBFS → encode as 16-bit PCM WAV.

const TARGET_SR = 16000;

function downmixToMono(buf: AudioBuffer): Float32Array {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  if (ch === 1) return buf.getChannelData(0).slice();
  const out = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += d[i];
  }
  for (let i = 0; i < len; i++) out[i] /= ch;
  return out;
}

// Simple 1-pole high-pass ~80Hz to cut mic rumble / breath thump.
function highPass(samples: Float32Array, sampleRate: number, cutoff = 80) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = alpha * (prevOut + x - prevIn);
    prevIn = x;
    prevOut = y;
    samples[i] = y;
  }
}

function peakNormalize(samples: Float32Array, targetPeak = 0.89) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-4) return; // near-silent; leave alone
  const gain = Math.min(6, targetPeak / peak); // cap gain to avoid amplifying noise floor
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Preprocess a recorded audio blob into a normalized 16kHz mono WAV.
 * Falls back to the original blob if decoding fails (e.g. unsupported codec).
 */
export async function preprocessAudio(blob: Blob): Promise<Blob> {
  try {
    const arr = await blob.arrayBuffer();
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const decodeCtx = new Ctx();
    const decoded = await decodeCtx.decodeAudioData(arr.slice(0));
    await decodeCtx.close().catch(() => {});

    const mono = downmixToMono(decoded);
    const srcRate = decoded.sampleRate;

    // Resample to 16kHz via OfflineAudioContext (higher quality than naive picker).
    const targetLen = Math.ceil((mono.length / srcRate) * TARGET_SR);
    const offline = new OfflineAudioContext(1, targetLen, TARGET_SR);
    const srcBuf = offline.createBuffer(1, mono.length, srcRate);
    srcBuf.getChannelData(0).set(mono);
    const srcNode = offline.createBufferSource();
    srcNode.buffer = srcBuf;
    srcNode.connect(offline.destination);
    srcNode.start(0);
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0).slice();

    highPass(samples, TARGET_SR, 80);
    peakNormalize(samples, 0.89);

    return encodeWav(samples, TARGET_SR);
  } catch {
    return blob;
  }
}
