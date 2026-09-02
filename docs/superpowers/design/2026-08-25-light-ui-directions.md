# Light UI directions — three worlds to react to

**Status: a proposal, not a decision, and not the rewrite.** CLAUDE.md's START
HERE item 3 says DESIGN.md is rewritten FIRST and the pages follow. This file is
the input to that rewrite. It changes no page and no token.

Paul ruled on 2026-08-24 that the UI is not to be dark and that he wants
something engaging. **What "engaging" means is his to say**, so this offers three
worlds that are engaging in three different ways and states what each costs. One
gets chosen, DESIGN.md is rewritten around it, and the pages follow it.

Every contrast figure below was computed against the actual hex values, not
estimated. Where a value failed, it was changed until it passed and the failure
is recorded rather than tidied away.

---

## Before the directions: what is actually being replaced

STRUCK is not one decision, it is about twelve, and only some of them are about
darkness. Sorting them is the difference between a rewrite and a repaint.

### Structural — survives any world, because it is architecture and not taste

- **Texture belongs to the tape and to nothing else.** This is PRODUCT.md's
  content/texture split made visible. A light world that wears paper grain fails
  for exactly the reason a dark one that wore scanlines failed.
- **CSS-only selection through hoisted `position: fixed` radios.** DESIGN.md is
  right that the world's central mechanic *is* this technique. No direction below
  touches it.
- **One value struck out of all values present.** The mechanic, not the colour.
  Every direction keeps it; they disagree about what "struck" looks like.
- **The 4px spacing scale**, zero dependencies, no inline styles, self-hosted
  fonts, server-rendered HTML.
- **`outline` on `:focus-visible`, never removed**, and the aspect-ratio glyph.
  Both stay named exceptions.
- **Imported photographs stay untinted.** They are the subject.
- **Orange means exactly one thing.** The *discipline* is structural — it exists
  because the frost-and-amber world let one hue mean ten things and colour
  stopped being able to answer "what have I chosen?". The *hue* is not.

### Aesthetic — a dark-ground answer, and free to change

- `#070A11`, `#FF8A1E`, and all nine `rgba(255,138,30,…)` halos.
- **The gauze and the bloom.** An anode mesh is a thing a cathode readout has.
- **The 420ms decay.** It models a phosphor letting go. Nothing on a light ground
  has a phosphor, so the decay becomes an unmotivated fade.
- **Ghosts at `opacity: .5`.** Measured, permanent, and dark-specific — see below.

### The border rule is the interesting one, and it is half of each

DESIGN.md calls "no borders, no rules, no dividers, anywhere" **the one rule that
makes it this world and not another**, and the mechanical check that no element
inside the wrapper has a visible border is genuinely load-bearing today.

**But the rule is downstream of the ground.** On near-black a hairline is the
brightest thing in its region, so it reads as a box and the page becomes "an
ordinary dark UI with orange accents" exactly as DESIGN.md says. That failure mode
does not transfer. On paper the equivalent failure is different: paper's own
separator is the **edge of a sheet** — a lighter plane with a shadow under it —
and a page that refuses all edges reads as a wireframe rather than as a document.

So the honest carry-over is **the spirit, not the check**: grouping is never a
line drawn *between* two things. What replaces `border: 0` is a per-direction
answer, and each direction below states its own border budget rather than
inheriting a number. **The "third border in a world that permits two" question —
the pricing pill — is settled by each direction explicitly**, because it is a
grammar defect and it does not go away just because the palette did.

### One finding that constrains all three: the ghost does not survive at .5

DESIGN.md's ghost adaptation is measured and correct — bone at `opacity: .5` over
`#070A11` gives **4.55:1**. That number is a fact about a *dark* ground and it
inverts. Halving the opacity of a light value over near-black moves it slowly
toward the ground; halving a dark value over paper races it toward white.

| Ground | ink @ .5 | @ .6 | @ .65 |
|---|---|---|---|
| Paper `#F7F5F1` | 3.32:1 **fail** | **4.54:1** | 5.34:1 |
| Chassis `#E7E4DE` | 3.06:1 **fail** | 4.06:1 fail | **4.71:1** |
| Page `#FBFAF8` | 3.40:1 **fail** | **4.68:1** | 5.56:1 |

**Every light world must restate its ghost number, and the darker the ground the
more it costs.** This is a straight repeat of the lesson DESIGN.md already paid
for once, in the other direction, and whichever world is chosen the new file must
carry its own measured figure or the ghosts ship illegible.

### What the move costs mechanically, so nobody scopes it as a repaint

