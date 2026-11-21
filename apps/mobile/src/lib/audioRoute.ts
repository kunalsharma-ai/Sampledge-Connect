export interface AudioOutput {
  id: string;
  label: string;
}

/** Names for the audio routes the phone reports (LiveKit AudioSession output ids). */
export function outputLabel(id: string): string {
  switch (id) {
    case 'speaker':
    case 'force_speaker':
      return 'Speaker';
    case 'earpiece':
      return 'Phone';
    case 'default':
      return 'Phone or headset';
    case 'headset':
      return 'Headset';
    case 'bluetooth':
      return 'Bluetooth';
    default:
      return id;
  }
}

export function outputIcon(
  id: string,
): 'volume-high' | 'call' | 'headset' | 'bluetooth' | 'volume-medium' {
  if (id === 'speaker' || id === 'force_speaker') return 'volume-high';
  if (id === 'earpiece' || id === 'default') return 'call';
  if (id === 'headset') return 'headset';
  if (id === 'bluetooth') return 'bluetooth';
  return 'volume-medium';
}

/**
 * The route a call starts on: video calls on the speaker (the phone is held away from the ear),
 * voice calls on the earpiece; a connected headset or Bluetooth wins either way.
 */
export function defaultOutput(outputs: readonly AudioOutput[], video: boolean): string | null {
  const ids = outputs.map((o) => o.id);
  for (const id of ['bluetooth', 'headset']) if (ids.includes(id)) return id;
  if (video) return ids.find((i) => i === 'speaker' || i === 'force_speaker') ?? ids[0] ?? null;
  return ids.find((i) => i === 'earpiece' || i === 'default') ?? ids[0] ?? null;
}
