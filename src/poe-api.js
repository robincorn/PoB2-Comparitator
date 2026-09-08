const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { shell } = require('electron');

const CLIENT_ID = process.env.POE_CLIENT_ID || '';
const CLIENT_VERSION = process.env.POE_CLIENT_VERSION || '0.1.0';
const CONTACT = process.env.POE_CONTACT || 'configure-contact@example.invalid';
const USER_AGENT = `OAuth ${CLIENT_ID || 'unconfigured'}/${CLIENT_VERSION} (contact: ${CONTACT}) PoB2-Comparitator`;
const AUTH_BASE = 'https://www.pathofexile.com';
const API_BASE = 'https://api.pathofexile.com';
const REDIRECT_HOST = '127.0.0.1';
const REDIRECT_PORT = 47831;
const REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}/callback`;
const SCOPES = ['account:profile', 'account:leagues', 'account:characters'];

function requireClientId() {
  if (!CLIENT_ID) {
    throw new Error('PoE OAuth is not configured. Set POE_CLIENT_ID to our registered public client ID. The PoB client ID is intentionally not supported.');
  }
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detail = parsed?.error_description || parsed?.error?.message || parsed?.error || text || `HTTP ${res.statusCode}`;
          reject(new Error(`${res.statusCode}: ${detail}`));
          return;
        }
        resolve(parsed ?? text);
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('Path of Exile request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function formEncode(values) {
  return Object.entries(values)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

class PoeApiClient {
  constructor(auth = null) {
    this.auth = auth || null;
  }

  isAuthenticated() {
    return Boolean(this.auth?.accessToken && this.auth?.refreshToken);
  }

  #normalizeToken(token) {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Number(token.expires_in || 0) * 1000,
      username: token.username || this.auth?.username || null,
      subject: token.sub || this.auth?.subject || null,
    };
  }

  async authenticate() {
    requireClientId();
    const codeVerifier = randomToken(32);
    const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = randomToken(24);

    const { code } = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      const server = http.createServer((req, res) => {
        const requestUrl = new URL(req.url, REDIRECT_URI);
        if (requestUrl.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const returnedState = requestUrl.searchParams.get('state');
        const code = requestUrl.searchParams.get('code');
        const error = requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>PoB2 Comparitator</title><p>Authorization complete. You can close this window.</p>');
        server.close();
        if (returnedState !== state) return finish(reject, new Error('OAuth state mismatch'));
        if (error) return finish(reject, new Error(`Path of Exile authorization failed: ${error}`));
        if (!code) return finish(reject, new Error('Path of Exile did not return an authorization code'));
        finish(resolve, { code });
      });

      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          finish(reject, new Error(`OAuth callback port ${REDIRECT_PORT} is already in use.`));
        } else {
          finish(reject, error);
        }
      });
      server.listen(REDIRECT_PORT, REDIRECT_HOST, async () => {
        const authUrl = new URL('/oauth/authorize', AUTH_BASE);
        authUrl.searchParams.set('client_id', CLIENT_ID);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', SCOPES.join(' '));
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        try {
          await shell.openExternal(authUrl.toString());
        } catch (error) {
          server.close();
          finish(reject, new Error(`Could not open Path of Exile authorization page: ${error.message}`));
        }
      });
    });

    const body = formEncode({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES.join(' '),
      code_verifier: codeVerifier,
    });
    const token = await request(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, body);
    this.auth = this.#normalizeToken(token);
    return this.auth;
  }

  async refresh() {
    requireClientId();
    if (!this.auth?.refreshToken) throw new Error('Not authenticated');
    const body = formEncode({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: this.auth.refreshToken,
    });
    const token = await request(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, body);
    this.auth = this.#normalizeToken(token);
    return this.auth;
  }

  async ensureToken() {
    if (!this.isAuthenticated()) throw new Error('Not authenticated');
    if (!this.auth.expiresAt || Date.now() + 30000 >= this.auth.expiresAt) await this.refresh();
    return this.auth.accessToken;
  }

  async apiGet(path) {
    let token = await this.ensureToken();
    try {
      return await request(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      if (!String(error.message).startsWith('401:')) throw error;
      await this.refresh();
      token = this.auth.accessToken;
      return request(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    }
  }

  async listCharacters() {
    const response = await this.apiGet('/character/poe2');
    return Array.isArray(response?.characters) ? response.characters : [];
  }

  async getCharacter(name) {
    const response = await this.apiGet(`/character/poe2/${encodeURIComponent(name)}`);
    if (!response?.character) throw new Error('Path of Exile returned no character data');
    return response.character;
  }
}

module.exports = { PoeApiClient, CLIENT_ID, SCOPES, REDIRECT_URI };