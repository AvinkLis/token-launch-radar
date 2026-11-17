# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/AvinkLis/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/AvinkLis/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over a sealed DefiLlama snapshot (758 protocols at $5M TVL or more, sealed 14 November 2026). It screens for protocols that record no token — re-applying the house watchlist's own rule at every size, so the 40 watchlist protocols are carried whole and 158 more are found below the house's floor — and prices each one from the market's own revealed numbers: the median market-cap/TVL of the trading protocols in its category, adjusted by a size factor (the median residual of its TVL band), its seven-day TVL growth, and how long it has run with no token. The result is a ranked board of 198 pre-token protocols, each with the full price breakdown and a concrete farm plan (the action, what it costs, how long it takes), presented as one static dashboard page: sortable, filterable, with a detail view per protocol and the calibration tables behind the prices.

The program is a pure function of the snapshot's bytes: Node's standard library only, no network, no clock, no randomness, so two runs write identical output.

## Run it

```sh
# Node 22+. /input is the sealed snapshot's directory (or pass a snapshot.json
# file); the output directory receives board.json, data.js, dashboard/,
# screenshots/ and dossier.json.
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /input
```

Then open `out/dashboard/index.html` in a browser: it renders entirely from the `data.js` written beside it.

---

<sub>Entered on [make.fun](https://make.fun/?ref=cy781krb&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
