import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
};

const manifestPath = path.resolve(
  root,
  valueAfter("--manifest") ?? "docs/fspm-conformance.json",
);
const governanceDirectory = valueAfter("--governance-dir");
const jsonOutput = args.includes("--json");
const markdownOutput = args.includes("--markdown");
const allowedStatuses = new Set([
  "implemented",
  "adapted",
  "not_implemented",
  "not_applicable",
]);
const shaPattern = /^[0-9a-f]{40}$/;
const issuePattern = /^#[1-9][0-9]*$/;
const keyPattern = /^[a-z0-9_]+$/;
const failures = [];

if (jsonOutput && markdownOutput) {
  failures.push("output: --json and --markdown are mutually exclusive");
}

const fail = (location, message) => failures.push(`${location}: ${message}`);
const nonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const requireKeys = (record, keys, location) => {
  for (const key of keys) {
    if (!(key in record)) fail(location, `missing required property '${key}'`);
  }
};

const rejectUnknownKeys = (record, keys, location) => {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(location, `unknown property '${key}'`);
  }
};

const requireUniqueStrings = (values, location) => {
  if (!Array.isArray(values) || values.length === 0) {
    fail(location, "must be a non-empty array");
    return;
  }
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    if (!nonEmptyString(value))
      fail(`${location}[${index}]`, "must be a non-empty string");
    if (seen.has(value))
      fail(`${location}[${index}]`, `duplicate value '${value}'`);
    seen.add(value);
  }
};

const validateEvidence = async (evidence, location) => {
  requireUniqueStrings(evidence, location);
  if (!Array.isArray(evidence)) return;
  for (const [index, reference] of evidence.entries()) {
    if (!nonEmptyString(reference)) continue;
    if (reference.startsWith("http://") || reference.startsWith("https://"))
      continue;
    const resolved = path.resolve(root, reference);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      fail(
        `${location}[${index}]`,
        "local evidence must stay inside the repository",
      );
      continue;
    }
    try {
      await access(resolved);
    } catch {
      fail(
        `${location}[${index}]`,
        `evidence path does not exist: ${reference}`,
      );
    }
  }
};

const validateEntry = async (entry, location) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    fail(location, "must be an object");
    return;
  }
  rejectUnknownKeys(
    entry,
    ["key", "status", "adaptation", "rationale", "evidence", "issue"],
    location,
  );
  requireKeys(entry, ["key", "status"], location);
  if (!keyPattern.test(entry.key ?? ""))
    fail(location, "key must use snake_case");
  if (!allowedStatuses.has(entry.status))
    fail(location, `unknown status '${entry.status}'`);

  if (entry.issue !== undefined && !issuePattern.test(entry.issue)) {
    fail(location, `issue must look like #123, received '${entry.issue}'`);
  }

  switch (entry.status) {
    case "implemented":
      await validateEvidence(entry.evidence, `${location}.evidence`);
      break;
    case "adapted":
      if (!nonEmptyString(entry.adaptation) || entry.adaptation.length < 20) {
        fail(
          location,
          "adapted entries require a substantive adaptation statement",
        );
      }
      await validateEvidence(entry.evidence, `${location}.evidence`);
      break;
    case "not_implemented":
      if (!nonEmptyString(entry.rationale) || entry.rationale.length < 20) {
        fail(
          location,
          "not_implemented entries require a substantive rationale",
        );
      }
      if (!issuePattern.test(entry.issue ?? "")) {
        fail(
          location,
          "not_implemented entries require a tracked GitHub issue",
        );
      }
      break;
    case "not_applicable":
      if (!nonEmptyString(entry.rationale) || entry.rationale.length < 20) {
        fail(
          location,
          "not_applicable entries require a substantive rationale",
        );
      }
      break;
  }
};

