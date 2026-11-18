# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/herdin72/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/herdin72/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-2) ranks 178 pre-token protocols from a sealed DefiLlama snapshot (758 protocols, 2026-11-14) by implied token value — TVL × momentum × maturity × chain breadth — with a farm plan for every row. Static dashboard: ranked board, per-protocol detail view, and chain/category filters. No network at runtime.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
# then serve the output: cd out && python3 -m http.server 8080
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=3cnb50c1&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
