const f = (key, label, type = "text", extra = {}) => ({
  key,
  label,
  type,
  ...extra,
});
const provenance = [
  f("source", "Source / evidence reference", "textarea"),
  f("verified_on", "Last verified", "date"),
  f("notes", "Notes", "textarea"),
];
const entity = f("entity_id", "Entity", "ref", {
  ref: "entities",
  required: true,
});
const person = f("person_id", "Person", "ref", { ref: "people" });
const evidence = f("evidence_id", "Evidence document", "ref", {
  ref: "documents",
});
const dates = [
  f("starts_on", "Effective from", "date", { required: true }),
  f("ends_on", "Effective through", "date"),
];
export const SCHEMA = {
  entities: {
    label: "Entities",
    singular: "entity",
    fields: [
      f("legal_name", "Legal name", "text", { required: true }),
      f("display_name", "Display name"),
      f("dba", "DBA / trade names"),
      f("relationship", "Portfolio relationship", "select", {
        options: ["Company", "Client", "Company and client", "Other"],
      }),
      f("entity_type", "Entity type", "select", {
        options: [
          "LLC",
          "Corporation",
          "Partnership",
          "Sole proprietor",
          "Trust",
          "Nonprofit",
          "Other",
        ],
      }),
      f("jurisdiction", "Formation jurisdiction"),
      f("ein", "EIN", "password"),
      f("parent_id", "Parent entity", "ref", { ref: "entities" }),
      f("principal_address", "Principal address", "textarea"),
      f("mailing_address", "Mailing address", "textarea"),
      f("registered_agent", "Registered agent"),
      f("registered_address", "Registered office", "textarea"),
      f("fiscal_year_end", "Fiscal year end (MM-DD)", "text", {
        placeholder: "12-31",
        pattern: "[0-9]{2}-[0-9]{2}",
      }),
      f("tax_classification", "Tax classification"),
      ...provenance,
    ],
  },
  people: {
    label: "People",
    singular: "person",
    fields: [
      f("name", "Full name", "text", { required: true }),
      f("email", "Email", "email"),
      f("phone", "Phone", "tel"),
      f("address", "Address", "textarea"),
      ...provenance,
    ],
  },
  groups: {
    label: "Groups",
    singular: "group",
    fields: [
      f("name", "Group name", "text", { required: true }),
      f("description", "Description", "textarea"),
      f("source", "Source", "textarea"),
      f("verified_on", "Last verified", "date"),
    ],
  },
  memberships: {
    label: "Group memberships",
    singular: "membership",
    fields: [
      entity,
      f("group_id", "Group", "ref", { ref: "groups", required: true }),
      f("notes", "Notes", "textarea"),
    ],
  },
  roles: {
    label: "Officers & authority",
    singular: "role",
    fields: [
      entity,
      { ...person, required: true },
      f("title", "Officer / role title", "text", { required: true }),
      f("authority", "Explicit authority / limits", "textarea", {
        placeholder: "Not verified — a title does not confer authority",
      }),
      ...dates,
      evidence,
      ...provenance,
    ],
  },
  ownership: {
    label: "Ownership",
    singular: "ownership interest",
    fields: [
      entity,
      person,
      f("owner_entity_id", "Owner entity (instead of person)", "ref", {
        ref: "entities",
      }),
      f("percentage", "Ownership percentage", "number", {
        required: true,
        min: 0,
        max: 100,
        step: "0.000001",
      }),
      f("class", "Share / membership class"),
      f("basis", "Basis of interest", "textarea"),
      ...dates,
      evidence,
      ...provenance,
    ],
  },
  obligations: {
    label: "Obligations",
    singular: "obligation",
    fields: [
      entity,
      f("title", "Known obligation", "text", { required: true }),
      { ...person, label: "Responsible person" },
      f("due_on", "Due date", "date", { required: true }),
      f("status", "Status", "select", {
        required: true,
        options: ["open", "in_progress", "complete", "not_applicable"],
      }),
      f("completed_on", "Completed on", "date"),
      evidence,
      ...provenance,
    ],
  },
  insurance: {
    label: "Insurance",
    singular: "insurance policy",
    fields: [
      entity,
      f("carrier", "Carrier"),
      f("policy_type", "Policy type", "text", { required: true }),
      f("policy_number", "Policy number"),
      f("named_insured", "Named insured (exact wording)", "textarea"),
      f("broker", "Broker"),
      f("agent", "Agent"),
      f("contact", "Contact", "textarea"),
      f("starts_on", "Term starts", "date"),
      f("ends_on", "Term ends", "date"),
      f("coverage_limits", "Coverage limits", "textarea"),
      f("deductibles", "Deductibles", "textarea"),
      f("premium", "Documented premium (currency / period)"),
      f("verification", "Verification", "select", {
        required: true,
        options: [
          "Not verified",
          "Historical evidence",
          "Verified against source",
        ],
      }),
      evidence,
      ...provenance,
    ],
  },
  documents: {
    label: "Documents",
    singular: "document",
    fields: [
      entity,
      f("title", "Document title", "text", { required: true }),
      f("classification", "Classification", "select", {
        options: [
          "Formation",
          "Governance",
          "Ownership",
          "Tax",
          "Authority",
          "Registration",
          "Agreement",
          "Insurance",
          "Other",
        ],
      }),
      f("executed", "Executed / final", "checkbox"),
      f("executed_on", "Executed on", "date"),
      f("current", "Designate current version", "checkbox"),
      f("expires_on", "Expires on", "date"),
      ...provenance,
    ],
  },
  favorites: { label: "Favorites", singular: "favorite", fields: [entity] },
};
export const KINDS = Object.keys(SCHEMA);
export function recordName(record) {
  return (
    record?.data.display_name ||
    record?.data.legal_name ||
    record?.data.name ||
    record?.data.title ||
    "Untitled"
  );
}
