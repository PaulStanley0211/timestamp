# Timestamp on lime — the visual world replaced (design, 2026-09-06)

**Status:** approved in conversation on 2026-09-06, section by section, by the
owner. This document is the record of that approval and the brief for the
implementation plan. Nothing in it is built.

**What it replaces.** Every visual decision in `DESIGN.md` (Struck and the
cream album page, 2026-08-24 / 2026-08-28) and the brand-guidelines PDF dated
September 2026. Both argue the opposite of this document on most axes — no
borders, no texture on the interface, one brick-red accent, two grounds — and
both are superseded by it. `DESIGN.md` is rewritten in the same commit as the
tokens (§8); the PDF is untracked and stays that way.

**What it does not change.** Product truth (`PRODUCT.md`), any route, any
form field, the four-step order, the pricing numbers, the legal text, the tape
itself. This is the world the pages sit in and the layout of two public pages;
the working pages keep the structure they were given on 2026-09-04.

---

## 1. The decision, and where it came from

The owner brought a Dribbble shot of a video-editing product (MAXS): acid-lime
panels on a near-black ground, a heavy condensed all-capitals display face,
a fine printed speckle on the lime, crumpled-paper testimonial cards, outlined
rounded cards, native-looking FAQ accordions, a column footer under a giant
wordmark. Three images were shown: the full desktop landing, the pricing page
with a compare-all-plans table, and a set of mobile screens. **The images are
the designer's work and are not committed to this repository**; this section
describes them so the spec stands alone.

Asked how far it goes, he chose **everywhere** — every page, one world instead
of two — with the cost stated: it replaces the documented brand. Asked where
the landing's place demo goes, he chose the reference's arrangement: the hero
is the lime poster with a tape playing in it, and the seven places move into
the full-bleed band lower down. Asked what fills the testimonial band with no
customers yet, he chose facts, built so quotes can replace them.

Three visual questions were then settled on mockups in a browser:

| Question | Chosen | Alternatives shown |
|---|---|---|
| Display face | **Anton** | Bebas Neue, Barlow Condensed 800 |
| Texture on the lime panels | **printed speckle** (fine procedural grain, multiply, ~0.3 opacity) | flat; crumpled paper |
| The hero's tape | **breaks out of the lime panel** onto the dark ground, the reference's move | side by side inside the panel |

The reasoning the owner heard and accepted, so it is not re-argued: Anton is
what makes a lime rectangle a poster, Bebas Neue is the most template-worn
free display face, and Barlow's lighter weights buy nothing because small text
is set in the body face anyway. The speckle reads as ink on paper rather than
video noise, so it does not imitate the tape. The breakout makes the tape the
largest thing on the first screen, which is the product's one argument.

---

## 2. The world

### 2.1 Palette — one ground, one accent, one light

Working values, measured with the WCAG formula against the ground they sit on.
The exact lime may move a few points at implementation to match the reference
under the speckle; any move is re-measured and the table updated.

| Token | Value | Role | Contrast |
|---|---|---|---|
| `--ground` | `#161618` | the page, everywhere | — |
| `--card` | `#1F1F22` | an outlined card sitting on the ground | — |
| `--lime` | `#D9FF00` | chosen, go, display | 15.71:1 on ground, 14.29:1 on card |
| `--ink` | `#F2F2F0` | body prose on the ground | 16.12:1 |
| `--ink-soft` | `#A9A9A6` | labels, hints, fine print on the ground | 7.67:1 (6.98:1 on card) |
| `--on-lime` | `#141414` | headings, buttons and body on a lime panel | 16.01:1 |
| `--on-lime-soft` | `#3A3A3A` | fine print on a lime panel | 9.89:1 |
| `--rec` | a red clearing 4.5:1 on the ground; `#E24B3B` is the floor at 4.56:1 | the record light and nothing else | ≥ 4.5:1 |
| `--line` | `rgba(242, 242, 240, 0.14)` | the 1px outline on cards and fields | — |

