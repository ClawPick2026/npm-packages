import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModelResearchExtension, inferModelAuthor } from "../index.ts";
import { FIXED_REFERENCE_PATHS, RECIPROCAL_REVIEW_RUBRIC } from "../src/types.ts";

function fixtureOutput(prompt) {
  const identityLine = prompt.match(/^(?:Researcher|Reviewer) identity: (.+)$/m);
  if (identityLine) {
    const identity = JSON.parse(identityLine[1]);
    const key = identity.key;
    if (prompt.includes("Researcher identity:")) {
      const date = prompt.match(/Research cutoff\/as-of date: (\d{4}-\d{2}-\d{2})/)[1];
      return JSON.stringify({
        schemaVersion: 1, researcher: identity, subjectTargets: ["a", "b"], asOfDate: date,
        taskSpecificRecommendation: "Conditional fixture advice; not a real model evaluation.",
        arguments: [{ id: `${key}-arg-1`, task: "Writing a skill", claim: "A bounded fixture claim", classification: "anecdotal", evidenceIds: [`${key}-ev-1`], support: "Synthetic fixture, not measured", counterevidence: "No real evaluation", conditions: "Offline fixture only", recommendation: "Do not treat this as real advice", confidence: 10 }],
        evidence: [{ id: `${key}-ev-1`, url: `https://example.com/${key}`, accessedAt: date, sourceAccess: "snippet", evidenceClass: "anecdotal", topics: ["general-routing"], supportsTarget: "neither", title: "Synthetic test source", excerptOrGap: "This fixture did not fetch a real source.", conditions: "Test only" }],
        counterevidenceAndConditions: ["No real evaluation"], confidence: 10,
        socialCoverage: { x: { status: "gap", evidenceIds: [], gap: "Offline fixture" }, reddit: { status: "gap", evidenceIds: [], gap: "Offline fixture" }, other: { status: "gap", evidenceIds: [], gap: "Offline fixture", platforms: [] } }, accessGaps: ["All live sources omitted"],
      });
    }
    return JSON.stringify({ schemaVersion: 1, reviewer: identity, reviewedOriginals: ["a", "b"], rubric: [...RECIPROCAL_REVIEW_RUBRIC], usefulnessVsOwn: { verdict: "mixed", explanation: "Both fixture reports preserve gaps." }, corrections: [], disagreements: [{ topic: "Suitability", position: "Not established by fixtures", evidenceIds: [] }], missingEvidence: ["Live comparative evidence"], writerRecommendation: "undetermined", writerEvidenceIds: [], confidence: 10 });
  }
  const date = prompt.match(/Evidence as-of date: (\d{4}-\d{2}-\d{2})/)[1];
  return `---\nname: model-routing-fixture\ndescription: Use this fixture only to test generated model-routing drafts.\n---\n\n## Routing guidance\n\nEvidence as of ${date}. Compared IDs: ${[...new Set([...prompt.matchAll(/"model":"([^"]+)"/g)].map(match => match[1]))].join(", ")}. This is synthetic test data, not a recommendation to use one real model over another. Consider the task and the conditions in both reports.\n\n## Limits and uncertainty\n\nNo source was fetched and no capability was measured. The writer was selected by an explicit user choice. Do not treat agreement, schema checks, or fixture results as empirical evidence.\n\n## Refresh triggers\n\nReplace all synthetic findings with actual, dated and reviewed evidence before any real use.\n\n## Supporting evidence\n\n${FIXED_REFERENCE_PATHS.map(ref => `- [Record](${ref})`).join("\n")}\n`;
}

const t3Tools = ["orchestrator_capabilities", "delegate_task", "task_status", "task_cancel"].map(name => ({ name: `mcp__t3-code__${name}`, parameters: { type: "object" } }));
const webTools = ["brave_search"].map(name => ({ name, parameters: { type: "object" } }));

