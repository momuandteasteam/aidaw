# Contributing to AIDAW

## Before opening a change

Use Node.js 22.13 or later, CMake 3.22 or later, a C++20 toolchain and FFmpeg.
Read `AGENTS.md` for repository-specific behavior and `DESIGN.md` for the
architecture. Keep song-specific instructions, source audio, rendered audio,
licensed presets and machine configuration outside the source tree.

By submitting a contribution, you agree that it is licensed under
`AGPL-3.0-only`, the licence used by this repository. Only submit code and data
you have the right to distribute.

## Build and test

```sh
npm ci
npm run configure:native
npm run build:native
npm run check:public
npm test
```

Commercial plug-in tests are conditional. A pull request must pass without
requiring a commercial plug-in, account, licence or user preset. When fixing a
host compatibility problem, add a generic regression test or a local test
plug-in case instead of checking in vendor binaries or plug-in state.

## Pull requests

- Explain the concrete trigger and resulting behavior.
- State which macOS or Windows configurations were tested.
- Keep unrelated generated files out of the change.
- Update protocol and format documentation when a public API, project schema or
  output contract changes.
- Redact home-directory paths, tokens, account names and licensed content from
  logs and fixtures.
- Do not add an observed host plug-in catalog. `catalog/observed-plugins.json`
  is intentionally ignored because product versions and program names can
  identify a workstation or disclose user-created names.

The repository does not run the native build in hosted CI. Run the checks above
before opening a pull request and record the tested host in the description.
Windows acceptance is recorded separately when it is run on a Windows machine.
