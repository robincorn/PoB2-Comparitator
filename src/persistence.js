const fs = require('fs');
const path = require('path');

class Persistence {
  constructor(app, safeStorage) {
    this.root = path.join(app.getPath('userData'), 'state');
    this.snapshotDir = path.join(this.root, 'snapshots');
    this.authFile = path.join(this.root, 'auth.bin');
    this.stateFile = path.join(this.root, 'state.json');
    this.safeStorage = safeStorage;
    fs.mkdirSync(this.snapshotDir, { recursive: true });
  }

  readState() {
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); }
    catch { return {}; }
  }

  writeState(state) {
    fs.mkdirSync(this.root, { recursive: true });
    const temp = `${this.stateFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temp, this.stateFile);
  }

  loadAuth() {
    if (!this.safeStorage?.isEncryptionAvailable()) return null;
    try {
      const encrypted = fs.readFileSync(this.authFile);
      return JSON.parse(this.safeStorage.decryptString(encrypted));
    } catch {
      return null;
    }
  }

  saveAuth(auth) {
    if (!auth) return this.clearAuth();
    if (!this.safeStorage?.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable; refusing to store the Path of Exile refresh token.');
    const encrypted = this.safeStorage.encryptString(JSON.stringify(auth));
    fs.writeFileSync(this.authFile, encrypted);
  }

  clearAuth() {
    try { fs.unlinkSync(this.authFile); } catch { /* already absent */ }
  }

  saveCharacterSelection(character) {
    const state = this.readState();
    state.character = {
      name: character.name,
      league: character.league,
      class: character.class,
      level: character.level,
      snapshotFile: state.character?.snapshotFile || null,
      lastSync: state.character?.lastSync || null,
    };
    this.writeState(state);
  }

  saveSnapshot(character) {
    const safeName = String(character.name || 'character').replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${safeName}.json`;
    const filePath = path.join(this.snapshotDir, fileName);
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(character), 'utf8');
    fs.renameSync(temp, filePath);

    const state = this.readState();
    state.character = {
      ...(state.character || {}),
      name: character.name,
      league: character.league,
      class: character.class,
      level: character.level,
      snapshotFile: fileName,
      lastSync: new Date().toISOString(),
    };
    this.writeState(state);
    return filePath;
  }

  loadSnapshot() {
    const state = this.readState();
    const fileName = state.character?.snapshotFile;
    if (!fileName) return null;
    try { return JSON.parse(fs.readFileSync(path.join(this.snapshotDir, fileName), 'utf8')); }
    catch { return null; }
  }

  getCharacterState() {
    return this.readState().character || null;
  }

  clearCharacter() {
    const state = this.readState();
    delete state.character;
    this.writeState(state);
  }
}

module.exports = { Persistence };