async function setup(t, kind = "pi", options = {}) {
  const temp = await mkdtemp(path.join(tmpdir(), "model-research-integration-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const tools = new Map(); const events = new Map(); const entries = []; const messages = []; const confirmations = []; const modelCalls = []; const hostCalls = []; const tasks = new Map();
  const models = [{ provider: "anthropic", id: "claude-test", name: "Alpha", maxTokens: 20000 }, { provider: "openai-codex", id: "gpt-test", name: "Beta", maxTokens: 20000, ...(options.minimalOnly ? { reasoning: true, thinkingLevelMap: { off: null, minimal: "minimal" } } : {}) }];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); }, registerCommand(_name, command) { this.command = command; }, on(name, fn) { events.set(name, fn); },
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); }, sendUserMessage(content, settings) { messages.push({ content, settings }); },
  };
  createModelResearchExtension({ stateRoot: path.join(temp, "state"), env: { ...(kind === "t3" ? { T3_MCP_URL: "http://localhost:unused" } : {}), ...(options.allowHeadless ? { PI_MODEL_RESEARCH_ALLOW_HEADLESS: "1" } : {}) } })(pi);
  const catalog = { parentThreadId: "thread-fixture", inheritedProviderInstanceId: "pi", features: { appOwnedSubagents: true, asyncPolling: true, cancellation: true }, providers: [{ providerInstanceId: "claudeAgent", canRunChildTask: true, canRunCrossProviderChildTask: true, constraints: [], models: [{ id: "claude-fable-test", options: [{ id: "fast", type: "boolean", currentValue: false }] }] }, { providerInstanceId: "pi", canRunChildTask: true, canRunCrossProviderChildTask: true, constraints: [], models: [{ id: "openai-codex/gpt-test", options: [{ id: "fast", type: "boolean", currentValue: false }] }] }] };
  const ctx = {
    cwd: temp, mode: kind === "pi" ? "tui" : "rpc", hasUI: options.hasUI ?? true,
    sessionManager: { getSessionId: () => "session-fixture", getBranch: () => entries }, scopedModels: [],
    modelRegistry: {
      getAvailable: () => models, find: (provider, id) => models.find(model => model.provider === provider && model.id === id), hasConfiguredAuth: () => true,
      streamSimple(model, context, settings) {
        modelCalls.push({ model, context: structuredClone(context), settings });
        const research = context.messages[0].content.includes("Researcher identity:");
        const search = context.messages.length === 1 && research;
        const policyProbe = options.policyProbe && context.messages.length === 3 && research;
        const content = search ? [{ type: "toolCall", id: "fixture-search", name: "brave_search", arguments: { query: "synthetic fixture source" } }] : policyProbe ? [{ type: "toolCall", id: "fixture-policy", name: "model_research_fetch", arguments: { url: "https://example.com:8080/" } }] : [{ type: "text", text: fixtureOutput(context.messages[0].content) }];
        const message = { role: "assistant", provider: model.provider, model: model.id, content, stopReason: search || policyProbe ? "toolUse" : "stop", usage: { input: 20, output: 10, cacheRead: 2, cacheWrite: 0, totalTokens: 32, cost: { total: 0.01 } } };
        return { async *[Symbol.asyncIterator]() { yield { type: "done", message }; } };
      },
    },
    tools: options.noTools ? [] : [...(kind === "t3" ? t3Tools : webTools), ...[...tools.values()].filter(tool => tool.exposure === "codemode")],
    ui: {
      async select(_title, choices) { return choices[0]; }, async input() { return "Compare models for coding and skill writing"; },
      async confirm(title, message) { confirmations.push({ title, message }); return options.approved !== false; }, setStatus() {}, notify() {},
    },
    async executeTool(name, args) {
      hostCalls.push({ name, args });
      let result;
      if (name === "model_research_fetch") {
        const result = await tools.get(name).execute("nested-reader", args, undefined, undefined, ctx);
        return { result, isError: result.isError === true };
      }
      if (name === "brave_search") return { content: [{ type: "text", text: "Synthetic offline search results at https://example.com/a and https://example.com/b" }] };
      if (name.endsWith("orchestrator_capabilities")) result = catalog;
      else if (name.endsWith("delegate_task")) {
        const taskId = `fixture-task-${tasks.size + 1}`;
        result = { taskId, providerInstanceId: args.target.providerInstanceId, model: args.target.model, status: "running", workState: "working", summary: null };
        tasks.set(taskId, { ...result, summary: fixtureOutput(args.task), status: "completed", workState: "result_available" });
      } else if (name.endsWith("task_status")) result = tasks.get(args.taskId);
      else if (name.endsWith("task_cancel")) result = { ...tasks.get(args.taskId), status: "cancelled" };
      else throw new Error("Synthetic final responses must not call real web tools");
      return { isError: false, content: [{ type: "text", text: kind === "t3" ? `${JSON.stringify(result, null, 2)}\n${JSON.stringify(result)}` : JSON.stringify(result) }] };
    },
  };
  const operation = tools.get("model_research");
  const call = params => operation.execute("call-fixture", params, undefined, undefined, ctx);
  const decoded = response => JSON.parse(response.content[0].text);
  return { pi, ctx, events, confirmations, messages, modelCalls, hostCalls, tasks, operation, call, decoded };
}

