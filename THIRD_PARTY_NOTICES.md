# Third-party notices

Crew Pocket is licensed under [MIT](LICENSE). **Its MIT license does not replace the licenses of included third-party code, artwork, model weights or external CLI programs.**

## Bundled software / artwork with verified notices

| Component | Used in | Attribution / license |
| --- | --- | --- |
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) | `public/vendor/pixel-agents/` office sprites, furniture and room layout; renderer incorporates reference behavior | MIT — © 2026 Pablo De Lucca. Full notice: [LICENSE.txt](public/vendor/pixel-agents/LICENSE.txt). Assets vendored from pinned upstream commit `b1bafd02896d90d83457266575a1e8e5011ce997`. |
| [MetroCity — JIK-A-4](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) | Source artwork for the six Pixel Agents character sprites (as credited by Pixel Agents) | The author lists the source pack as CC0 1.0. Crew Pocket's clothing color variants are derived from those six official sprite sheets. |
| [Answer me with HTML](https://github.com/magic76/answer-me-with-html) | `lib/vendor/answer-me-with-html/` | MIT — see [bundled license](lib/vendor/answer-me-with-html/LICENSE.txt). |
| [QRCode.js](https://github.com/davidshimjs/qrcodejs) | QR code implementation | MIT — see [bundled license](public/vendor/qrcodejs-LICENSE.txt). |
| [ONNX Runtime Web v1.14.0](https://github.com/microsoft/onnxruntime) | `public/js/ort.min.js` and `public/js/ort-wasm*.wasm` | MIT notice is embedded in the shipped JS bundle; preserve upstream copyright and license when updating the runtime. |

## Assets pending provenance review

- `public/models/3dspeaker_campplus.onnx`: the repository includes this model weight, but a **model-specific source URL, exact checkpoint and weight redistribution grant have not yet been verified here**. Do not assume the runtime library's license automatically covers downloaded model weights. Obtain and record the weight-specific license before marketing a redistributable software bundle.
- `public/FunnyDiary.apk`: tracked binary present in the public tree. Its provenance and need for distribution should be checked before an official release; `*.apk` is ignored for new files but older tracked files remain published.
- Other minified or prebuilt browser assets should be audited individually if updated or repackaged. This notice is an **inventory**, not a claim that every binary's provenance has been audited.

## Provider CLIs

Codex CLI, Claude Code CLI and Antigravity CLI are separately installed external programs. Users must follow the provider's own terms and authenticate their own accounts. Crew Pocket's MIT license does not extend provider-specific subscriptions, credentials or binary redistribution rights.

When adding new assets, keep a source URL, version/revision, license text, and redistribution evidence. Do not bundle an asset merely because another MIT-licensed repository references it.
