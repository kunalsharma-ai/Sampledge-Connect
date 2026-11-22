import type { ImageSourcePropType } from 'react-native';
import type { CallBackgroundPresetId } from '@sampledge/contracts';

/** 320x180 previews of the prebuilt call backgrounds (copied from apps/web/public/backgrounds/thumbs). */
export const PRESET_THUMBS: Record<CallBackgroundPresetId, ImageSourcePropType> = {
  'modern-office': require('../../assets/call-backgrounds/modern-office.jpg'),
  'executive-office': require('../../assets/call-backgrounds/executive-office.jpg'),
  'glass-meeting-room': require('../../assets/call-backgrounds/glass-meeting-room.jpg'),
  boardroom: require('../../assets/call-backgrounds/boardroom.jpg'),
  'open-plan-office': require('../../assets/call-backgrounds/open-plan-office.jpg'),
  'coworking-loft': require('../../assets/call-backgrounds/coworking-loft.jpg'),
  'library-study': require('../../assets/call-backgrounds/library-study.jpg'),
  'reception-lobby': require('../../assets/call-backgrounds/reception-lobby.jpg'),
  'office-lounge': require('../../assets/call-backgrounds/office-lounge.jpg'),
  'skyline-office': require('../../assets/call-backgrounds/skyline-office.jpg'),
  'minimal-workspace': require('../../assets/call-backgrounds/minimal-workspace.jpg'),
  'green-office': require('../../assets/call-backgrounds/green-office.jpg'),
  'luxury-living-room': require('../../assets/call-backgrounds/luxury-living-room.jpg'),
  'penthouse-view': require('../../assets/call-backgrounds/penthouse-view.jpg'),
  'home-study': require('../../assets/call-backgrounds/home-study.jpg'),
  'scandinavian-living': require('../../assets/call-backgrounds/scandinavian-living.jpg'),
  'fireplace-lounge': require('../../assets/call-backgrounds/fireplace-lounge.jpg'),
  'modern-sofa-corner': require('../../assets/call-backgrounds/modern-sofa-corner.jpg'),
  'reading-nook': require('../../assets/call-backgrounds/reading-nook.jpg'),
  'villa-terrace': require('../../assets/call-backgrounds/villa-terrace.jpg'),
  'contemporary-lounge': require('../../assets/call-backgrounds/contemporary-lounge.jpg'),
  'bookshelf-wall': require('../../assets/call-backgrounds/bookshelf-wall.jpg'),
  'plant-filled-room': require('../../assets/call-backgrounds/plant-filled-room.jpg'),
  'elegant-hallway-lounge': require('../../assets/call-backgrounds/elegant-hallway-lounge.jpg'),
};