test("native Pi setup, frozen exchange, explicit writer, usage and export work end-to-end offline", async t => {
  const h = await setup(t);
  const started = await h.call({ action: "start" });
  const data = h.decoded(started);
  assert.equal(data.status, "awaiting_writer");
  assert.equal(h.modelCalls.length, 6);
  assert.equal(h.confirmations.length, 1);
  assert.match(h.confirmations[0].message, /Both providers receive/);
  assert.ok(h.confirmations[0].message.includes(data.runId));
  assert.ok(h.ctx.tools.some(tool => tool.name === "model_research_fetch"));
  assert.equal(h.operation.executionMode, "sequential");
  assert.equal(started.usage.totalTokens, 192);
  for (const call of h.modelCalls.filter(call => call.context.messages[0].content.includes("Reviewer identity:"))) assert.equal("tools" in call.context, false);
  const status = await h.call({ action: "status", runId: data.runId });
  assert.equal(status.usage.totalTokens, 0);
  const completed = await h.call({ action: "writer", runId: data.runId, writer: "b" });
  assert.equal(h.decoded(completed).status, "complete");
  assert.match(h.decoded(completed).draftPath, /SKILL\.md$/);
  assert.equal(completed.usage.totalTokens, 32);
  assert.equal(h.modelCalls.length, 7);
  const exported = await h.call({ action: "export", runId: data.runId });
  assert.equal(exported.usage.totalTokens, 0);
  assert.equal(h.modelCalls.length, 7);
});

test("registered reader policy failures remain fatal across native-shaped host results", async t => {
  const h = await setup(t, "pi", { policyProbe: true });
  const result = h.decoded(await h.call({ action: "start", task: "Fixture policy boundary" }));
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "runtime_error");
  assert.match(result.error.message, /standard web ports/);
  assert.equal(h.modelCalls.length, 2, "no final research claim is accepted after a policy failure");
});

test("native Pi selection chooses the lowest supported thinking level when off is unavailable", async t => {
  const h = await setup(t, "pi", { minimalOnly: true });
  const result = h.decoded(await h.call({ action: "start", task: "Fixture" }));
  assert.equal(result.status, "awaiting_writer");
  assert.equal(result.models[1].settings.thinking, "minimal");
  assert.equal(h.modelCalls.find(call => call.model.id === "gpt-test").settings.reasoning, "minimal");
});

