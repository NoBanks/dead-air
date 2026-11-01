// Setup for Web Audio API tests
import { beforeAll } from 'vitest';

beforeAll(() => {
  // Setup AudioContext for jsdom
  if (!globalThis.AudioContext) {
    const { AudioContext: WebAudioContext } = require('web-audio-api');
    globalThis.AudioContext = WebAudioContext;
  }
});
