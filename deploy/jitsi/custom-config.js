// ---- SampConnect settings (appended to Jitsi's config.js by the container) ----
// Calls are started from SampConnect, which signs every join (JWT), so Jitsi's own welcome
// page, invite dialogs and app promotion are turned off.
config.disableDeepLinking = true;
config.welcomePage = { disabled: true };
config.prejoinConfig = { enabled: false };
config.disableInviteFunctions = true;
config.doNotStoreRoom = true;
config.hideConferenceSubject = true; // SampConnect shows the conversation's name above the call
config.defaultLogoUrl = 'images/watermark.svg';
config.defaultLanguage = 'en';
// Nothing leaves your servers: no gravatar, no analytics, no public STUN, no peer-to-peer
// (every call goes through your own videobridge), no GIPHY.
config.disableThirdPartyRequests = true;
config.analytics = { disabled: true };
config.p2p = { enabled: false };
config.giphy = { enabled: false };
config.feedbackPercentage = 0;
config.disableProfile = true;
config.readOnlyName = true;
config.enableEmailInStats = false;
config.deploymentUrls = {};
// SampConnect handles invites, recording and help; keep the call controls people need.
config.toolbarButtons = [
  'microphone',
  'camera',
  'desktop',
  'chat',
  'raisehand',
  'reactions',
  'participants-pane',
  'tileview',
  'select-background',
  'noisesuppression',
  'videoquality',
  'fullscreen',
  'toggle-camera',
  'settings',
  'shortcuts',
  'hangup',
];
config.legalUrls = {};
// Connect back to whichever address the page was opened on (https → wss, http → ws), so the
// same server works behind your TLS proxy and on http://localhost for a local try-out.
config.bosh = '/' + subdir + 'http-bind';
config.websocket =
  (location.protocol === 'https:' ? 'wss://' : 'ws://') +
  location.host +
  '/' +
  subdir +
  'xmpp-websocket';
