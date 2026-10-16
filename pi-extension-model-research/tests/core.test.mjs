import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceRun,
  automaticWriterSelection,
  cancelRun,
  chooseWriter,
  createRun,
} from "../src/engine.ts";
import { FIXED_REFERENCE_PATHS, RECIPROCAL_REVIEW_RUBRIC } from "../src/types.ts";
import {
  ValidationError,
  parseResearchReport,
  validateRun,
  validateSkillDraft,
} from "../src/validation.ts";

const AS_OF = "2026-05-20";
const CREATED = "2026-05-20T10:00:00.000Z";
const EXPIRES = "2099-05-20T10:00:00.000Z";

function target(key, overrides = {}) {
  const isA = key === "a";
  return {
    key,
    displayName: isA ? "Alpha Researcher" : "Beta Researcher",
    modelAuthor: isA ? "Author Alpha" : "Author Beta",
    model: isA ? "alpha-1" : "beta-2",
    hostingProvider: overrides.hostingProvider ?? "shared-gateway",
    transport: isA ? "pi-registry" : "t3-delegate",
    settings: { thinking: isA ? "medium" : "high", tools: "read-only-web" },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    runId: overrides.runId ?? "run-core-1",
    task: "Choose the better model for writing reusable Pi skills.",
    asOfDate: AS_OF,
    createdAt: CREATED,
    targets: overrides.targets ?? [target("a"), target("b")],
    limits: {
      maxJobs: 5,
      perCall: { timeoutMs: 60_000, maxTurns: 8, maxTokens: 12_000 },
      expiresAt: EXPIRES,
    },
  };
}

function evidence(key, options = {}) {
  return {
    id: `${key}-ev-${options.number ?? 1}`,
    url: options.url ?? `https://example.com/${key}/${options.number ?? 1}`,
    accessedAt: AS_OF,
    sourceAccess: options.sourceAccess ?? "fetched",
    evidenceClass: options.evidenceClass ?? "documented",
    topics: options.topics ?? ["skill-writing"],
    supportsTarget: options.supportsTarget ?? key,
    title: `Evidence for ${key}`,
    excerptOrGap: options.excerptOrGap ?? "A bounded source summary that does not claim structural validation is fact-checking.",
    conditions: options.conditions ?? "Observed for skill authoring under the stated harness settings.",
  };
}

function report(key, options = {}) {
  const ev = options.evidence ?? [evidence(key, options.evidenceOptions)];
  return {
    schemaVersion: 1,
    researcher: target(key),
    subjectTargets: ["a", "b"],
    asOfDate: options.asOfDate ?? AS_OF,
    taskSpecificRecommendation: `Use ${key} under the stated skill-writing conditions; preserve the listed limitations.`,
    arguments: options.arguments ?? [{
      id: `${key}-arg-1`,
      task: "Writing a portable SKILL.md",
      claim: `Target ${key} is useful under a bounded condition.`,
      classification: options.classification ?? "documented",
      evidenceIds: ev.map((entry) => entry.id),
      support: "The cited source supports only the bounded recommendation.",
      counterevidence: "No comparative causal conclusion follows from this source alone.",
      conditions: "Same prompt, harness, and tool constraints.",
      recommendation: `Route this task to ${key} only when those conditions hold.`,
      confidence: 72,
    }],
    evidence: ev,
    counterevidenceAndConditions: ["Harness and model-version changes may alter the result."],
    confidence: 70,
    socialCoverage: {
      x: { status: "gap", evidenceIds: [], gap: "X was inaccessible without credentials." },
      reddit: { status: "gap", evidenceIds: [], gap: "No relevant fetched Reddit thread was available." },
      other: { status: "gap", evidenceIds: [], gap: "No other social source was verified.", platforms: [] },
    },
    accessGaps: ["Social discussion remained inaccessible and was not treated as fetched."],
  };
}

function review(key, recommendation = "undetermined", writerEvidenceIds = []) {
  return {
    schemaVersion: 1,
    reviewer: target(key),
    reviewedOriginals: ["a", "b"],
    rubric: [...RECIPROCAL_REVIEW_RUBRIC],
    usefulnessVsOwn: {
      verdict: "mixed",
      explanation: "The peer is more specific on one condition, while my report retains clearer access gaps.",
    },
    corrections: [],
    disagreements: [],
    missingEvidence: ["No live comparative trial was performed."],
    writerRecommendation: recommendation,
    writerEvidenceIds,
    confidence: 64,
  };
}