**Lime means chosen, or go.** The selected place, outfit, shape and quality
card; the primary button on every page; the wordmark; the big display moments
(the manifesto's key words, the closing wordmark). Nothing else takes it —
not labels, not links in prose, not prices, not flags. That is the reference's
own discipline and it is what lets colour answer "what have I chosen?".

**Red means the record light.** One element, on the status page, plus the
`.rec` dot in the wordmark. A lime REC light is not a REC light. There is no
alarm red: an error is carried by weight and words in ink.

**The date stamp inside the tape stays orange.** It is texture, drawn by
ffmpeg, and the interface does not touch it. `--l-cathode` and the whole
`--l-*` layer are deleted from the sheet; the cathode value survives only in
the tape pipeline's own config.

**Two grounds become one.** The `body.is-landing` alias block that re-pointed
eleven tokens is deleted. Every alias name (`--ground`, `--accent`, `--ink`,
`--frost` and the rest) is kept and re-pointed once, at `:root`, so the
several hundred rules that read them follow without being rewritten. The
`--on-image*` tokens stay: text on a photograph is still text on a photograph.

### 2.2 Type — Anton for display, Inter for everything else, both self-hosted

| Face | File | Licence | Where |
|---|---|---|---|
| Anton | `assets/fonts/anton.woff2` (+ `.ttf` fallback) | SIL OFL 1.1 | every heading, the wordmark, card titles, prices, buttons |
| Inter | `assets/fonts/inter-400.woff2`, `inter-600.woff2`, latin subset | SIL OFL 1.1 | body, labels, forms, fine print |
| VT323 | `assets/fonts/tape-osd.ttf` (already shipped) | SIL OFL 1.1 | the burnt-in date stamp inside the tape, and the two places in the chrome that depict the tape: the flip-counter date on the landing and the cassette label's readout on the result page; nothing else |

Served like `tape-osd.ttf` is today, from the assets root, under the existing
`font-src 'self'`. **No network font is ever loaded**; the CSP does not change.
The OFL text is committed beside each file. The font files are fetched from
the Google Fonts GitHub release at implementation; the fetch names the files
and sizes and waits for the owner's go, because it is a download.

**Display is always uppercase**, tight leading (0.9–0.92), no tracking.
**Anton is never set below 18px.** Anything smaller that wants to read as a
label — nav links, the small nav buttons, "Remove", the archive label — is the
tracked 12px label role in Inter 600, which keeps its existing token. Body
is never uppercase except that label role. The size scale keeps its roles and its ratio (`--t-*` and the
display ladder `--d-*`), with one substitution: every place the sheet names the readout face
for a display role (`--d-3` card titles, `--d-4` section headings, the hero,
the pricing figures) now names Anton. Because Anton reads larger than VT323 at
the same pixel size, the display ladder is re-measured against the hero
mockup at implementation and the values recorded in `DESIGN.md`; the ratio and
the number of steps do not change.

### 2.3 Texture — speckle on lime only, paper on the fact cards only

- **Lime panels** carry the printed speckle: a procedural fractal-noise layer
  (SVG `feTurbulence`, ~0.85 base frequency, desaturated, `multiply`, opacity
  ~0.3). The filter is defined once as an inline `<svg>` block emitted by the
  page layout and applied from the stylesheet by id; it is never a raster
  asset. Same filter on every lime panel; one place to tune.
- **The three fact cards** on the landing carry the crumpled-paper look
  (low-frequency turbulence lit by `feDiffuseLighting`, `multiply`).
- **The dark ground and every dark card stay flat.** No grain, no vignette, no
  scanlines anywhere the ground is dark. The working pages are mostly dark, so
  they stay calm.
- **The tape's texture is the tape's.** Nothing in the interface imitates it.

`style-src 'self'` refuses inline `style` attributes and inline `<style>`
blocks, so the SVG filters are defined in markup and applied from the
stylesheet by id; nothing is inlined per element.

### 2.4 Borders and shape — allowed now

Outlined rounded cards are the reference's card language and the opposite of
the old "no borders" rule. The rule is inverted deliberately:

- Cards, fields, the FAQ rows and the shelf tiles carry a **1px outline in
  `--line`** and a **10–12px radius**. Buttons are 6–8px.
- The outline is drawn from the token, never a literal colour; the existing
  guard that refuses literal-colour borders survives unchanged.
- `<hr>` stays banned; separation is still space and the outline of the thing
  itself, not a rule between things.
- The focus outline stays 2px, offset 2px, never removed — but it is drawn
  in `--ink` on dark surfaces and `--on-lime` on lime ones. A lime ring on a
  chosen lime card would be invisible, and a chosen card is exactly where the
  keyboard focus sits after a selection.

### 2.5 Motion

Unchanged from the existing world: nothing pulses or hurries the reader except
the record light. The hero tape and the place loops respect
`prefers-reduced-motion` through the mechanism `BG_SCRIPT` already has.

---

## 3. The landing, section by section

The eight slots of the reference, filled with Timestamp's own content.
Everything the reference has and this product cannot back is dropped, named
in §3.10.

### 3.1 Hero (lime, speckled)

- Nav: wordmark left (set in Anton, with the `.rec` dot); Places, Pricing,
  Sign in as label-role links; a black-on-lime **"Make a tape"** pill right
  that opens the existing sign-in dialog. "Places" is an in-page anchor to the
  band of §3.4 on the landing and `/#places` from any other public page. The
  landing is only ever seen signed out: a signed-in visitor to `/` gets the
  order form, whose nav keeps today's items (email, credits, My videos,
  Plans, Account, Sign out), restyled.
