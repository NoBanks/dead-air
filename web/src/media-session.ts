import type { Track } from './types.js';

/**
 * Update Media Session API metadata
 */
export function updateMediaSession(track?: Track): void {
  if (!('mediaSession' in navigator)) {
    return; // Media Session not supported
  }

  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }

  // Create metadata for the media session
  try {
    navigator.mediaSession.metadata = new (window as any).MediaMetadata({
      title: track.title,
      artist: 'NoBanks Nearby',
      artwork: [
        // Add artwork if available
        // {
        //   src: '/artwork.png',
        //   sizes: '512x512',
        //   type: 'image/png',
        // },
      ],
    });
  } catch (e) {
    // MediaMetadata not supported
  }
}
