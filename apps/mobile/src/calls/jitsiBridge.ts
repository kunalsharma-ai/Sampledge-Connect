/**
 * Runs inside the Jitsi page on the phone (WebView). Jitsi's external API posts its events to
 * `window.parent`, which for a top-level page is the page itself: this answers Jitsi's
 * "__ready__" handshake once per id and forwards event names to the app.
 */
export const JITSI_BRIDGE_SCRIPT = `(function () {
  if (window.__sampconnectBridge) return;
  window.__sampconnectBridge = true;
  var echoed = {};
  window.addEventListener('message', function (e) {
    var m = e.data;
    try { if (typeof m === 'string') m = JSON.parse(m); } catch (_) { return; }
    if (!m || m.postis !== true || typeof m.scope !== 'string') return;
    if (m.scope.indexOf('jitsi_meet_external_api') !== 0) return;
    if (m.method === '__ready__') {
      if (echoed[m.params]) return;
      echoed[m.params] = true;
      window.postMessage(JSON.stringify({ postis: true, scope: m.scope, method: '__ready__', params: m.params }), '*');
      return;
    }
    if (m.method === 'message' && m.params && m.params.type === 'event') {
      var name = (m.params.data && m.params.data.name) || m.params.name;
      if (name && window.ReactNativeWebView)
        window.ReactNativeWebView.postMessage(JSON.stringify({ sampconnect: 'jitsi', event: name }));
    }
  });
})(); true;`;

/** Reads a message the bridge sent; the Jitsi event name, or null. */
export function bridgeEvent(data: string): string | null {
  try {
    const m = JSON.parse(data) as { sampconnect?: unknown; event?: unknown };
    return m.sampconnect === 'jitsi' && typeof m.event === 'string' ? m.event : null;
  } catch {
    return null;
  }
}
