import * as api from "./api.js";
import { SCHEMA } from "./schema.js";
import { OWNER, sha256 } from "./core.js";
const MiB = 1024 * 1024;
const kinds = new Set([
  "entities",
  "people",
  "groups",
  "memberships",
  "roles",
  "ownership",
  "obligations",
  "insurance",
]);
const mime = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const fail = (message) => {
  throw new Error(message);
};
function object(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("Object required");
}
function keys(v, allowed, required = allowed) {
  object(v);
  if (
    Object.keys(v).some((k) => !allowed.includes(k)) ||
    required.some((k) => !Object.hasOwn(v, k))
  )
    fail("Unknown or missing keys");
}
function date(v) {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    v.slice(0, 4) !== "0000" &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
  );
}
function dataFields(kind, data) {
  object(data);
  const fields = SCHEMA[kind].fields.filter((f) => f.type !== "ref");
  keys(
    data,
    fields.map((f) => f.key),
    fields.filter((f) => f.required).map((f) => f.key),
  );
  for (const [k, v] of Object.entries(data)) {
    const f = fields.find((f) => f.key === k);
    if (f.type === "checkbox") {
      if (typeof v !== "boolean") fail(`Boolean required: ${k}`);
    } else if (f.type === "number") {
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < f.min ||
        v > f.max
      )
        fail(`Invalid number: ${k}`);
    } else if (typeof v !== "string" || v.length > 10000 || !v.trim())
      fail(`Non-empty text required: ${k}`);
    if (f.type === "date" && !date(v)) fail(`Invalid date: ${k}`);
    if (f.options && !f.options.includes(v)) fail(`Invalid option: ${k}`);
    if (k === "ein" && !/^\d{2}-\d{7}$/.test(v)) fail("Invalid EIN");
    if (k === "fiscal_year_end" && !date(`2000-${v}`))
      fail("Invalid fiscal year end");
  }
  if (data.ends_on && data.starts_on && data.ends_on < data.starts_on)
    fail("End date precedes start date");
  if (
    kind === "obligations" &&
    data.status === "complete" &&
    !data.completed_on
  )
    fail("Completion date required");
}
async function stableId(kind, key) {
  const hash = await sha256(
    new TextEncoder().encode(
      `360-corporate-reviewed-intake-v1\0${kind}\0${key}`,
    ),
  );
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function prepareIntake(input) {
  const serialized = JSON.stringify(input);
  if (new TextEncoder().encode(serialized).length > 50 * MiB)
    fail("JSON exceeds 50 MiB");
  // Detach caller-owned objects before any await; no reviewed payload mutation.
  const bundle = JSON.parse(serialized);
  keys(bundle, ["version", "records", "documents"]);
  if (
    bundle.version !== 1 ||
    !Array.isArray(bundle.records) ||
    !Array.isArray(bundle.documents)
  )
    fail("Invalid intake version or arrays");
  if (bundle.records.length + bundle.documents.length > 250)
    fail("Maximum 250 entries");
  const entries = [],
    byKey = new Map();
  let total = 0;
  for (const r of bundle.records) {
    keys(r, ["key", "kind", "data", "links"]);
    if (!kinds.has(r.kind)) fail("Unsupported record kind");
    dataFields(r.kind, r.data);
    object(r.links);
    const refs = SCHEMA[r.kind].fields.filter((f) => f.type === "ref");
    keys(
      r.links,
      refs.map((f) => f.key),
      refs.filter((f) => f.required).map((f) => f.key),
    );
    if (
      r.kind === "ownership" &&
      (!!r.links.person_id === !!r.links.owner_entity_id ||
        r.links.owner_entity_id === r.links.entity_id)
    )
      fail("Choose exactly one different owner");
    entries.push({ ...r, refs });
  }
  for (const d of bundle.documents) {
    keys(d, [
      "key",
      "entityKey",
      "filename",
      "mime",
      "base64",
      "sha256",
      "data",
    ]);
    dataFields("documents", d.data);
    if (
      typeof d.data.executed !== "boolean" ||
      typeof d.data.current !== "boolean"
    )
      fail("Explicit executed/current required");
    if (
      typeof d.filename !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/.test(d.filename) ||
      mime[d.filename.split(".").pop().toLowerCase()] !== d.mime
    )
      fail("Invalid filename or MIME");
    if (
      typeof d.base64 !== "string" ||
      d.base64.length > Math.ceil((25 * MiB) / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        d.base64,
      )
    )
      fail("Invalid base64");
    const raw = atob(d.base64);
    if (btoa(raw) !== d.base64) fail("Noncanonical base64");
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    total += bytes.length;
    if (!bytes.length || bytes.length > 25 * MiB || total > 35 * MiB)
      fail("Document size limit exceeded");
    if (
      typeof d.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(d.sha256) ||
      (await sha256(bytes)) !== d.sha256
    )
      fail("Document SHA-256 mismatch");
    entries.push({
      key: d.key,
      kind: "documents",
      data: d.data,
      links: { entity_id: d.entityKey },
      refs: [{ key: "entity_id", ref: "entities" }],
      document: d,
      bytes,
    });
  }
  for (const e of entries) {
    if (
      typeof e.key !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(e.key) ||
      byKey.has(e.key)
    )
      fail("Invalid or duplicate key");
    e.id = await stableId(e.kind, e.key);
    byKey.set(e.key, e);
  }
  for (const e of entries) {
    e.dependencies = [];
    for (const [field, key] of Object.entries(e.links)) {
      const target = byKey.get(key),
        ref = e.refs.find((f) => f.key === field);
      if (typeof key !== "string" || !target || target.kind !== ref.ref)
        fail(`Invalid link: ${e.key}.${field}`);
      e.dependencies.push(key);
      e.data[field] = target.id;
    }
    if (
      e.links.evidence_id &&
      byKey.get(e.links.evidence_id).links.entity_id !== e.links.entity_id
    )
      fail("Evidence entity mismatch");
    if (e.kind === "documents") {
      const d = e.document;
      Object.assign(e.data, {
        filename: d.filename,
        mime: d.mime,
        bytes: e.bytes.length,
        sha256: d.sha256,
        object_path: `${OWNER}/${e.id}/${d.filename}`,
        family_id: e.id,
        file_version: 1,
        status: "ready",
      });
    }
    if (new TextEncoder().encode(JSON.stringify(e.data)).length > 60000)
      fail("Record data exceeds safety limit");
  }
  const ordered = [],
    visiting = new Set(),
    done = new Set();
  function visit(e) {
    if (done.has(e.key)) return;
    if (visiting.has(e.key)) fail("Dependency cycle");
    visiting.add(e.key);
    for (const key of e.dependencies) visit(byKey.get(key));
    visiting.delete(e.key);
    done.add(e.key);
    ordered.push(e);
  }
  for (const e of entries) visit(e);
  return ordered;
}
function same(a, b) {
  if (!a || !b) return a === b;
  const ak = Object.keys(a).sort(),
    bk = Object.keys(b).sort();
  return (
    JSON.stringify(ak) === JSON.stringify(bk) && ak.every((k) => a[k] === b[k])
  );
}
function exact(row, e, data = e.data) {
  return (
    row && row.id === e.id && row.archived === false && same(row.data, data)
  );
}
export async function runIntake(bundle, io = api, allowed = () => true) {
  const entries = await prepareIntake(bundle),
    results = [],
    successful = new Set();
  for (const e of entries) {
    try {
      if (!allowed()) fail("Session changed; select the original bundle again");
      await io.identity();
      if (e.dependencies.some((k) => !successful.has(k)))
        fail("Blocked by failed dependency");
      // Recheck exact dependency targets immediately before each mutation.
      for (const k of e.dependencies) {
        const dep = entries.find((x) => x.key === k);
        if (!exact(await io.read(dep.kind, dep.id), dep))
          fail("Dependency changed; no write attempted");
      }
      let row = await io.read(e.kind, e.id),
        status = "created";
      if (e.kind !== "documents") {
        if (row) {
          if (!exact(row, e)) fail("Existing row conflict; never overwritten");
          status = "skipped";
        } else {
          if (!allowed()) fail("Session changed");
          await io.save(e.kind, e.data, null, false, e.id);
        }
      } else {
        const pending = { ...e.data, status: "pending", current: false };
        const ready = exact(row, e);
        if (row && !ready && !exact(row, e, pending))
          fail("Existing document conflict; never overwritten");
        if (!row) {
          if (!allowed()) fail("Session changed");
          row = await io.save("documents", pending, null, false, e.id);
        }
        let bytes = await io.readObject(e.data.object_path);
        if (!bytes) {
          if (ready) fail("Ready object missing; no replacement allowed");
          if (!allowed()) fail("Session changed");
          await io.uploadObject(e.data.object_path, e.bytes, e.data.mime);
          bytes = await io.readObject(e.data.object_path);
        }
        if (!bytes || (await sha256(bytes)) !== e.data.sha256)
          fail("Stored SHA-256 mismatch; finalization blocked");
        if (ready) status = "skipped";
        else {
          if (!allowed()) fail("Session changed");
          await io.save("documents", e.data, row, false);
        }
      }
      if (!exact(await io.read(e.kind, e.id), e))
        fail(
          "Exact target readback failed; retry original bundle to reconcile",
        );
      successful.add(e.key);
      results.push({ key: e.key, kind: e.kind, id: e.id, status });
    } catch (error) {
      // Never automatically retry a mutation with an uncertain response.
      results.push({
        key: e.key,
        kind: e.kind,
        id: e.id,
        status: "error",
        error: error.message,
      });
    }
  }
  return results;
}