function skillDraft() {
  const links = FIXED_REFERENCE_PATHS.map((path) => `- [Evidence record](${path})`).join("\n");
  return `---\nname: model-routing-skill-writing\ndescription: Use this dated guide to choose between two configured model families for writing portable skills.\n---\n\n## Routing guidance\n\nAs of ${AS_OF}, compare alpha-1 and beta-2 and choose a target only under the task, harness, and evidence conditions recorded below. Documented or measured support is stronger than anecdotal discussion, and no recommendation automatically switches models.\n\n## Limits and uncertainty\n\nThis draft does not claim live evidence verification. Social access gaps, model updates, hosting differences, tool settings, and unresolved counterevidence limit every recommendation. Structural validation checks shape and references, not truth.\n\n## Refresh triggers\n\nRefresh after a model version, hosting path, price, tool policy, or material skill format changes, or when newer fetched comparative evidence becomes available.\n\n## Supporting evidence\n\n${links}\n`;
}

function json(value) {
  return JSON.stringify(value);
}

function checkpointRecorder() {
  const snapshots = [];
  return {
    snapshots,
    save(run) {
      snapshots.push(structuredClone(run));
    },
  };
}

class ScriptedRuntime {
  kind = "t3";
  starts = [];
  checks = [];
  cancels = [];

  constructor(startOutcomes, checkOutcomes = {}) {
    this.startOutcomes = startOutcomes;
    this.checkOutcomes = checkOutcomes;
  }

  async start(job) {
    this.starts.push({ key: job.key, status: job.status, prompt: job.prompt, requestId: job.requestId });
    const outcome = this.startOutcomes[job.key];
    if (outcome instanceof Error) throw outcome;
    if (!outcome) throw new Error(`No start outcome for ${job.key}`);
    return typeof outcome === "function" ? outcome(job) : outcome;
  }

  async check(job) {
    this.checks.push({ key: job.key, taskId: job.taskId, requestId: job.requestId });
    const queue = this.checkOutcomes[job.key];
    const outcome = Array.isArray(queue) ? queue.shift() : queue;
    if (outcome instanceof Error) throw outcome;
    if (!outcome) throw new Error(`No check outcome for ${job.key}`);
    return outcome;
  }

  async cancel(job) {
    this.cancels.push({ key: job.key, taskId: job.taskId, requestId: job.requestId });
  }
}

test("sequences independent research, freezes exact originals, uses the same rubric, and waits on a tie", async () => {
  const rawResearchA = json(report("a"));
  const rawResearchB = json(report("b"));
  const rawReviewA = json(review("a"));
  const rawReviewB = json(review("b"));
  const runtime = new ScriptedRuntime({
    "research-a": { status: "complete", text: rawResearchA },
    "research-b": { status: "complete", text: rawResearchB },
    "review-a": { status: "complete", text: rawReviewA },
    "review-b": { status: "complete", text: rawReviewB },
    draft: { status: "complete", text: skillDraft() },
  });
  const recorder = checkpointRecorder();
  const run = createRun(input());

  await advanceRun(run, runtime, recorder.save);

  assert.equal(run.status, "awaiting_writer");
  assert.equal(run.stage, "writer_selection");
  assert.equal(run.originals.a.raw, rawResearchA);
  assert.equal(run.originals.b.raw, rawResearchB);
  assert.equal(run.reviews.a.raw, rawReviewA);
  assert.equal(run.reviews.b.raw, rawReviewB);
  assert.deepEqual(runtime.starts.map((entry) => entry.key), ["research-a", "research-b", "review-a", "review-b"]);
  assert.equal(runtime.starts[0].prompt.includes(rawResearchB), false, "independent research must not see the peer report");
  assert.equal(runtime.starts[1].prompt.includes(rawResearchA), false, "independent research must not see the peer report");
  for (const key of ["review-a", "review-b"]) {
    const reviewStart = runtime.starts.find((entry) => entry.key === key);
    assert.ok(reviewStart.prompt.includes(rawResearchA));
    assert.ok(reviewStart.prompt.includes(rawResearchB));
    assert.ok(reviewStart.prompt.includes(JSON.stringify(RECIPROCAL_REVIEW_RUBRIC)));
  }
  assert.ok(recorder.snapshots.some((snapshot) => snapshot.jobs.some((entry) => entry.status === "dispatching")));

  chooseWriter(run, "b", "The user explicitly chose B after the evidence tie.", "2026-05-20T11:00:00.000Z");
  const draftJob = run.jobs.find((entry) => entry.key === "draft");
  for (const exactOutput of [rawResearchA, rawResearchB, rawReviewA, rawReviewB]) assert.ok(draftJob.prompt.includes(exactOutput));
  assert.ok(draftJob.prompt.includes("The user explicitly chose B"));
  assert.ok(draftJob.prompt.includes(AS_OF));

  await advanceRun(run, runtime, recorder.save);
  assert.equal(run.status, "complete");
  assert.equal(run.writerSelection.mode, "user");
  assert.equal(run.skillDraft, skillDraft());
  validateRun(run);
});

