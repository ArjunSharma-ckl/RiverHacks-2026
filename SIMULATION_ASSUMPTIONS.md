# Simulation assumptions

MF-001 is a deterministic training scenario. Identical configuration, elapsed time and incident choices reproduce the same run. Operators inject incidents. There is no randomized failure probability.

- A sol lasts 24.6597 hours. Manual steps integrate at intervals of at most one hour. The clock stops at the planned duration or when a critical resource reaches zero.
- Solar generation uses installed kW × mean daily POWER solar irradiation / 24. This daily average omits night cycles, tracking, seasonal variation and AC losses. The Mars projection uses a 0.43 solar scaling factor. Atmospheric pressure, gravity and radiation exposure are outside the simulation.
- Habitat demand is constant. The rover has a 2.4 kWh pack, draws 0.12 kW while moving, and recharges from habitat power at up to 0.32 kW while stationary. A communications outage suspends driving until the operator restores the link or authorizes autonomous operation. Generated energy serves loads and then charges storage up to its capacity. Battery loss represents net discharge. Backup power supplies up to 20 kWh when enabled.
- Each crew member consumes 0.84 kg oxygen, 1.6 L net water and 0.64 kg food per 24 hours. Values represent training budgets. An oxygen leak adds 0.38 kg/h, or 0.09 kg/h after isolation. One emergency reserve adds 3 kg.
- A solar failure leaves 15% generation and dust leaves 35%. Effects multiply. Repairs consume spares. Shedding nonessential load reduces base demand to 65%. Sheltering through a dust storm advances time by four hours.
- A dispatched rover travels at an illustrative average 0.22 km/h. Local scene motion illustrates activity around the base. Breakdowns and dust suspend travel.
- ASTRA uses fictional crew, synthetic vital signs and scripted medical drills. Time on shift, activity and incident choice change readings. The medical kit and reduced duty create follow-up monitoring intervals. These exercises have no clinical or treatment authority.
- The report snapshots actual reserves and the recorded decision log. Habitat endurance requires reaching the scheduled end. A rover or geological objective also requires positive traverse distance.

Crew duty cycles include 0.20 hours of outbound travel, 0.55 hours of work and 0.20 hours for the return. Each completed work period records one sample, audit or suit check, or recovers 0.35 L of water up to tank capacity. Storms halt field work. Medical incidents and recovery suspend the affected astronaut’s duties. The helmet and chase cameras track the same duty progress used to calculate production. The ASTRA pulse trace is a synthetic rhythm paced by the selected astronaut’s simulated heart rate.
