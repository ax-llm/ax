# Agent Skills

Install the Ax skills for {{language}} into your coding agent workspace.

```{{shellFence}}
{{skillInstallCommand}}
```

The URL publishes a well-known agent-skills index for this language:

```text
{{skillInstallURL}}.well-known/agent-skills/index.json
```

## Published Skills

{{skillList}}

## Source

{{skillSource}}

Generated language package skills are emitted by the AxIR compiler together with `README.md`, `API.md`, `axir-api.json`, examples, and capability manifests. The website reads those generated package skill files and publishes installable well-known artifacts.
