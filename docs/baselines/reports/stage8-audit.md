# Stage 8 content audit

Snapshot: `1786673780`

| status | count |
|---|---:|
| pass | 5 |
| warn | 10 |
| block | 0 |
| total | 15 |

## Per CID

- **2** `about` (page) — **pass**
  - notes: built body chars≈278
- **5** `friends` (page) — **pass**
  - notes: page body empty by design; friends render from data/friends.json (Joe JFriends); built body chars≈30 (empty source page)
- **11** `omv-webui-400-bad-request` (post) — **warn**
  - warnings: body contains 3 h1 heading(s) (page title is separate)
  - notes: converted shortcodes: 1; headingFixes during sync: 5; built body chars≈550
- **13** `maibot-astrbot-napcat` (post) — **warn**
  - warnings: body contains 3 h1 heading(s) (page title is separate)
  - notes: converted shortcodes: 2; headingFixes during sync: 6; built body chars≈5582
- **16** `dn42` (page) — **warn**
  - warnings: heading level skips: 2→4
  - notes: converted shortcodes: 1; headingFixes during sync: 3; built body chars≈1662
- **30** `grafana-bird-status` (post) — **warn**
  - warnings: heading level skips: 2→4; body contains 2 h1 heading(s) (page title is separate)
  - notes: converted shortcodes: 1; headingFixes during sync: 18; built body chars≈24851
- **33** `ios-lz4-extract` (post) — **warn**
  - warnings: heading level skips: 2→4
  - notes: converted shortcodes: 1; headingFixes during sync: 7; built body chars≈476
- **34** `silly-tavern-linux` (post) — **warn**
  - warnings: heading level skips: 2→4; body contains 2 h1 heading(s) (page title is separate)
  - notes: converted shortcodes: 2; headingFixes during sync: 22; built body chars≈1541
- **41** `screen-tmux-ssh-background` (post) — **warn**
  - warnings: heading level skips: 2→4
  - notes: headingFixes during sync: 10; built body chars≈519
- **47** `typecho-joe-mermaid` (post) — **pass**
  - notes: converted shortcodes: 1; headingFixes during sync: 1; built body chars≈9054
- **61** `blog-cover-origin` (post) — **pass**
  - notes: built body chars≈566
- **62** `stable-diffusion-notes-p1` (post) — **warn**
  - warnings: heading level skips: 2→4; body contains 3 h1 heading(s) (page title is separate)
  - notes: converted shortcodes: 4; headingFixes during sync: 13; built body chars≈2128
- **66** `rp-hub-silly-tavern` (post) — **warn**
  - warnings: heading level skips: 1→3; body contains 3 h1 heading(s) (page title is separate)
  - notes: converted shortcodes: 1; headingFixes during sync: 3; built body chars≈854
- **68** `looking-glass-shadow-incident` (post) — **pass**
  - notes: built body chars≈5298
- **76** `asterisk-telephony42` (post) — **warn**
  - warnings: heading level skips: 2→4; body contains 5 h1 heading(s) (page title is separate)
  - notes: converted shortcodes: 1; headingFixes during sync: 29; built body chars≈12341