- Headline in Anton at `--t-hero`: **"One photograph. Fifteen seconds of
  2003."**, centred, three lines at desktop.
- One sentence: "Upload one photo of your face, choose a place and an outfit,
  and get back a tape that looks like it was found in a drawer."
- The button, and under it the line "21 free credits with a new account. One
  tape, no card." The number comes from the same seam that prices an order;
  it is never typed.
- **The counter ruler** along the panel's foot: tick marks with `REC 00:03 …
  00:15` in the label face, instead of the reference's editing timeline.
- **The tape** breaks out of the panel's bottom edge onto the dark ground: the
  16:9 Times Square tape, muted, looping, `playsinline`, poster first, at
  about 82% of the content width, 8px radius, with the caption line "Times
  Square · 2003 · 16:9 · made from one photograph" beneath.
- No star strip: there are no reviews behind one.

### 3.2 The manifesto

The reference's giant uppercase sentence with clips inlined between the words.
Ours, in Anton, lime and ink alternating by phrase on the dark ground:
**"You, somewhere in 2003, on a tape that looks found in a drawer."**
Inlined between the words: three tilted frame stickers cut from the owner's
tapes (Times Square, the space centre, the phone-shaped Times Square) and one
small readout sticker showing a burnt-in date. The stickers are the showcase
media of §4; with none available the sentence renders without them.

### 3.3 Two cards — "How it looks"

- **The grade.** The existing drag-to-wipe (`figure.wipe`, `WIPE_SCRIPT`,
  `assets/landing/photo.jpg` and `tape.jpg`) moved into a card. No change to
  its mechanism.
- **Your own place.** A card with a real place photograph beside its tape
  frame and the sentence that the customer can upload their own garden or
  kitchen. Its image is a place card that already ships; if a showcase pair
  exists for an owner-uploaded place it is used instead.

### 3.4 The full-bleed band — "Seven places, or your own."

A place photograph across the whole width, scrimmed as the landing scrims
today; over it the **rail of seven place cards** that exists now, snapping,
with the chosen card lime; the photograph behind changes to the card picked.
This is the current landing's background mechanism (hoisted `lplace` radios,
generated `.bg--<id>` layers, `BG_SCRIPT` swapping the loop) moved into one
band instead of the whole page. The loops keep playing here; the per-place
scrim table is reused unchanged.

### 3.5 Three fact cards — the "user says" slot

On crumpled paper, the first on lime and the other two on white as the
reference does, headed in Anton:

1. **"Exactly fifteen seconds."** 375 frames, PAL, because a 2003 tape was.
2. **"The shape you choose."** 4:3, 16:9 or 9:16; the file is the shape.
3. **"Deleted after seven days."** The photograph; the tape after thirty.

The card markup is the one a quotation would use (a figure with a blockquote
and a caption), so real customer quotes drop into the same three cards later
without a layout change. The retention numbers come from the config the purge
enforces, as the consent text's do.

### 3.6 The demo band

The reference's "Demo" photo becomes **the 9:16 Times Square tape standing
phone-shaped on the dark ground with the 4:3 space-centre tape beside it**, so
the two other shapes are seen; both muted, looping, poster first. Heading in
Anton: **"Any shape. Any place."** Under it the "Make a tape" button, and the
flip counter: **`14 08 2003`**, in the tape's readout face, as static styled
digits. It is a decoration that says what the product is named for, not a
statistic, and nothing animates it.

### 3.7 FAQ

Native `<details>` / `<summary>` rows, outlined, a plus glyph that turns to a
minus on open via CSS. No script. Six questions, copy drafted from
`PRODUCT.md` and the legal pages and reviewed by the owner before shipping:

1. Is it free? (21 credits, one tape, no card; packs after that)
2. What happens to my photograph? (rendered by the processors `/privacy`
   names, from the same derivation, so an added classifier appears here the
   day it appears there; deleted after seven days; location data stripped on
   intake)
3. How long does a tape take? (usually under ten minutes — the three tapes
   of 2026-09-05 took six to eight; the status page shows the three phases)
4. Does it look real? (the tape is built in ffmpeg, the model only does the scene; the file is marked AI-generated)
5. Which shapes and qualities? (4:3, 16:9, 9:16; 480p and 720p; the same price in every shape)
6. Can I delete everything? (the account page; export first if wanted)

Every number in the answers comes from config or the pricing seam, never
typed, and the existing German-word sweep and still-approval sweep run over
the page as they run over every page.

### 3.8 Footer

Two link columns on the dark ground — **Product**: Make a tape, Places,
Pricing, My videos; **Legal**: Privacy, Terms, Legal notice,
support@timestamptapes.com — then the giant **"TIMESTAMP."** in Anton, lime,
edge to edge, then the copyright and the AI-disclosure line the footer already
carries. No social icons until accounts exist.

### 3.9 At phone width

The reference's mobile screens were shown and the page follows them, without
a hamburger menu, because a menu needs a script and the nav already wraps
below 30rem. At 320, 375, 414, 768, 1024 and 1440px, the six widths this
project tests at, the page has no horizontal overflow, and:

- the hero stacks: wordmark and pill on one line, links beneath, headline at
  the fluid hero size, the tape at full content width under the button;
- the manifesto sentence shrinks with the viewport and the stickers stay
  inline, smaller;
- the two cards, the three fact cards, the two demo tapes and the footer
  columns stack in one column;
- the place rail scrolls sideways as it does today, snapping, with the
  photograph behind it;
- the FAQ rows and the giant wordmark span the full width, the wordmark
  shrinking to fit rather than wrapping.

### 3.10 Dropped from the reference, on purpose

The five-star strip (no reviews), the Monthly/Yearly toggle (one-off packs),
the compare-all-plans table on the landing (there is one product; §5.3 gives
the pricing page a true comparison instead), the social icons (no accounts),
the "Try demo" flow (the demo is the tape).

---

## 4. The showcase media — faces stay off the public repository

Three tapes and their derived stills carry the owner's face. The repository is
public and git history is permanent, so **none of them is committed**.

- **`TIMESTAMP_SHOWCASE_DIR`** (documented in `.env.example`, set in
  `.env.web` on the box) names a directory outside the repository —
  `/opt/timestamp/showcase` on the box, mounted read-only into the web
  container. The web process serves an **allow-listed set of filenames** from
  it under `/showcase/<name>` through the existing `sendFile` (range
  requests, ETag, nosniff), with `Cache-Control: public, max-age=86400` and
  `X-Robots-Tag` as every response already carries. Any name not on the list
  is a 404; there is no directory listing.
- **The files**, produced once by a script in `scripts/tapedeck/showcase.mjs`
  from a job directory, the way `wipe-pair.mjs` produces the wipe pair:

  | Name | Source | Encode |
  |---|---|---|
  | `hero-16x9.mp4`, `hero-16x9.jpg` | `20260905-221822-a32b2a` | 1280x720, muted, crf 28, faststart, about 3 MB; poster = last frame |
  | `tape-9x16.mp4`, `tape-9x16.jpg` | `20260905-125257-3a448b` | 540x960, muted, crf 28 |
  | `tape-4x3.mp4`, `tape-4x3.jpg` | `20260905-200239-931272` | 960x720 (the matted 1080x1920 delivery cropped to its 4:3 picture), muted, crf 28 |
  | `sticker-1.jpg` … `sticker-4.jpg` | one frame each | 480px wide |

  The delivered tapes are never served: they are 35–37 MB and exist to be
  downloaded, not streamed.
- **Absent means fall back, never break.** With the directory unset or a file
  missing, the hero shows a place photograph in the tape's slot captioned
  with that place's own name (never the tape's caption, which would then be
  untrue), the manifesto renders without stickers, the demo band shows
  place cards. The page is fully testable with no face on the machine, and
  that is the state every test runs in.
- **The Art. 50 line stays.** The metadata tags survive the re-encode
  (`-map_metadata 0`), asserted by the script before it writes, as the
  re-encode on the box did.

---

## 5. The pricing page

### 5.1 Lime band

Heading in Anton: **"Credits, not subscriptions."** One sentence: a tape costs
credits, credits come in packs, tax is added at checkout. Signed in, the
band's second line is the balance in tapes ("43 credits left. Enough for 2
more tapes at 480p."), from the seam that already writes it. No toggle.

### 5.2 Three cards

| Card | Figure in Anton | Beneath | Check-marks |
|---|---|---|---|
| Free | "21 credits" | "when you sign up" | 1 tape at 480p · any shape · no card |
| Starter | "$12" | "92 credits" | 4 tapes at 480p, or 2 at 720p · any shape · yours to download and keep · photograph deleted after 7 days |
| Standard — lifted, lime, "Recommended" | "$19" | "138 credits" | 6 tapes at 480p, or 3 at 720p · the same three lines |

The counts are computed from `creditCost` and the pack sizes, exactly as the
existing "a rung counts tapes in every shape it sells" tests demand. Signed
out, the Free card carries a **"Start free"** action to `/signup`; signed in,
the Free card is absent and the band carries the balance instead. The
**acknowledgement checkbox** on each paid form stays,
word for word, restyled as an outlined field; the guard that refuses a
checkout body naming an amount or a credit count survives.

### 5.3 The comparison table — 480p against 720p

The reference compares plans; this product has one product and two
qualities, so the table compares those. Rows: credits per tape (21 / 46, from
the pricing seam); source detail (480 lines / 720 lines — never the pixel
raster the model is ordered at, because the supplier does not always deliver
what is ordered and a printed raster invites "that is not what I got"); the
delivered file (1080 lines in both, full-bleed in the wide shapes, matted in
4:3); the grain (identical, by design); what each pack buys at that quality. The second column is the
recommended one and carries the lime highlight, as the reference's middle
column does.

Beneath it, the short **"What comes back"** table from the product's own
facts: fifteen seconds exactly, three shapes, mono bed at -27 LUFS, the AI
disclosure in the file.

### 5.4 FAQ and footer

The same components as the landing, rendered by the same functions.

---

## 6. The pages behind sign-in, and the small pages

Structure unchanged from 2026-09-04; world changed. Per page:

- **Order form (`/`, signed in).** Four step cards outlined on the ground,
  step numbers in Anton, the option cards outlined. The chosen **text** card
  (outfit, shape, quality) fills lime with `--on-lime` text; the chosen
  **photograph** card (a place) keeps its picture and takes a 2px lime outline
  and a lime badge, because a fill would cover the thing being chosen. The
  photo and place dropzones a dashed `--line` outline, the Record button lime with the price beside it, the archive strip
  beneath. Same four steps, same order, same controls, same scripts.
- **Status (`/j/:id`).** Heading in Anton ("The garden, being filmed"), the
  three phase rows as outlined cards, the record light red on the one filming.
- **Result.** The tape beside its cassette label; the label's readout stays
  in VT323 because it depicts the object; download button lime; the shelf
  beneath.
- **My videos, Account.** Shelf tiles with the outline; the balance sentence.
- **Login, signup, the code page, reset, reset-complete, and the landing's
  sign-in dialog.** One outlined panel on the ground, heading in Anton,
  Google first, fields outlined, button lime. Forms untouched. The dialog's
  eleven-alias restatement (§60K) goes, because there is only one world to
  restate.
- **Onboarding.** The same panel style. Its dark ground is now every page's
  ground, so `singlePlaceGround()` and the `--frost-lit` plate rule for it
  are deleted rather than kept.
- **Privacy, terms, legal notice, the error trio.** Dark ground, Anton
  heading, Inter body at reading measure, no lime panel.

---

## 7. Implementation shape

- **One stylesheet, tokens first.** `static.mjs` keeps its structure; the
  `:root` block gets the §2.1 values, the `.is-landing` block and every `--l-*`
  token are deleted, the `@font-face` block grows by three faces. Rules that
  read aliases follow on their own; rules that name the readout face for a
  display role are re-pointed to Anton.
- **No new inline script.** FAQ is `<details>`; the counter is static markup;
  the rail reuses `BG_SCRIPT`; the wipe reuses `WIPE_SCRIPT`. The hero and
  demo `<video>` elements ship with a poster and **no `src` and no
  `autoplay`**, exactly as the place loops do: `BG_SCRIPT` assigns the source
  and plays them only when motion is permitted and the codec is playable, so
  no script, reduced motion, save-data, or a missing showcase file each leave
  the poster standing. `BG_SCRIPT`'s text changes for this and its hash
  follows. `INLINE_SCRIPT_HASHES` follows
  any script text change automatically, as it does today.
- **Shared components.** `faq()` and `siteFooter()` are functions in
  `views.mjs` used by both public pages; the fact cards and the pricing cards
  are their own functions with the numbers passed in from the seams.
- **The CSP does not change.** `font-src 'self'`, `style-src 'self'`,
  `img-src 'self' data:`, `media-src` as today (verified at implementation:
  the hero video is same-origin under `/showcase/`).
- **Zero dependencies stays true.** Fonts are files; filters are SVG; nothing
  is installed.

---

## 8. Tests and guards — what is rewritten, what is deleted, what is added

Every guard that pins a **property** survives with the new values; every
guard that pins a **rule this world inverts** is deleted with the rule, and
the deletion is named in the commit. By name, from `test/web-static.test.js`
and `test/browser-smoke.test.js`:

**Rewritten to the new world (same property, new values):**
- "every colour the identity ships clears its floor on the ground it sits on"
  — recomputed from the §2.1 tokens; still fails if any pair drops below 4.5:1.
- "a ghost sits at its ground's floor, and --ink is what has to survive it" —
  `--ghost` re-solved against `#161618` (measured at implementation), one
  ground instead of two.
