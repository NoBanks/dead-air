import type { Segment, Track } from './types.js';

/**
 * Format a date string (ISO format) to month and year
 */
function formatMadeAt(madeAt: string): string {
  try {
    const date = new Date(madeAt);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Update the now-playing card with segment information
 */
export function updateCard(segment: Segment | null, track?: Track): void {
  // Get or create the card element
  let card = document.getElementById('now-playing');
  if (!card) {
    card = document.createElement('div');
    card.id = 'now-playing';
    card.setAttribute('aria-live', 'polite');
    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    const artistEl = document.createElement('div');
    artistEl.className = 'artist';
    const madeAtEl = document.createElement('div');
    madeAtEl.className = 'made-at';
    card.appendChild(titleEl);
    card.appendChild(artistEl);
    card.appendChild(madeAtEl);
    document.body.appendChild(card);
  }

  const titleEl = card.querySelector('.title') as HTMLElement;
  const artistEl = card.querySelector('.artist') as HTMLElement;
  const madeAtEl = card.querySelector('.made-at') as HTMLElement;

  // Apply transition
  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  if (!prefersReducedMotion) {
    card.classList.add('fading-out');
  }

  // Update content after a brief delay (or immediately if reduced motion)
  const updateDelay = prefersReducedMotion ? 0 : 100;
  setTimeout(() => {
    if (!segment) {
      // Hide the card
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';

    if (segment.kind === 'song' && track) {
      titleEl.textContent = track.title;
      artistEl.textContent = 'NoBanks Nearby';
      const madeAt = formatMadeAt(track.made_at);
      madeAtEl.textContent = madeAt;
    } else if (segment.kind === 'voice') {
      titleEl.textContent = 'Dead John';
      artistEl.textContent = '';
      madeAtEl.textContent = '';
    } else if (segment.kind === 'numbers' || segment.kind === 'ebs') {
      card.style.display = 'none';
      return;
    }

    // Fade in
    if (!prefersReducedMotion) {
      card.classList.remove('fading-out');
    }
  }, updateDelay);
}