test("rejects targets from the same model-author family while allowing shared hosting", () => {
  assert.throws(
    () => createRun(input({ targets: [target("a", { modelAuthor: "Same Author" }), target("b", { modelAuthor: " same author " })] })),
    /model-author families must differ/,
  );
  assert.doesNotThrow(() => createRun(input({ runId: "shared-host-ok" })));
});

test("strict research validation checks HTTP sources, evidence references, confidence, and non-empty evidence", () => {
  const invalidReference = report("a");
  invalidReference.arguments[0].evidenceIds = ["a-missing"];
  assert.throws(() => parseResearchReport(json(invalidReference), target("a"), [target("a"), target("b")]), /unknown evidence/);

  const invalidUrl = report("a");
  invalidUrl.evidence[0].url = "file:///tmp/fake";
  assert.throws(() => parseResearchReport(json(invalidUrl), target("a"), [target("a"), target("b")]), /HTTP\(S\)/);

  const invalidConfidence = report("a");
  invalidConfidence.confidence = 101;
  assert.throws(() => parseResearchReport(json(invalidConfidence), target("a"), [target("a"), target("b")]), /0 through 100/);

  const empty = report("a", { evidence: [], arguments: [] });
  assert.throws(() => parseResearchReport(json(empty), target("a"), [target("a"), target("b")]), /must contain 1 through/);
});

test("automatic writer selection requires matching recommendations and qualifying evidence cited by both reviews", async () => {
  const evA = evidence("a", { topics: ["general-routing"] });
  const evB = evidence("b", { topics: ["skill-writing"], sourceAccess: "fetched", evidenceClass: "measured", supportsTarget: "b" });
  const runtime = new ScriptedRuntime({
    "research-a": { status: "complete", text: json(report("a", { evidence: [evA] })) },
    "research-b": { status: "complete", text: json(report("b", { evidence: [evB], classification: "measured" })) },
    "review-a": { status: "complete", text: json(review("a", "b", [evB.id])) },
    "review-b": { status: "complete", text: json(review("b", "b", [evB.id])) },
    draft: { status: "complete", text: skillDraft() },
  });
  const run = createRun(input({ runId: "auto-writer" }));
  await advanceRun(run, runtime, () => {});

  assert.equal(run.status, "complete");
  assert.equal(run.writerSelection.target, "b");
  assert.equal(run.writerSelection.mode, "automatic");
  assert.deepEqual(run.writerSelection.evidenceIds, [evB.id]);
  assert.equal(automaticWriterSelection(run).target, "b");
});

test("matching votes without fetched non-anecdotal skill-writing evidence still await explicit choice", async () => {
  const weak = evidence("b", { sourceAccess: "snippet", evidenceClass: "anecdotal", topics: ["skill-writing"] });
  const runtime = new ScriptedRuntime({
    "research-a": { status: "complete", text: json(report("a")) },
    "research-b": { status: "complete", text: json(report("b", { evidence: [weak], classification: "anecdotal" })) },
    "review-a": { status: "complete", text: json(review("a", "b", [weak.id])) },
    "review-b": { status: "complete", text: json(review("b", "b", [weak.id])) },
  });
  const run = createRun(input({ runId: "weak-votes" }));
  await advanceRun(run, runtime, () => {});
  assert.equal(run.status, "awaiting_writer");
  assert.equal(run.writerSelection, undefined);
  assert.equal(run.jobs.length, 4, "no extra paid trial or draft may be dispatched before a choice");
});

