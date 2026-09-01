const KMA_LIST_FIELDS = ["item", "date", "tm", "time", "filename", "fileName", "name", "path"];

export function findLatestKmaTimestamp(payload) {
  const parsed = parseKmaListPayload(payload);
  if (parsed && Array.isArray(parsed.list)) {
    return parsed.list.map(extractKmaListTimestamp).filter(Boolean).sort().at(-1) ?? null;
  }
  return typeof payload === "string" ? extractKmaFilenameTimestamp(payload) : null;
}

function parseKmaListPayload(payload) {
  if (payload && typeof payload === "object") return payload;
  if (typeof payload !== "string") return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractKmaListTimestamp(item) {
  if (typeof item === "string") return extractKmaFilenameTimestamp(item);
  if (!item || typeof item !== "object") return null;
  for (const field of KMA_LIST_FIELDS) {
    const timestamp = extractKmaFilenameTimestamp(item[field]);
    if (timestamp) return timestamp;
  }
  return null;
}

function extractKmaFilenameTimestamp(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^20\d{10}$/.test(trimmed)) return trimmed;
  return trimmed.match(/(?:^|[/_-])(20\d{10})(?:[_.-][A-Za-z0-9-]+)*\.(?:png|jpg|jpeg|nc|bin)$/i)?.[1] ?? null;
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
