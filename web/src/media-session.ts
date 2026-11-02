/**
 * What the phone's lock screen and media controls show while 1714 plays in the background.
 */
export function updateMediaSession(now?: { title: string; artist: string }): void {
  if (!('mediaSession' in navigator)) {
    return; // Media Session not supported
  }

  if (!now) {
    navigator.mediaSession.metadata = null;
    return;
  }

  try {
    navigator.mediaSession.metadata = new (window as any).MediaMetadata({
      title: now.title,
      artist: now.artist,
      album: 'DEAD AIR · 1714 AM',
      artwork: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  } catch (e) {
    // MediaMetadata not supported
  }
}
