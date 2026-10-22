import * as api from "./api.js";
import { prepareIntake, runIntake } from "./intake.js";
import {
  OWNER,
  maskEin,
  normalizeEin,
  packetReason,
  packetFilename,
  reviewPacket,
  safeFilename,
  zipStore,
} from "./core.js";
import { SCHEMA, KINDS, recordName } from "./schema.js";
const $ = (s) => document.querySelector(s),
  root = $("#workspace"),
  dialog = $("#editor");
const state = {
  data: {},
  view: "entities",
  entity: null,
  tab: "overview",
  query: "",
  type: "",
  group: "",
  favorites: false,
  archives: false,
  ready: false,
  generation: 0,
};
const NAV = [
  ["entities", "Explore", "▦"],
  ["people", "People", "♙"],
  ["documents", "Documents", "▤"],
  ["insurance", "Insurance", "◇"],
  ["obligations", "Obligations", "◷"],
  ["groups", "Groups", "◇"],
  ["activity", "Activity", "≋"],
  ["intake", "Reviewed intake", "↓"],
];
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "disabled" || k === "hidden")
      node[k] = !!v;
    else if (k === "text") node.textContent = v;
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity))
    if (c !== null && c !== undefined)
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
function button(text, action, cls = "subtle", attrs = {}) {
  return el(
    "button",
    { type: "button", class: cls, onclick: action, ...attrs },
    text,
  );
}
function text(tag, content, cls = "") {
  return el(tag, { class: cls }, content);
}
function rows(kind) {
  return state.data[kind] || [];
}
function active(kind) {
  return rows(kind).filter((r) => !r.archived);
}
function find(kind, id) {
  return rows(kind).find((r) => r.id === id);
}
function friendly(value) {
  return String(value ?? "").replaceAll("_", " ");
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function toast(message) {
  const n = $("#toast");
  n.textContent = message;
  n.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (n.hidden = true), 6000);
}
function empty(title, description, action) {
  return el(
    "section",
    { class: "empty" },
    text("span", "◇", "empty-glyph"),
    text("h2", title),
    text("p", description),
    action,
  );
}
function messageError(error) {
  return (
    error?.message || "The operation failed. Nothing has been assumed saved."
  );
}
function clearPrivate() {
  state.ready = false;
  state.data = {};
  state.generation++;
  dialog.close();
  dialog.replaceChildren();
  $("#print-sheet").replaceChildren();
  $("#toast").hidden = true;
}
function lock(message = "Verifying your existing 360 session…", retry = false) {
  clearPrivate();
  $("#identity-status").textContent = "Session not verified";
  $("#navigation").replaceChildren();
  root.replaceChildren(
    el(
      "div",
      { class: "lock" },
      empty(
        "Your private corporate register",
        message,
        retry ? button("Verify existing session", bootstrap, "primary") : null,
      ),
    ),
  );
}
function renderNav() {
  const n = $("#navigation");
  n.replaceChildren(
    ...NAV.map(([key, label, icon]) =>
      button(
        [el("span", { class: "nav-icon", "aria-hidden": "true" }, icon), label],
        () => {
          state.view = key;
          state.entity = null;
          state.query = "";
          render();
        },
        key === state.view ? "active" : "",
        { "aria-current": key === state.view ? "page" : null },
      ),
    ),
  );
}
function heading(
  title,
  description,
  actions = [],
  overline = "THE CORPORATE REGISTER",
) {
  return el(
    "section",
    { class: "heading" },
    el(
      "div",
      {},
      text("div", overline, "eyebrow"),
      text("h1", title),
      text("p", description),
    ),
    el("div", { class: "heading-actions" }, actions),
  );
}
async function bootstrap() {
  lock();
  const gen = state.generation;
  try {
    await api.identity();
    const data = await api.loadAll();
    if (gen !== state.generation) return;
    state.data = data;
    state.ready = true;
    $("#identity-status").textContent = "Jon’s verified 360 identity";
    render();
  } catch (error) {
    if (gen === state.generation) lock(messageError(error), true);
  }
}
async function refresh() {
  if (!state.ready) return bootstrap();
  const gen = state.generation;
  try {
    const data = await api.loadAll();
    if (gen !== state.generation) return;
    state.data = data;
    render();
    toast("Register refreshed.");
  } catch (e) {
    lock(messageError(e), true);
  }
}
async function action(work) {
  const gen = state.generation;
  try {
    await work();
    if (gen !== state.generation) return;
    state.data = await api.loadAll();
    if (gen !== state.generation) return;
    render();
  } catch (e) {
    if (gen === state.generation) toast(messageError(e));
  }
}
function render() {
  if (!state.ready) return;
  renderNav();
  root.replaceChildren();
  if (state.entity) {
    renderEntity();
    return;
  }
  if (state.view === "entities") renderExplore();
  else if (state.view === "activity") renderActivity();
  else if (state.view === "intake") renderIntake();
  else renderRegister(state.view);
}
function renderIntake() {
  const gen = state.generation;
  let sequence = 0;
  const preview = el("div", { class: "intake-preview" }),
    notice = el("p", { role: "alert" });
  const input = el("input", {
    type: "file",
    accept: ".json,application/json",
    "aria-label": "Reviewed JSON file",
    onchange: async () => {
      const ticket = ++sequence;
      preview.replaceChildren();
      notice.textContent = "";
      const file = input.files[0];
      if (!file) return;
      try {
        if (file.size > 50 * 1024 * 1024) throw Error("JSON exceeds 50 MiB");
        const source = await file.text(),
          bundle = JSON.parse(source),
          entries = await prepareIntake(bundle);
        if (
          ticket !== sequence ||
          gen !== state.generation ||
          !preview.isConnected
        )
          return;
        preview.append(
          text(
            "h2",
            `${entries.length} entries validated — review every source`,
          ),
        );
        for (const e of entries) {
          const display = JSON.stringify(
            { data: e.data, links: e.links },
            null,
            2,
          ).replace(/\b\d{2}-\d{7}\b/g, (v) => maskEin(v));
          preview.append(
            el(
              "section",
              { class: "record-row" },
              el(
                "div",
                {},
                text("h3", `${e.kind} / ${e.key}`),
                text(
                  "p",
                  `Source: ${e.data.source || "Not recorded"}`.replace(
                    /\b\d{2}-\d{7}\b/g,
                    (v) => maskEin(v),
                  ),
                ),
                text("pre", display),
              ),
            ),
          );
        }
        const reviewed = el("input", { type: "checkbox" });
        const commit = button(
          "Commit reviewed intake",
          async () => {
            if (!reviewed.checked) return;
            commit.disabled = true;
            input.disabled = true;
            reviewed.disabled = true;
            notice.textContent =
              "Import running. Partial commits are possible; keep the original JSON for retry.";
            try {
              const results = await runIntake(
                JSON.parse(source),
                api,
                () => state.ready && gen === state.generation,
              );
              if (gen !== state.generation || !preview.isConnected) return;
              const count = (s) => results.filter((r) => r.status === s).length;
              notice.textContent = `Created: ${count("created")} · Skipped: ${count("skipped")} · Errors: ${count("error")}`;
              preview.replaceChildren(
                text("h2", "Intake results"),
                text(
                  "p",
                  "Existing exact records were skipped; conflicts were not overwritten. Select the same original JSON again to reconcile uncertain saves or resume pending uploads.",
                ),
                ...results.map((r) =>
                  text(
                    "p",
                    `${r.key}: ${r.status}${r.error ? " — " + r.error : ""}`,
                  ),
                ),
                button("Download intake results", () =>
                  saveBlob(
                    new Blob([JSON.stringify(results, null, 2)], {
                      type: "application/json",
                    }),
                    "corporate-intake-results.json",
                  ),
                ),
              );
              const data = await api.loadAll();
              if (gen === state.generation) state.data = data;
            } catch (error) {
              if (gen === state.generation)
                notice.textContent = messageError(error);
            } finally {
              input.disabled = false;
            }
          },
          "primary",
          { disabled: true },
        );
        reviewed.addEventListener("change", () => {
          commit.disabled = !reviewed.checked;
        });
        preview.append(
          el("label", {}, reviewed, "I reviewed every entry and its source"),
          commit,
        );
      } catch (error) {
        if (ticket === sequence && gen === state.generation)
          notice.textContent = messageError(error);
      }
    },
  });
  root.append(
    heading(
      "Reviewed intake",
      "Choose a reviewed format-v1 JSON file. All entries and original document hashes are validated before any writes. No overwrites; retries use permanent stable keys.",
    ),
    text(
      "p",
      "Private sources stay in this browser and the private corporate backend. This is not a transaction across records and storage. Historical insurance facts do not certify current coverage.",
    ),
    input,
    notice,
    preview,
  );
}
function selectFilter(label, values, value, change) {
  const s = el(
    "select",
    { "aria-label": label, onchange: (e) => change(e.target.value) },
    el("option", { value: "" }, label),
    values.map((v) => el("option", { value: v.value ?? v }, v.label ?? v)),
  );
  s.value = value;
  return s;
}
function toolbar(extra = []) {
  const input = el("input", {
    type: "search",
    placeholder: "Search the entire register…",
    "aria-label": "Search the entire register",
    value: state.query,
    oninput: (e) => {
      state.query = e.target.value;
      renderResults();
    },
  });
  return el(
    "div",
    { class: "toolbar" },
    el("div", { class: "search" }, input),
    extra,
    button(
      state.archives ? "Archived" : "Active",
      () => {
        state.archives = !state.archives;
        render();
      },
      state.archives ? "filter-on" : "subtle",
      { "aria-pressed": String(state.archives) },
    ),
  );
}
function match(record) {
  return JSON.stringify({ ...record.data, ein: undefined })
    .toLowerCase()
    .includes(state.query.toLowerCase().trim());
}
function renderExplore() {
  root.append(
    heading(
      "The portfolio.",
      "A clear view of your companies, their people, and the records behind them.",
      [button("+ Add entity", () => edit("entities"), "primary")],
      "YOUR PRIVATE PORTFOLIO",
    ),
  );
  const due = active("obligations").filter(
    (r) =>
      !["complete", "not_applicable"].includes(r.data.status) &&
      r.data.due_on <= today(),
  ).length;
  root.append(
    el(
      "div",
      { class: "stats" },
      [
        ["entities", "Entities"],
        ["groups", "Groups"],
        ["documents", "Documents"],
        ["insurance", "Insurance"],
      ].map(([k, label]) =>
        el(
          "div",
          { class: "stat" },
          text("span", active(k).length, "stat-value"),
          text("span", label, "stat-label"),
        ),
      ),
      el(
        "div",
        { class: "stat" },
        text("span", due, "stat-value"),
        text("span", "Due / overdue", "stat-label"),
      ),
    ),
  );
  root.append(
    toolbar([
      selectFilter(
        "All types",
        [
          ...new Set(
            rows("entities")
              .map((r) => r.data.entity_type)
              .filter(Boolean),
          ),
        ].sort(),
        state.type,
        (v) => {
          state.type = v;
          renderResults();
        },
      ),
      selectFilter(
        "All groups",
        active("groups").map((r) => ({ value: r.id, label: recordName(r) })),
        state.group,
        (v) => {
          state.group = v;
          renderResults();
        },
      ),
      button(
        "☆ Favorites",
        () => {
          state.favorites = !state.favorites;
          render();
        },
        state.favorites ? "filter-on" : "subtle",
        { "aria-pressed": String(state.favorites) },
      ),
    ]),
    el("div", { id: "results" }),
  );
  renderResults();
}
function renderResults() {
  const target = $("#results");
  if (!target) return;
  target.replaceChildren();
  if (state.view !== "entities") {
    renderRows(state.view, target);
    return;
  }
  let entities = rows("entities").filter(
    (e) =>
      e.archived === state.archives &&
      (!state.type || e.data.entity_type === state.type) &&
      (!state.group ||
        active("memberships").some(
          (m) => m.data.entity_id === e.id && m.data.group_id === state.group,
        )) &&
      (!state.favorites ||
        active("favorites").some((f) => f.data.entity_id === e.id)),
  );
  const q = state.query.trim();
  if (q)
    entities = entities.filter(
      (e) =>
        match(e) ||
        ["roles", "ownership", "documents", "obligations", "memberships"].some(
          (k) =>
            rows(k).some(
              (r) =>
                r.data.entity_id === e.id &&
                (match(r) ||
                  (r.data.person_id &&
                    match(find("people", r.data.person_id) || { data: {} }))),
            ),
        ),
    );
  entities.sort((a, b) => recordName(a).localeCompare(recordName(b)));
  target.append(
    el(
      "div",
      { class: "section-label" },
      text(
        "span",
        `${state.archives ? "ARCHIVED" : "PORTFOLIO"} / ${String(entities.length).padStart(2, "0")}`,
      ),
      text("span", "ENTITY DIRECTORY"),
    ),
  );
  if (!entities.length)
    target.append(
      empty(
        q
          ? "No matching entities"
          : state.archives
            ? "No archived entities"
            : "Your portfolio starts here",
        q
          ? "Try a legal name, person, document or jurisdiction."
          : "Add a company or client. No sample companies or officers are included.",
        !state.archives
          ? button("+ Add entity", () => edit("entities"), "primary")
          : null,
      ),
    );
  else
    target.append(
      el(
        "div",
        { class: "cards" },
        entities.map((entity) => {
          const d = entity.data,
            favorite = active("favorites").find(
              (f) => f.data.entity_id === entity.id,
            );
          return el(
            "article",
            { class: "entity-card" },
            el(
              "div",
              { class: "card-head" },
              text(
                "span",
                recordName(entity)
                  .split(/\s+/)
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase(),
                "monogram",
              ),
              button(
                favorite ? "★" : "☆",
                () =>
                  action(async () => {
                    if (favorite)
                      await api.save(
                        "favorites",
                        favorite.data,
                        favorite,
                        true,
                      );
                    else await api.save("favorites", { entity_id: entity.id });
                  }),
                `favorite${favorite ? " on" : ""}`,
                {
                  "aria-label": `${favorite ? "Unfavorite" : "Favorite"} ${recordName(entity)}`,
                  "aria-pressed": String(!!favorite),
                },
              ),
            ),
            button(
              recordName(entity),
              () => openEntity(entity.id),
              "card-open",
            ),
            text(
              "div",
              d.display_name ? d.legal_name : d.dba || "Legal entity",
              "card-legal",
            ),
            el(
              "div",
              { class: "card-foot" },
              text(
                "span",
                [
                  d.entity_type || "Type unrecorded",
                  d.jurisdiction || "Jurisdiction unrecorded",
                ].join(" · "),
              ),
              text("span", "↗", "arrow"),
            ),
          );
        }),
      ),
    );
  if (q) {
    const matches = KINDS.filter(
      (k) => !["entities", "favorites", "memberships"].includes(k),
    ).flatMap((k) =>
      rows(k)
        .filter((r) => r.archived === state.archives && match(r))
        .map((r) => ({ k, r })),
    );
    if (matches.length) {
      target.append(
        text("div", `ACROSS THE REGISTER / ${matches.length}`, "section-label"),
      );
      const list = el("div", { class: "record-list" });
      for (const { k, r } of matches) list.append(recordRow(k, r));
      target.append(list);
    }
  }
}
function openEntity(id) {
  state.entity = id;
  state.tab = "overview";
  render();
  root.focus();
}
function renderEntity() {
  const record = find("entities", state.entity);
  if (!record) {
    state.entity = null;
    render();
    return;
  }
  root.append(
    button(
      "← Back to portfolio",
      () => {
        state.entity = null;
        state.view = "entities";
        render();
      },
      "back",
    ),
    heading(
      recordName(record),
      record.data.legal_name,
      [
        button("Fact sheet", () => printSheet(record)),
        button("Build packet", () => packet(record)),
        button("Edit entity", () => edit("entities", record), "primary"),
      ],
      record.archived ? "ARCHIVED ENTITY" : "ENTITY RECORD",
    ),
  );
  const tabs = [
    ["overview", "Overview"],
    ["ownership", "Ownership"],
    ["documents", "Documents"],
    ["insurance", "Insurance"],
    ["obligations", "Obligations"],
    ["memberships", "Groups"],
    ["activity", "Activity"],
  ];
  root.append(
    el(
      "div",
      { class: "tabs", role: "tablist", "aria-label": "Entity sections" },
      tabs.map(([key, label]) =>
        button(
          label,
          () => {
            state.tab = key;
            render();
          },
          state.tab === key ? "active" : "",
          { role: "tab", "aria-selected": String(state.tab === key) },
        ),
      ),
    ),
  );
  if (state.tab === "overview") {
    root.append(
      details("entities", record),
      el(
        "div",
        { class: "section-label" },
        `UPDATED ${new Date(record.updated_at).toLocaleString()} · REVISION ${record.version}`,
      ),
      button(
        record.archived ? "Restore entity" : "Archive entity",
        () => archive("entities", record),
        record.archived ? "subtle" : "danger",
      ),
    );
  } else if (state.tab === "activity") renderActivity(record.id);
  else {
    const kind = state.tab;
    root.append(
      el(
        "div",
        { class: "heading" },
        text(
          "p",
          kind === "roles"
            ? "A title is not evidence of signing authority. Record authority and its source explicitly."
            : kind === "ownership"
              ? "Dated interests from recorded evidence. The register may be incomplete; percentages are not a certified cap table."
              : kind === "obligations"
                ? "Known obligations only. Dates are recorded, not inferred from jurisdiction."
                : kind === "documents"
                  ? "Private originals. New versions preserve every prior file. Links expire after 60 seconds."
                  : "Organize this entity without changing its legal structure.",
          "notice",
        ),
        button(
          `+ Add ${SCHEMA[kind].singular}`,
          () => edit(kind, null, { entity_id: record.id }),
          "primary",
        ),
      ),
    );
    const target = el("div", { class: "record-list" });
    root.append(target);
    const relevant = rows(kind).filter((r) => r.data.entity_id === record.id);
    if (!relevant.length)
      target.append(
        empty(
          `No ${SCHEMA[kind].label.toLowerCase()} recorded`,
          "Add only information supported by your records.",
        ),
      );
    for (const r of relevant) target.append(recordRow(kind, r));
    if (kind === "ownership") renderPositions(record, relevant);
  }
}
function positionStatus(r) {
  const d = r.data;
  if (r.archived) return "Archived · Historical · Current status unconfirmed";
  if (d.ends_on && d.ends_on < today())
    return "Historical · Current status unconfirmed";
  if (d.starts_on && d.starts_on > today())
    return "Future-dated · Current status unconfirmed";
  const historical = /historical|former|past officer/i.test(
    `${d.notes || ""} ${d.source || ""} ${d.title || ""}`,
  );
  return `${historical ? "Historical evidence · " : ""}Current status unconfirmed`;
}
function positionLine(r) {
  return text("p", `${r.data.title} · ${positionStatus(r)}`, "position-line");
}
function personPositions(personId, entityId) {
  return personId
    ? rows("roles").filter(
        (r) => r.data.person_id === personId && r.data.entity_id === entityId,
      )
    : [];
}
function renderPositions(entity, interests) {
  const roles = rows("roles").filter((r) => r.data.entity_id === entity.id);
  const ownerIds = new Set(
    interests.map((r) => r.data.person_id).filter(Boolean),
  );
  const otherIds = [...new Set(roles.map((r) => r.data.person_id))].filter(
    (id) => !ownerIds.has(id),
  );
  if (otherIds.length)
    root.append(
      el(
        "section",
        {
          class: "other-officers",
          "aria-label": "Other officers and positions",
        },
        text("h2", "Other officers & positions"),
        text(
          "p",
          "Recorded positions with no ownership interest recorded here.",
          "muted small",
        ),
        otherIds.map((id) =>
          el(
            "article",
            { class: "officer-summary" },
            text("h3", recordName(find("people", id))),
            personPositions(id, entity.id).map(positionLine),
          ),
        ),
      ),
    );
  root.append(
    el(
      "details",
      { class: "positions-manager" },
      text("summary", "Manage positions & authority"),
      text(
        "p",
        "A title or ownership interest is not evidence of signing authority. Historical assignments are retained; current status is not assumed. Review each record and its source.",
        "notice",
      ),
      button(
        "+ Add role",
        () => edit("roles", null, { entity_id: entity.id }),
        "primary",
      ),
      el(
        "div",
        { class: "record-list" },
        roles.map((r) => recordRow("roles", r)),
      ),
    ),
  );
}
function details(kind, record) {
  return el(
    "dl",
    { class: "details" },
    SCHEMA[kind].fields.map((f) => {
      let value = record.data[f.key];
      if (f.type === "ref")
        value = value ? recordName(find(f.ref, value)) : "Not recorded";
      else if (f.key === "ein") value = maskEin(value);
      else if (f.type === "checkbox") value = value ? "Yes" : "No";
      else if (value !== undefined && value !== null) value = friendly(value);
      return el(
        "div",
        { class: "detail" },
        text("dt", f.label),
        text("dd", value || "Not recorded"),
      );
    }),
  );
}
function rowTitle(kind, r) {
  if (kind === "insurance")
    return `${r.data.policy_type} · ${r.data.carrier || "Carrier not recorded"} · ${r.data.policy_number || "Number not recorded"}`;
  if (kind === "roles")
    return `${recordName(find("people", r.data.person_id))} · ${r.data.title}`;
  if (kind === "ownership")
    return `${recordName(find(r.data.person_id ? "people" : "entities", r.data.person_id || r.data.owner_entity_id))} · ${r.data.percentage}%`;
  if (kind === "memberships")
    return recordName(find("groups", r.data.group_id));
  return recordName(r);
}
function recordRow(kind, r) {
  const d = r.data,
    info = [];
  if (d.entity_id && !state.entity)
    info.push(recordName(find("entities", d.entity_id)));
  if (kind === "insurance")
    info.push(
      `${d.verification} · ${d.ends_on && d.ends_on < today() ? "Expired term — renewal review needed" : "Current coverage not certified"} · ${d.source || "Source not recorded"}`,
    );
  if (kind === "roles")
    info.push(`Authority: ${d.authority || "Not verified"}`);
  if (d.starts_on)
    info.push(`${d.starts_on} → ${d.ends_on || "No end recorded"}`);
  if (kind === "documents")
    info.push(
      `Version ${d.file_version} · ${d.classification || "Unclassified"} · ${d.status} · ${d.executed ? "Executed" : "Not executed"} · ${d.current ? "Current" : "Not current"}${d.expires_on ? ` · Expires ${d.expires_on}` : ""}`,
    );
  if (kind === "obligations")
    info.push(
      `${friendly(d.status)} · Due ${d.due_on} · Owner: ${d.person_id ? recordName(find("people", d.person_id)) : "Unassigned"}`,
    );
  if (kind === "people") info.push(d.email || "No email recorded");
  if (kind === "groups")
    info.push(
      d.description ||
        `${active("memberships").filter((m) => m.data.group_id === r.id).length} active members`,
    );
  const actions = [
    button("Edit", () => edit(kind, r)),
    button(
      r.archived ? "Restore" : "Archive",
      () => archive(kind, r),
      r.archived ? "subtle" : "subtle danger",
    ),
  ];
  if (kind === "documents") {
    if (d.status === "ready") {
      actions.unshift(
        button("Download", () =>
          action(async () => {
            saveBlob(await api.download(r), d.filename);
            toast("Download verified against SHA-256.");
          }),
        ),
        button("Secure link", () => secureLink(r)),
        button("New version", () =>
          edit("documents", null, { ...d, executed: false, current: false }, r),
        ),
      );
    } else if (d.status === "pending")
      actions.unshift(button("Retry finalization", () => retryFinalize(r)));
  }
  const related = [];
  if (kind === "insurance") {
    const fields = ["carrier", "policy_number", "starts_on", "ends_on"];
    if (fields.every((k) => d[k])) {
      for (const other of active("insurance").filter(
        (x) =>
          x.id !== r.id &&
          x.data.entity_id !== d.entity_id &&
          fields.every((k) => x.data[k] === d[k]),
      )) {
        related.push(
          button(
            `Matching policy facts: ${recordName(find("entities", other.data.entity_id))}`,
            () => {
              state.entity = other.data.entity_id;
              state.tab = "insurance";
              render();
            },
          ),
        );
      }
      if (related.length)
        related.unshift(
          text(
            "p",
            "Matching documented carrier, number and term only — not inferred coverage.",
          ),
        );
    }
  }
  const summary = el(
    "details",
    { class: "row-detail" },
    text("summary", "Record details"),
    details(kind, r),
  );
  return el(
    "article",
    { class: `record-row${kind === "ownership" ? " ownership-row" : ""}` },
    el(
      "div",
      { class: "record-main" },
      text(
        "h3",
        kind === "ownership"
          ? recordName(
              find(
                d.person_id ? "people" : "entities",
                d.person_id || d.owner_entity_id,
              ),
            )
          : rowTitle(kind, r),
      ),
      kind === "ownership"
        ? [
            personPositions(d.person_id, d.entity_id).map(positionLine),
            d.person_id && !personPositions(d.person_id, d.entity_id).length
              ? text(
                  "p",
                  "No position recorded for this entity",
                  "position-line",
                )
              : null,
            text("span", `${d.percentage}% interest`, "ownership-metric"),
            text("p", positionStatus(r), "position-status"),
          ]
        : null,
      kind === "roles" ? text("p", positionStatus(r), "position-status") : null,
      r.archived ? text("span", "ARCHIVED", "tag warn") : null,
      info.map((s) => text("p", s)),
      related,
      summary,
    ),
    el("div", { class: "row-actions" }, actions),
  );
}
function renderRegister(kind) {
  root.append(
    heading(
      SCHEMA[kind].label,
      kind === "insurance"
        ? "Source-backed policy facts. Historical evidence and term dates do not certify coverage or compliance. Review renewals against current evidence."
        : kind === "people"
          ? "One shared directory. Roles and authority belong to dated entity assignments."
          : kind === "documents"
            ? "Your private document register. Originals stay intact; each revision is a separate version."
            : kind === "obligations"
              ? "Known commitments, accountable owners, and the evidence of completion."
              : "A portfolio can have many structures. Groups are organizational, not legal ownership.",
      [button(`+ Add ${SCHEMA[kind].singular}`, () => edit(kind), "primary")],
    ),
    toolbar(),
    el("div", { id: "results" }),
  );
  renderResults();
}
function renderRows(kind, target) {
  const records = rows(kind)
    .filter((r) => r.archived === state.archives && match(r))
    .sort((a, b) =>
      kind === "obligations"
        ? a.data.due_on.localeCompare(b.data.due_on)
        : rowTitle(kind, a).localeCompare(rowTitle(kind, b)),
    );
  target.append(
    text(
      "div",
      `${records.length} ${SCHEMA[kind].label.toUpperCase()}`,
      "section-label",
    ),
  );
  if (!records.length)
    target.append(
      empty(
        "Nothing recorded here yet",
        "Add a record, or change your search and archive filter.",
      ),
    );
  else
    target.append(
      el(
        "div",
        { class: "record-list" },
        records.map((r) => recordRow(kind, r)),
      ),
    );
}
async function renderActivity(entityId = null) {
  const target = el(
    "div",
    {},
    text("p", "Loading server-stamped activity…", "muted"),
  );
  if (!entityId)
    root.append(
      heading(
        "Activity",
        "An immutable history of register changes. Export/download events are not tracked as database mutations.",
      ),
    );
  root.append(target);
  const gen = state.generation;
  try {
    await api.identity();
    let logs = await api.list("activity");
    if (gen !== state.generation) return;
    if (entityId) {
      const ids = new Set([
        entityId,
        ...KINDS.flatMap((k) =>
          rows(k)
            .filter((r) => r.data.entity_id === entityId)
            .map((r) => r.id),
        ),
      ]);
      logs = logs.filter((r) => ids.has(r.record_id));
    }
    target.replaceChildren();
    if (!logs.length)
      target.append(
        empty(
          "No activity yet",
          "Saved changes will appear here with server timestamps.",
        ),
      );
    for (const r of logs) {
      const old = r.old_record?.data || {},
        data = r.new_record?.data || {};
      const changed = [
        ...new Set([...Object.keys(old), ...Object.keys(data)]),
      ].filter((k) => JSON.stringify(old[k]) !== JSON.stringify(data[k]));
      const safe = { ...data };
      if (safe.ein) safe.ein = maskEin(safe.ein);
      target.append(
        el(
          "article",
          { class: "audit-row" },
          text(
            "div",
            `${r.action.toUpperCase()} · ${r.table_name.replace("cc_", "")} · ${new Date(r.happened_at).toLocaleString()}`,
          ),
          text("code", `${r.record_id} · Actor ${r.actor_id}`),
          text(
            "div",
            changed.length
              ? `Changed fields: ${changed.join(", ")}`
              : "Archive state changed",
          ),
          el(
            "details",
            {},
            text("summary", "Saved record (EIN masked)"),
            text("pre", JSON.stringify(safe, null, 2)),
          ),
        ),
      );
    }
  } catch (e) {
    if (gen === state.generation)
      target.replaceChildren(text("p", messageError(e), "error"));
  }
}
function showDialog(title, body) {
  dialog.replaceChildren(
    el(
      "div",
      { class: "dialog-head" },
      el("h2", { id: "dialog-title" }, title),
      button("×", () => dialog.close(), "icon-button", {
        "aria-label": "Close dialog",
      }),
    ),
    body,
  );
  dialog.showModal();
}
function formField(f, value, record) {
  let control;
  if (f.type === "ref") {
    control = el(
      "select",
      { name: f.key, required: f.required ? "" : null },
      el("option", { value: "" }, "Not recorded"),
      rows(f.ref)
        .filter(
          (r) =>
            r.id !== (f.key === "parent_id" ? record?.id : null) &&
            (!r.archived || r.id === value),
        )
        .sort((a, b) => recordName(a).localeCompare(recordName(b)))
        .map((r) =>
          el(
            "option",
            { value: r.id },
            `${recordName(r)}${r.archived ? " (archived)" : ""}`,
          ),
        ),
    );
    control.value = value || "";
  } else if (f.type === "select") {
    control = el(
      "select",
      { name: f.key, required: f.required ? "" : null },
      el("option", { value: "" }, "Not recorded"),
      f.options.map((v) => el("option", { value: v }, friendly(v))),
    );
    control.value = value || "";
  } else if (f.type === "textarea")
    control = el(
      "textarea",
      {
        name: f.key,
        maxlength: 10000,
        placeholder: f.placeholder || "",
        required: f.required ? "" : null,
      },
      value || "",
    );
  else
    control = el("input", {
      name: f.key,
      type: f.type,
      value: f.type === "checkbox" ? "true" : (value ?? ""),
      checked: f.type === "checkbox" && value,
      required: f.required ? "" : null,
      min: f.min,
      max: f.max,
      step: f.step,
      pattern: f.pattern,
      placeholder: f.placeholder || "",
      maxlength: 10000,
      autocomplete: f.type === "password" ? "off" : null,
    });
  const label = el(
    "label",
    {
      class: `field${f.type === "textarea" ? " wide" : ""}${f.type === "checkbox" ? " checkbox" : ""}`,
    },
    f.type === "checkbox" ? control : null,
    text("span", `${f.label}${f.required ? " *" : ""}`),
    f.type !== "checkbox" ? control : null,
  );
  if (f.key === "ein")
    label.append(
      button(
        "Show / hide EIN",
        () =>
          (control.type = control.type === "password" ? "text" : "password"),
        "subtle",
      ),
    );
  return label;
}
function edit(kind, record = null, defaults = {}, prior = null) {
  if (!state.ready) return;
  if (prior) {
    prior = rows("documents")
      .filter(
        (d) =>
          d.data.entity_id === prior.data.entity_id &&
          d.data.family_id === prior.data.family_id,
      )
      .reduce(
        (latest, d) =>
          Number(d.data.file_version) > Number(latest.data.file_version)
            ? d
            : latest,
        prior,
      );
  }
  const base = record?.data || defaults;
  const form = el("form", { class: "dialog-body" });
  const fields = SCHEMA[kind].fields;
  form.append(
    text(
      "p",
      kind === "roles"
        ? "Title does not establish authority. State actual limits and link supporting evidence."
        : kind === "ownership"
          ? "Choose exactly one owner: a person OR an entity. Percentages are recorded interests, not a certified cap table."
          : kind === "documents"
            ? prior
              ? `New version in this document family. Previous file remains unchanged. Version ${Number(prior.data.file_version) + 1}.`
              : "Files are private and never overwritten. Mark executed/current only after reviewing the document."
            : "Required fields are marked *. Unverified facts should remain blank.",
      "field-note",
    ),
  );
  const grid = el(
    "div",
    { class: "form-grid" },
    fields.map((f) => formField(f, base[f.key], record)),
  );
  form.append(grid);
  if (kind === "documents" && !record)
    grid.append(
      el(
        "label",
        { class: "field wide" },
        text("span", "Original document * (25 MB maximum)"),
        el("input", {
          name: "file",
          type: "file",
          required: "",
          accept: ".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx",
        }),
      ),
    );
  const error = el("p", { class: "error", role: "alert" }),
    submit = el(
      "button",
      { type: "submit", class: "primary" },
      kind === "documents" && !record ? "Upload & save" : "Save record",
    );
  form.append(
    error,
    el(
      "div",
      { class: "dialog-actions" },
      button("Cancel", () => dialog.close()),
      submit,
    ),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    if (!form.reportValidity()) return;
    const data = record ? { ...record.data } : {};
    for (const f of fields) {
      const control = form.elements.namedItem(f.key);
      let v = f.type === "checkbox" ? control.checked : control.value.trim();
      if (f.type === "number" && v !== "") v = Number(v);
      if (f.key === "ein")
        try {
          v = normalizeEin(v);
        } catch (e) {
          error.textContent = e.message;
          return;
        }
      if (v === "" || v === null) delete data[f.key];
      else data[f.key] = v;
    }
    if (kind === "roles" && !data.authority) data.authority = "Not verified";
    if (kind === "ownership" && !!data.person_id === !!data.owner_entity_id) {
      error.textContent = "Choose exactly one owner: person or entity.";
      return;
    }
    if (data.ends_on && data.ends_on < data.starts_on) {
      error.textContent = "End date must not precede the start date.";
      return;
    }
    const gen = state.generation;
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      if (kind === "documents" && !record)
        await api.upload(data, form.elements.namedItem("file").files[0], prior);
      else await api.save(kind, data, record);
      if (gen !== state.generation) return;
      state.data = await api.loadAll();
      if (gen !== state.generation) return;
      dialog.close();
      render();
      toast("Saved and verified.");
    } catch (e) {
      if (gen === state.generation) {
        error.textContent = messageError(e);
        submit.disabled = false;
        submit.textContent = "Try save again";
      }
    }
  });
  showDialog(
    `${record ? "Edit" : prior ? "New version of" : "Add"} ${SCHEMA[kind].singular}`,
    form,
  );
}
function archive(kind, record) {
  const body = el(
    "div",
    { class: "dialog-body" },
    text(
      "p",
      record.archived
        ? "Restore this record to the active register?"
        : "Archive this record? It will remain in history; no documents or related records are deleted.",
      "field-note",
    ),
  );
  const err = text("p", "", "error");
  const confirm = button(
    record.archived ? "Restore record" : "Archive record",
    async () => {
      confirm.disabled = true;
      const gen = state.generation;
      try {
        await api.save(kind, record.data, record, !record.archived);
        if (gen !== state.generation) return;
        state.data = await api.loadAll();
        if (gen !== state.generation) return;
        dialog.close();
        render();
        toast(record.archived ? "Record restored." : "Record archived.");
      } catch (e) {
        err.textContent = messageError(e);
        confirm.disabled = false;
      }
    },
    "primary",
  );
  body.append(
    err,
    el(
      "div",
      { class: "dialog-actions" },
      button("Cancel", () => dialog.close()),
      confirm,
    ),
  );
  showDialog(
    `${record.archived ? "Restore" : "Archive"} ${SCHEMA[kind].singular}`,
    body,
  );
}
function saveBlob(blob, name) {
  if (!state.ready) throw new Error("Session no longer verified.");
  const url = URL.createObjectURL(blob),
    a = el("a", { href: url, download: safeFilename(name) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function secureLink(record) {
  const gen = state.generation;
  try {
    const url = await api.signedLink(record);
    if (gen !== state.generation) return;
    const input = el("input", {
      class: "secure-link",
      readonly: "",
      value: url,
      "aria-label": "60 second secure download URL",
    });
    const body = el(
      "div",
      { class: "dialog-body" },
      text(
        "p",
        "Anyone holding this link can download the file for 60 seconds. Share only with an intended recipient. The link is never stored in the register.",
        "notice warn",
      ),
      input,
      el(
        "div",
        { class: "dialog-actions" },
        button("Copy link", async () => {
          await navigator.clipboard.writeText(url);
          toast("Link copied. Expires 60 seconds after creation.");
        }),
      ),
    );
    showDialog("Temporary secure link", body);
    setTimeout(() => {
      if (input.isConnected) {
        input.value = "Expired — generate a new link.";
      }
    }, 60000);
  } catch (e) {
    toast(messageError(e));
  }
}
function retryFinalize(record) {
  const body = el(
    "form",
    { class: "dialog-body" },
    text(
      "p",
      "Select the original file. Finalization succeeds only if the object already exists in private storage with the recorded size. If upload never reached storage, archive this pending record and upload again.",
      "notice",
    ),
  );
  const file = el("input", {
      type: "file",
      required: "",
      "aria-label": "Original file",
    }),
    err = text("p", "", "error"),
    submit = el(
      "button",
      { type: "submit", class: "primary" },
      "Verify & finalize",
    );
  body.append(file, err, el("div", { class: "dialog-actions" }, submit));
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const gen = state.generation;
    try {
      await api.finalize(record, file.files[0]);
      if (gen !== state.generation) return;
      state.data = await api.loadAll();
      if (gen !== state.generation) return;
      dialog.close();
      render();
    } catch (e) {
      err.textContent = messageError(e);
      submit.disabled = false;
    }
  });
  showDialog("Recover pending document", body);
}
function printSheet(record) {
  const sheet = $("#print-sheet");
  sheet.replaceChildren(
    el(
      "div",
      { class: "print-title" },
      text("p", "360 CORPORATE · PRIVATE FACT SHEET"),
      text("h1", recordName(record)),
      text("p", record.data.legal_name),
    ),
    text(
      "p",
      `${record.archived ? "ARCHIVED — HISTORICAL RECORD" : "ACTIVE REGISTER RECORD"} · Prepared ${new Date().toLocaleString()} · Entity ${record.id} · Revision ${record.version}`,
      "print-note",
    ),
    text(
      "p",
      "Register facts only, not a certificate or legal opinion. EIN masked. Verify current authority against underlying evidence.",
      "print-note",
    ),
    details("entities", record),
  );
  for (const kind of ["roles", "ownership", "obligations", "memberships"]) {
    const records = active(kind).filter((r) => r.data.entity_id === record.id);
    sheet.append(text("h2", SCHEMA[kind].label));
    if (!records.length) sheet.append(text("p", "Not recorded"));
    for (const r of records)
      sheet.append(text("h3", rowTitle(kind, r)), details(kind, r));
  }
  window.print();
}
function packet(entity) {
  const docs = rows("documents").filter((r) => r.data.entity_id === entity.id);
  const snapshot = new Map(docs.map((d) => [d.id, d.version]));
  const form = el(
    "form",
    { class: "dialog-body" },
    text(
      "p",
      "Select the exact documents to share. Only active, ready, executed, current and unexpired files are eligible. The ZIP contains selected originals plus a manifest; never the full register or EIN.",
      "notice",
    ),
  );
  const selectors = [];
  for (const d of docs) {
    const reason = packetReason(d);
    const input = el("input", {
      type: "checkbox",
      value: d.id,
      disabled: !!reason,
      "aria-label": `Include ${d.data.title}`,
    });
    selectors.push(input);
    form.append(
      el(
        "label",
        { class: `packet-item${reason ? " disabled" : ""}` },
        input,
        el(
          "span",
          {},
          d.data.title,
          el(
            "small",
            {},
            `Version ${d.data.file_version} · ${d.data.filename} · ${reason || "Eligible — review before including"}`,
          ),
        ),
      ),
    );
  }
  if (!docs.length)
    form.append(text("p", "No documents recorded for this entity.", "muted"));
  const reviewed = el("input", {
    type: "checkbox",
    "aria-label": "I reviewed this exact selection",
  });
  form.append(
    el(
      "label",
      { class: "packet-item" },
      reviewed,
      text(
        "span",
        "I reviewed this exact selection and its intended recipient.",
      ),
    ),
  );
  selectors.forEach((i) =>
    i.addEventListener("change", () => (reviewed.checked = false)),
  );
  const error = text("p", "", "error"),
    submit = el(
      "button",
      { type: "submit", class: "primary" },
      "Create selected ZIP",
    );
  form.append(
    error,
    el(
      "div",
      { class: "dialog-actions" },
      button("Cancel", () => dialog.close()),
      submit,
    ),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const gen = state.generation;
    error.textContent = "";
    try {
      let chosen = reviewPacket(
        docs,
        selectors.filter((i) => i.checked).map((i) => i.value),
        reviewed.checked,
      );
      if (chosen.length > 99) throw new Error("Select at most 99 documents.");
      if (chosen.reduce((sum, d) => sum + d.data.bytes, 0) > 95 * 1024 * 1024)
        throw new Error("Selected files exceed the 95 MB packet limit.");
      submit.disabled = true;
      submit.textContent = "Verifying selection…";
      await api.identity();
      const fresh = await api.list("documents", { entityId: entity.id });
      chosen = reviewPacket(
        fresh,
        chosen.map((d) => d.id),
        true,
      );
      if (chosen.some((d) => d.version !== snapshot.get(d.id)))
        throw new Error(
          "A selected record changed. Close and review the packet again.",
        );
      const files = [],
        manifest = {
          format: "360-corporate-packet-v1",
          created_at: new Date().toISOString(),
          entity: { id: entity.id, legal_name: entity.data.legal_name },
          reviewed: true,
          documents: [],
        };
      for (const d of chosen) {
        submit.textContent = `Preparing ${files.length + 1} of ${chosen.length}…`;
        const blob = await api.download(d);
        if (gen !== state.generation) return;
        const name = packetFilename(files.length + 1, d.data.filename);
        files.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
        manifest.documents.push({
          id: d.id,
          revision: d.version,
          title: d.data.title,
          file: name,
          file_version: d.data.file_version,
          family_id: d.data.family_id,
          classification: d.data.classification || null,
          sha256: d.data.sha256,
          bytes: d.data.bytes,
          executed: d.data.executed,
          current: d.data.current,
          expires_on: d.data.expires_on || null,
        });
      }
      const final = await api.list("documents", { entityId: entity.id });
      reviewPacket(
        final,
        chosen.map((d) => d.id),
        true,
      );
      if (
        chosen.some(
          (d) => final.find((r) => r.id === d.id)?.version !== d.version,
        )
      )
        throw new Error(
          "A selected document changed during export. Review again.",
        );
      await api.identity();
      if (gen !== state.generation) return;
      files.unshift({
        name: "manifest.json",
        bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      });
      saveBlob(
        new Blob([zipStore(files)], { type: "application/zip" }),
        `${safeFilename(recordName(entity))}-packet-${today()}.zip`,
      );
      dialog.close();
      toast("Reviewed packet created with verified originals and manifest.");
    } catch (e) {
      if (gen === state.generation) {
        error.textContent = messageError(e);
        submit.disabled = false;
        submit.textContent = "Create selected ZIP";
        reviewed.checked = false;
      }
    }
  });
  showDialog(`Document packet · ${recordName(entity)}`, form);
}
$("#refresh").addEventListener("click", refresh);
// Invalidate immediately; SDK methods run outside its auth callback lock.
window.Shared360Session.client.auth.onAuthStateChange(() => {
  lock();
  setTimeout(bootstrap, 0);
});
window.addEventListener("storage", () => {
  lock();
  bootstrap();
});
window.addEventListener("focus", async () => {
  if (!state.ready) return;
  try {
    await api.identity();
  } catch (e) {
    lock(messageError(e), true);
  }
});
setInterval(async () => {
  if (!state.ready || document.hidden) return;
  try {
    await api.identity();
  } catch (e) {
    lock(messageError(e), true);
  }
}, 60000);
window.addEventListener("pagehide", () =>
  lock("Session verification required."),
);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) bootstrap();
});
bootstrap();
