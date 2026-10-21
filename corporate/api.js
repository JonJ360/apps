import { OWNER, safeFilename, sha256 } from "./core.js";
import { KINDS } from "./schema.js";
const session = () => window.Shared360Session;
function unwrap({ data, error }) {
  if (error) throw new Error(error.message || "Request failed");
  return data;
}
export async function identity() {
  const result = await session().current();
  if (result?.user?.id !== OWNER)
    throw new Error(
      "This private register is restricted to Jon’s verified 360 identity. Sign in through AR or Asset Register, then return here.",
    );
  return result.user;
}
export async function list(kind, { entityId } = {}) {
  if (![...KINDS, "activity"].includes(kind))
    throw new Error("Unsupported register");
  const all = [];
  for (let from = 0; from < 20000; from += 500) {
    let q = session()
      .client.from(`cc_${kind}`)
      .select("*")
      .order(kind === "activity" ? "id" : "created_at", {
        ascending: kind !== "activity",
      })
      .order("id", { ascending: true })
      .range(from, from + 499);
    if (entityId) q = q.eq("entity_id", entityId);
    const rows = unwrap(await q);
    all.push(...rows);
    if (rows.length < 500) return all;
  }
  throw new Error(
    "Register exceeds the 20,000 row interactive safety limit. No partial results shown; contact your administrator.",
  );
}
export async function loadAll() {
  await identity();
  return Object.fromEntries(
    await Promise.all(KINDS.map(async (k) => [k, await list(k)])),
  );
}
export async function save(
  kind,
  data,
  record = null,
  archived = record?.archived || false,
  explicitId = null,
) {
  await identity();
  const saved = unwrap(
    await session().client.rpc("cc_save", {
      p_kind: kind,
      p_id: record?.id || explicitId,
      p_expected_version: record?.version || 0,
      p_data: data,
      p_archived: archived,
    }),
  );
  // Exact target readback; do not claim a write based only on RPC success.
  const actual = unwrap(
    await session()
      .client.from(`cc_${kind}`)
      .select("*")
      .eq("id", saved.id)
      .single(),
  );
  if (
    !actual ||
    actual.version !== saved.version ||
    actual.archived !== saved.archived ||
    JSON.stringify(actual.data) !== JSON.stringify(saved.data)
  )
    throw new Error(
      "Save returned, but verification found a concurrent change. Reload before continuing.",
    );
  return actual;
}
const mimeByExt = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export async function upload(data, file, prior = null) {
  await identity();
  if (!file || file.size < 1 || file.size > 25 * 1024 * 1024)
    throw new Error("Choose a non-empty document up to 25 MB.");
  const mime = mimeByExt[file.name.split(".").pop().toLowerCase()];
  if (!mime) throw new Error("Allowed: PDF, PNG, JPEG, TXT, DOCX, XLSX.");
  const bytes = await file.arrayBuffer(),
    hash = await sha256(bytes),
    id = crypto.randomUUID();
  const filename =
    safeFilename(file.name).replace(/^[^a-zA-Z0-9]+/, "") || "document";
  const path = `${OWNER}/${id}/${filename}`;
  const current = !!data.current;
  let row = await save(
    "documents",
    {
      ...data,
      filename,
      mime,
      bytes: file.size,
      object_path: path,
      family_id: prior?.data.family_id || crypto.randomUUID(),
      file_version: prior ? Number(prior.data.file_version) + 1 : 1,
      sha256: hash,
      status: "pending",
      current: false,
    },
    null,
    false,
    id,
  );
  try {
    unwrap(
      await session()
        .client.storage.from("cc-private")
        .upload(path, new Blob([bytes], { type: mime }), {
          contentType: mime,
          upsert: false,
          cacheControl: "0",
        }),
    );
    const stored = unwrap(
      await session().client.storage.from("cc-private").download(path),
    );
    if ((await sha256(await stored.arrayBuffer())) !== hash)
      throw new Error("Uploaded content failed SHA-256 readback verification.");
    row = await save(
      "documents",
      { ...row.data, status: "ready", sha256: hash, current },
      row,
    );
    return row;
  } catch (error) {
    // Preserve pending metadata when finalization failed; don't hide an uploaded object.
    throw new Error(
      `Upload did not finish: ${error.message}. Pending document ${id} is retained; use Retry finalization with the original file or archive it.`,
    );
  }
}
export async function finalize(record, file) {
  if (record.data.status !== "pending")
    throw new Error("Only pending documents can be finalized.");
  if (!file || file.size !== record.data.bytes)
    throw new Error("Choose the original file with the recorded size.");
  const hash = await sha256(await file.arrayBuffer());
  if (hash !== record.data.sha256)
    throw new Error(
      "The selected file is not the original registered content.",
    );
  const stored = unwrap(
    await session()
      .client.storage.from("cc-private")
      .download(record.data.object_path),
  );
  if ((await sha256(await stored.arrayBuffer())) !== hash)
    throw new Error(
      "Stored content differs from the registered original. Finalization blocked.",
    );
  return save(
    "documents",
    { ...record.data, status: "ready", sha256: hash, current: false },
    record,
  );
}
export async function download(record) {
  await identity();
  if (record.data.status !== "ready") throw new Error("Upload is not ready.");
  const blob = unwrap(
    await session()
      .client.storage.from("cc-private")
      .download(record.data.object_path),
  );
  const bytes = await blob.arrayBuffer();
  if ((await sha256(bytes)) !== record.data.sha256)
    throw new Error(
      "Document hash mismatch. Export blocked; investigate the stored object.",
    );
  await identity();
  return new Blob([bytes], { type: record.data.mime });
}
export async function signedLink(record) {
  await identity();
  if (record.data.status !== "ready" || record.archived)
    throw new Error("Only active, ready documents can be linked.");
  return unwrap(
    await session()
      .client.storage.from("cc-private")
      .createSignedUrl(record.data.object_path, 60, {
        download: record.data.filename,
      }),
  ).signedUrl;
}