test("malformed JSON fails explicitly while retaining the successful peer output", async () => {
  const rawB = json(report("b"));
  const runtime = new ScriptedRuntime({
    "research-a": { status: "complete", text: "{not json" },
    "research-b": { status: "complete", text: rawB },
  });
  const run = createRun(input({ runId: "invalid-json" }));
  await advanceRun(run, runtime, () => {});

  assert.equal(run.status, "error");
  assert.equal(run.error.code, "invalid_output");
  assert.equal(run.jobs.find((entry) => entry.key === "research-a").result, "{not json");
  assert.equal(run.jobs.find((entry) => entry.key === "research-b").status, "complete");
  assert.equal(run.jobs.find((entry) => entry.key === "research-b").result, rawB);
  assert.equal(run.originals, undefined);
  validateRun(run);
});

test("pending jobs resume with one check and stable IDs without duplicate starts", async () => {
  const runtime = new ScriptedRuntime({
    "research-a": { status: "pending", taskId: "external-a" },
    "research-b": { status: "complete", text: json(report("b")) },
    "review-a": { status: "complete", text: json(review("a")) },
    "review-b": { status: "complete", text: json(review("b")) },
  }, {
    "research-a": [{ status: "complete", text: json(report("a")) }],
  });
  const run = createRun(input({ runId: "pending-resume" }));

  await advanceRun(run, runtime, () => {});
  assert.equal(run.status, "running");
  assert.equal(run.jobs.find((entry) => entry.key === "research-a").taskId, "external-a");
  assert.deepEqual(runtime.starts.map((entry) => entry.key), ["research-a", "research-b"]);

  await advanceRun(run, runtime, () => {});
  assert.equal(run.status, "awaiting_writer");
  assert.equal(runtime.starts.filter((entry) => entry.key === "research-a").length, 1);
  assert.deepEqual(runtime.checks, [{ key: "research-a", taskId: "external-a", requestId: "pending-resume:research-a" }]);
});

test("cancellation is checkpointed and cancels external tasks without erasing completed work", async () => {
  const runtime = new ScriptedRuntime({
    "research-a": { status: "pending", taskId: "task-a" },
    "research-b": { status: "pending", taskId: "task-b" },
  });
  const recorder = checkpointRecorder();
  const run = createRun(input({ runId: "cancel-run" }));
  await advanceRun(run, runtime, recorder.save);
  await cancelRun(run, runtime, recorder.save, "User stopped the paid run");

  assert.equal(run.status, "cancelled");
  assert.equal(run.cancellationReason, "User stopped the paid run");
  assert.deepEqual(runtime.cancels.map((entry) => entry.key), ["research-a", "research-b"]);
  assert.ok(run.jobs.every((entry) => entry.status === "cancelled"));
  assert.ok(recorder.snapshots.some((snapshot) => snapshot.status === "cancelled"));
  validateRun(run);
});

test("a persisted dispatch-in-progress blocks instead of relaunching", async () => {
  const run = createRun(input({ runId: "uncertain-dispatch" }));
  run.jobs[0].status = "dispatching";
  run.jobs[0].dispatchedAt = "2026-05-20T10:01:00.000Z";
  validateRun(run);
  const runtime = new ScriptedRuntime({});
  await advanceRun(run, runtime, () => {});

  assert.equal(run.status, "error");
  assert.equal(run.error.code, "uncertain_dispatch");
  assert.equal(runtime.starts.length, 0);
});

test("a thrown start preserves dispatching state and proves the pre-dispatch checkpoint", async () => {
  const runtime = new ScriptedRuntime({ "research-a": new Error("connection dropped after send") });
  const recorder = checkpointRecorder();
  const run = createRun(input({ runId: "throw-during-dispatch" }));
  await advanceRun(run, runtime, recorder.save);

  assert.equal(run.status, "error");
  assert.equal(run.error.code, "uncertain_dispatch");
  assert.equal(run.jobs[0].status, "dispatching");
  assert.ok(recorder.snapshots.some((snapshot) => snapshot.jobs[0].status === "dispatching" && snapshot.status === "running"));
  assert.deepEqual(runtime.starts.map((entry) => entry.key), ["research-a"]);
});

