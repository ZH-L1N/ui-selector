# ui-selector README redesign implementation plan

## Goal

Turn the repository homepage into a concise, project-native explanation of what
`ui-selector` captures, why its privacy model is credible, how to try it, and where its
current fidelity limits are.

The redesign must remain evidence-led. It must not describe every selected element as
implementation-ready because the measured actionability run found strong results for text and
control leaves but only eight faithful results across twelve elements overall.

## Approved direction

- Audience: frontend developers who use AI coding agents and want a local, privacy-conscious
  way to hand off UI evidence.
- Story: value, real proof, mechanism, first use, measured actionability, details and limits.
- Visual direction: a warm-light precision instrument built from selection brackets,
  locator paths, measured spacing, and the product's existing `#0a7766` green.
- Hero: a deterministic pure SVG title system using the canonical lowercase
  `ui-selector` name.
- Proof: a static raster board made only from the committed synthetic fixture and the real
  capture UI. Prompt-ready Markdown is the primary output shown.
- Mechanism: a compact pure SVG pipeline from selected element through allowlisted capture
  to `CaptureV1`, JSON, and Markdown.
- Badges: CI and MIT only.
- Theme behavior: self-contained warm-light assets that remain stable on GitHub light and
  dark backgrounds.
- Documentation language: English.

## Scope

### Add

- `assets/readme/hero.svg`
- `assets/readme/proof-board.png`
- `assets/readme/mechanism.svg`
- Reproducible source material for the proof board when it materially helps maintenance
- `docs/security-and-limitations.md`

### Rewrite

- `README.md`

### Do not change

- Product source, tests, build behavior, trusted-origin configuration, or committed `dist/`
- Public claims that cannot be derived from repository evidence
- Git history until implementation, review, and verification are complete

## Implementation

1. Capture three safe proof states from `tests/fixtures/site/index.html`: the selected
   `Get started` button, the real result panel, and a concise prompt-ready Markdown excerpt.
   Keep the fixture identity visible so the images cannot be mistaken for a private site.
2. Draw the hero at a 1200-unit width with a complete warm-white background, large readable
   typography, a selection-field motif, a real locator label, and three factual metadata
   items: local bookmarklet, JSON plus Markdown, and no runtime network.
3. Compose the proof board as a static raster sequence. Preserve enough scale for the
   selected component, panel controls, and Markdown hierarchy to remain recognizable at a
   900-pixel GitHub render; put exact copyable detail in adjacent Markdown.
4. Draw the mechanism diagram with the same visual grammar. Show the deny-by-default gate,
   URL and text reduction, one sanitized `CaptureV1` path, and the two output formats.
5. Rewrite the README in this order:
   - hero and minimal badges;
   - proof and plain-language explanation;
   - three-step mechanism and diagram;
   - cross-platform quick start;
   - captured evidence and Standard versus Deep mode;
   - measured actionability, including strong text/control leaf results and the `8/12`
     overall result;
   - concise safety boundaries;
   - compatibility and known limitations;
   - documentation, development commands, and license.
6. Move the detailed threat model, hostile-page caveat, screenshot-surface risk, trust-model
   detail, and Claude artifact explanation into `docs/security-and-limitations.md`. Preserve
   the existing facts while removing repetition from the homepage.
7. Keep critical instructions, limitations, links, and commands in Markdown rather than
   hiding them inside images.

## Verification

- Render the two SVGs and the proof board at 900-pixel and 360-pixel widths.
- Visually inspect clipping, contrast, hierarchy, proof authenticity, and mobile legibility.
- Run the `beautify-github-readme` audit against the rewritten README.
- Run repository format, lint, typecheck, unit tests, browser tests, and build.
- Review the complete diff for unsupported claims, stale links, unsafe SVG constructs,
  accidental private data, and unrelated changes; fix every issue found.
- Commit and push only after all required checks pass.
