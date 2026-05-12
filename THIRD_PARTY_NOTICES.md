# Third-Party Runtime Notices

OfficeAgent may package third-party command runtimes for Windows sandboxed project workflows. The exact staged runtime versions are recorded in the runtime manifests packaged under `resources/runtime/*` and copied at runtime into `<managed-root>/.officeagent/runtime/*`.

This notice is for bundled/staged tool runtimes only. It is not a replacement for a full legal review before external distribution.

## OpenAI Codex Windows sandbox reference code

OfficeAgent's Windows sandbox v2 implementation includes code copied or closely adapted from the OpenAI Codex Windows sandbox implementation, especially DPAPI credential wrapping, local sandbox user/group provisioning patterns, hidden Winlogon user-list handling, setup error/reporting shapes, Windows path-normalization concepts, capability SID persistence, and restricted/capability token construction patterns.

- Upstream project: <https://github.com/openai/codex>
- Local reference during implementation: `C:\Projects\codex\codex-rs\windows-sandbox-rs`
- License: Apache License 2.0

Retain Apache-2.0 attribution for any copied or closely adapted Codex Windows sandbox source.

## CPython / Python runtime

OfficeAgent can bundle CPython for Windows via Astral `python-build-standalone` release archives.

- Upstream project: <https://github.com/astral-sh/python-build-standalone>
- Runtime source artifacts: <https://github.com/astral-sh/python-build-standalone/releases>
- OfficeAgent runtime manifest: `resources/runtime/python/<runtime-id>/officeagent-python-runtime.json`
- CPython license file in the staged runtime: `resources/runtime/python/<runtime-id>/LICENSE.txt`

CPython is distributed under the Python Software Foundation License and related historical/third-party notices included in the runtime's `LICENSE.txt` file. Do not remove that file from packaged runtimes.

`python-build-standalone` itself is maintained by Astral and is licensed under the Mozilla Public License 2.0. OfficeAgent uses its published redistributable Python runtime artifacts; if OfficeAgent later modifies or redistributes `python-build-standalone` source files, include the MPL-2.0 source/license obligations for those files.

## uv

OfficeAgent can bundle Astral `uv` for Windows.

- Upstream project: <https://github.com/astral-sh/uv>
- Runtime source artifacts: <https://github.com/astral-sh/uv/releases>
- uv license policy: <https://docs.astral.sh/uv/reference/policies/license/>
- OfficeAgent runtime manifest: `resources/runtime/uv/<runtime-id>/officeagent-uv-runtime.json`

uv is licensed under either Apache License 2.0 or MIT License, at your option. OfficeAgent includes the MIT license notice below for bundled uv binaries.

```text
MIT License

Copyright (c) 2025 Astral Software Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Microsoft Visual C++ runtime files

Some Windows Python runtime artifacts include Microsoft Visual C++ runtime DLLs, such as `vcruntime140.dll` and `vcruntime140_1.dll`. Before any external release, confirm the exact runtime payload and include any Microsoft redistribution terms required for the DLLs actually shipped.

## Release checklist

Before publishing a package that includes staged runtimes:

1. Confirm this notice is packaged as `resources/THIRD_PARTY_NOTICES.md`.
2. Confirm each staged Python runtime still includes `LICENSE.txt`.
3. Confirm each staged runtime manifest records the exact version, source archive, and SHA-256.
4. Confirm whether any Microsoft VC runtime redistribution notice is required for the shipped payload.
