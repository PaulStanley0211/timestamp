# Drop your test photos here

Two files, both optional-but-one:

- **`face.jpg`** — one photo of you. This is the identity anchor for the whole
  render. Waist-up or head-and-shoulders, reasonably lit, looking roughly at the
  camera. It does not need to be good; it needs to be *you*.
- **`place.jpg`** — optional. A photo of the actual place you want to be in.
  This is the two-reference path — "your actual childhood garden" — and it is
  the strongest version of this product.

Any of `.jpg` / `.jpeg` / `.png` / `.webp` works. The pipeline re-encodes on
intake, which autorotates from EXIF and **strips every metadata block**, so the
copy stored in the job directory carries no GPS coordinates. That matters more
for `place.jpg` than for `face.jpg`: a photo of a place carries its exact
location, and this directory is gitignored precisely so an original never gets
committed by accident.

Nothing here is committed. See `.gitignore`.
