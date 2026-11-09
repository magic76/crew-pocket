#!/usr/bin/env node

const apiBase = "https://api.github.com";
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const dryRun = String(process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const summaryFile = process.env.GITHUB_STEP_SUMMARY;

if (!token || !repository || !repository.includes("/")) {
  throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const repoName = repository.split("/")[1];
const cutoffDays = 7;
const prHeadShas = await listOpenPullRequestHeadShas();
const artifacts = await listArtifacts();
const latestThree = new Set(
  [...artifacts]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 3)
    .map((artifact) => artifact.id),
);
const runCache = new Map();
let releasesPromise;

const scanned = artifacts.length;
let oldCount = 0;
let oldBytes = 0;
const candidates = [];
const heldReasons = new Map();

for (const artifact of artifacts) {
  const ageDays = (Date.now() - Date.parse(artifact.created_at)) / 86_400_000;
  const minAgeDays = repoName === "magic76.github.io" && artifact.name.startsWith("crew-shorts-daily-") ? 14 : cutoffDays;
  if (ageDays < minAgeDays) {
    continue;
  }

  oldCount += 1;
  oldBytes += artifact.size_in_bytes;

  let decision;
  if (latestThree.has(artifact.id)) {
    decision = { delete: false, reason: "latest three artifacts" };
  } else if (prHeadShas.has(artifact.workflow_run?.head_sha)) {
    decision = { delete: false, reason: "artifact belongs to an open pull request head" };
  } else {
    decision = await decideArtifact(artifact);
  }

  if (decision.delete) {
    candidates.push(artifact);
  } else {
    heldReasons.set(decision.reason, (heldReasons.get(decision.reason) ?? 0) + 1);
  }
}

const candidateBytes = candidates.reduce((sum, artifact) => sum + artifact.size_in_bytes, 0);
let deletedCount = 0;
let deletedBytes = 0;
let alreadyGone = 0;
const failures = [];

if (!dryRun) {
  await parallel(candidates, 4, async (artifact) => {
    try {
      await request("/repos/" + repository + "/actions/artifacts/" + artifact.id, { method: "DELETE" });
      deletedCount += 1;
      deletedBytes += artifact.size_in_bytes;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        alreadyGone += 1;
        return;
      }
      failures.push({ id: artifact.id, name: artifact.name, message: error.message });
    }
  });
}

