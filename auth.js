'use strict';

// Auth module — OAuth 2.0 Authorization Code + PKCE with refresh tokens.
//
// How it works:
//   connect()  — opens a popup for the one-time consent screen, exchanges the
//                auth code for an access token + refresh token, stores both.
//   getToken() — returns the stored access token if still valid; otherwise calls
//                the Google token endpoint directly (plain fetch, no popup, no
//                user interaction) using the stored refresh token.
//
// This replaces the previous GIS implicit-token approach, which required a
// hidden iframe / popup on every hourly renewal and broke without user interaction.
//
// Exposes: getToken(), connect(clientId, clientSecret), handleRedirect(),
//          getClientId(), setClientId(), getClientSecret(), setClientSecret(),
//          clearToken()
const Auth = (() => {
  const SCOPE             = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly';
  const CLIENT_ID_KEY     = 'wallcal_client_id';
  const CLIENT_SECRET_KEY = 'wallcal_client_secret';
  const TOKEN_KEY         = 'wallcal_access_token';
  const TOKEN_EXPIRY_KEY  = 'wallcal_token_expiry';
  const REFRESH_TOKEN_KEY = 'wallcal_refresh_token';
  const TOKEN_ENDPOINT    = 'https://oauth2.googleapis.com/token';

  let _pendingGetToken = null;

  // ── PKCE helpers ──────────────────────────────────────────────────────────

  function _generateVerifier() {
    const buf = new Uint8Array(48);
    crypto.getRandomValues(buf);
    return btoa(String.fromCharCode(...buf))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function _generateChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  function getClientId()      { return localStorage.getItem(CLIENT_ID_KEY)     || ''; }
  function setClientId(id)    { localStorage.setItem(CLIENT_ID_KEY, id.trim()); }
  function getClientSecret()  { return localStorage.getItem(CLIENT_SECRET_KEY) || ''; }
  function setClientSecret(s) { localStorage.setItem(CLIENT_SECRET_KEY, s.trim()); }

  function _saveTokens({ access_token, refresh_token, expires_in }) {
    const expiry = Date.now() + expires_in * 1000 - 60_000;
    localStorage.setItem(TOKEN_KEY, access_token);
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiry));
    if (refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, refresh_token);
    return access_token;
  }

  function _loadStoredToken() {
    const token  = localStorage.getItem(TOKEN_KEY);
    const expiry = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
    return (token && Date.now() < expiry) ? token : null;
  }

  // Clears only the short-lived access token. The refresh token is preserved so
  // the next getToken() call can silently obtain a new access token.
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  }

  // ── Silent refresh ────────────────────────────────────────────────────────

  async function _doRefresh() {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const clientId     = getClientId();
    if (!refreshToken || !clientId) return null;

    const params = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
    });
    const secret = getClientSecret();
    if (secret) params.set('client_secret', secret);

    const res = await fetch(TOKEN_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });

    if (!res.ok) {
      // Refresh token revoked or expired — user must reconnect via settings.
      if (res.status === 400 || res.status === 401) {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
      }
      return null;
    }

    return _saveTokens(await res.json());
  }

  // ── Public API ────────────────────────────────────────────────────────────

  // Returns a valid access token. If the stored token has expired, silently
  // refreshes it via the refresh token (a plain fetch — no popup required).
  async function getToken() {
    const stored = _loadStoredToken();
    if (stored) return stored;

    if (!getClientId()) return null;

    // Deduplicate concurrent callers so a single refresh request serves all.
    if (!_pendingGetToken) {
      _pendingGetToken = _doRefresh().finally(() => { _pendingGetToken = null; });
    }
    return _pendingGetToken;
  }

  // One-time setup: opens a popup OAuth consent screen, exchanges the resulting
  // auth code for an access token + long-lived refresh token, and stores both.
  async function connect(clientId, clientSecret) {
    setClientId(clientId);
    if (clientSecret) {
      setClientSecret(clientSecret);
    } else {
      localStorage.removeItem(CLIENT_SECRET_KEY);
    }

    const verifier   = _generateVerifier();
    const challenge  = await _generateChallenge(verifier);
    const redirectUri = window.location.origin + window.location.pathname.replace(/\/+$/, '');

    const authParams = new URLSearchParams({
      response_type:         'code',
      client_id:             clientId,
      redirect_uri:          redirectUri,
      scope:                 SCOPE,
      access_type:           'offline',
      prompt:                'consent',
      code_challenge:        challenge,
      code_challenge_method: 'S256',
    });

    const popup = window.open(
      'https://accounts.google.com/o/oauth2/v2/auth?' + authParams,
      'wallcal_oauth',
      'width=520,height=640,menubar=no,toolbar=no,location=no,status=no',
    );
    if (!popup) {
      const err = new Error('Popup blocked — please allow popups for this page and try again.');
      err.code = 'popup_blocked';
      throw err;
    }

    // Wait for the popup to post back the auth code via handleRedirect().
    const code = await new Promise((resolve, reject) => {
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollTimer);
          window.removeEventListener('message', handler);
          reject(new Error('Authorization was cancelled.'));
        }
      }, 500);

      function handler(event) {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== 'wallcal_oauth_code') return;
        clearInterval(pollTimer);
        window.removeEventListener('message', handler);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.code);
      }
      window.addEventListener('message', handler);
    });

    // Exchange the auth code for access + refresh tokens.
    const tokenParams = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      code_verifier: verifier,
    });
    if (clientSecret) tokenParams.set('client_secret', clientSecret);

    const res = await fetch(TOKEN_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    tokenParams.toString(),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error_description || `Token exchange failed (${res.status})`);
    }

    return _saveTokens(await res.json());
  }

  // Call this as early as possible on page load. If this page is the OAuth
  // redirect target inside the popup, it posts the auth code back to the opener
  // and closes itself — the rest of the app never initialises in that case.
  // Returns true if handled (window will close), false otherwise.
  function handleRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const error  = params.get('error');
    if (!code && !error) return false;

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: 'wallcal_oauth_code', code: code || null, error: error || null },
        window.location.origin,
      );
      window.close();
      return true;
    }

    // Not in a popup (e.g. popup was blocked and user was redirected in the main
    // window). Remove the OAuth params and let the app load normally; the user
    // will need to click Connect again.
    window.history.replaceState({}, '', window.location.pathname);
    return false;
  }

  return {
    getToken, connect, handleRedirect,
    getClientId, setClientId, getClientSecret, setClientSecret, clearToken,
  };
})();
