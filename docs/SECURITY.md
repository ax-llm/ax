# Security Policy

## Supported Versions

Use this section to tell people about which versions of your project are
currently being supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| latest   | :white_check_mark: |

## Reporting a Vulnerability

To report vulnerabilities please email use the private reporting feature of Github.
https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability#privately-reporting-a-security-vulnerability

## AxJSRuntime Threat Model

`AxJSRuntime` is defense-in-depth for LLM-authored code, not a container or VM boundary. Host callbacks and granted runtime permissions remain the authority boundary; keep durable secrets and privileged effects in host-side functions.
