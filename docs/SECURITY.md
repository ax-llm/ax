# Security Policy

## Supported Versions

Security updates target the latest release.

| Version | Supported          |
| ------- | ------------------ |
| latest   | :white_check_mark: |

## Reporting a Vulnerability

Use [GitHub's private vulnerability reporting form](https://github.com/ax-llm/ax/security/advisories/new)
to report a suspected vulnerability to the maintainers. You can also open the
repository's **Security** tab, select **Advisories**, and choose **Report a
vulnerability**.

Include the affected Ax version, reproduction steps, expected and actual
behavior, and the potential impact. Keep vulnerability details out of public
issues and pull requests while maintainers investigate.

## AxJSRuntime Threat Model

`AxJSRuntime` is defense-in-depth for LLM-authored code, not a container or VM boundary. Host callbacks and granted runtime permissions remain the authority boundary; keep durable secrets and privileged effects in host-side functions.
