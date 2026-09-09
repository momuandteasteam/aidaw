# Security policy

## Supported versions

AIDAW is currently a development release. Security fixes are made on the
latest `main` branch; no older release line receives security updates.

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Use GitHub's
private vulnerability reporting feature for this repository. Include the
affected commit, operating system, reproduction steps and expected impact.
Remove API tokens, absolute home-directory paths, licensed audio, presets and
plug-in state from reports.

If private vulnerability reporting is unavailable, open a public issue that
only asks the maintainers to enable a private reporting channel. Do not include
the vulnerability details in that issue.

## Remote server boundary

- The HTTP server binds to `127.0.0.1` by default and does not implement TLS.
- Keep it on localhost and use SSH port forwarding, or place it behind an
  authenticated HTTPS reverse proxy. Never expose token-bearing plain HTTP to
  an untrusted network.
- Use a random `AIDAW_HTTP_TOKEN` of at least 32 characters and rotate it after
  suspected disclosure. Do not commit it or place it in command examples with
  a real value.
- A server instance is for one trusted owner. It does not provide tenant
  isolation, per-user authorization or a sandbox for uploaded projects.
- Audio plug-ins execute native code with the server process's permissions.
  Install and load only trusted plug-ins. Use a dedicated operating-system
  account or virtual machine when plug-ins or project bundles are untrusted.

See `docs/REMOTE_SERVER.md` for the supported connection pattern and current
limits.
