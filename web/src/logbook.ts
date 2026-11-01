// The Logbook: eight pages, filled by what the listener finds. Lives only on this device.
// No hidden frequency appears here; pages remember the frequency the listener tuned themselves.

export interface Page {
  id: string;
  title: string;
  hint: string;
  entry: string;
}

export const PAGES: Page[] = [
  { id: 'old-station', title: 'The Old Station', hint: 'Where was John before 1714?',
    entry: 'WHLW. Same voice, younger. Reading names off a phone list like his life depends on it. Maybe somebody else\'s did.' },
  { id: 'marty', title: "Marty's Channel", hint: 'Engineers talk on their own frequency.',
    entry: 'Wind. Metal. A service radio keyed open on a tower in the rain. Once in a while, one word.' },
  { id: 'bulletin', title: 'The Bulletin', hint: 'What night was it?',
    entry: 'A weather bulletin for the Pale Harbor valley. It plays again and again, and every time a little more of it is gone.' },
  { id: 'hold', title: 'Hold Music', hint: 'Everyone called the same number.',
    entry: 'The request line, on hold forever. Under the music, people are still calling in.' },
  { id: 'town', title: 'The Town', hint: 'Who paid for this station?',
    entry: 'Every sponsor on the air was a real place once. Put them together and you can draw the town.' },
  { id: 'three-fourteen', title: '3:14', hint: 'The numbers are not random.',
    entry: 'His last full minute. One more call. Then he asks Marty how it\'s looking out there, and the air goes dead.' },
  { id: 'rink', title: 'The Rink', hint: 'Who was still dancing that night?',
    entry: 'The Starlite. Halloween skate. Somebody is still out on the floor.' },
  { id: 'between', title: 'Between Stations', hint: 'Some things only make sense in reverse.',
    entry: 'Nothing should live between channels. Something does, and it is talking backwards.' },
];

export const TOWN_ADS: Record<string, string> = {
  ad_motorlodge: 'Hollow Pines Motor Lodge, Route nine, just past the dam',
  ad_diner: "Gable's 24 Hour Diner, corner of Fairview and Main",
  ad_rink: 'Starlite Roller Rink, Old Mill Road',
  ad_repair: 'Lindqvist Radio and TV Repair, Main Street',
  ad_laundromat: 'Pale Harbor Laundromat, right below the dam',
  ad_drivein: 'The Orpheum Drive In, River Road',
};

interface Found { at: number; freq: number }
interface State {
  found: Record<string, Found>;
  ads: string[];
  numbersHeard: boolean;
  finaleDone: boolean;
}

const KEY = 'deadair.logbook.v1';
let state: State = { found: {}, ads: [], numbersHeard: false, finaleDone: false };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...state, ...JSON.parse(raw) };
} catch {
  // Private window or blocked storage: the hunt still works for this visit.
}
const save = (): void => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* see above */ }
};

const listeners = new Set<(newPage: Page | null) => void>();
export function onLogbookChange(fn: (newPage: Page | null) => void): void {
  listeners.add(fn);
}
const emit = (p: Page | null): void => listeners.forEach((fn) => fn(p));

export function foundCount(): number {
  return PAGES.filter((p) => state.found[p.id]).length;
}
export function isFound(id: string): boolean {
  return !!state.found[id];
}
export function foundInfo(id: string): Found | undefined {
  return state.found[id];
}
export function complete(): boolean {
  return foundCount() === PAGES.length;
}

/** Returns true when this is a new page. */
export function record(pageId: string, freq: number): boolean {
  const page = PAGES.find((p) => p.id === pageId);
  if (!page || state.found[pageId]) return false;
  state.found[pageId] = { at: Date.now(), freq };
  save();
  emit(page);
  return true;
}

export function heardAd(clipId: string): void {
  if (!(clipId in TOWN_ADS) || state.ads.includes(clipId)) return;
  state.ads.push(clipId);
  save();
  if (Object.keys(TOWN_ADS).every((id) => state.ads.includes(id))) record('town', 1714);
  else emit(null);
}
export function adsHeard(): string[] {
  return [...state.ads];
}

export function heardNumbers(): void {
  if (state.numbersHeard) return;
  state.numbersHeard = true;
  save();
  emit(null);
}
export function numbersHeard(): boolean {
  return state.numbersHeard;
}

/** The finale replaces one Emergency Broadcast, once, after every page is found. */
export function finaleDue(): boolean {
  return complete() && !state.finaleDone;
}
export function markFinale(): void {
  state.finaleDone = true;
  save();
  emit(null);
}
export function finaleDone(): boolean {
  return state.finaleDone;
}
