# Agent Skills

Install one Ax entry-point skill for {{language}} into your coding agent workspace.
It includes a compact capability index and local reference guides. Your agent
reads the relevant guides as needed; no extra skill installation is required
during a task.

```{{shellFence}}
{{skillInstallCommand}}
```

Specialist skills remain available individually below. To register every
specialist as a separate skill, use the same command with `--skill '*'`.

{{skillSetupNotes}}

The URL publishes a well-known agent-skills index for this language:

```text
{{skillInstallURL}}.well-known/agent-skills/index.json
```

## Published Skills

{{skillList}}

## Source

{{skillSource}}

Generated language package skills are emitted by the AxIR compiler together with `README.md`, `API.md`, `axir-api.json`, examples, and capability manifests. The website reads those generated package skill files and publishes installable well-known artifacts.
