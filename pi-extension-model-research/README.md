# Model Research for Pi

Turn two models’ independent research and reciprocal reviews into a dated model-selection skill draft.

## What you can do

- Compare two model-author providers, usually Anthropic and OpenAI, with configurable models.
- Gather arguments from X/Twitter, Reddit, other discussions, and primary sources, with evidence-quality labels.
- Exchange both original evaluations and compare each report’s usefulness against the other.
- Select a skill writer when the evidence supports it, or ask you when it does not.
- Save comparison tables, original reports, reviews, and an uninstalled skill draft.

## Install

Once published:

```bash
pi install npm:@firstpick/pi-extension-model-research
```

This package is currently a source implementation, not a published release. To try a local checkout without changing your installed packages, run this from the repository root:

```bash
pi -e ./pi-extension-model-research/index.ts
```

## How to use it

Start the dedicated workflow:

```text
/model-research start Compare these models for coding, research, planning, and writing Pi skills.
```

Choose two models from Pi’s native lists, then review the settings, limits, privacy notice, and confirmation. The extension does not reuse the generic Workflows extension.

In Pi TUI, the model calls run directly through your configured providers. Inside **T3 Code’s Pi provider**, research, review, and drafting run as tracked T3 child tasks. Completion notifications guide continuation; there is no polling loop.

Useful commands:

- `/model-research list` — find this session/thread’s runs.
- `/model-research status <id>` — inspect without starting more work.
- `/model-research continue <id>` — reconcile completed T3 tasks and advance.
- `/model-research writer <id>` — choose a writer when evidence was inconclusive.
- `/model-research cancel <id>` — stop further work and cancel known pending tasks.

A completed run returns paths to `comparison.md` and `SKILL.md`, alongside the preserved evidence. Review the draft before installing or relying on it.

## Before you start

Requires Pi 1.3 or newer and Node.js 22.19 or newer. Standalone Pi needs a callable search tool such as [Brave Search for Pi](https://github.com/Firstp1ck/pi-coding-agent-forge/tree/main/pi-extension-brave-search); a bounded public-page reader is bundled. T3 requires available, authenticated providers and app-owned orchestration tools.

Both providers receive the research task and, later, both reports and reviews. Public search queries go to your web tools. **Do not include secrets or private customer information.** No parent conversation history is copied.

Source access and factual claims remain **model-reported**, not independently fact-checked. Inaccessible X/Reddit threads must be recorded as gaps. Agreement and self-ratings are not benchmarks.

T3 children use approval-required mode, but their inherited tools are **not sandboxed by this extension**. T3 delegation offers no enforceable per-call token or USD cap. Headless model dispatch is disabled unless the operator explicitly opts in; a model-supplied confirmation flag alone cannot enable it. Nothing is installed, published, or switched automatically.

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for complete commands, limits, storage, compatibility, security, and troubleshooting.
