import type { AudioGraph } from './types.js';

/**
 * Build the Web Audio graph with music, voice, and static buses
 */
export function buildGraph(ctx: AudioContext): AudioGraph {
  // Create buses
  const musicBus = ctx.createGain();
  const voiceBus = ctx.createGain();
  const staticBus = ctx.createGain();

  // Create filter chain
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 120;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 5000;

  // Create saturation curve (mild soft-clip: y = (3/2) * x - (1/2) * x^3, clipped to [-1, 1])
  const saturationCurve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1; // map to [-1, 1]
    const y = 1.5 * x - 0.5 * x * x * x;
    saturationCurve[i] = Math.max(-1, Math.min(1, y));
  }
  const waveShaper = ctx.createWaveShaper();
  waveShaper.curve = saturationCurve;

  // Master output
  const master = ctx.createGain();
  master.gain.value = 1.0;

  // Initially connect all buses through the filter chain
  const connectFiltered = (): void => {
    // Disconnect any previous connections (safe to call multiple times)
    musicBus.disconnect();
    voiceBus.disconnect();
    staticBus.disconnect();
    highpass.disconnect();
    lowpass.disconnect();
    waveShaper.disconnect();

    // Connect buses to filter chain
    musicBus.connect(highpass);
    voiceBus.connect(highpass);
    staticBus.connect(highpass);

    // Filter chain
    highpass.connect(lowpass);
    lowpass.connect(waveShaper);
    waveShaper.connect(master);

    // Master to destination
    master.connect(ctx.destination);
  };

  const connectClean = (): void => {
    // Disconnect previous chain
    musicBus.disconnect();
    voiceBus.disconnect();
    staticBus.disconnect();
    highpass.disconnect();
    lowpass.disconnect();
    waveShaper.disconnect();

    // Connect buses directly to master
    musicBus.connect(master);
    voiceBus.connect(master);
    staticBus.connect(master);

    // Master to destination
    master.connect(ctx.destination);
  };

  // Initial connection
  connectFiltered();

  let cleanMode = false;

  const audioGraph: AudioGraph = {
    musicBus,
    voiceBus,
    staticBus,
    master,
    setCleanMode(clean: boolean): void {
      if (clean === cleanMode) return;
      cleanMode = clean;
      if (clean) {
        connectClean();
      } else {
        connectFiltered();
      }
    },
  };

  return audioGraph;
}