The token architecture is better than it needed to be and it pays off here. The
sheet defines a **world layer** (`--l-ground`, `--l-cathode`, `--l-bone`,
`--l-dim`, `--l-hot`, `--l-lift`) and an **alias layer** (`--ground`, `--accent`,
`--ink`, `--muted`, `--faint`, `--frost`, `--frost-lit`, `--hairline`) pointing at
it, precisely so there is one place a colour is decided. **Changing the ground is
about fifteen declarations and roughly 300 rules follow for free.**

What does not follow, because it is written as literals:

| Literal | Count | Why it has to be hand-rewritten |
|---|---|---|
| `rgba(255,138,30,…)` halos | **9** in `static.mjs`, plus 4 families generated per preset in `presetCss` | A glow is not a colour, it is a light model. Paper has none. |
| `rgba(11,10,9,…)` scrims and card caps | **10** | A dark scrim over a light page is a bruise. |
| `.gauze`, `.bloom` | 2 blocks | Deleted or replaced outright. |
| Bare hexes (`#B9B3A9`, `#17130F`, `#453E36`, `#14110E`, `#C8C2B8` …) | ~14 distinct | Each is a dark-world value that no token can redirect. |

**The generated `presetCss` is the biggest single item**: every `:checked` rule
strikes with `color` plus `text-shadow`, and two of the three directions delete
the text-shadow half entirely. Budget the rewrite there, not at `:root`.

---

## Direction 1 — THE PRINT

**The interface is the photograph you had developed, and the paper it came back
on.** The tape is not a file, it is a print in a wallet from the lab: bright
paper, near-black ink, and the date printed in the corner in orange because that
is where a date-back camera put it.

### Tokens

| Token | Value | Role |
|---|---|---|
| `--paper` | `#F7F5F1` | the page. Print stock, warm-neutral, **not cream** |
| `--paper-lift` | `#FFFFFF` | the print itself, sitting on the page. Depth goes UP |
| `--ink` | `#1A1714` | body and display. **16.39:1** on paper |
| `--ink-dim` | `#6B645C` | labels. **5.35:1** |
| `--ghost` | `ink @ opacity .6` | unlit options. **4.54:1**, replaces `.5` |
| `--stamp` | `#E4581F` | the date-back orange. Large numerals and marks only — **3.37:1** |
| `--stamp-ink` | `#B03A0B` | the same orange at text weight. **5.58:1** |
| borders | none drawn; **the printed edge** | `--paper-lift` on `--paper` plus a soft shadow |

**The two-value accent is the point, not a hedge.** `#FF8A1E` is a *glow* value
tuned to burn against near-black; on paper it measures **2.17:1** and is unusable. Dye
on paper is denser and redder than light through a phosphor, which is why the date
on a real print is this colour. Large type takes `--stamp`; anything at body size
takes `--stamp-ink`, and the sheet should make that impossible to get wrong.

### Type

**VT323 is recast from cathode to dot-matrix.** It stops glowing and starts
printing: near-black or `--stamp-ink`, never haloed. This is period-true rather
than a compromise — a lab's index sheet and a camcorder's own character generator
were both dot-matrix, and VT323 in ink on paper reads as *printed by a machine*,
which is exactly the register.

Headlines stay VT323 uppercase but in **ink, not orange**, so the page's loudest
voice is print rather than light. Body prose moves up: paper is a reading surface,
so the system sans goes to **16px**, which also closes the Readable Font Size item
in CLAUDE.md §6c that has been waiting on Paul.

### How 2003 survives

**Paper warmth plus the printed date.** The warmth is the substrate, not a light
source: warm-neutral stock, warm-black ink, dye-orange numerals. Nothing glows
because paper does not glow, and refusing to fake a glow is what keeps this from
reading as a dark theme with the lights turned up.

### Carries over / dies

**Carries:** struck and ghost (a ghost is a print face-down; struck is full and
stamped), the CSS-only radios untouched, no strokes, texture off the chrome, one
meaning for orange, the spacing scale, VT323.
**Dies:** every halo, the gauze, the bloom, the near-black scrim, the 420ms decay,
and `--frost-lit` as depth-downward — depth now goes toward white.

**Border budget: two, unchanged, plus a device.** Focus outline and the aspect
glyph stay. The new device is the **printed edge** — a lighter plane with a
shadow, which is not a stroke and passes the existing mechanical check unmodified.

### Signature

**The archive shelf becomes an index print.** Every tape you have made, as a frame
on one sheet, its date printed underneath in orange. `.panel--archive` is already
there and already the most under-used part of the page.

### Tradeoffs, honestly