const report = {
  scanned,
  oldCount,
  oldBytes,
  candidateCount: candidates.length,
  candidateBytes,
  deletedCount,
  deletedBytes,
  alreadyGone,
  heldReasons: Object.fromEntries([...heldReasons.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  failures,
  dryRun,
};

console.log(JSON.stringify(report, null, 2));
await writeSummary(report);
if (failures.length > 0) {
  process.exitCode = 1;
}

async function decideArtifact(artifact) {
  const name = artifact.name;

  if (repoName === "crew-pocket") {
    const names = new Set([
      "crew-pocket-runtime-debug",
      "crew-pocket-runtime-dev-debug",
      "crew-pocket-dev-debug",
      "crew-pocket-android-wrapper-debug",
    ]);
    return names.has(name) ? allow("old debug build") : hold("unrecognized artifact name");
  }

  if (repoName === "crew-infinite-click") {
    return name === "ai-infinite-click-mvp-debug" ? allow("old debug build") : hold("unrecognized artifact name");
  }

  if (repoName === "crew-builder") {
    return ["crew-builder-debug", "crew-forge-debug"].includes(name)
      ? allow("old debug build")
      : hold("unrecognized artifact name");
  }

  if (repoName === "crew-helper") {
    if (!["CrewHelper-Release-APK", "CrewHelper-Release-AAB"].includes(name)) {
      return hold("unrecognized artifact name");
    }
    const run = await getRun(artifact);
    if (!run) return hold("workflow run details unavailable");
    if (run.conclusion !== "success" || workflowPath(run.path) !== ".github/workflows/build.yml") {
      return hold("build did not complete successfully in the expected workflow");
    }
    if (run.event === "pull_request") return allow("old pull request build");
    if (run.event === "workflow_dispatch") return hold("manual build purpose is unconfirmed");
    if (run.event !== "push") return hold("build event is not covered by cleanup policy");

    const branch = String(run.head_branch ?? "").replace(/^refs\/tags\//, "");
    if (/^v\d/.test(branch)) {
      const extension = name.endsWith("-APK") ? ".apk" : ".aab";
      const releases = await listReleases();
      const release = releases.find((item) => item.tag_name === branch && !item.draft && !item.prerelease);
      const hasAsset = release?.assets?.some((asset) => String(asset.name).toLowerCase().endsWith(extension));
      return hasAsset
        ? allow("published GitHub release contains matching asset")
        : hold("tag artifact retained until the published release asset is confirmed");
    }
    return ["main", "master"].includes(branch) ? allow("old successful mainline build") : hold("non-main branch build is unconfirmed");
  }

  if (repoName === "crew-teacher") {
    if (name === "CrewTeacher-camera-dev") return allow("old ephemeral test APK");
    if (!(name === "CrewTeacher-main-release" || /^CrewTeacher-\d+\.\d+\.\d+-\d+$/.test(name))) {
      return hold("unrecognized artifact name");
    }
    const run = await getRun(artifact);
    if (!run) return hold("workflow run details unavailable");
    if (run.conclusion !== "success" || workflowPath(run.path) !== ".github/workflows/play-aab.yml") {
      return hold("Play build or publish did not complete successfully");
    }
    if (run.event === "workflow_dispatch") return allow("successful manual Google Play upload");
    if (run.event === "push" && run.head_branch === "main") {
      return allow("successful mainline Google Play upload");
    }
    return hold("tag or non-published Teacher bundle is retained");
  }

  if (repoName === "crew-story") {
    if (!/^CrewStory-\d+\.\d+\.\d+-\d+$/.test(name)) return hold("unrecognized artifact name");
    const run = await getRun(artifact);
    if (!run) return hold("workflow run details unavailable");
    if (run.conclusion !== "success" || workflowPath(run.path) !== ".github/workflows/android-aab.yml") {
      return hold("AAB build or publish did not complete successfully");
    }
    if (run.event === "pull_request") return allow("old successful pull request build");
    if (run.event === "workflow_dispatch") return allow("successful manual Google Play upload");
    if (run.event === "push" && run.head_branch === "main") {
      return hold("mainline AAB has no confirmed Google Play publication");
    }
    return hold("AAB workflow event is not covered by cleanup policy");
  }

  if (repoName === "magic76.github.io") {
    if (name === "crew-app") return allow("old generated web build");
    if (name.startsWith("crew-shorts-daily-")) return allow("review artifact passed its 14-day retention window");
    return hold("deployment or test artifact purpose is unconfirmed");
  }

  return hold("repository has no cleanup policy");
}

async function listArtifacts() {
  const result = await getAllPages("/repos/" + repository + "/actions/artifacts?per_page=100");
  return result.flatMap((page) => page.artifacts ?? []).filter((artifact) => !artifact.expired);
}

async function listOpenPullRequestHeadShas() {
  const pulls = await getAllPages("/repos/" + repository + "/pulls?state=open&per_page=100");
  return new Set(pulls.flatMap((page) => page.map((pull) => pull.head?.sha).filter(Boolean)));
}

async function listReleases() {
  if (!releasesPromise) {
    releasesPromise = getAllPages("/repos/" + repository + "/releases?per_page=100")
      .then((pages) => pages.flat());
  }
  return releasesPromise;
}

async function getRun(artifact) {
  const id = artifact.workflow_run?.id;
  if (!id) return null;
  if (!runCache.has(id)) {
    runCache.set(id, request("/repos/" + repository + "/actions/runs/" + id).catch(() => null));
  }
  return runCache.get(id);
}

function workflowPath(value) {
  return String(value ?? "").split("@", 1)[0];
}

function allow(reason) {
  return { delete: true, reason };
}

function hold(reason) {
  return { delete: false, reason };
}

async function getAllPages(path) {
  let url = apiBase + path;
  const pages = [];
  while (url) {
    const response = await request(url);
    pages.push(response);
    url = response._next ?? null;
  }
  return pages;
}

async function request(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : apiBase + pathOrUrl;
  const method = options.method ?? "GET";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers ?? {}),
      },
    });
    if (response.ok || response.status === 204) {
      if (response.status === 204) return {};
      const data = await response.json();
      const link = response.headers.get("link") ?? "";
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      if (next) data._next = next[1];
      return data;
    }

    const retryAfter = Number(response.headers.get("retry-after") ?? 0);
    const rateLimited = response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
    const retryable = [429, 500, 502, 503, 504].includes(response.status) || (response.status === 403 && (retryAfter > 0 || rateLimited));
    const details = await response.text();
    if (retryable && attempt < 4) {
      const delay = Math.min(Math.max(retryAfter * 1000, 1000 * (2 ** attempt)), 30_000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    throw new ApiError(response.status, method + " " + new URL(url).pathname + " failed: " + details.slice(0, 500));
  }
  throw new Error("GitHub API request exhausted retries.");
}

async function parallel(items, concurrency, callback) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        await callback(current);
      }
    }),
  );
}

async function writeSummary(data) {
  const action = data.dryRun ? "Dry run" : "Cleanup run";
  const holdRows = Object.entries(data.heldReasons)
    .map(([reason, count]) => "| " + escapeMarkdown(reason) + " | " + count + " |")
    .join("\n");
  const failureRows = data.failures.length
    ? data.failures.map((item) => "| " + item.id + " | " + escapeMarkdown(item.name) + " | " + escapeMarkdown(item.message) + " |").join("\n")
    : "| — | — | — |";
  const content = [
    "## Actions artifact cleanup — " + action,
    "",
    "| Measure | Result |",
    "| --- | ---: |",
    "| Artifacts scanned | " + data.scanned + " |",
    "| Older than policy window | " + data.oldCount + " (" + formatBytes(data.oldBytes) + ") |",
    "| Eligible for deletion | " + data.candidateCount + " (" + formatBytes(data.candidateBytes) + ") |",
    "| Deleted | " + data.deletedCount + " (" + formatBytes(data.deletedBytes) + ") |",
    "| Already expired or removed | " + data.alreadyGone + " |",
    "| Failed deletions | " + data.failures.length + " |",
    "",
    "### Retained artifact reasons",
    "",
    "| Reason | Count |",
    "| --- | ---: |",
    holdRows || "| None | 0 |",
    "",
    "### Failed items",
    "",
    "| Artifact ID | Name | Error |",
    "| ---: | --- | --- |",
    failureRows,
    "",
    "Caches, releases, workflow runs, commits, pull requests, and branches are not modified.",
    "",
  ].join("\n");
  if (summaryFile) {
    const fs = await import("node:fs/promises");
    await fs.appendFile(summaryFile, content);
  }
}

function formatBytes(bytes) {
  if (bytes < 1_000_000) return bytes + " B";
  return (bytes / 1_000_000_000).toFixed(3) + " GB";
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
