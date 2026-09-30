# Open Spec Mesh

Node.js tools and reusable Agent/Skill guidance for **Quick** and **human-driven SDD** development. Automatic SDD lifecycle commands are retired.

[中文说明](README.zh-CN.md)

## Requirements

- Node.js **22.0.0 or newer**, a compatible npm, and Git.
- Linux/macOS host configuration paths. Minimum-version validation uses Node 22.0.0 with npm 10; installing the newest npm is not required.
- An existing Codex, OpenCode or Claude Code installation. This package does not install the host application or supply model credentials.

## Install from the public npm registry

Public npm release **0.0.1 is published**. The commands below install that version. If a mirror returns E404, verify the registry rather than treating a local pack as publication.

```sh
# 1. Install the command (does not modify host configuration).
npm install --global open-spec-mesh@0.0.1 --registry=https://registry.npmjs.org/
open-spec-mesh --version

# 2. Preview and explicitly configure Codex.
open-spec-mesh install --host codex --skip-tools --dry-run
open-spec-mesh install --host codex --skip-tools
```

The expected command version is `0.0.1`. Start a new host session after installation so it loads the updated rules, roles and Skills.

`--skip-tools` installs the core toolkit without installing Research tools. It does not claim Research MCP availability and does not enable System One. npm installation has no `postinstall` hook that configures Home; the explicit `open-spec-mesh install` step is required.

### Choose a host or configuration directory

```sh
# Default homes: ~/.codex, ~/.config/opencode, ~/.claude.
open-spec-mesh install --host codex --skip-tools
open-spec-mesh install --host opencode --skip-tools
open-spec-mesh install --host claude --skip-tools

# Optional custom configuration home (quote paths containing spaces).
open-spec-mesh install --host codex --host-home "/path/to/codex home" --skip-tools
```

Default homes also honor `CODEX_HOME`, `OPENCODE_CONFIG_DIR` and `CLAUDE_CONFIG_DIR`. `--codex-home` remains a Codex compatibility option. Host startup examples are in the [operations guide](docs/04-operations/O02-applications/O02-01-local-toolkit.md).

### Run without a global install

```sh
npm exec --yes --registry=https://registry.npmjs.org/ --package=open-spec-mesh@0.0.1 -- \
  open-spec-mesh install --host codex --skip-tools
```

### Source or offline-distribution alternative

```sh
# From this repository: globally link the checkout; retain its directory.
npm ci
npm install --global .
open-spec-mesh install --host codex --skip-tools

# Or build a portable artifact; dependencies still need npm access/cache.
npm pack
npm install --global ./open-spec-mesh-0.0.1.tgz
open-spec-mesh install --host codex --skip-tools
```

### Upgrade, uninstall and troubleshoot

```sh
# Upgrade the command, then explicitly upgrade the managed host assets.
npm install --global open-spec-mesh@latest --registry=https://registry.npmjs.org/
open-spec-mesh install --host codex --skip-tools --dry-run
open-spec-mesh install --host codex --skip-tools

# Remove only the global command; this does not remove configured host assets.
npm uninstall --global open-spec-mesh
```

- Before host upgrades, back up the affected managed paths and configuration. The installer rolls back a failed transaction but does not keep a persistent backup after success.
- Upgrades replace package-owned Skill directories, removing their old Python scripts and caches, and apply known legacy Skill/role retirements. Recognized managed Python MCP launches migrate to Node; their old helpers/caches are removed. Custom MCP launches, unrelated Python tools, user model/provider settings and credentials are preserved.
- Same-name unmanaged assets are not overwritten. Resolve the reported ownership conflict before retrying; do not delete your entire host Home.
- If the command is not found, add your npm global executable directory to `PATH` (on Linux/macOS, typically `$(npm prefix -g)/bin`). For permission errors, use a user-owned Node installation/global prefix rather than automatically running host configuration with `sudo`.
- The [publication guide](docs/04-operations/O02-applications/O02-02-npm-publication.md) distinguishes a verified local artifact, authentication, and a successful registry publication.

## osm shortcut (local source only; not published yet)

Public npm 0.0.1 still uses open-spec-mesh. The local source now includes osm; run npm ci and npm install -g . in the checkout to use it (not a registry upgrade).

```sh
osm --dry-run  # Preview the default Codex install without writing Home.
osm            # Equivalent to open-spec-mesh install --host codex --skip-tools.
osm --help
osm --version
osm install --host opencode --skip-tools
```

