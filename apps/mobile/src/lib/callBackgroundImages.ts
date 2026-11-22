import type { CallBackgroundPresetId } from '@sampledge/contracts';

/**
 * The prebuilt call backgrounds at full size (1280x720, copied from apps/web/public/backgrounds),
 * bundled so the phone's camera can put them behind you even with no connection.
 */
export const PRESET_IMAGES: Record<CallBackgroundPresetId, number> = {
  'modern-office': require('../../assets/call-backgrounds/full/modern-office.jpg'),
  'executive-office': require('../../assets/call-backgrounds/full/executive-office.jpg'),
  'glass-meeting-room': require('../../assets/call-backgrounds/full/glass-meeting-room.jpg'),
  boardroom: require('../../assets/call-backgrounds/full/boardroom.jpg'),
  'open-plan-office': require('../../assets/call-backgrounds/full/open-plan-office.jpg'),
  'coworking-loft': require('../../assets/call-backgrounds/full/coworking-loft.jpg'),
  'library-study': require('../../assets/call-backgrounds/full/library-study.jpg'),
  'reception-lobby': require('../../assets/call-backgrounds/full/reception-lobby.jpg'),
  'office-lounge': require('../../assets/call-backgrounds/full/office-lounge.jpg'),
  'skyline-office': require('../../assets/call-backgrounds/full/skyline-office.jpg'),
  'minimal-workspace': require('../../assets/call-backgrounds/full/minimal-workspace.jpg'),
  'green-office': require('../../assets/call-backgrounds/full/green-office.jpg'),
  'luxury-living-room': require('../../assets/call-backgrounds/full/luxury-living-room.jpg'),
  'penthouse-view': require('../../assets/call-backgrounds/full/penthouse-view.jpg'),
  'home-study': require('../../assets/call-backgrounds/full/home-study.jpg'),
  'scandinavian-living': require('../../assets/call-backgrounds/full/scandinavian-living.jpg'),
  'fireplace-lounge': require('../../assets/call-backgrounds/full/fireplace-lounge.jpg'),
  'modern-sofa-corner': require('../../assets/call-backgrounds/full/modern-sofa-corner.jpg'),
  'reading-nook': require('../../assets/call-backgrounds/full/reading-nook.jpg'),
  'villa-terrace': require('../../assets/call-backgrounds/full/villa-terrace.jpg'),
  'contemporary-lounge': require('../../assets/call-backgrounds/full/contemporary-lounge.jpg'),
  'bookshelf-wall': require('../../assets/call-backgrounds/full/bookshelf-wall.jpg'),
  'plant-filled-room': require('../../assets/call-backgrounds/full/plant-filled-room.jpg'),
  'elegant-hallway-lounge': require('../../assets/call-backgrounds/full/elegant-hallway-lounge.jpg'),
};
