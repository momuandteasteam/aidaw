# AIDAW open-source development

AIDAW is developed in the open under the GNU Affero General Public License,
version 3 only (`AGPL-3.0-only`). The licence is intentional: if a modified
version is offered as a network service, users should be able to receive the
corresponding source for that version as required by the licence.

## What belongs in this repository

The repository contains the portable engine, native starter components,
protocol and project-format documentation, tests, setup tooling, and portable
reference metadata. Contributions must be code or data that the contributor
has the right to redistribute under AGPL-3.0-only or under the applicable
third-party licence.

Do not commit:

- commercial plug-in binaries, presets, captured plug-in state or sample libraries;
- source audio, rendered masters, artwork or project bundles belonging to a
  particular production;
- API tokens, credentials, machine configuration, absolute home-directory
  paths or observed host plug-in catalogs.

The repository ignores one-off Tea Steam Jukebox mastering scripts because
they refer to private production material and licensed plug-ins. Keep similar
song-specific work outside the distributable source tree.

## Before opening a pull request

From a clean source checkout, run:

```sh
npm ci
npm run configure:native
npm run build:native
npm run check:public
npm test
```

The native build and tests must pass without a commercial plug-in, account,
licence or user preset. Tests that require an installed plug-in may be skipped,
but the contribution must include a portable regression test where practical.
Record the operating system and architecture used for validation in the pull
request. Keep changes focused, update public protocol or format documentation
when needed, and explain the user-visible behavior that changed.

See [CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), and
the repository [licence](../LICENSE) before contributing.