- "no page the app can render wears a texture of its own" — becomes: the
  speckle filter is applied only to `.lime` panels and the paper filter only
  to `.fact` cards; the dark ground and every dark card carry neither.
- "the cathode orange has left the chrome and kept the date stamp" — becomes:
  no `--l-*` token exists, `#FF8A1E` appears nowhere in the sheet, and the
  date stamp inside the tape is still orange in the pipeline config.
- "the landing plays the place full-bleed instead of framing it in a panel" —
  becomes: the full-bleed band carries the rail and the `.bg--<id>` layers;
  the hero carries the tape slot.
- "the hero is set in the sans face at the hero size" — Anton at `--t-hero`.
- "nothing in the soft tier is also ghosted" — survives, tokens renamed.
- "the free grant opens the page as a sentence, not as a third card with no
  button" — becomes: the free rung is a card with a sign-up action when
  signed out, and absent when signed in.
- "the two packs stand side by side, and the larger one is lifted and
  recommended" — becomes three cards, the Standard lifted and recommended.
- "a pack states its price in the readout face with the credit count directly
  beneath it" — the figure is in Anton; the credit count stays beneath it.
- "the price sits with the claim, and the hero carries one action" — the hero
  still carries one action; the price line beneath it is the free-grant
  sentence, and the pack prices live on the pricing page.
