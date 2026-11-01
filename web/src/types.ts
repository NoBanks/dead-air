// Re-export station types
export type {
  Segment,
  SongSegment,
  VoiceSegment,
  NumbersSegment,
  EbsSegment,
  Track,
  ClipKind,
  VoiceClip,
  Voicebank,
  FeaturedEntry,
  NowPlayingResult,
  DaySchedule,
} from '../../station/src/core/types.js';

// Client-local types

export interface DialState {
  freqKHz: number;    // current frequency, clamped [520, 1740]
  locked: boolean;    // true when snapped to a station
  lockedFreq: number; // the station frequency, if locked
}

export interface AudioGraph {
  musicBus: GainNode;   // gain: 1.0 (full) or ~0.316 (ducked, -10 dB)
  voiceBus: GainNode;   // gain: 1.0 always
  staticBus: GainNode;  // gain: 0.0..1.0, follows distance from station
  master: GainNode;     // gain: 1.0 always, final output
  setCleanMode(clean: boolean): void;
}