- **This is the direction nearest the generic AI look** — warm off-white, and the
  default next move is a high-contrast serif and a terracotta accent. It survives
  only if executed as *print white with a terminal face*, and it fails the moment
  someone reaches for a display serif.
- The place photographs now sit on white, so their Soul Cinema vignettes will read
  as dirt on the paper unless every card gets the printed edge.
- **It re-argues a product decision it does not own.** Direct mode deleted the
  still on purpose — there is no picture the visitor ever meets (PRODUCT.md). A
  world built on prints implies an object the product deliberately stopped making.

---

## Direction 2 — THE FLIP-OUT

**The page is the camcorder's own body, and the only dark thing on the site is the
screen.** Light silver-grey chassis, hard little silkscreened labels, and one
recessed well where the tape plays — warm, lit, and the single place the cathode
world still exists.

**This is the strongest answer to the hard problem, because it does not translate
the warmth at all — it quarantines it.** STRUCK is not deleted; it is reduced to
the size of a screen. `#FF8A1E` on `#12161A` still measures **7.71:1** inside the
well, where it was always true, and the light chassis around it makes the tape
read as *more* of an object rather than less.

### Tokens

| Token | Value | Role |
|---|---|---|
| `--chassis` | `#E7E4DE` | the body. Matte plastic, warm-grey |
| `--chassis-lift` | `#F3F1EC` | a raised panel. **14.70:1** to ink |
| `--chassis-seam` | `#CFCBC2` | a moulding line. **1.28:1** — a seam, not a divider |
| `--ink` | `#211E1A` | silkscreen lettering. **13.08:1** |
| `--ink-dim` | `#5F5A52` | secondary labels. **5.39:1** |
| `--ghost` | `ink @ opacity .65` | **4.71:1**. Costs more here than anywhere |
| `--rec` | `#A82A22` | the record lamp. **5.48:1**. Red, because a REC lamp was |
| `--well` | `#12161A` | the LCD. Cool blue-black, so the warm tape sits forward |
| `--osd` | `#FF8A1E` | **unchanged from STRUCK**, and legal only inside the well |

**Two accents that cannot be confused, because they live in different places.**
Red is the machine speaking about itself (recording, alarm); orange is the tape
speaking (date, counter, timecode) and it may not appear outside the well. That is
a stricter reading of "orange means exactly one thing" than STRUCK manages today,
where orange is also the CTA, the how-numbers and the landing read-out.

### Type

**Two registers, and the split is physical.** The chassis is lettered the way a
2003 camcorder body was — small, hard, wide-tracked uppercase system sans, the
`NIGHTSHOT / 700× DIGITAL ZOOM` idiom. **VT323 appears only on the screen**: the
date, the counter, REC, the credit balance. Headlines become large system sans at
tight tracking.

This narrows the display face rather than dropping it, and it is a better use of
VT323 than today's, where it is simultaneously the hero face and the read-out and
therefore neither.

### How 2003 survives

**By being the object rather than describing it.** Warmth is not asked of the
chrome; the chrome is a cool machine and every warm thing on screen is footage.
The era arrives through proportion and labelling — a strip of controls, a hinge, a
well — not through colour.

### Carries over / dies

**Carries:** struck and ghost (a chassis control is engaged or it is not), the
CSS-only radios, zero texture in the chrome, the spacing scale, VT323 narrowed,
and the entire cathode palette inside the well.
**Dies:** the full-bleed place background — a chassis is opaque, so the place
photographs move *inside* the screen. The gauze and bloom die as page-wide layers
and could return, correctly, as artefacts of the LCD only.

**Border budget: three, and the third is argued.** A chassis has **seams**, and a
`1px #CFCBC2` moulding line at 1.28:1 against the chassis is a manufacturing mark,
not a device for separating two things — the same argument the aspect glyph won
on. **This is the direction that deliberately spends a border**, and if that
argument is rejected the direction still works on shadow alone, slightly weaker.

### Signature

**The well.** One dark, warm-lit rectangle on every page — the tape on the result
page, the chosen place on the app page, and **a tape playing on the landing page
before any control is offered**, which is what PRODUCT.md has asked for all along
("the tape leads from the first viewport") and which the current landing page does
not do; it shows blurred veils of place photographs instead.

### Tradeoffs, honestly

- **Skeuomorphism is one bad decision away.** Bevels, plastic gradients and a
  drawn hinge would land it squarely in "AI tool with a filter". The rule has to
  be written into DESIGN.md explicitly: the chassis is a colour and a labelling
  convention, never a texture and never a bevel.
- **It is the most expensive of the three.** Two type registers, two accents with
  a geographic rule, and a screen component that has to work on five pages.
