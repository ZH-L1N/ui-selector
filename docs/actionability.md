# Actionability run 1 — 2026-08-22

The first measurement of whether a captured brief is actually usable. Everything before it
validated capture _correctness_ and _safety_: 82 review findings, four defects found by hand,
90 unit tests, 57 browser tests, zero leaks. None of it touched the product's premise —
"a design brief an AI coding agent can act on."

## Method

Twelve elements captured from `tests/fixtures/site/index.html` — three buttons (one
disabled), a nav link, `h1`, `h2`, a paragraph, an image, a card list item, a section, a nav,
a header. Each brief was handed to an independent agent whose **only** input was the Markdown,
with an explicit instruction not to read the fixture; each rebuilt the component as standalone
HTML and CSS, and then listed every visual property it had to guess. A separate judge, holding
the original source, graded fidelity and assigned every difference a cause:
`missing-field`, `rebuilder-error`, or `unknowable`.

Asking rebuilders to enumerate their own guesses is what makes this measure the brief rather
than the model: a capable agent papers over gaps, and the self-reported guess list exposes the
gap it papered over.

No cheating was detected. Wrong guesses fell exactly where the briefs are silent.

## Score: 8 / 12 faithful (67%), against a bar of 80%

The failure is not diffuse. **One structural gap accounts for every genuine miss.**

### Leaf elements: excellent

All eight leaf rebuilds — three buttons, nav link, `h1`, `h2`, paragraph — came back
effectively pixel-exact. Geometry, design tokens (`--brand`, `--radius`, `--ink`) with their
definition sites, and all three interaction states carried perfectly. Several rebuilders
verified the brief's numbers arithmetically against each other.

### Containers: fail, and for one reason

`ax-6` (card), `ax-7` (section), `ax-9` (header) all failed. **Capture stops at the selected
element's boundary**, so a container's brief describes what is often an invisible transparent
box, while everything a viewer actually sees lives in descendants flattened into a single text
run. Concretely:

- the card's title rendered at half size (16px/600 instead of 24px/700), its green `::before`
  arrow missing, its link the wrong colour;
- the section's "Get started" rebuilt as a dark anchor pill instead of a brand-green button —
  wrong colour, shape, size, and typeface;
- the header's 32×32 logo child absent entirely, nav gap 16px against a real 12px.

`ax-8` (nav) passed only by arithmetic back-solving and luck — its hover background landed
within one hex value of the original by accident.

This is the gap that separates pass from fail, and it is worth being precise about why it
matters: **selecting a container is the normal case for design work.** A developer asks for
"this card", not "this one div with no background".

### The one unknowable

`ax-5`, the image: geometry exact, artwork 100% invention. No computed-style field can fix it;
the screenshot path already exists and is the right mitigation.

## Fields to add, ranked (input to v1.1)

| Field                                                                                                                                                                      | Guessed | Impact   | Why                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Child-subtree capture** — one or two levels of descendants with per-child tag, text boundaries, rect, styles that differ from the parent, and descendant pseudo-elements | 4       | **high** | The single field separating pass from fail. Flips ax-6, ax-7, ax-9 and removes ax-8's dependence on luck → roughly 11/12                                                                 |
| Sibling inventory — tag, first-line text, rect of adjacent siblings                                                                                                        | 9       | medium   | Never corrupts the component, but every delivered _page_ is fiction: ax-4 invented a wrong headline as the largest element on screen                                                     |
| Effective background — first non-transparent ancestor's `background-color`                                                                                                 | 12      | medium   | All twelve guessed white and all twelve were right _by luck_, inferring it from the dark ink colour. On any tinted or dark page, every rebuild would put the element on the wrong ground |
| Transition longhands, or suppression of the default                                                                                                                        | 12      | medium   | Fixed below                                                                                                                                                                              |
| Ancestor layout chain — each ancestor's content rect, padding, authored sizing                                                                                             | 12      | low      | Every rebuild back-solved the inset into magic padding. Correct at the capture viewport, rigid where the original is responsive                                                          |
| Media-query rules at other breakpoints                                                                                                                                     | 2       | low      | No difference at the capture viewport; only worth it if the promise extends past it                                                                                                      |

## Noise: fixed in this pass

Roughly **15 of the 63 allowlisted properties did all the work**. Most of the rest was
harmless padding — but two default serializations were **not** harmless, and that distinction
is the useful part:

- **`transition: all`** — the UA-default shorthand meaning _no transition_. Seven of twelve
  rebuilders read it as an instruction and invented 150–200ms motion the page does not have.
- **`outline: <color> none 3px`** — the default when nothing sets an outline. Two rebuilders
  back-formed a visible 3px focus ring from it.

A default that reads as an instruction is worse than padding: it does not dilute the brief, it
falsifies it. Both are now suppressed, with regression tests naming the measured consequence.
Also dropped: positional offsets and `z-index` on static elements, the entire flex/grid block
when the element is neither container nor item, `object-fit` on non-replaced elements, border
longhands that only repeat a `none` shorthand, `transform-origin` with no transform, and the
always-default lines. A button brief went 2,902 → 2,010 characters with more signal, not less.

**And one false claim of my own.** The brief used to end "Nothing was omitted." Five
rebuilders independently called that misleading, and they were right: it was true of the
element's own captured fields while the descendants, siblings, and ancestor background that
actually determine appearance were never in scope. Silence about what was never looked at is
not the same as nothing having been left out. Reworded, with a test.

## What this run proves about method

Every earlier stage — three adversarial plan rounds, five code-review lenses, 82 findings —
read the spec's 63-property field table and `markdown.ts` closely, and **not one asked whether
the section the brief exists for was present.** The prompt-ready output shipped with no
colours at all: no `color`, no resolved `background-color`, no `border-radius`. The tests were
green because each asserted a section that _was_ rendered.

Review finds fields that are wrong. Only use finds fields that are absent. They are different
instruments, and the second one had never been picked up.