test("run expiry records cancellation without dispatching another paid job", async () => {
  const expiredInput = input({ runId: "expired-run" });
  expiredInput.createdAt = "2000-01-01T00:00:00.000Z";
  expiredInput.asOfDate = "2000-01-01";
  expiredInput.limits.expiresAt = "2000-01-02T00:00:00.000Z";
  const runtime = new ScriptedRuntime({});
  const run = createRun(expiredInput);
  await advanceRun(run, runtime, () => {});

  assert.equal(run.status, "cancelled");
  assert.equal(run.error.code, "expired");
  assert.equal(runtime.starts.length, 0);
  assert.ok(run.jobs.every((entry) => entry.status === "cancelled"));
  validateRun(run);
});

test("skill validation enforces portable frontmatter, dated limits, and fixed links", () => {
  assert.equal(validateSkillDraft(skillDraft(), AS_OF), skillDraft());
  assert.throws(() => validateSkillDraft(skillDraft().replace(`](${FIXED_REFERENCE_PATHS[0]})`, "](references/other.json)"), AS_OF), /missing fixed reference/);
  assert.throws(() => validateSkillDraft(skillDraft().replace(`As of ${AS_OF}`, "As of an unknown date"), AS_OF), /must state evidence as-of date/);
  assert.throws(() => validateSkillDraft("---\nname: Bad Name\ndescription: bad\n---\nshort", AS_OF), /lowercase hyphenated/);
  for (const scalar of ["true", "null", "123", ".5", ".inf"]) assert.throws(() => validateSkillDraft(skillDraft().replace(/^description: .+$/m, `description: ${scalar}`), AS_OF), /unsafe YAML/);
  assert.doesNotThrow(() => validateSkillDraft(skillDraft().replace(/^description: .+$/m, 'description: "true"'), AS_OF));
  for (const name of ["true", "123", "1e3"]) assert.throws(() => validateSkillDraft(skillDraft().replace(/^name: .+$/m, `name: ${name}`), AS_OF), /non-scalar YAML/);
});

test("retains completed T3 task IDs and cancels errored pending checks", async () => {
  const run = createRun(input({ runId: "task-audit" }));
  const runtime = new ScriptedRuntime({
    "research-a": { status: "pending", taskId: "task-a" },
    "research-b": { status: "pending", taskId: "task-b" },
  }, {
    "research-a": { status: "complete", text: json(report("a")) },
    "research-b": new Error("temporary status transport failure"),
  });
  await advanceRun(run, runtime, () => {});
  await advanceRun(run, runtime, () => {});
  assert.equal(run.jobs[0].taskId, "task-a");
  assert.equal(run.jobs[1].taskId, "task-b");
  assert.equal(run.status, "error");
  await cancelRun(run, runtime, () => {});
  assert.ok(runtime.cancels.some(entry => entry.taskId === "task-b"));
  validateRun(run);
});

test("rejects unsafe draft links and ambiguous YAML and invalid calendar dates", () => {
  assert.throws(() => validateSkillDraft(skillDraft() + "\n[escape](../../outside)\n", AS_OF), /unsupported link/);
  assert.throws(() => validateSkillDraft(skillDraft().replace("description: Use", "description: Choose: Use"), AS_OF), /unsafe YAML/);
  const badDate = report("a", { asOfDate: "2026-02-31" });
  assert.throws(() => parseResearchReport(json(badDate), target("a"), [target("a"), target("b")]), /valid YYYY-MM-DD/);
});

test("rechecks expiry between model dispatches", async () => {
  const configuration = input({ runId: "expiry-between" });
  configuration.createdAt = "2000-01-01T00:00:00.000Z";
  const run = createRun(configuration);
  const runtime = new ScriptedRuntime({
    "research-a": () => {
      run.limits.expiresAt = new Date(Date.now() - 1000).toISOString();
      return { status: "complete", text: json(report("a")) };
    },
  });
  await advanceRun(run, runtime, () => {});
  assert.equal(run.error.code, "expired");
  assert.deepEqual(runtime.starts.map(entry => entry.key), ["research-a"]);
});

test("run persistence validation is bounded and strict", () => {
  const run = createRun(input({ runId: "strict-run" }));
  const withExtra = structuredClone(run);
  withExtra.unexpected = true;
  assert.throws(() => validateRun(withExtra), ValidationError);

  const wrongRequest = structuredClone(run);
  wrongRequest.jobs[0].requestId = "unstable";
  assert.throws(() => validateRun(wrongRequest), /stable run-specific request ID/);
});
