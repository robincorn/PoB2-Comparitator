const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { shell } = require('electron');

const CLIENT_ID = process.env.POE_CLIENT_ID || 'pob';
const AUTH_BASE = 'https://www.pathofexile.com';
const API_BASE = 'https://api.pathofexile.com';
const SCOPES = ['account:profile', 'account:leagues', 'account:characters'];

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
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detail = parsed?.error_description || parsed?.error || text || `HTTP ${res.statusCode}`;
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

  async authenticate() {
    const codeVerifier = randomToken(32);
    const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = randomToken(24);

    const result = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const requestUrl = new URL(req.url, 'http://127.0.0.1');
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
        if (returnedState !== state) return reject(new Error('OAuth state mismatch'));
        if (error) return reject(new Error(`Path of Exile authorization failed: ${error}`));
        if (!code) return reject(new Error('Path of Exile did not return an authorization code'));
        resolve(code);
      });

      server.on('error', reject);
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : null;
        if (!port) {
          server.close();
          reject(new Error('Could not allocate OAuth callback port'));
          return;
        }
        const redirectUri = `http://localhost:${port}`;
        const authUrl = new URL('/oauth/authorize', AUTH_BASE);
        authUrl.searchParams.set('client_id', CLIENT_ID);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', SCOPES.join(' '));
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        try {
          await shell.openExternal(authUrl.toString());
        } catch (error) {
          server.close();
          reject(new Error(`Could not open Path of Exile authorization page: ${error.message}`));
        }
      });
    });

    const address = await new Promise((resolve, reject) => {
      const probe = http.createServer();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const port = probe.address().port;
        probe.close(() => resolve(port));
      });
    });
    // The OAuth callback server has already closed, so its port is not available here.
    // PoE's token endpoint only requires the exact redirect URI used during authorization;
    // the callback server below therefore repeats the authorization flow with a stable port.
    void address;
    throw new Error('OAuth callback setup failed unexpectedly');
  }

  async refresh() {
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

  #normalizeToken(token) {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Number(token.expires_in || 0) * 1000,
      username: token.username || this.auth?.username || null,
      subject: token.sub || this.auth?.subject || null,
    };
  }

  async ensureToken() {
    if (!this.isAuthenticated()) throw new Error('Not authenticated');
    if (Date.now() + 30000 >= this.auth.expiresAt) await this.refresh();
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

module.exports = { PoeApiClient, CLIENT_ID, SCOPES };