test("T3 RPC setup dispatches exactly five app-owned jobs over explicit continuations", async t => {
  const h = await setup(t, "t3");
  let result = await h.call({ action: "start", task: "Fixture model comparison" });
  const runId = h.decoded(result).runId;
  assert.equal(result.terminate, true);
  assert.equal(h.tasks.size, 2);
  assert.equal(h.modelCalls.length, 0);
  const notices = await h.events.get("before_agent_start")({ messageType: "user", prompt: "Delegated task fixture-task-1 reached a terminal state." }, h.ctx);
  assert.match(notices.message.content, /action=continue/);
  assert.equal(h.tasks.size, 2, "notification hook must not dispatch anything");
  result = await h.call({ action: "continue", runId });
  assert.equal(h.tasks.size, 4);
  assert.equal(h.hostCalls.filter(call => call.name.endsWith("task_status")).length, 2);
  result = await h.call({ action: "continue", runId });
  assert.equal(h.decoded(result).status, "awaiting_writer");
  assert.equal(h.hostCalls.filter(call => call.name.endsWith("task_status")).length, 4);
  result = await h.call({ action: "writer", runId, writer: "b" });
  assert.equal(h.tasks.size, 5);
  assert.equal(result.terminate, true);
  result = await h.call({ action: "continue", runId });
  assert.equal(h.decoded(result).status, "complete");
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.hostCalls.filter(call => call.name.endsWith("task_status")).length, 5);
  assert.ok(h.decoded(result).jobs.every(job => job.taskId));
  for (const call of h.hostCalls.filter(call => call.name.endsWith("delegate_task"))) {
    assert.equal(call.args.mode, "async");
    assert.equal(call.args.runtimeMode, "approval-required");
    assert.equal(call.args.target.options.fast, false);
    assert.match(call.args.clientRequestId, /^study-/);
  }
});

test("T3 notifications match each active run without resurrecting old markers", async t => {
  const h = await setup(t, "t3");
  const first = h.decoded(await h.call({ action: "start", task: "First fixture" }));
  await h.call({ action: "start", task: "Second fixture" });
  const notification = { messageType: "user", prompt: "Delegated task fixture-task-1 reached a terminal state." };
  const hook = h.events.get("before_agent_start");
  assert.ok((await hook(notification, h.ctx)).message.content.includes(first.runId));
  await h.call({ action: "cancel", runId: first.runId });
  assert.equal(await hook(notification, h.ctx), undefined);
});

test("native consent shows the complete bounded task, not a silently truncated preview", async t => {
  const h = await setup(t, "pi", { approved: false });
  const task = "A".repeat(1200) + " END_OF_FULL_TASK";
  await h.call({ action: "start", task });
  assert.ok(h.confirmations[0].message.includes(task));
  assert.equal(h.modelCalls.length, 0);
});

test("declined consent and missing T3 bridge cause no model dispatch", async t => {
  const declined = await setup(t, "pi", { approved: false });
  const response = await declined.call({ action: "start", confirmed: true });
  assert.match(response.content[0].text, /cancelled before model dispatch/);
  assert.equal(declined.modelCalls.length, 0);
  assert.equal(declined.confirmations.length, 1);
  const unavailable = await setup(t, "t3", { noTools: true });
  const denied = await unavailable.call({ action: "start" });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /Missing callable T3 tools/);
  assert.equal(unavailable.modelCalls.length, 0);
});

test("headless start requires informed consent and command bridge queues only the dedicated operation", async t => {
  const h = await setup(t, "pi", { hasUI: false, allowHeadless: true });
  const targets = [{ hostingProvider: "anthropic", model: "claude-test" }, { hostingProvider: "openai-codex", model: "gpt-test" }];
  const disabled = await setup(t, "pi", { hasUI: false });
  const blocked = await disabled.call({ action: "start", task: "Fixture", targets, confirmed: true });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /PI_MODEL_RESEARCH_ALLOW_HEADLESS/);
  assert.equal(disabled.modelCalls.length, 0);
  const denied = await h.call({ action: "start", task: "Fixture", targets });
  assert.match(denied.content[0].text, /cancelled before model dispatch/);
  assert.equal(h.modelCalls.length, 0);
  const accepted = await h.call({ action: "start", task: "Fixture", targets, confirmed: true });
  assert.equal(h.decoded(accepted).status, "awaiting_writer");
  await h.pi.command.handler("continue study-test", h.ctx);
  assert.match(h.messages[0].content, /"action":"continue","runId":"study-test"/);
  assert.match(h.messages[0].content, /do not poll/);
  assert.equal(inferModelAuthor("pi", "openrouter/anthropic/claude-version"), "anthropic");
  assert.equal(inferModelAuthor("custom", "notclaude-company"), undefined);
});
