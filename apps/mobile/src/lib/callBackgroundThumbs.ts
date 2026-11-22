import type { ImageSourcePropType } from 'react-native';
import type { CallBackgroundPresetId } from '@sampledge/contracts';

/** 320x180 previews of the prebuilt call backgrounds (copied from apps/web/public/backgrounds/thumbs). */
export const PRESET_THUMBS: Record<CallBackgroundPresetId, ImageSourcePropType> = {
  'skyline-office': require('../../assets/call-backgrounds/skyline-office.jpg'),
  'dusk-skyline': require('../../assets/call-backgrounds/dusk-skyline.jpg'),
  'night-city': require('../../assets/call-backgrounds/night-city.jpg'),
  'glass-meeting-room': require('../../assets/call-backgrounds/glass-meeting-room.jpg'),
  boardroom: require('../../assets/call-backgrounds/boardroom.jpg'),
  'executive-wood': require('../../assets/call-backgrounds/executive-wood.jpg'),
  library: require('../../assets/call-backgrounds/library.jpg'),
  reception: require('../../assets/call-backgrounds/reception.jpg'),
  'brick-coworking': require('../../assets/call-backgrounds/brick-coworking.jpg'),
  'scandi-room': require('../../assets/call-backgrounds/scandi-room.jpg'),
  lounge: require('../../assets/call-backgrounds/lounge.jpg'),
  'green-wall': require('../../assets/call-backgrounds/green-wall.jpg'),
  'home-office': require('../../assets/call-backgrounds/home-office.jpg'),
  'mountain-view': require('../../assets/call-backgrounds/mountain-view.jpg'),
  'seaside-view': require('../../assets/call-backgrounds/seaside-view.jpg'),
  'navy-geometric': require('../../assets/call-backgrounds/navy-geometric.jpg'),
  'soft-bokeh': require('../../assets/call-backgrounds/soft-bokeh.jpg'),
  'slate-gradient': require('../../assets/call-backgrounds/slate-gradient.jpg'),
  'warm-gradient': require('../../assets/call-backgrounds/warm-gradient.jpg'),
  'teal-waves': require('../../assets/call-backgrounds/teal-waves.jpg'),
};
