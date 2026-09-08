const zlib = require('zlib');

function decodeShareCode(code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error('PoB2 share code is empty');
  }

  const normalized = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
  const compressed = Buffer.from(padded, 'base64');

  let xml;
  try {
    // PoB2 build codes are raw DEFLATE streams. This is deliberately kept in
    // the Node/Electron host because PoB2's HeadlessWrapper does not implement
    // Inflate() in headless mode.
    xml = zlib.inflateRawSync(compressed);
  } catch (rawError) {
    // Be tolerant of zlib-wrapped data as well; some tooling around PoB codes
    // has historically produced that form.
    try {
      xml = zlib.inflateSync(compressed);
    } catch {
      throw new Error(`Invalid PoB2 share code: ${rawError.message}`);
    }
  }

  const xmlText = xml.toString('utf8');
  if (!xmlText.trim().startsWith('<')) {
    throw new Error('Invalid PoB2 share code: decoded payload is not XML');
  }
  return xmlText;
}

module.exports = { decodeShareCode };
