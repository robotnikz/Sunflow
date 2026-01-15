# Security Policy

## Supported Versions

We currently support:

- The latest released version (`main`/latest GitHub Release)
- The latest container image tag published from `main` (e.g. `ghcr.io/robotnikz/sunflow:latest`)

Older versions may still receive fixes on a best-effort basis, but we recommend upgrading first when reporting issues.

## Reporting a Vulnerability

Please **do not** open public GitHub issues for security vulnerabilities.

Instead, use **GitHub Private Vulnerability Reporting**:

1. Go to: `https://github.com/robotnikz/Sunflow/security/advisories`
2. Click **“Report a vulnerability”**
3. Provide the details listed below

If you cannot use the advisory feature, open an issue **only with minimal details** and ask for a private contact channel.

### What to Include

- A clear description of the vulnerability and affected component (frontend/backend/Docker)
- Steps to reproduce (PoC is welcome)
- Impact assessment (what an attacker can achieve)
- Affected versions / commit SHA (if known)
- Any logs/screenshots that help reproduce (please remove secrets)

### What Not to Include

- Do not include real credentials, API keys, tokens, or webhook URLs
- Do not include private user data

## Our Response Process

After you report a vulnerability, we aim to:

- Acknowledge receipt within **72 hours**
- Provide an initial assessment and next steps within **7 days**
- Ship a fix as quickly as possible depending on severity and complexity

## Coordinated Disclosure

We appreciate coordinated disclosure.

- Please allow a reasonable time for a fix before publishing details.
- If you want to publish a write-up, mention this in the advisory so we can align on a date.

## Safe Harbor

We support good-faith security research.

- If you follow this policy and avoid privacy violations, service disruption, or data destruction, we will not pursue legal action against you.
- Please only test against systems and data you own or have explicit permission to test.
