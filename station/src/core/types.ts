// Track from the library
export interface Track {
  id: string;
  slug: string;
  title: string;
  seconds: number;
  talkup_seconds: number;
  lufs: number;
  made_at: string;
  mp3: string;
}

// Voice clip kinds
export type ClipKind =
  | "signon"
  | "id"
  | "drop"
  | "talkup"
  | "backsell"
  | "setup"
  | "break"
  | "storm"
  | "marty"
  | "sponsor"
  | "caller"
  | "signal";

// Voice clip from voicebank
export interface VoiceClip {
  id: string;
  kind: ClipKind;
  text: string;
  seconds: number;
  file: string;
  song_id?: string;
  // "night": only airs 7 PM to 6 AM LA. "0314": airs once a day, at 3:14 AM LA, never at random.
  air?: "night" | "0314";
}

// Voicebank data
export interface Voicebank {
  clips: VoiceClip[];
}

// Featured song entry
export interface FeaturedEntry {
  song_id: string;
  setup_clip_id: string;
}

// Base segment properties
interface BaseSegment {
  startMs: number;
  endMs: number;
}

// Song segment
export interface SongSegment extends BaseSegment {
  kind: "song";
  trackId: string;
  title: string;
  mp3: string;
  /** True only on the last segment of a day: the song was clipped at dayEnd. */
  truncated?: true;
  /**
   * Optional talk-up metadata. The clip plays from
   * song.startMs + startOffsetMs and ends exactly at
   * song.startMs + talkup_seconds * 1000.
   * startOffsetMs may be negative for featured setup clips that are longer
   * than the gap available before song start (only valid when the preceding
   * segment is also a song).
   * Talk-ups are NOT separate timeline segments; they play simultaneously
   * with the song intro on the audio layer.
   */
  talkup?: {
    clipId: string;
    file: string;
    text: string;
    startOffsetMs: number;
  };
}

// Voice segment
export interface VoiceSegment extends BaseSegment {
  kind: "voice";
  clipId: string;
  clipKind: ClipKind;
  text: string;
  file: string;
}

// Numbers station segment
export interface NumbersSegment extends BaseSegment {
  kind: "numbers";
  // The short reading at :14 past the hour (the full one runs at midnight).
  short?: true;
}

// Emergency Broadcast System segment
export interface EbsSegment extends BaseSegment {
  kind: "ebs";
}

// Union of all segment types
export type Segment =
  | SongSegment
  | VoiceSegment
  | NumbersSegment
  | EbsSegment;

// Day schedule (one full station day)
export interface DaySchedule {
  dayIndex: number;
  startMs: number;
  endMs: number;
  segments: Segment[];
}

// Result from nowPlaying
export interface NowPlayingResult {
  segment: Segment;
  offsetMs: number;
  next: Segment[];
}
