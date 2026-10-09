# Notices

## License

Cloviela Router is distributed under the **GNU General Public License, version 3
only**. The full text is in [`LICENSE`](LICENSE).

## Provenance

The gateway engine — request routing, protocol translation, provider adapters,
persistence, telemetry — is third-party code under the same GPL-3.0-only terms,
incorporated here as the starting point for this project.

| | |
|---|---|
| Project | Cartethyia |
| Source | <https://github.com/risunCode/Cartethyia> |
| Revision | branch `dev`, commit `382cf2308f4a09aeac0b5e2b1adf8fa7ace9319f` |
| License | GPL-3.0-only |

Its copyright and license are retained as the GPL requires. The engine was
incorporated as a single commit so the history of this repository begins at a
state that runs.

## Modifications

Every change made to the incorporated engine is recorded in
[`CHANGELOG.md`](CHANGELOG.md), with dates. In summary, this project adds and
maintains:

- the console: an original interface, theme, artwork and Indonesian-first
  localization;
- Bansos: publishing a subsidized key and the public page that hands it out;
- the `cloviela` command-line tool;
- operational work across routing, provider handling, security and deployment.

Presentation changes (theme, artwork, localization) are kept separate from
engine changes so either can move independently.

## Artwork

The character illustrations in `assets/` and `dashboard/public/rikka/` were
generated for this project with OpenAI GPT-Image-2 through OMP. They are
original derivative illustrations of the Rikka Takarada character design;
prompts, dimensions and hashes are recorded in
[`assets/manifest.json`](assets/manifest.json).

The character identity is **not** covered by the GPL and remains the property
of its rightsholders. This is an unofficial personal fan theme: it is not
affiliated with, sponsored by, or endorsed by any rightsholder, and it claims
no commercial rights to the character.

## Warranty

This software is provided **without warranty**, as stated in the GPLv3.