- **The chassis lightness is load-bearing, and a plausible silver is a trap.** The
  first value tried was `#DEDBD4` — a convincing 2003 grey, and one where
  `#B03A0B` measures **4.39:1** and fails body text outright. Lightening the
  ground to `#E7E4DE` fixed it (**4.79:1**) without touching the accent. A
  mid-light ground squeezes contrast from both ends at once, which is also why
  the ghost costs `.65` here and `.6` everywhere else. **Whoever picks the final
  chassis value is setting the contrast budget for the whole world**, so it is
  measured first and chosen second, not the other way round.
- The chassis metaphor has to survive a phone, where there is no room for a strip
  of controls beside a screen.

---

## Direction 3 — EIGHT AFTERNOONS

**The page has no colour of its own; the memory you choose colours it.** Near-white
and almost neutral until a place is struck, then the whole page floods with that
place's light — sodium orange, chlorinated teal, television violet — over the
900ms cross-fade that already exists.

This is the most engaging in the literal sense: **the page visibly and largely
answers the visitor**, with machinery the repo already built. `PLACE_HUES`,
`placeGradient` and the `.bg--<id>` fade are all in `static.mjs` today, CSS-only,
no script, and the file's own comment already argues the thesis — *"it makes
colour carry information … the app is a visibly different colour for every memory
somebody picks."* On a dark ground that is eight tints under a scrim. On a light
ground it is eight different afternoons.

### Tokens

| Token | Value | Role |
|---|---|---|
| `--page` | `#FBFAF8` | near-white, barely warm. Neutral because it must host 8 hues |
| `--wash` | per place, measured | the struck place's own light, at paper lightness |
| `--ink` | `#171512` | **14.41:1 at worst across all eight washes** |
| `--ink-dim` | `#655F57` | **4.99:1 at worst** |
| `--ghost` | `ink @ opacity .6` | **4.68:1** |
| `--struck` | per place, measured | the place's hue at ink strength |
| `--stamp` | `#E4581F` / `#B03A0B` | **the date, and nothing else** |

**Orange finally means exactly one thing.** Selection is no longer orange — it is
the colour of what you chose — which frees the accent to be the burnt-in date
alone. That is a purer reading of DESIGN.md's palette rule than STRUCK achieves.

### The eight values, and the formula that does not work

The obvious implementation is `hsl(H 62% 92%)` for the wash and `hsl(H 78% 34%)`
for the strike. **Measured, five of the eight fail 4.5:1** — because HSL lightness
is not perceptual lightness, and green at L34 is far brighter than blue at L34.
Schrebergarten came out at **3.09:1**.

Hand-tuned to a 5:1 floor against each wash, the lightness required spans **25.5
to 40 — a 14.5-point spread that no single coefficient reproduces**:

| Place | wash | struck | measured |
|---|---|---|---|
| `autobahn-raststaette` | `#F7E8DE` | `#9F4B14` | 5.02:1 |
| `balkon-waesche` | `#DEF0F7` | `#126B8F` | 5.06:1 |
| `hallenbad-nachmittag` | `#DEF7F6` | `#0E746D` | 5.04:1 |
| `kuechentisch-fruehstueck` | `#F7F0DE` | `#815F10` | 5.13:1 |
| `ostsee-strand` | `#DEEAF7` | `#1661B6` | 5.05:1 |
| `plattenbau-treppenhaus` | `#DEF7EC` | `#0F7649` | 5.03:1 |
| `schrebergarten-august` | `#ECF7DE` | `#48740E` | 5.03:1 |
| `wohnzimmer-abend` | `#F3DEF7` | `#9B16B6` | 5.21:1 |

**These are a table, not a function**, and that is the direction's real cost. It is
also the third time this repo has learned the same lesson — the 480p/720p ratio
was reasoned and the invoice disagreed; `hash32`'s signed shift quietly
desaturated whichever cards hashed high because "muddier than intended looks
exactly like a design decision". **Generated colour goes wrong silently.** A place
added without an entry here needs a fallback that is safe rather than plausible.

### Type

The colour is loud, so the type is quiet. System sans at 16px carries nearly
everything; headings are large, tight and low-contrast. **VT323 shrinks to its
smallest role of the three** — the date stamp and numerals only.

### How 2003 survives

**As the colour of the era's ordinary light.** Sodium vapour, chlorinated cyan, a
television in a dark room: the catalogue already insists these are observations
rather than preferences, and on a light ground they stop being tints under a scrim
and become the actual subject. The date stamp carries the rest.

### Carries over / dies

**Carries:** the strike mechanic in its strongest form, the CSS-only radios, the
cross-fade, no strokes, texture off the chrome, the spacing scale.
**Dies:** a fixed accent, the halos, the gauze, the bloom, and — most
significantly — **the idea that the product has a colour at all**.