Running osm explicitly performs installation; it is not an npm postinstall. The legacy entry still shows help with no arguments. A clear request such as “publish 0.0.2” automatically selects `$sdd-release` and authorizes npm publication of that target version; users need not type a skill invocation. Requests for release materials alone do not authorize upload.

## Workflow

- Quick: the current Agent implements, tests and self-reviews continuously; prefer useful Explorer/Librarian read-only investigation over repeated Main file traversal.
- SDD: requirements → overall design → execution plan (task breakdown and task-level design) → implementation → delivery. Human confirmation controls each stage; an explicit user instruction may authorize multiple stages.
- Single-task/serial implementation stays in the current Agent and checkout. Only explicitly selected parallel writes use Workers and isolated worktrees.
- Design constrains goals and public behavior, not file lists, functions or coding steps. Small implementation adjustments are autonomous.
- Name new agents `role_desc`, for example `explorer_module_flow` or `librarian_node_backend`; keep configured role IDs unchanged.
- Documents and checks assist review, not machine approval. Real tests and security protections remain. Installing/upgrading the package does not advance a workflow stage.

## SDD skill guidance

When you select SDD mode, Main explains the current stage, suggests the matching `sdd-*` skill with a ready-to-use invocation, and points to the next entry when the stage is complete. Skill completion does not approve another stage.

| Stage or need | Skill | Example |
|---|---|---|
| Document scaffolding, only when needed | `$sdd-init` | `$sdd-init Initialize the project document scaffold` |
| Requirements | `$sdd-req` | `$sdd-req Create or refine the requirements for this Change` |
| Overall design | `$sdd-design` | `$sdd-design Requirements are confirmed; write the overall design` |
| Execution plan: task breakdown and task-level design | `$sdd-plan` | `$sdd-plan Overall design is confirmed; write the execution plan and task designs` |
| Implementation and validation | `$sdd-do` | `$sdd-do The execution plan is confirmed; implement serially and validate` |
| Delivery and archiving after confirmation | `$sdd-close` | `$sdd-close Summarize actual implementation and validation for my confirmation` |

Skip initialization if a suitable scaffold already exists. Use `$sdd-migrate` for conflicting legacy document structures, `$sdd-research` for reusable research/long-term ADRs when needed, and `$sdd-diagnose` only when diagnostics are requested. A clear request to publish a target version automatically selects `$sdd-release` and authorizes that version’s npm upload; requests for materials alone do not authorize publication. Natural-language authorization is also valid. If a skill is not installed or available in the session, Main must say so and guide installation/loading rather than claim it was invoked.

The broad `$sdd-change` skill and former `sdd-requirements` name are no longer managed; use `$sdd-req` for requirements. Old `sdd-change/scripts/` entrypoints have been removed. During upgrade, a previously registered old directory is preserved in a private local ZIP under `open-spec-mesh/retired-skills/` before leaving skill discovery, including local edits. Recovery archives are not automatically cleaned up; unregistered user directories are retained with a warning rather than removed by name.

## Auxiliary commands

```sh
open-spec-mesh --help
open-spec-mesh init-project --root /path/to/project
open-spec-mesh new-change feature --root /path/to/project
# After human confirmation:
open-spec-mesh ensure-design CHG-YYYYMMDD-feature --root /path/to/project
open-spec-mesh new-task CHG-YYYYMMDD-feature capability --root /path/to/project
open-spec-mesh validate-docs --root /path/to/project
```

Change creation writes only requirements; task creation writes macro Markdown and a human-readable plan. Neither creates execution state. `observe`/`diagnose` collect read-only evidence. Release commands prepare documents, not deployment. Integration and validation use ordinary Git/project tools.

## Optional services and validation

Research tooling additionally uses `CONTEXT7_API_KEY` / `TAVILY_API_KEY`; export your own values in the invoking environment before running installation without `--skip-tools`. Credentials are not included in the npm package or written by npm installation.

System One is optional and disabled by default. The self-hosted GPU service is removed; only the Node.js HTTP/MCP client for an external compatible inference service remains. It does not download models, start local inference or execute Python. The managed bridge is currently Codex-only.

For contributors, from a source checkout:

```sh
npm ci
npm run validate:core
npm run validate:full
```

Full validation additionally requires real host CLIs, Docker, Mermaid and Research tooling. Missing prerequisites are failures, not successful placeholders. First-party tools, tests and automation are Node.js-only; the audit requires zero first-party Python sources. Core results do not prove full external-host or inference readiness.

See [rules](AGENTS.md), [tool guide](sdd-init/references/runtime-guide.md), [document guidance](sdd-init/references/document-contract.md) and [project documentation](docs/index.md).