- `test/deploy-topology.test.js` learns the showcase bind mount: web only,
  read-only, and no other service mounts it.
- "the landing list is a rail that snaps, and its menu is a plate" — the rail
  assertions survive in the band; the plate assertion goes with the plate.
- The dim-tier-needs-a-plate rule from §63C — deleted: the plate exists to
  rescue dim text over a photograph, and text no longer sits over one except
  in the band, where the on-image tokens apply.
- Browser contrast sweeps — unchanged; they measure whatever ships.

**Deleted with the rule:**
- The `--frost-lit` plate assertions for onboarding and the sign-in dialog's
  alias restatement (§60K, §63B) — there is one world.
- The browser test that the landing's nav links take bone plus a shadow over
  the loop (§60K) — the nav sits on the lime panel now, and the contrast
  sweep covers it like any other text.

**Kept unchanged:**
- "no border in the sheet draws a line of its own colour", "no page emits an
  `<hr>`", "nothing in the sheet takes a focus outline away again", "the type
  scale is the only place a size is decided", the German sweep, the
  still-approval sweep, the design-rationale-on-the-wire guard, every pricing
  arithmetic test, every CSP hash test, the order-form and status-page
  structure tests.

**Added:**
- Fonts: each `@font-face` names a file that exists under `assets/fonts/` with
  its OFL beside it; no `fonts.googleapis.com` or `gstatic` string anywhere in
  `scripts/`.
