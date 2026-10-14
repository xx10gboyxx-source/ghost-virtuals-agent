# Roadmap

Implemented in v0.3: Base meme-token spot screening, two closed-candle strategies,
bounded public feed adapters, persistent paper execution, risk controls, research
reports and reproducible synthetic evaluation.

Remaining work, not claimed as shipped:
1. Validate live GeckoTerminal and GoPlus payloads, coverage and observation latency.
2. Collect forward paper results using identified meme-token pools and observed costs.
3. Evaluate real Virtuals inference fidelity and credit consumption.
4. Add independently verified sale simulation, route liquidity/price-impact and MEV assessment.
5. Validate supervised hosting, health monitoring and restart recovery under outages.
6. Design and separately review real wallet execution, permissions, receipts and exits.

No roadmap milestone automatically enables live trading. Compute credits are for
inference evaluation; they do not fund trades or create a deployed trading service.