const headingSlug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const validateCanonicalSource = async (source, location, manifest) => {
  if (!nonEmptyString(source) || !source.includes("#")) {
    fail(location, "must contain a governance-doc path and heading anchor");
    return;
  }
  if (!governanceDirectory) return;

  const [sourcePath, anchor] = source.split("#", 2);
  const governanceRoot = path.resolve(governanceDirectory);
  const resolved = path.resolve(governanceRoot, sourcePath);
  if (!resolved.startsWith(`${governanceRoot}${path.sep}`)) {
    fail(
      location,
      "canonical source must stay inside the governance repository",
    );
    return;
  }
  let contents;
  try {
    contents = await readFile(resolved, "utf8");
  } catch {
    fail(location, `canonical source does not exist: ${sourcePath}`);
    return;
  }
  const anchors = contents
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => headingSlug(line.replace(/^#{1,6}\s+/, "")));
  if (!anchors.includes(anchor)) {
    fail(
      location,
      `heading anchor '${anchor}' does not exist in ${sourcePath}`,
    );
  }

  const gitHeadPath = path.join(governanceRoot, ".git", "HEAD");
  try {
    const head = (await readFile(gitHeadPath, "utf8")).trim();
    if (head.startsWith("ref:")) {
      const refPath = path.join(governanceRoot, ".git", head.slice(5));
      const commit = (await readFile(refPath, "utf8")).trim();
      if (commit !== manifest.governance.commit) {
        fail("governance.commit", `checked-out governance SHA is ${commit}`);
      }
    } else if (head !== manifest.governance.commit) {
      fail("governance.commit", `checked-out governance SHA is ${head}`);
    }
  } catch {
    fail(
      "governance.commit",
      "could not verify the governance repository HEAD",
    );
  }
};

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  console.error(`FSPM conformance profile could not be read: ${error.message}`);
  process.exit(1);
}

rejectUnknownKeys(
  manifest,
  [
    "$schema",
    "schema",
    "profileVersion",
    "profileStatus",
    "evaluatedAt",
    "implementationBaseline",
    "governance",
    "statusDefinitions",
    "components",
  ],
  "profile",
);
requireKeys(
  manifest,
  [
    "schema",
    "profileVersion",
    "profileStatus",
    "evaluatedAt",
    "implementationBaseline",
    "governance",
    "statusDefinitions",
    "components",
  ],
  "profile",
);

if (manifest.schema !== "screeps-fspm-conformance/v1")
  fail("schema", "unsupported schema");
if (!Number.isInteger(manifest.profileVersion) || manifest.profileVersion < 1) {
  fail("profileVersion", "must be a positive integer");
}
if (!new Set(["partial", "full"]).has(manifest.profileStatus)) {
  fail("profileStatus", "must be partial or full");
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.evaluatedAt ?? "")) {
  fail("evaluatedAt", "must use YYYY-MM-DD");
}
if (!shaPattern.test(manifest.implementationBaseline ?? "")) {
  fail("implementationBaseline", "must be a full lowercase Git SHA");
}
if (!manifest.governance || typeof manifest.governance !== "object") {
  fail("governance", "must be an object");
} else {
  rejectUnknownKeys(
    manifest.governance,
    ["repository", "commit", "reviewRule"],
    "governance",
  );
  requireKeys(
    manifest.governance,
    ["repository", "commit", "reviewRule"],
    "governance",
  );
  if (manifest.governance.repository !== "Namauu/governance-docs") {
    fail("governance.repository", "must identify the authoritative repository");
  }
  if (!shaPattern.test(manifest.governance.commit ?? "")) {
    fail("governance.commit", "must be a full lowercase Git SHA");
  }
}

const catalogSource = await readFile(
  path.join(root, "packages/runtime/src/planning/fspm-catalog.ts"),
  "utf8",
);
const pinnedSha = catalogSource.match(
  /FSPM_GOVERNANCE_SHA\s*=\s*"([0-9a-f]{40})"/,
)?.[1];
if (!pinnedSha) {
  fail(
    "governance.commit",
    "runtime catalog does not expose a full FSPM_GOVERNANCE_SHA",
  );
} else if (pinnedSha !== manifest.governance.commit) {
  fail(
    "governance.commit",
    `manifest SHA differs from runtime catalog SHA ${pinnedSha}`,
  );
}

if (
  !manifest.statusDefinitions ||
  typeof manifest.statusDefinitions !== "object"
) {
  fail("statusDefinitions", "must be an object");
} else {
  const definitionKeys = Object.keys(manifest.statusDefinitions).sort();
  const statusKeys = [...allowedStatuses].sort();
  if (JSON.stringify(definitionKeys) !== JSON.stringify(statusKeys)) {
    fail(
      "statusDefinitions",
      "must define exactly the four conformance statuses",
    );
  }
}

const counts = Object.fromEntries(
  [...allowedStatuses].map((status) => [status, 0]),
);
const componentKeys = new Set();
if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
  fail("components", "must be a non-empty array");
} else {
  for (const [componentIndex, component] of manifest.components.entries()) {
    const location = `components[${componentIndex}]`;
    if (
      !component ||
      typeof component !== "object" ||
      Array.isArray(component)
    ) {
      fail(location, "must be an object");
      continue;
    }
    rejectUnknownKeys(
      component,
      [
        "key",
        "name",
        "status",
        "owner",
        "issue",
        "canonicalSources",
        "fields",
        "invariants",
      ],
      location,
    );
    requireKeys(
      component,
      [
        "key",
        "name",
        "status",
        "owner",
        "canonicalSources",
        "fields",
        "invariants",
      ],
      location,
    );
    if (!keyPattern.test(component.key ?? ""))
      fail(location, "key must use snake_case");
    if (componentKeys.has(component.key))
      fail(location, `duplicate component key '${component.key}'`);
    componentKeys.add(component.key);
    if (!allowedStatuses.has(component.status))
      fail(location, `unknown status '${component.status}'`);
    if (!/^area:[a-z0-9_-]+$/.test(component.owner ?? "")) {
      fail(location, "owner must be an area label");
    }
    if (
      component.status === "not_implemented" &&
      !issuePattern.test(component.issue ?? "")
    ) {
      fail(location, "a non-conformant component requires a tracked issue");
    }
    requireUniqueStrings(
      component.canonicalSources,
      `${location}.canonicalSources`,
    );
    if (Array.isArray(component.canonicalSources)) {
      for (const [
        sourceIndex,
        source,
      ] of component.canonicalSources.entries()) {
        await validateCanonicalSource(
          source,
          `${location}.canonicalSources[${sourceIndex}]`,
          manifest,
        );
      }
    }

    const entries = [
      ["fields", component.fields],
      ["invariants", component.invariants],
    ];
    let componentHasMissing = false;
    for (const [entryKind, values] of entries) {
      if (!Array.isArray(values) || values.length === 0) {
        fail(`${location}.${entryKind}`, "must be a non-empty array");
        continue;
      }
      const entryKeys = new Set();
      for (const [entryIndex, entry] of values.entries()) {
        const entryLocation = `${location}.${entryKind}[${entryIndex}]`;
        await validateEntry(entry, entryLocation);
        if (entryKeys.has(entry?.key))
          fail(entryLocation, `duplicate key '${entry?.key}'`);
        entryKeys.add(entry?.key);
        if (allowedStatuses.has(entry?.status)) counts[entry.status] += 1;
        if (entry?.status === "not_implemented") componentHasMissing = true;
      }
    }
    if (componentHasMissing && component.status !== "not_implemented") {
      fail(
        location,
        "component with a missing field or invariant must be not_implemented",
      );
    }
  }
}

