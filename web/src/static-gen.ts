import type { AudioGraph } from './types.js';

/**
 * Generate a 2-second white noise buffer
 */
function generateNoiseBuffer(ctx: AudioContext, offset: number): AudioBuffer {
  const len = ctx.sampleRate * 2; // 2 seconds of audio
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[(i + offset) % len] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Create static generators and connect them to the static bus
 * Two channels with prime-length offsets to prevent phase alignment
 */
export function createStaticGenerator(
  ctx: AudioContext,
  graph: AudioGraph
): { stop: () => void } {
  // Generate two noise buffers with prime-length offsets
  const buffer1 = generateNoiseBuffer(ctx, 0);
  const buffer2 = generateNoiseBuffer(ctx, 44041); // prime number for offset

  // Create source nodes
  const src1 = ctx.createBufferSource();
  src1.buffer = buffer1;
  src1.loop = true;

  const src2 = ctx.createBufferSource();
  src2.buffer = buffer2;
  src2.loop = true;

  // Create bandpass filters
  const bp1 = ctx.createBiquadFilter();
  bp1.type = 'bandpass';
  bp1.frequency.value = 600;
  bp1.Q.value = 1.5;

  const bp2 = ctx.createBiquadFilter();
  bp2.type = 'bandpass';
  bp2.frequency.value = 600;
  bp2.Q.value = 0.8;

  // Create gain nodes for each channel (main and ghost)
  const gain1 = ctx.createGain();
  gain1.gain.value = 0;

  const gain2 = ctx.createGain();
  gain2.gain.value = 0;

  // Connect: source -> filter -> gain -> static bus
  src1.connect(bp1);
  bp1.connect(gain1);
  gain1.connect(graph.staticBus);

  src2.connect(bp2);
  bp2.connect(gain2);
  gain2.connect(graph.staticBus);

  // Store references to gains for updateStaticGain
  (graph as any)._staticGain1 = gain1;
  (graph as any)._staticGain2 = gain2;

  // Start the noise sources
  src1.start();
  src2.start();

  return {
    stop: () => {
      src1.stop();
      src2.stop();
    },
  };
}

/**
 * Convert distance from station to a gain value and apply it
 * @param distanceKHz - Distance from the locked frequency in kHz
 * @param graph - The audio graph
 * @param ctx - The audio context
 */
export function updateStaticGain(
  distanceKHz: number,
  graph: AudioGraph,
  ctx: AudioContext
): void {
  // Linear interpolation: distance 0 = gain 0, distance >= 200 kHz = gain 1
  const maxDistance = 200;
  const targetGain = Math.max(0, Math.min(1, distanceKHz / maxDistance));

  const gain1 = (graph as any)._staticGain1 as GainNode;
  const gain2 = (graph as any)._staticGain2 as GainNode;

  if (gain1 && gain2) {
    // Main channel at full target gain
    gain1.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.05);
    // Ghost channel at 20% of main gain
    gain2.gain.setTargetAtTime(targetGain * 0.2, ctx.currentTime, 0.05);
  }
}