- Showcase: an unknown name under `/showcase/` is 404; every allow-listed name
  is served with range support and the cache header; with the directory
  unset every public page renders and no `<video>` names a showcase URL.
- Landing: the eight sections present in order; the FAQ has six `<details>`;
  the fact cards use the quotation markup; the counter reads a date; the
  footer's giant wordmark exists once.
- Pricing: three cards; the middle one carries the recommended mark; the
  comparison table has exactly two quality columns; the acknowledgement stays
  in every paid form.
- Browser: the hero video, when a showcase file is present, is muted and
  playing after load; the FAQ opens on click and on Enter; lime appears on
  exactly one card per option row after a selection.

---

## 9. Docs

- **`DESIGN.md` is rewritten** in the tokens commit: the world in one sentence
  ("a lime poster on a dark ground; the tape is the biggest thing on every
  page that has one"), the rules of §2, the measured palette, the type scale
  with Anton's re-measured ladder, the two textures and where each is
  allowed, the outline language, and a "do and do not" list.
- **The brand-guidelines PDF** describes the old world. It is untracked and is
  not committed; if a brand document is wanted again it is regenerated from
  the new `DESIGN.md` after the site ships.
- **`docs/deploy-runbook.md`** gains the showcase step: create
  `/opt/timestamp/showcase`, copy the files the producer script wrote, set
  `TIMESTAMP_SHOWCASE_DIR` in `.env.web`, and the compose mount.
- **`CLAUDE.md`** gets a section recording what shipped, the reference's
  description, the decisions and their reasons, once the work is done.

---

## 10. Order of work, commits, deploy

One commit per step, test-first, every guard sabotage-verified:

1. Fonts and tokens: the three faces, the §2.1 palette, `.is-landing` and
   `--l-*` deleted, `DESIGN.md` rewritten, the §8 guards rewritten. Every page
   is in the new world with its old layout.
2. Shared components: `faq()`, `siteFooter()`, the outlined-card and lime-panel
   primitives, the speckle and paper filters.
3. Showcase: the env var, the route, the allow-list, the producer script, the
   fallbacks.
4. Landing, sections 3.1–3.8.
5. Pricing, §5.
6. **First deploy**, after 4 and 5 together and the showcase files copied to
   the box, so the live site never shows two worlds. Verified from outside.
   **Between steps 1 and 6 nothing is pulled on the box**: the branch carries
   the new world with old layouts, and the box tracks this branch.
7. Order form, status, result.
8. My videos, account, onboarding, the auth five and the dialog.
9. Legal pages and the error trio.
10. Second deploy; `CLAUDE.md` section.

Each of 4–9 is judged by the owner looking at it rendered before the next
starts, one page at a time, which is the working loop this project has.

---

## 11. What the owner still supplies or decides

- **Go for the font download** when the implementation names the files and
  sizes.
- **The FAQ copy**, drafted by the implementation, read once before it ships.
- **Which four frames become the manifesto stickers**; the implementation
  proposes them from the three tapes.
- **The exact lime**, if the working `#D9FF00` reads wrong under the speckle
  when the first page is rendered; any move is re-measured.
- Nothing else blocks any step.

---

## 12. Out of scope

A public share link for a tape (a product decision about public tapes, not
a page change); customer quotes (the cards are ready for them); a
compare-plans table on the landing; social accounts and their icons; any
change to the tape itself, the prompts, the pipeline or the prices.
