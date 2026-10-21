export const OWNER = "b605d98f-498e-4a94-94cf-e055ed2b5fcc";
export function normalizeEin(value) {
  if (!value?.trim()) return "";
  const digits = value.replace(/[-\s]/g, "");
  if (!/^\d{9}$/.test(digits)) throw new Error("EIN must contain nine digits.");
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}
export function maskEin(value) {
  return value ? `••-•••${normalizeEin(value).slice(-4)}` : "Not recorded";
}
export function packetReason(
  record,
  today = new Date().toISOString().slice(0, 10),
) {
  const d = record.data;
  if (record.archived) return "Archived";
  if (
    d.status !== "ready" ||
    !d.object_path ||
    !/^[a-f0-9]{64}$/.test(d.sha256 || "")
  )
    return "Upload incomplete";
  if (!d.executed) return "Not executed";
  if (!d.current) return "Not current";
  if (d.expires_on && d.expires_on < today) return "Expired";
  return "";
}
export function reviewPacket(documents, ids, reviewed, today) {
  if (!ids.length) throw new Error("Select at least one eligible document.");
  if (!reviewed)
    throw new Error("Confirm your review before creating a packet.");
  return [...new Set(ids)].map((id) => {
    const d = documents.find((d) => d.id === id);
    if (!d || packetReason(d, today))
      throw new Error(
        "Document selection changed or is no longer eligible. Review again.",
      );
    return d;
  });
}
export function safeFilename(name) {
  const clean = String(name)
    .split(/[\\/]/)
    .pop()
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/^\.+/, "") || "document";
  if (clean.length <= 120) return clean;
  const extension = clean.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0] || "";
  return clean.slice(0, 120 - extension.length) + extension;
}
export function packetFilename(index, filename) {
  return safeFilename(`${String(index).padStart(2, "0")}-${safeFilename(filename)}`);
}
function crc32(bytes) {
  let crc = -1;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
// ZIP32, STORE method. Deliberately bounded; no compression dependency or external service.
export function zipStore(files) {
  if (files.length > 100) throw new Error("Packet limit: 100 files.");
  const enc = new TextEncoder(),
    locals = [],
    centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(safeFilename(f.name)),
      bytes = f.bytes,
      crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length + bytes.length),
      v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, bytes.length, true);
    v.setUint32(22, bytes.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(bytes, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length),
      c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, bytes.length, true);
    c.setUint32(24, bytes.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
    if (offset > 100 * 1024 * 1024) throw new Error("Packet limit: 100 MB.");
  }
  const size = centrals.reduce((a, b) => a + b.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
