export function findLatestKmaTimestamp(text) {
  return (String(text).match(/20\d{10}/g) ?? []).sort().at(-1) ?? null;
}

export function isPng(buffer) {
  return buffer.length >= 24
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47;
}

export function readPngDimensions(buffer) {
  if (!isPng(buffer)) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
