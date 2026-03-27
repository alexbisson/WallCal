'use strict';

// Auth module — OAuth flow, token storage, silent re-auth.
// Exposes: getToken(), connect(clientId), getClientId(), setClientId(id), clearToken()
const Auth = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly';
  const CLIENT_ID_KEY = 'wallcal_client_id';
  const TOKEN_KEY = 'wallcal_access_token';
  const TOKEN_EXPIRY_KEY = 'wallcal_token_expiry';

  let tokenClient = null;
  let pendingResolve = null;
  let pendingReject = null;
  let _pendingGetToken = null;

  // ── Storage ──────────────────────────────────────────────────────────────

  function getClientId() {
    return localStorage.getItem(CLIENT_ID_KEY) || '';
  }

  function setClientId(id) {
    localStorage.setItem(CLIENT_ID_KEY, id.trim());
  }

  function _saveToken(response) {
    const token = response.access_token;
    // Refresh 1 minute before actual expiry to avoid races
    const expiry = Date.now() + response.expires_in * 1000 - 60_000;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiry));
    return token;
  }

  function _loadStoredToken() {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiry = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
    if (token && Date.now() < expiry) {
      return token;
    }
    return null;
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  }

  // ── GIS token client ──────────────────────────────────────────────────────

  function _handleCallback(response) {
    if (response.error) {
      const reject = pendingReject;
      pendingResolve = null;
      pendingReject = null;
      if (reject) reject(new Error(response.error));
      return;
    }
    const token = _saveToken(response);
    const resolve = pendingResolve;
    pendingResolve = null;
    pendingReject = null;
    if (resolve) resolve(token);
  }

  function _handleErrorCallback(err) {
    const reject = pendingReject;
    pendingResolve = null;
    pendingReject = null;
    if (reject) reject(new Error(err && err.type ? err.type : 'popup_failed_to_open'));
  }

  function _ensureTokenClient(clientId) {
    if (!tokenClient || tokenClient._clientId !== clientId) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: _handleCallback,
        error_callback: _handleErrorCallback,
      });
      tokenClient._clientId = clientId;
    }
  }

  function _requestToken(prompt) {
    return new Promise((resolve, reject) => {
      pendingResolve = resolve;
      pendingReject = reject;
      tokenClient.requestAccessToken({ prompt });
    });
  }

  // Polls until the GIS library is available, or times out.
  function _waitForGIS(timeout = 15_000) {
    if (typeof google !== 'undefined' && google.accounts) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeout;
      const interval = setInterval(() => {
        if (typeof google !== 'undefined' && google.accounts) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(interval);
          reject(new Error('Google Identity Services failed to load'));
        }
      }, 200);
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  // Returns a valid access token, attempting silent re-auth if stored token
  // is missing or expired. Returns null if unauthenticated and can't re-auth.
  // Concurrent callers share one in-flight request so a single GIS callback
  // resolves all of them (fixes the parallel-fetch overwrite bug).
  async function getToken() {
    const stored = _loadStoredToken();
    if (stored) return stored;

    const clientId = getClientId();
    if (!clientId) return null;

    if (_pendingGetToken) return _pendingGetToken;

    _pendingGetToken = (async () => {
      try {
        await _waitForGIS();
      } catch (_) {
        return null; // GIS unavailable; next refresh cycle will retry
      }

      _ensureTokenClient(clientId);

      try {
        // Empty prompt = use existing Google session cookie; no user interaction.
        return await _requestToken('');
      } catch (_) {
        return null;
      }
    })().finally(() => { _pendingGetToken = null; });

    return _pendingGetToken;
  }

  // Triggers the full OAuth consent screen. Called from the settings panel.
  async function connect(clientId) {
    setClientId(clientId);
    tokenClient = null; // force re-init with (possibly new) client ID
    await _waitForGIS();
    _ensureTokenClient(clientId);
    return _requestToken('consent');
  }

  return { getToken, connect, getClientId, setClientId, clearToken };
})();