**Border budget: two, unchanged.** Grouping is the wash: two groups on different
washes need no line between them, which is the closest any direction gets to
STRUCK's original argument.

### Signature

**The strike.** The landing page's ghost stack of eight place names, where striking
one repaints the entire page in that place's light. Roughly 80% built already,
impossible to mistake for another company's page, and it *is* the product thesis
rather than an illustration of it.

### Tradeoffs, honestly

- **Eight themes is eight contrast problems, not one.** The table above is the
  minimum; every component gets re-checked against all eight, and the light-hue
  end (grass, chlorine, butter) is where things fail.
- **A product with no fixed colour has no colour in a screenshot.** There is no
  brand swatch, and marketing, the favicon and an OG image all have to answer that
  question separately.
- **It leans hardest on the place photographs, and only eight exist.** A visitor
  who types their own place or uploads one gets the neutral page — the least
  engaging state, handed to the visitor doing the most interesting thing. That is
  a real hole and it needs an answer before this ships.
- Quiet type plus loud colour can read generic if the signature is not carried all
  the way through.

---

## The pricing page, which is not moot

CLAUDE.md item 7 marks the pricing-page work "possibly moot if the UI world
changes". **It is not.** §23's finding is grammatical, not chromatic: the three
plans are visually identical, so the one page whose entire job is answering *which
plan am I on* is the one page not using the world's selection grammar. That defect
survives any repaint.

The bordered `.plan .mark` pill is the chromatic half, and each direction retires
it differently — as a **stamp** on the print, as **silkscreened lettering** on the
chassis, as the plan's own **wash** in Eight Afternoons. **The strike-and-ghost
half is the same fix in all three** and should be written into the rewritten
DESIGN.md as a rule the pricing page is measured against, not left as a page-level
to-do. That is the failure §23 already diagnosed once: page-by-page opt-in is how
five pages stayed wrong.

---

## How to choose

**These are not three intensities of one idea; they answer three different
questions**, and the useful way in is to answer the question rather than to pick a
palette.

| | THE PRINT | THE FLIP-OUT | EIGHT AFTERNOONS |
|---|---|---|---|
| Engaging by being | **warm and tactile** | **an object you operate** | **responsive to you** |
| Warmth mechanism | paper and dye | quarantine the glow in a screen | the memory's own light |
| Keeps of STRUCK | most of the grammar, none of the light | the light, in one rectangle | the mechanic, none of the colour |
| Border budget | 2 + printed edge | **3, seam argued** | 2, unchanged |
| Ghost | `.6` | `.65` | `.6` |
| Build cost | **lowest** | **highest** | middle, front-loaded on the colour table |
| Biggest risk | lands on the generic AI cream page | tips into skeuomorphism | eight contrast problems; no brand colour |
| Already built | the archive panel | nothing | ~80% of the signature |

**Three checks worth running before deciding.**

1. **Which object is the product?** The print, the machine, or the memory. Every
   other question follows from that one, and none of them settles it.
2. **Does the landing page have to play a tape?** PRODUCT.md says the buyer's
   doubt is credibility and that the artifact must lead the first viewport. Today
   it does not. Only THE FLIP-OUT makes that structural rather than optional.
3. **Cheapest possible test, and it costs nothing:** the alias layer means one
   direction's ground and ink can be tried by editing about fifteen declarations
   and reloading. **The halos are what will look wrong**, and they are literals, so
   a fair look needs the nine `rgba(255,138,30,…)` rules neutralised too. Restart
   the server and hard-refresh, or you will be measuring the old bytes.

**A recommendation, offered as one and not as a decision.** THE FLIP-OUT is the
strongest of the three, because it is the only one that does not have to *argue*
the warmth onto a light ground — it keeps the world that was already chosen and
correct, at the size where it was always true, and spends the light on making the
tape the brightest idea on the page. It is also the most expensive and the easiest
to execute badly. If the budget is not there, THE PRINT is the safer build and
EIGHT AFTERNOONS is the more distinctive one.

## The single question each direction hinges on

- **THE PRINT** — *Is a Timestamp something you had developed, or something you
  recorded?* If the object is a print, this is right. If it is a tape, it is a
  world built on an artifact the product deliberately stopped making.
- **THE FLIP-OUT** — *Should the interface be the machine, or the thing the machine
  made?* And, concretely: **is Paul willing to spend a third border on a seam?**
- **EIGHT AFTERNOONS** — *Does Timestamp have a colour, or do the memories?* If the
  brand needs a swatch, this direction cannot give it one.
