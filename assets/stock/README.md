# Stock clips for look development

Drop any video here and grade it:

    npm run look -- --in=assets/stock/<file>.mp4 --name=<label>

Anything works. A 15s-or-longer clip with a person, skin tones and at least one
bright light source (a window, a lamp, the sun) exercises the most of the chain --
bloom keys off highlights and the grade is judged on skin.

**Nothing in this folder is ever shipped, and nothing here is committed.**
The whole directory is gitignored apart from this file. If you have no clip at
hand, `npm run look` with no `--in` generates its own source from ffmpeg's
`testsrc2`, so the command works on a fresh clone.