if (manifest.profileStatus === "full" && counts.not_implemented > 0) {
  fail(
    "profileStatus",
    "full parity is forbidden while any required item is not implemented",
  );
}
if (manifest.profileStatus === "partial" && counts.not_implemented === 0) {
  fail("profileStatus", "partial profile has no remaining missing items");
}

const summary = {
  schema: manifest.schema,
  profileVersion: manifest.profileVersion,
  profileStatus: manifest.profileStatus,
  governanceCommit: manifest.governance?.commit ?? null,
  components: componentKeys.size,
  items: Object.values(counts).reduce((sum, count) => sum + count, 0),
  counts,
  valid: failures.length === 0,
};

const markdownCell = (value) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

const componentCounts = (component) => {
  const result = Object.fromEntries(
    [...allowedStatuses].map((status) => [status, 0]),
  );
  for (const entry of [
    ...(component.fields ?? []),
    ...(component.invariants ?? []),
  ]) {
    if (allowedStatuses.has(entry.status)) result[entry.status] += 1;
  }
  return result;
};

const renderMarkdownReport = () => {
  const lines = [
    "# NTI FSPM conformance report",
    "",
    `- Profile: \`${manifest.schema}\` v${manifest.profileVersion} (\`${manifest.profileStatus}\`)`,
    `- Evaluated: ${manifest.evaluatedAt}`,
    `- Implementation baseline: \`${manifest.implementationBaseline}\``,
    `- Governance authority: \`${manifest.governance.repository}@${manifest.governance.commit}\``,
    `- Coverage: ${summary.items} mapped fields and invariants across ${summary.components} components`,
    `- Result: ${summary.valid ? "valid" : "invalid"}`,
    "",
    "## Coverage summary",
    "",
    "| Component | Status | Implemented | Adapted | Missing | N/A | Owner | Tracking |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];

  for (const component of manifest.components ?? []) {
    const componentSummary = componentCounts(component);
    lines.push(
      `| ${markdownCell(component.name)} | \`${markdownCell(component.status)}\` | ${componentSummary.implemented} | ${componentSummary.adapted} | ${componentSummary.not_implemented} | ${componentSummary.not_applicable} | \`${markdownCell(component.owner)}\` | ${markdownCell(component.issue ?? "—")} |`,
    );
  }

  lines.push(
    "",
    "## Open conformance gaps",
    "",
    "| Component | Kind | Canonical item | Tracking | Rationale |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const component of manifest.components ?? []) {
    for (const [kind, entries] of [
      ["Field", component.fields ?? []],
      ["Invariant", component.invariants ?? []],
    ]) {
      for (const entry of entries) {
        if (entry.status !== "not_implemented") continue;
        lines.push(
          `| ${markdownCell(component.name)} | ${kind} | \`${markdownCell(entry.key)}\` | ${markdownCell(entry.issue)} | ${markdownCell(entry.rationale)} |`,
        );
      }
    }
  }

  lines.push("", "## Canonical sources", "");
  for (const component of manifest.components ?? []) {
    lines.push(
      `- **${component.name}:** ${component.canonicalSources.map((source) => `\`${source}\``).join(", ")}`,
    );
  }
  lines.push("");
  return lines.join("\n");
};

if (jsonOutput) {
  console.log(JSON.stringify({ ...summary, failures }, null, 2));
} else if (markdownOutput && failures.length === 0) {
  console.log(renderMarkdownReport());
} else if (failures.length === 0) {
  console.log(
    `FSPM conformance profile valid: ${summary.components} components, ${summary.items} mapped fields/invariants (${counts.implemented} implemented, ${counts.adapted} adapted, ${counts.not_implemented} not implemented, ${counts.not_applicable} not applicable).`,
  );
} else {
  console.error(
    `FSPM conformance profile failed with ${failures.length} finding(s):`,
  );
  for (const finding of failures) console.error(`- ${finding}`);
}

process.exit(failures.length === 0 ? 0 : 1);
