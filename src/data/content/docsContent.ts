/*
  Author: Runor Ewhro
  Description: owns the long-form reference documentation entries used by the
               docs page, keeping simulation math and evaluation explanations in
               structured data rather than page component branches.
*/

export interface DocProseBlock {
  type: 'prose'
  text: string[]
}

export interface DocFormulaBlock {
  type: 'formula'
  caption: string
  title: string
  lines: string[]
}

export interface DocTableBlock {
  type: 'table'
  columns: string[]
  rows: string[][]
}

/** Renders the live grade ladder from the evaluation module. */
export interface DocLadderBlock {
  type: 'ladder'
  caption: string
  title: string
}

/**
 * Renders the live Tune Break level table from the engine. Shows the key
 * breakpoints by default and expands to every level from 1 to 90.
 */
export interface DocLevelTableBlock {
  type: 'levelTable'
  caption: string
  title: string
}

export type DocBlock =
  | DocProseBlock
  | DocFormulaBlock
  | DocTableBlock
  | DocLadderBlock
  | DocLevelTableBlock

export interface DocSection {
  id: string
  title: string
  blocks: DocBlock[]
}

/** Selects the topic's interactive calculation example. */
export type DocInstrument = 'anchorScale' | 'stackRamp' | 'searchSpace' | 'none'

export interface DocTopic {
  id: string
  /** Stable short topic code, e.g. "SCORE". */
  code: string
  eyebrow: string
  title: string
  abstract: string
  summary?: string
  drives: string
  instrument: DocInstrument
  /** Calculation caveats for the selected instrument. */
  instrumentNote?: string[]
  aliases?: string[]
  sections: DocSection[]
}

const evaluationTopic: DocTopic = {
  id: 'build-evaluation',
  code: 'SCORE',
  eyebrow: 'Scoring',
  title: 'Scoring',
  abstract: 'Build-score benchmarks, loadout-aware Echo quality, generated stat weights, and Crit Value.',
  drives: 'Build score - Echo score - Crit value - Echo generation weights',
  instrument: 'anchorScale',
  instrumentNote: [
    'The chart uses fixed illustrative damage values to demonstrate the 0%, 100%, and 200% anchors. Actual anchors are computed for the selected build context using the rules below.',
    'The 0% anchor removes all Echoes. The 100% anchor uses at most 16 relevant lines and 32 shared tier increases, with the flat-stat and ranking constraints below. The 200% anchor uses the maximum-value model. Their damage values change with the resonator, weapon, team, controls, and preserved utility requirements.',
  ],
  aliases: ['evaluation', 'build-score', 'dps-score', 'echo-score', 'cv', 'crit-value'],
  sections: [
    {
      id: 'score-request',
      title: '01 Score Request',
      blocks: [
        {
          type: 'prose',
          text: [
            'A build score request starts with the selected resonator state, the latest simulation, the enemy profile, and the other team members. The score cannot be computed from Echo totals alone, because the denominator is generated for the same rotation, team state, enemy, weapon, active controls, Sonata state, and main Echo assumptions.',
            'The returned number places active build damage on a generated reference scale: 0% is the no-Echo baseline, 100% is the constrained investment benchmark, and 200% is the maximum-value benchmark. Scores can exceed 100%. This compares damage inside one standardized combat situation; Echo-card quality uses its own reference, described in section 12.',
            'So scores stay comparable, the evaluation does not score your exact field state. It first normalizes the situation to fixed endgame conditions: the resonator is forced to level 90, every skill level is maxed, every trace node is maxed, and the equipped weapon is taken to its max level. The target is replaced with a standard level 100, 20% RES enemy. Your equipped Echoes, weapon choice and rank, sequence, team, and active controls are kept as set; only the levels and the enemy are standardized.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.1',
          title: 'Score request boundary',
          lines: [
            'input = {',
            '    selectedResonator,',
            '    latestSimulation,',
            '    enemyProfile,',
            '    teamRuntimeState',
            '}',
            '',
            'evaluation = buildEvaluation(input)',
            'score = evaluation.percent * 100',
          ],
        },
      ],
    },
    {
      id: 'data-loaded',
      title: '02 Data Loaded',
      blocks: [
        {
          type: 'prose',
          text: [
            'Before any score math runs, the game-data layer has already loaded Echo definitions, Echo stat tables, Sonata set definitions, source states, resonator seeds, skills, effects, and default rotations. The build score uses those catalogs to rebuild both the active Echo contribution and the generated reference builds from the same rules.',
            'Echo stat data supplies legal primary main stats by Echo cost, the fixed secondary stat by Echo cost, the legal substat keys, and the min/max/division range used to recreate legal substat roll values. Echo catalog data supplies each Echo cost and eligible Sonata sets. Sonata set data supplies set piece thresholds, set effects, utility set state controls, stack limits, and the operations that turn those states into stat or damage effects.',
          ],
        },
        {
          type: 'table',
          columns: ['Loaded data', 'Scoring use'],
          rows: [
            ['Resonator seed', 'selects the evaluation rotation used to compute active damage and reference damage'],
            ['Current resonator state', 'provides weapon, Echoes, active controls, stack values, combat state, and team links'],
            ['Echo stat table', 'defines legal main stats, fixed secondary stats, substat keys, and legal roll values'],
            ['Echo catalog', 'defines cost, set membership, and legal main Echo carriers'],
            ['Sonata set definitions', 'define piece activation, utility states, stack controls, and set effects'],
            ['Enemy profile and team state', 'feed the same damage evaluator used by active and reference builds'],
          ],
        },
      ],
    },
    {
      id: 'evaluation-context',
      title: '03 Evaluation Context',
      blocks: [
        {
          type: 'prose',
          text: [
            'The evaluation uses a set rotation independent of what you can set. User rotation edits do not define the build-score rotation. The equipped Echoes, weapon, weapon rank, sequence, team, active controls, and combat state remain part of the situation; the resonator, weapon, skill, and trace levels and the enemy are standardized as described above.',
            'Set state is rebuilt for evaluation scoring. If the equipped build has a completed utility Sonata set, the evaluation preserves that utility set only with the same active controls and stack values currently present on the selected resonator.',
            'BTW! A "Utility" sonata set are just sets i flagged as not entirely dps focused like Moonlit Clouds and Rejuvenating Glow :P'
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.2',
          title: 'Evaluation context construction',
          lines: [
            'evaluationRuntime = standardize(currentRuntime)',
            '    resonator level -> 90',
            '    all skill levels -> max',
            '    all trace nodes -> max',
            '    weapon level -> max (weapon and rank kept)',
            'enemy = standard level 100, 20% RES',
            '',
            'evaluationRuntime.rotation.sequence = defaultRotationSequence(resonator)',
            '',
            'utilityPlan = completed utility Sonata sets in equipped Echoes',
            'enabledSetStates = characterSetRule(resonator)',
            '',
            'for each completed utility set in utilityPlan:',
            '    for each state on that set:',
            '        if current control value is active:',
            '            enabledSetStates.add(state with current value)',
            '',
            'context = prepare default rotation with enabledSetStates',
          ],
        },
      ],
    },
    {
      id: 'active-damage',
      title: '04 Active Damage',
      blocks: [
        {
          type: 'prose',
          text: [
            'A build is scored by converting the equipped Echoes into flat stat totals, active Sonata pieces, the selected main Echo effect, and the selected main Echo slot. That Echo contribution is added to the prepared evaluation combat context and evaluated.',
            'Every damage entry in the evaluation rotation is evaluated against that Echo contribution and multiplied by its rotation contribution weight. The final active damage is the weighted sum across the whole rotation.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.1',
          title: 'Active build damage',
          lines: [
            'echoContribution = build Echo stat and effect contribution(equipped Echoes)',
            '',
            'activeDamage = 0',
            'for each damage entry in the evaluation rotation:',
            '    activeDamage += evaluate(entry, echoContribution) * entryWeight',
          ],
        },
      ],
    },
    {
      id: 'anchor-inputs',
      title: '05 Anchor Inputs',
      blocks: [
        {
          type: 'prose',
          text: [
            'Anchor weights... they\'re basically what lets the program rate a build. They are the 0, 100, and 200 reference anchors. Those anchors are reused when the equipped Echo edit does not change the reference search space.',
            'The equipped build reaches the anchors through only three channels: its Energy Regen target, its completed utility Sonata set plan plus active utility state values, and a selected main Echo support effect that applies beyond the wearer. Non-ER substats and ordinary main stats change active damage without moving the reference anchors. Sonata pieces and self-only main Echo effects also move the anchors if they change the resolved ER target.',
            'That split is important: the active build is scored exactly with its current Echoes, current Sonata set rows, and current main Echo effect. The reference anchors are generated builds. They search legal Sonata plans and legal main Echo carriers, but they only inherit utility-set requirements and support-main-Echo locks from the equipped build.',
            'TLDR! This doesn\'t really matter much, i\'m just trying to say, computation is expensive so it would only run the "full" thing when certain stuff (as mentioned earlier) changes because those genuinely affect these anchors... which in turn affect the rating scale.'
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.3',
          title: 'Anchor reuse boundary',
          lines: [
            'anchorInputs = {',
            '    current situation with Echo stats removed,',
            '    enemy profile,',
            '    team state,',
            '    targetER from equipped build,',
            '    completed utility set ids and piece counts,',
            '    active utility set control values,',
            '    preserved support main Echo id',
            '}',
            '',
            'if stored anchors exist for anchorInputs:',
            '    skip reference search',
            '    re-score active build against stored anchors',
          ],
        },
      ],
    },
    {
      id: 'reference-space',
      title: '06 Reference Space',
      blocks: [
        {
          type: 'prose',
          text: [
            'Reference builds are generated legal five-Echo builds. "Legal" in the sense that you can get these in the actual game, Wuthering Waves. For example, A build that contains the echo, Hoartoise, while still somehow achieving a 5pc Tidebreaking Courage, 4-4-3-3-3 cost setup is not legal, as that is impossible to have in game. The search enumerates legal cost layouts, legal Sonata layouts, legal main Echo carriers, and legal primary main stats. It rejects any generated build that cannot preserve required utility sets, cannot carry the required support main Echo, or cannot form the requested set plan.',
            'Set pieces are counted per Sonata set the usual way: one Echo can sit in two different sets and count toward each, so a frame is legal as long as its five Echo/set pairs are distinct. The same Echo in the same set is the only redundant case.',
            'Every generated frame carries three structural choices before substats exist: the Echo cost layout, the Sonata set plan, and the main Echo effect row. The frame scorer applies the generated Sonata rows and selected main Echo effect before evaluating the same packed damage contexts used for the active build.',
            'The no-Echo baseline is scored first with no Echo stats, no Echo set rows, and no main Echo effect. The 100 and 200 anchors then search the same generated build space with different roll budgets and roll qualities.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.4',
          title: 'Generated anchor frames',
          lines: [
            'frames = []',
            '',
            'for each legal five-Echo cost layout:',
            '    if required main Echo cost is absent: continue',
            '    for each legal Sonata set plan:',
            '        if required utility plan is not retained: continue',
            '        if the Echo definitions cannot form the set plan: continue',
            '        for each legal main Echo choice:',
            '            build five generated Echoes',
            '            apply set plan',
            '            require five distinct Echo/set pairs',
            '            encode Echo stats, Sonata rows, Echo kinds, and main Echo effect',
            '            discard frames with duplicate Sonata-effect / main-Echo-effect signatures',
            '            frames.push(prepared generated build)',
            '',
            'baselineDamage = damage(no Echo frame)',
          ],
        },
      ],
    },
    {
      id: 'useful-stats-main-stats',
      title: '07 Useful Stats',
      blocks: [
        {
          type: 'prose',
          text: [
            'For each generated Echo/set/main-Echo frame, the search discovers which stats can actually move damage before it enumerates primary main stats and substat fills. It starts from the frame with main stats only, removes the frame\'s current primary main stats, adds one high probe value for every legal stat, scores that full probe, then removes one probed stat at a time. A stat is useful when removing it changes damage.',
            'The report uses a deterministic beam of the most promising frame families and a bounded main-stat candidate budget. This is intentionally an estimate: it keeps the UI responsive and memory-bounded, but it can miss a theoretically stronger legal reference build.',
            'Useful stats are used to keep main-stat enumeration and substat filling focused. Energy Regen is removed for resonators that intentionally ignore ER. When the equipped build has an ER target, Energy Regen is forced into the useful set so the reference build can satisfy the target even if ER does not increase direct damage.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.5',
          title: 'Useful-stat probe',
          lines: [
            'probe = frame with primary main stats removed',
            '',
            'for each legal stat:',
            '    probe += highest legal main-stat value or max substat roll',
            '',
            'fullDamage = damage(probe)',
            '',
            'for each legal stat:',
            '    trial = probe - that stat value',
            '    if abs(fullDamage - damage(trial)) > epsilon:',
            '        usefulStats.add(stat)',
            '',
            'if resonator ignores ER: usefulStats.remove(ER)',
            'if equipped build has ER target: usefulStats.add(ER)',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.6',
          title: 'Primary main-stat enumeration',
          lines: [
            'for each Echo slot in the generated frame:',
            '    legalMains = primary main stats allowed by that Echo cost',
            '    usefulMains = legalMains whose stat is useful',
            '',
            '    if usefulMains is empty:',
            '        enumerate the first legal main stat only',
            '    else:',
            '        enumerate every useful legal main stat',
            '',
            'candidate = one complete five-slot primary main-stat assignment',
          ],
        },
      ],
    },
    {
      id: 'roll-models',
      title: '08 Slot And Tier Models',
      blocks: [
        {
          type: 'prose',
          text: [
            'The 100 reference has 25 occupied substat slots: five distinct keys on each of five Echoes. At most 16 lines may be relevant: any stat that contributes to damage, plus every ER line reserved for the equipped requirement. The remaining nine or more lines are non-damage filler at legal minimum values.',
            'At least two of the relevant lines must be flat ATK, flat HP, or flat DEF that contributes to damage. Both lines may use the same key.',
            'Value upgrades use a separate shared budget of 32 tier increases from minimum values. Each move to the next legal tier costs one step, including ER upgrades. Before allocating damage lines, each candidate ranks the damage keys by the gain from one minimum-value line, with its main stats and reserved ER already present. ER consumes both budgets but is excluded from the ranking.',
            'Every line of the top two ranked keys is capped at floor(0.29 times that key’s maximum number of upgrades). Every line of the lowest-ranked damage key actually selected must receive at least ceil(0.5 times its maximum upgrades). These mandatory upgrades also consume the shared 32 steps. A candidate is rejected if the floor conflicts with a cap or cannot fit the budget.',
            'Steps count positions in each stat’s legal tier list, not a fraction of its value range. Reaching maximum Crit Rate from minimum costs seven steps, while reaching maximum flat ATK costs three. Uneven value gaps still cost one step each.',
          ],
        },
        {
          type: 'table',
          columns: ['Quantity', '100 anchor', '200 anchor'],
          rows: [
            ['Slot budget', '25 integer lines', '25 maximum-value lines'],
            ['Per-stat cap', '5 copies', '5 copies'],
            ['Matching-main deduction', '0; substats may match main stats', '0'],
            ['Relevant-line budget', 'at most 16, including ER', 'up to 25'],
            ['Non-damage filler', 'at least 8 minimum-tier lines', 'not required'],
            ['Shared upgrade budget', '32 adjacent tier increases, including ER', 'maximum values'],
            ['Relevant flat lines', 'at least 2; same or different keys', 'not required'],
            ['Top two damage keys', 'each line capped at floor(0.29 * maximum steps)', 'legal maximum'],
            ['Lowest selected damage key', 'each line upgraded by at least ceil(0.5 * maximum steps)', 'legal maximum'],
            ['Line values', 'legal tiers chosen individually', 'maximum, with exact ER reservation'],
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.2',
          title: 'Tier improvement cost',
          lines: [
            'steps(stat, value) = zero-based index in the legal tier list',
            'minimum tier costs 0; each adjacent tier increase costs 1',
            '',
            'Crit Rate: 6.3, 6.9, ..., 10.5',
            '    steps(6.9) = 1; steps(10.5) = 7',
            '',
            'Flat ATK: 30, 40, 50, 60',
            '    steps(40) = 1; steps(60) = 3',
            '',
            'Flat HP: 320, 360, 390, 430, 470, 510, 540, 580',
            '    steps(360) = 1; steps(390) = 2',
            '',
            'If Crit Rate and Crit DMG are the top two damage keys:',
            '    each has 7 possible increases; floor(7 * 0.29) = 2',
            '    every Crit Rate line is capped at 7.5%',
            '    every Crit DMG line is capped at 15.0%',
            '',
            'If flat ATK is the lowest-ranked selected damage key:',
            '    ceil(3 * 0.5) = 2 increases per line',
            '    every flat ATK line must reach at least 50',
            '    two such lines consume 4 of the shared 32 steps',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.3',
          title: '100-anchor constraints',
          lines: [
            'sum(occupied slots) = 25',
            '5 distinct substat keys per Echo',
            'at most 5 copies per key across the build',
            'relevant damage lines + reserved ER lines <= 16',
            'relevant flat ATK / HP / DEF lines >= 2',
            'all remaining lines are non-damage filler at minimum values',
            '',
            'each value belongs to its stat’s legal tier list',
            'sum(steps(stat, value)) <= 32, including ER upgrades',
            'top two damage keys: each line’s steps <= floor(maximum steps * 0.29)',
            'lowest selected damage key: each line’s steps >= ceil(maximum steps * 0.5)',
            'ER is excluded from the damage-key ranking',
            'generated combat ER >= equipped combat ER, unless ER is ignored',
            '',
            'Unused upgrade capacity is allowed when no legal improvement helps.',
          ],
        },
      ],
    },
    {
      id: 'er-utility',
      title: '09 ER Utility And Main Echo',
      blocks: [
        {
          type: 'prose',
          text: [
            'Energy Regen is a requirement matching the equipped build\'s resolved combat ER total, except for resonators that ignore ER, such as Lucilla and Phrolova. The reference build first gets ER from its character, weapon, team, chosen main stats, Sonata effects, and main Echo, using the same representative combat-stat snapshot as the equipped build. Any remaining ER is supplied by generated substats.',
            'The 100 reference compares legal ER tier combinations using up to five slots. Every ER line counts toward the 16 relevant lines, and every ER tier increase consumes one of the shared 32 steps. The generated total may exceed the target by the amount required to reach a legal tier; both scoring and the report use that actual total. A candidate that cannot meet ER within these budgets is rejected. The 200 reference retains its existing maximum-roll reservation with the exact missing ER total.',
            'Utility Sonata sets are handled as anchor constraints, not as ordinary active-build stats. If the equipped build has a completed utility set at its max piece count, the generated reference and maximum builds must retain that set id and piece count. The evaluation also carries over the active control values for that utility set, so a utility set with stacks, toggles, or conditional states is scored under the same enabled state.',
            'Main Echoes are split the same way. The active build uses the equipped main Echo effect. Reference builds enumerate legal main Echo carriers for each generated frame, but a currently equipped main Echo is locked into the reference search only when it has a non-self support effect. A self-only effect does not lock the main Echo choice; any ER it supplies still contributes to the equipped ER target.',
          ],
        },
        {
          type: 'table',
          columns: ['Equipped-build input', 'Anchor behavior'],
          rows: [
            ['Energy Regen total', 'becomes a target the generated reference build must satisfy unless the resonator ignores ER'],
            ['Completed utility Sonata set', 'becomes a required generated set plan entry with the same set id and max piece count'],
            ['Utility set controls', 'rebuild the evaluation Sonata rows with the same active values and stacks for preserved utility sets'],
            ['Support main Echo effect', 'locks the generated reference frames to a carrier of that exact main Echo id'],
            ['Self-only main Echo effect', 'not locked, but any ER it supplies contributes to the preserved ER target'],
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.4',
          title: 'ER reservation',
          lines: [
            'targetER = resolved combat ER of equipped build',
            'if resonator ignores ER: targetER = 0',
            'missingER = max(0, targetER - candidate combat ER before substats)',
            '',
            'for count from 1 through 5, when missingER > 0:',
            '    choose the lowest legal tier total meeting missingER',
            '    reserve count of the 16 relevant slots and their tier steps',
            '    reject if the steps exceed the shared budget of 32',
            '    fill remaining relevant slots, add filler, and spend remaining steps',
            '',
            'keep the candidate with the highest damage',
            'if missingER is zero: reserve no ER slots',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.7',
          title: 'Utility and main Echo constraints',
          lines: [
            'requiredUtilityPlan = completed utility Sonata sets(equippedEchoes)',
            'requiredMainEcho = equipped main Echo if it has non-self support effect',
            '',
            'for each generated setPlan:',
            '    if requiredUtilityPlan is not retained: reject',
            '    rebuild Sonata rows with preserved utility control values',
            '',
            'for each generated mainEchoChoice:',
            '    if requiredMainEcho exists and choice.echo.id != requiredMainEcho.id:',
            '        reject',
            '    encode choice.mainEchoEffect into the generated frame',
          ],
        },
      ],
    },
    {
      id: 'substat-fill',
      title: '10 Substat Fill',
      blocks: [
        {
          type: 'prose',
          text: [
            'For the 100 reference, each candidate ER count gets its own allocation. After reserving ER and ranking the damage keys, the search first selects two relevant flat lines. It then chooses the remaining relevant lines by immediate damage gain at minimum value, up to 16 relevant lines total. Non-damage filler completes all 25 physical slots. Relevance uses every detected damage stat, including weak stats outside the maximum-search shortlist, so a weak useful stat cannot bypass the limit as filler.',
            'The search first funds the minimum upgrades on every line of the lowest-ranked selected damage key. It then upgrades the selected damage lines one legal tier at a time, choosing the largest immediate damage gain while respecting the top-two caps, until it reaches 32 total steps or no allowed step helps. ER and the mandatory minimum upgrades consume the same budget. This is a bounded heuristic, not a proof of the globally best distribution. Each final line is assigned to an Echo, and scoring and report totals use those same values.',
            'The 200 pass retains its separate greedy maximum-value fill. Both passes reuse the bounded main-stat and Echo-frame candidate pool. The no-Echo 0 anchor is unchanged.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.8',
          title: 'Slot and tier allocation',
          lines: [
            'reserve legal ER slots and their tier steps',
            'rank damage keys by gain from one minimum-value line; exclude ER',
            'reserve two relevant flat lines within the relevant-slot budget',
            'fill relevant slots at minimum values, up to 16 including ER',
            'fill to 25 slots using non-damage keys at minimum values',
            'respect at most five copies per key throughout',
            '',
            'upgrade every line of the lowest selected damage key to its half-upgrade floor',
            'reject if that floor conflicts with a top-two cap or exceeds the budget',
            'stepsRemaining = 32 - reservedERSteps - mandatoryLowestKeySteps',
            'choose the allowed adjacent increase with the largest damage gain',
            'apply it and subtract one step; repeat while a step helps',
            '',
            'distribute the 25 values over five Echoes without duplicate keys',
            'report counts and totals from those generated values',
          ],
        },
      ],
    },
    {
      id: 'percent-grade',
      title: '11 Percent And Grade',
      blocks: [
        {
          type: 'prose',
          text: [
            'When the anchor search finishes, the score has four damage numbers: no-Echo baseline damage, active build damage, 100-anchor damage, and 200-anchor damage. The percent conversion is piecewise linear. Damage below the 100 anchor is measured against the no-Echo baseline. Damage above the 100 anchor is measured against the 200 anchor.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.5',
          title: 'Build score normalization',
          lines: [
            'if activeDamage >= referenceDamage:',
            '    percent = 1 + (activeDamage - referenceDamage)',
            '              / (max(maximumDamage, referenceDamage) - referenceDamage)',
            '',
            'else:',
            '    percent = (activeDamage - baselineDamage)',
            '              / (referenceDamage - baselineDamage)',
            '',
            'buildScore = max(0, percent) * 100',
          ],
        },
        {
          type: 'ladder',
          caption: 'TBL.2',
          title: 'Build score grade ladder',
        },
      ],
    },
    {
      id: 'echo-score',
      title: '12 Echo Score',
      blocks: [
        {
          type: 'prose',
          text: [
            'Echo score measures the quality of the equipped Echoes. Once a simulation reference is available, the five cards are scored together against one damage-derived substat target. The combined Echo-quality percentage uses those same points. Build score separately measures rotation damage against the 0 / 100 / 200 anchors.',
            'The Echo-quality reference keeps the equipped Echo bodies, Sonata sets, and primary main-stat layout, clears their substats, then greedily allocates 25 maximum-value lines with at most five copies per key. It uses the current combat and rotation context. Useful-value ceilings remove portions that no longer improve damage, such as Crit Rate beyond the effective cap. This is a legal reference found by the search, not a proof of the global optimum.',
            'That 25-line Echo-quality ideal is independent of the 16-relevant-line / 32-step build benchmark. Substat edits do not move the Echo-quality target. Changing the main-stat layout, weapon, team, or other combat context can rebuild it. A card’s points can still change when another Echo changes, because all copies of each substat share a point budget.',
            'A matching primary main stat is worth 44 points. Matching uses the reference’s count of each main-stat key at each Echo cost; excess duplicates do not each earn another 44 points. Other main stats can receive partial credit from cost-relative weights. The fixed secondary main stat affects damage but earns no separate quality points.',
            'Each selected substat line contributes up to 21 points. A key absent from the ideal receives zero. ER substats and ER / Healing Bonus primary mains are utility: their points and their corresponding denominator slots are both omitted. ER still consumes relevant lines and tier increases in the separate 100% build benchmark.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.6',
          title: 'Loadout substat credit',
          lines: [
            'for each non-utility key selected by the reference:',
            '    n = reference line count for this key',
            '    target = useful reference total, capped at n * maximum legal value',
            '    actual = sum of this key across equipped Echoes',
            '             (each individual value capped at its legal maximum)',
            '',
            '    availablePoints = 21 * n * min(1, actual / target)',
            '    share these points in proportion to each Echo’s value',
            '    cap each Echo at 21 points for this key',
            '    redistribute overflow among the remaining copies',
            '',
            'Points that cannot fit within the per-Echo caps remain unearned.',
            'Value beyond the useful target adds no further loadout credit.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.7',
          title: 'Echo-quality percentages',
          lines: [
            'mainMaximum = 0 for an ER / Healing Bonus main, otherwise 44',
            'scorableSubSlots = 5 - number of positive utility substats',
            'echoMaximum = mainMaximum + 21 * scorableSubSlots',
            'echoPoints = min(echoMaximum, mainPoints + sharedSubstatPoints)',
            '',
            'oneEchoPercent = echoPoints / echoMaximum * 100',
            'fiveEchoPercent = sum(echoPoints) / sum(echoMaximum) * 100',
            '',
            'ordinary Echo: maximum = 44 + 5 * 21 = 149',
            'one ER substat: maximum = 44 + 4 * 21 = 128',
            'utility main: maximum = 5 * 21 = 105',
            'utility main and one ER substat: maximum = 4 * 21 = 84',
            '',
            'Each missing Echo slot adds 149 maximum points and earns zero.',
            'The combined percentage is a ratio of totals, not an average of cards.',
          ],
        },
        {
          type: 'prose',
          text: [
            'The Phoebe example below comes from logging the active scoring profile for a saved build: level 90 S0 Phoebe with R1 Luminous Hymn, five Moonlit Clouds pieces, and Zani / Chisa teammates. Its 43311 mains are Crit DMG, Spectro DMG, Spectro DMG, ATK%, and ATK%. The sample uses its saved rotation and controls against a level 100, 20% RES target.',
            'This reference selects five lines each of Crit Rate, Crit DMG, ATK%, flat ATK, and Heavy ATK DMG Bonus. Each key has a 105-point budget. The effective weights below are points per stat unit before the useful-total and per-Echo caps. They are specific to this sample; changing Phoebe’s context can change the selected keys, counts, and useful totals.',
          ],
        },
        {
          type: 'table',
          columns: ['Phoebe stat', 'Reference lines', 'Useful total', 'Points per unit before caps'],
          rows: [
            ['Crit Rate', '5', '52.5%', '2 per percentage point'],
            ['Crit DMG', '5', '105%', '1 per percentage point'],
            ['ATK%', '5', '58%', '1.810345 per percentage point'],
            ['Flat ATK', '5', '300', '0.35 per ATK'],
            ['Heavy ATK DMG Bonus', '5', '58%', '1.810345 per percentage point'],
            ['Other damage substats', '0', '0', '0 in this reference'],
            ['Energy Regen', '0', 'utility', 'omitted from points and maximum'],
          ],
        },
        {
          type: 'formula',
          caption: 'EX.1',
          title: 'Phoebe sample using the active reference',
          lines: [
            'Each primary main matches the reference: 44 points per Echo.',
            'Each Echo has these four substats:',
            '    Crit Rate 6.9%:   6.9 * 2       = 13.800000 points',
            '    Crit DMG 13.8%: 13.8 * 1       = 13.800000 points',
            '    ATK 7.1%:        7.1 * 105 / 58 = 12.853448 points',
            '    Heavy ATK 7.1%:  7.1 * 105 / 58 = 12.853448 points',
            '',
            'Three Echoes have ER 7.6% as their fifth substat:',
            '    earned = 44 + 53.306897 = 97.306897',
            '    maximum = 44 + 4 * 21 = 128',
            '    card score = 76.0210%',
            '',
            'Two Echoes have flat ATK 40 as their fifth substat:',
            '    flat ATK points = 40 * 0.35 = 14',
            '    earned = 111.306897; maximum = 149',
            '    card score = 74.7026%',
            '',
            'combined Echo quality = 514.534483 / (3 * 128 + 2 * 149) * 100',
            '                      = 75.4449%',
            '',
            'The selected 25 maximum-value lines reach 100% Echo quality.',
            'The separate build score is computed from rotation damage.',
          ],
        },
        {
          type: 'prose',
          text: [
            'Before a valid loadout reference is available, Echo scores fall back to generated character weights. These weights come from sampled damage gains, with utility and elemental-main weights added by the generator. They also supply partial main-stat credit. They are not multipliers on the loadout substat points above.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.8',
          title: 'Generated-weight fallback',
          lines: [
            'flatFactor = 0.05 for flat HP, 0.6 for flat ATK / DEF, otherwise 1',
            'effectiveWeight(key) = generatedWeight(key) * flatFactor(key)',
            'ceiling = highest effectiveWeight among scorable legal substats',
            'scale = 1 / ceiling, or 1 if no positive ceiling exists',
            '',
            'subPoints(key) = 21 * value / maximum legal substat value',
            '                   * effectiveWeight(key) * scale',
            '',
            'mainWeight = generatedWeight(key) / highest legal main weight at this cost',
            '    a prepared main-stat profile can override this weight',
            'mainPoints = 44 * value / legal primary main value * mainWeight',
            '',
            'omit utility main and substat points',
            'maximum = (0 for a utility main, otherwise 44)',
            '        + best (5 - utility substat slots) maximum-value subPoints',
            '',
            'oneEchoPercent = (mainPoints + sum(subPoints)) / maximum * 100',
            'fiveEchoPercent = sum(points) / sum(matching maxima) * 100',
            'Missing slots earn zero and retain a full fallback maximum.',
          ],
        },
      ],
    },
    {
      id: 'cv',
      title: '13 Crit Value',
      blocks: [
        {
          type: 'prose',
          text: [
            'Crit Value is just Crit Rate converted at a 2:1 ratio plus Crit DMG. You know this...',
            'An echo instance/slot compute CV from sub stats only (as per usual). When looking at the full build though, it computes based on the aggregated total (from main stats and sub stats). The Echo totals badge colors the full-build number by averaging it back toward a one-Echo badge scale.',
            'That averaging first subtracts a crit-main baseline of 44 CV per 4-cost Echo, capped at two. Only 4-cost Echoes can roll a crit main stat (+44 CV each), so a 44111 lineup reaches a higher raw total CV (298) than a standard 43311 (254). A full 5-slot build fits at most two 4-cost Echoes (the 12-cost budget leaves 4+4+1+1+1), so subtracting up to two crit mains removes that contribution and judges both lineups on substat CV alone: each reduces to 210 (5 x 42) and reaches 100%. Stacking three or more 4-cost Echoes means dropping slots (444 uses three), where the cap stops the discount growing while the divide-by-five still penalizes the empty slots, keeping those builds below 100%.',
          ],
        },
        {
          type: 'table',
          columns: ['Slots', 'Layout', '#4-cost', 'Max CV', 'Grade'],
          rows: [
            ['5', '33311', '0', '210', '100%'],
            ['5', '43311', '1', '254', '100%'],
            ['5', '44111', '2', '298', '100%'],
            ['4', '4331', '1', '212', '80.0%'],
            ['4', '4431', '2', '256', '80.0%'],
            ['3', '333', '0', '126', '60.0%'],
            ['3', '443', '2', '214', '60.0%'],
            ['3', '444', '3', '258', '81.0%'],
            ['2', '44', '2', '172', '40.0%'],
            ['1', '4', '1', '86', '20.0%'],
          ],
        },
        {
          type: 'prose',
          text: [
            'Every full 5-slot layout lands at 100% regardless of cost split; each dropped slot costs about 20%. 444 is the lone outlier at 81%, since the cap leaves its third crit main undiscounted.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.9',
          title: 'CV formulas',
          lines: [
            'single Echo CV:',
            '    CV = 2 * sub-stat Crit Rate + sub-stat Crit DMG',
            '',
            'one echo:',
            '    cv = 2 * (sub-stat Crit Rate + crit main-stat Crit Rate)',
            '               + (sub-stat Crit DMG + crit main-stat Crit DMG)',
            '',
            'build total:',
            '    cv = sum(fullEchoCV for five Echo slots)',
            '',
            'badge percent for a single echo:',
            '    badgePercent = clamp(CV / 42 * 100, 0, 100)',
            '',
            '4-cost Echoes in the lineup (capped at 2):',
            '    #4-cost = min(count of 4-cost Echoes, 2)',
            '',
            'grade used by total echo stats:',
            '    grade = clamp(((totalCV - 44 * #4-cost) / 5) / 42 * 100, 0, 100)',
          ],
        },
      ],
    },
  ],
}

const optimizerTopic: DocTopic = {
  id: 'optimizer-engine',
  code: 'OPT',
  eyebrow: 'Search engine',
  title: 'Optimizer Engine',
  abstract: 'How the optimizer turns a build problem into fixed numeric damage templates, legal candidate spaces, and bounded ranked results.',
  drives: 'Inventory search - Theory search - Rotation totals - Main-stat suggestions - Sonata suggestions - Weapon suggestions - Substat deltas',
  instrument: 'searchSpace',
  instrumentNote: [
    'Counts measured from a representative account: Phoebe and a 175-Echo inventory and 9 rotation features. They are read straight from the live helpers, not estimated.',
    'Optimizer counts cover Inventory and Theory search. Suggestion counts cover the actual Main Stats and Set Plans routes for Phoebe\'s selected direct target and default rotation.',
    'Which search is widest is not fixed: Inventory scales with how many Echoes you own (roughly choose-5 of the bag), so a small bag can make it far smaller than Theory while a large one like this makes it far larger. What does hold regardless of account: GPU only diverges from CPU on Inventory (it skips the 12 total cost cap, so it over-counts) and Theory search always derives its own main stat filter and collapses equivalent builds. For suggestions, Main Stats and Set Plans keep the current Echo identities fixed but score with neutral main-Echo passive rows; rotation does not widen their candidate space, it just rescales each candidate across more stored damage snapshots.',
  ],
  aliases: ['optimizer', 'optimizer engine', 'rotation optimizer', 'target optimizer', 'theory optimizer', 'weapon search', 'stat constraints'],
  sections: [
    {
      id: 'execution-model',
      title: '00 The Brainchild',
      blocks: [
        {
          type: 'prose',
          text: [
            'This app\'s optimizer engine is a very delicate and adorable little munchkin (Yes it is). And so a lot of effort is put into making sure it is as efficient, as expressive, as fast and as accurate as it can be all at once. We don\'t want to have it eat up all your memory and run for days now, do we?',
            'This engine has two very different layers. The outer layer is the full Simulation world: authored skills, runtime state, team graph, active controls, rotation execution, set effect toggles, enemy setup, and all the object-rich data needed to describe one real scenario. The inner layer is the packed scorer: fixed-length numeric arrays plus a small evaluation routine that can score one candidate build without reopening that outer world.',
            'The hot loop is the part that runs once per candidate. For Inventory search that can mean hundreds of millions or even BILLIONS of five-Echo candidates (as you saw up there), and the GPU path is explicitly built so this stays viable at that scale. For Theory search the raw catalog cross-product is compacted first, but the remaining canonical builds still need the same repeated scoring. Suggestions are smaller, but they still use the same inner contract because the exact same counterfactual may need to be scored thousands of times.',
            'The fast evaluator is the concrete scorer that consumes those packed inputs. For a single skill target it receives one packed setup for one selected skill. For a rotation target it receives many packed setups, one for each saved damage event from that rotation, and adds them together using stored weights. Either way, the evaluator only reconstructs candidate Echo stats, adds prepared set and main-Echo rows, applies one already-prepared damage formula, and returns damage plus a visible stat line. It does not rebuild the combat graph, replay the rotation, walk authored effect trees, or resolve UI-facing runtime controls on every candidate.',
            'That separation is why terms like "packed", "hot loop", and "fast evaluator" matter. Any logic that remains candidate-dependent after compile time is paid for once per candidate, per legal main-Echo choice, per saved rotation damage event, and sometimes per weapon candidate. So the optimizer and suggestion routes aggressively front-load work: simulate once, prepare once, encode once, then keep the repeated scorer as close to array math as possible.',
            'TLDR! Just ONE extra unnecessary computation per candidate can have this consume x5 times more memory or take x5 times more time than it would without it.'
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.0',
          title: 'Execution split',
          lines: [
            'authored runtime state',
            '    -> prep stage',
            '    -> packed scoring setups + encoded Echo rows + prepared set rows',
            '    -> hot loop over candidate builds',
            '    -> bounded winner list',
            '    -> materialize winners back into user-facing builds',
            '',
            'hot-loop work ~=',
            '    candidate builds',
            '  x legal main-Echo choices',
            '  x saved rotation damage events',
            '  x optional weapon candidates',
          ],
        },
        {
          type: 'table',
          columns: ['Term', 'Exact meaning here', 'Why the engine is shaped around it'],
          rows: [
            ['packed setup', 'One fixed numeric view of a damage problem: compiled stats, enemy factors, skill-specific fields, toggles, and metadata stored in one numeric array.', 'CPU workers, GPU shaders, and suggestion routes can all score the same problem without reopening runtime objects.'],
            ['fast evaluator', 'The repeated scorer that takes the packed setup plus encoded Echo rows, set rows, and main-Echo rows and returns damage and visible stats.', 'This is the only part allowed to run once per candidate at scale.'],
            ['hot loop', 'The inner repeated candidate-evaluation path inside inventory search, theory search, and the suggestion engines.', 'Its cost multiplies by the entire search space, so even small extra logic here matters.'],
            ['prep stage', 'The one-time phase that simulates rotations, resolves selected skills, applies authored effects, strips current Echoes when needed, builds set masks, and packs the scoring setup.', 'Expensive interpretation lives here so it is paid once instead of once per candidate.'],
            ['materialization', 'The final phase that turns compact winning rows back into concrete Echo ids, weapon ids, and display stats.', 'The UI only needs a few winners, so object reconstruction is delayed until after search.'],
          ],
        },
        {
          type: 'table',
          columns: ['Allowed inside the hot loop', 'Pushed out before the hot loop'],
          rows: [
            ['sum encoded Echo stat rows', 'rebuild the combat graph'],
            ['count distinct set pieces and add prepared set rows', 'replay the rotation sequence'],
            ['add one chosen main-Echo bonus row', 'resolve authored effect registries'],
            ['apply one packed scoring setup or a stored weighted list of them', 'walk runtime controls to decide scenario logic'],
            ['check min/max stat constraints and keep bounded winners', 'search-space canonicalization and equivalence pruning'],
          ],
        },
      ],
    },
    {
      id: 'optimizer-request',
      title: '01 Optimizer Request',
      blocks: [
        {
          type: 'prose',
          text: [
            'Okay, now for the actual algorithm, every run begins from one build state, one enemy, one set of active controls, and one scoring objective. The first decision is what damage number to optimize: one selected skill or one weighted rotation total. The second decision is what candidate space to search: real inventory Echoes, generated candidates, or a narrower recommendation space such as main-stat rewrites, Sonata reassignment, weapon swaps, or substat perturbations.',
            'The full optimizer never scores the currently equipped five Echoes as fixed search members. It removes them from the active state, keeps the rest of the state intact, and treats the candidate pool as the only variable part of the problem. Recommendation engines keep the equipped Echo identities and mutate only one axis at a time.',
            'That separation matters because the scoring objective and the candidate generator are independent. Single skill and rotation runs both feed into the same damage evaluator. Inventory search, theory search, and the smaller recommendation engines differ mainly in how they enumerate candidates before calling that evaluator.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.1',
          title: 'Optimizer request boundary',
          lines: [
            'input = {',
            '    current character state,',
            '    available Echo list,',
            '    enemy setup,',
            '    search settings,',
            '    selected targets,',
            '    active Sonata conditions,',
            '    optional rotation edits,',
            '    optional weapon candidates',
            '}',
            '',
            'if searching a theoretical space and the target is a singe skill:',
            '    prepare theory single skill search',
            '',
            'if searching a theoretical space and the targets are a sequence of skills (ie. a rotation/combo):',
            '    prepare theory rotation search',
            '',
            'if searching the echo inventory and the target is a singe skill:',
            '    prepare inventory single skill search',
            '',
            'if searching the echo inventory and the targets are a sequence of skills:',
            '    prepare inventory rotation search',
          ],
        },
        {
          type: 'table',
          columns: ['Candidate space', 'What changes'],
          rows: [
            ['inventory full search', 'replace all five Echoes with legal inventory choices'],
            ['theory full search', 'replace all five Echoes with generated catalog candidates'],
            ['main-stat suggestions', 'keep the five Echoes, change legal main-stat choices only, and neutralize main-Echo passive rows during comparison'],
            ['Sonata suggestions', 'keep the five Echoes, change only their set assignment, and neutralize main-Echo passive rows during comparison'],
            ['weapon suggestions', 'keep the Echoes, change only the weapon and passive state'],
            ['substat deltas', 'keep the build, add or remove one substat amount at a time'],
          ],
        },
      ],
    },
    {
      id: 'direct-objective',
      title: '02 Single Skill Objective',
      blocks: [
        {
          type: 'prose',
          text: [
            'Single-skill search builds one exact damage problem from the Echo-free state. The engine rebuilds the team, applies the selected target and active controls, resolves the selected skill against the current enemy, and freezes everything in that skill except the Echo contribution that will arrive later from the candidate build.',
            'The accepted damage families are narrow on purpose. The optimizer supports ordinary skill damage, Tune Break, Hack, and the supported negative-effect families. Those all become stable numeric problems once the non-Echo build state is fixed.',
            'Echo attacks (skills from your main echo) are excluded. The chosen main Echo is not known when the target problem is prepared. It changes from candidate to candidate. The optimizer therefore models main-Echo effects as candidate-dependent bonus rows added during search, not as one preselected attack that can be treated as fixed before the search starts.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.2',
          title: 'Single skill prep',
          lines: [
            'echoFreeState = current character state with equipped Echoes removed',
            'teamState = rebuild team state from echoFreeState',
            'chosenSkill = resolve selected skill against enemy and active toggles',
            'fixedSkillProblem = convert chosenSkill into fixed numeric inputs',
          ],
        },
      ],
    },
    {
      id: 'rotation-objective',
      title: '03 Rotation Objective',
      blocks: [
        {
          type: 'prose',
          text: [
            'Rotation search starts from the same Echo-free state, then applies the selected rotation program and simulates it once under the current team and enemy conditions. That simulation is not repeated inside the hot search loop.',
            'After the simulation, the engine keeps only the damage events that can be rescored safely for every candidate build: they must belong to the optimized character and they must belong to one of the supported damage families. Each kept event also carries the weight it contributed inside the original simulated total.',
            'The optimizer objective for rotation search is therefore not “run a rotation again for every candidate”. It is “re-evaluate the stored event list for every candidate, then sum those event damages with the original event weights”.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.3',
          title: 'Rotation preparation',
          lines: [
            'echoFreeState = current character state with equipped Echoes removed',
            'preparedRotationState = apply rotation program to echoFreeState',
            'fullRotation = simulate the rotation against the fixed enemy',
            '',
            'storedEvents = keep only damage events where',
            '    event belongs to the optimized character',
            '    event belongs to a supported damage family',
            '',
            'rotationTarget = weighted sum of storedEvents',
          ],
        },
      ],
    },
    {
      id: 'echo-rows',
      title: '04 Echo Rows',
      blocks: [
        {
          type: 'prose',
          text: [
            'Every available Echo is encoded once into dense numeric rows so the hot loop never needs to reopen the original Echo objects. One row holds the raw stat contribution of that Echo: primary main stat, fixed secondary stat, and all substats. Parallel arrays hold Echo cost, Sonata set, and a compact identity used during piece counting. The identity value exists only so set pieces can be counted as distinct Echo/set pairings.',
            'Main-Echo effects are encoded separately from the ordinary stat row. Each Echo also gets a second bonus row containing only the extra bonuses it would supply if that Echo became the chosen main Echo. That is what lets the engine test one five-Echo candidate under several main-Echo choices without rebuilding the entire candidate from scratch.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.4',
          title: 'Echo encoding',
          lines: [
            'for each available Echo i:',
            '    statRow[i] = primary main',
            '               + fixed secondary',
            '               + all substats',
            '',
            '    cost[i] = Echo cost',
            '    set[i] = Sonata set',
            '    type[i] = identity used for distinct-piece counting inside a set',
            '',
            '    mainBonus[i] = extra bonuses if Echo i is chosen as main Echo',
          ],
        },
      ],
    },
    {
      id: 'prepared-bonuses',
      title: '05 Prepared Sonata Bonuses',
      blocks: [
        {
          type: 'prose',
          text: [
            'Sonata effects are also prepared before search. For each Sonata set and each relevant piece-count state, the optimizer precomputes the supported bonus contribution that can be added later inside the hot loop.',
            'The packed scorer assumes an encoded set effect is active whenever its piece-count rule is satisfied. It does not re-evaluate trigger truth per candidate. So authored set conditions are resolved before encoding: disabled parts are removed from the runtime mask and the prepared lookup never includes them.',
            'That is the reason the set-condition controls matter so much for optimizer and suggestion quality. They are the compile-time gate deciding which Sonata bonuses are even allowed to enter the packed search.',
            'This is why the hot loop can count set pieces and add Sonata bonuses without reopening the full effect system for every five-Echo candidate.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.5',
          title: 'Prepared Sonata lookup',
          lines: [
            'for each Sonata set S:',
            '    for each relevant piece count P:',
            '        preparedSetBonus[S, P] = supported bonus contribution',
            '',
            'candidateSetBonus = add preparedSetBonus',
            '    after counting the set pieces in the chosen 5 Echoes',
          ],
        },
      ],
    },
    {
      id: 'shared-payload',
      title: '06 Shared Search Data',
      blocks: [
        {
          type: 'prose',
          text: [
            'Both single-skill and rotation search reuse one shared numeric package. It contains the encoded Echo rows, the prepared Sonata lookup, the legal main-Echo choices, the stat-limit rules, and the combination-index data that lets workers jump directly into their assigned part of the five-Echo space.',
            'The stat-limit rules are stored as fixed min/max pairs in this order: ATK, HP, DEF, Crit Rate, Crit DMG, Energy Regen, DMG Bonus, and final damage. A disabled rule stores a minimum above its maximum, which makes that check automatically pass.',
            'The combination-index data serves two purposes. It gives the engine an exact or estimated search-space size for progress reporting, and it gives CPU and GPU workers a deterministic mapping from job range to candidate combinations. When the main Echo is not locked, each legal five-Echo choice must still be tested under up to five main-Echo choices, so the visible progress count expands by that factor even though the underlying Echo combination is the same.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.1',
          title: 'Stat-limit layout',
          lines: [
            '[',
            '  atkMin, atkMax,',
            '  hpMin, hpMax,',
            '  defMin, defMax,',
            '  crMin, crMax,',
            '  cdMin, cdMax,',
            '  erMin, erMax,',
            '  bonusMin, bonusMax,',
            '  damageMin, damageMax',
            ']',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.2',
          title: 'Shared payload assembly',
          lines: [
            'shared = {',
            '    statRow,',
            '    cost,',
            '    set,',
            '    type,',
            '    mainBonus,',
            '    preparedSetBonus,',
            '    stat limits,',
            '    legal main-Echo choices,',
            '    combination indexing data,',
            '    progress multiplier',
            '}',
          ],
        },
      ],
    },
    {
      id: 'direct-template',
      title: '07 Single Skill Damage Template',
      blocks: [
        {
          type: 'prose',
          text: [
            'Before search starts, the selected skill is compressed into one fixed numeric damage template. That template already contains the non-Echo side of the calculation: base and final non-Echo stats, enemy resistance and defense multipliers, skill scaling coefficients, crit fields, flat damage terms, and any special fields needed by Tune Break, Hack, or the supported negative-effect branches.',
            'From that point onward, a candidate build only has to contribute its own Echo stats, set bonuses, and chosen-main-Echo bonuses. The fast evaluator combines those candidate rows with the fixed template and computes damage directly.',
            'This is the reason the optimizer can score very large search spaces without reopening the full build model for every candidate.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.6',
          title: 'Single skill template',
          lines: [
            'fixedDamageTemplate = {',
            '    non-Echo base stats,',
            '    non-Echo final stats,',
            '    enemy resistance and defense factors,',
            '    skill scaling coefficients,',
            '    crit fields,',
            '    flat damage terms,',
            '    special fields for Tune Break / Hack / negative effects',
            '}',
          ],
        },
      ],
    },
    {
      id: 'rotation-templates',
      title: '08 Rotation Event Templates',
      blocks: [
        {
          type: 'prose',
          text: [
            'Rotation search uses the same idea, but one template is not enough. Every kept damage event from the earlier rotation simulation becomes its own fixed numeric template, and each one keeps its original rotation weight.',
            'The final rotation score for one candidate build is the weighted sum across that template list. The engine does not rerun the rotation itself. It reruns only the damage computation for the kept events.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.3',
          title: 'Rotation total for one candidate',
          lines: [
            'rotationDamage(candidate, chosenMainEcho) =',
            '    sum over kept events {',
            '        eventDamage(candidate, chosenMainEcho, eventTemplate)',
            '      * eventWeight',
            '    }',
          ],
        },
      ],
    },
    {
      id: 'inventory-space',
      title: '09 Inventory Search Space',
      blocks: [
        {
          type: 'prose',
          text: [
            'The inventory search space is every legal way to choose 5 distinct inventory Echoes whose total cost does not exceed 12. That is the base combinatorial problem the optimizer has to walk.',
            'A locked main Echo does not shrink the build to four slots. The build still has five Echoes. The lock only says that the winning five-Echo candidate must contain one specific Echo, and that only that Echo can be treated as the chosen main Echo when the candidate is scored.',
            'The engine also keeps a separate count of this space. That count feeds the progress bar and the displayed search size. It is a work estimate, not a damage result.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.7',
          title: 'Inventory combo rules',
          lines: [
            'pick 5 distinct inventory Echoes',
            'require total Echo cost <= 12',
            '',
            'if main Echo is locked:',
            '    keep only candidates containing that locked Echo',
            '',
            'if main Echo is not locked:',
            '    test the same five-Echo candidate',
            '    under each legal main-Echo choice',
          ],
        },
      ],
    },
    {
      id: 'theory-space',
      title: '10 Theory Search Space',
      blocks: [
        {
          type: 'prose',
          text: [
            'Theory search changes the candidate generator, not the later scorer. Instead of drawing from real inventory Echoes, it keeps the current build substat profiles fixed and generates synthetic candidates from the Echo catalog: catalog identity, cost, Sonata set, legal main stat, and legal chosen-main-Echo carrier.',
            'The generated row space is much larger than the set of distinct final builds, so it is compacted before scoring. Slot permutations that produce the same total stats are collapsed into one canonical ordering, and set-plan variants that differ only by a redundant promoted 1-piece set are also collapsed. The goal is to emit one scored representative per distinct theoretical build, not every bookkeeping permutation that leads to the same totals.',
            'The displayed theory size is therefore the count of emitted canonical candidates, not the raw cross-product of slot rows. Once those candidates exist, the same CPU, GPU, worker, and result stages used by inventory search take over.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.8',
          title: 'Theory build generation',
          lines: [
            'keep current substat profiles fixed',
            '',
            'for each occupied slot:',
            '    enumerate legal {cost, set, main stat} rows',
            '    enumerate legal chosen-main-Echo carrier rows',
            '',
            'combine rows into legal 5-slot builds',
            'drop equivalent slot permutations',
            'drop redundant 1-piece plan promotions',
            'emit one canonical candidate per distinct build',
          ],
        },
      ],
    },
    {
      id: 'target-cpu',
      title: '11 Single Skill CPU Search',
      blocks: [
        {
          type: 'prose',
          text: [
            'The single-skill CPU path is the simplest exact search. It walks the assigned five-Echo candidates, skips any candidate whose total cost exceeds 12, scores every remaining candidate against the selected skill, and keeps only the strongest results.',
            'The candidate score follows one fixed order. First sum the raw stat rows of the chosen 5 Echoes. Then count the Sonata pieces they activate and add the corresponding prepared Sonata bonuses. Then test each legal main-Echo choice by adding the matching main-Echo bonus row. Then rebuild the final visible stats, compute the selected-skill damage, and apply the stat-limit gate.',
            'Weapon search reuses the same order. The engine prepares extra weapon-specific stat and effect overlays once, then scores the same five-Echo candidate against every candidate weapon and keeps the best weapon together with the best Echo choice.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.9',
          title: 'Single skill candidate evaluation',
          lines: [
            'candidateEchoStats = sum(raw Echo rows of the chosen 5 Echoes)',
            'candidateEchoStats += prepared Sonata bonuses activated by those 5 Echoes',
            '',
            'for each legal main-Echo choice:',
            '    testedStats = candidateEchoStats + main-Echo bonus row',
            '    finalStats = combine fixed build state + testedStats',
            '    damage = evaluate selected skill(finalStats)',
            '    if all stat limits pass:',
            '        keep best damage / main-Echo choice',
          ],
        },
      ],
    },
    {
      id: 'rotation-cpu',
      title: '12 Rotation CPU Search',
      blocks: [
        {
          type: 'prose',
          text: [
            'The rotation CPU path reuses the same candidate-build reconstruction, but changes the objective. Instead of evaluating one selected skill, it evaluates every kept rotation event for the candidate build, multiplies each event by its stored weight, and sums the results into one rotation total.',
            'The stat-limit gate moves to the end. Rotation search first finds the best weighted total for the candidate build, then rebuilds one representative visible stat line for that winning version and checks the stat limits there. So the damage total comes from many weighted events while the visible stat gate comes from one representative skill.',
            'Rotation weapon search extends the same idea to weapons. A weapon can change more than one fixed quantity inside the rotation score, so each candidate weapon receives its own prepared event-template list before the Echo candidate is rescored.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.10',
          title: 'Rotation candidate evaluation',
          lines: [
            'candidateEchoStats = sum(raw Echo rows of the chosen 5 Echoes)',
            'candidateEchoStats += prepared Sonata bonuses activated by those 5 Echoes',
            '',
            'for each legal main-Echo choice:',
            '    totalDamage = 0',
            '    for each kept event:',
            '        testedStats = candidateEchoStats + main-Echo bonus row',
            '        totalDamage += eventDamage(testedStats) * eventWeight',
            '',
            '    visibleStatLine = rebuild one representative visible stat line',
            '    if all stat limits pass on visibleStatLine:',
            '        keep best totalDamage / main-Echo choice',
          ],
        },
      ],
    },
    {
      id: 'gpu-backend',
      title: '13 GPU Search',
      blocks: [
        {
          type: 'prose',
          text: [
            'The GPU path does not change the rules or the math. It solves the same search problem with the same constraints, but moves the repeated scoring work onto the graphics processor.',
            'All long-lived numeric arrays are uploaded once: Echo rows, prepared Sonata bonuses, costs, type identities, main-Echo bonus rows, fixed damage templates, stat limits, and combination-index data. Individual GPU jobs then only send small run-specific values such as their start range, job size, and main-Echo lock state.',
            'Single-skill and rotation search use separate GPU kernels because one scores one fixed damage problem and the other scores a weighted event list. Theory search also uses its own batch shape so one generated candidate stays one scored candidate rather than being merged too early.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.11',
          title: 'GPU job shape',
          lines: [
            'initialize GPU state once',
            'upload all long-lived numeric arrays',
            '',
            'for each GPU job:',
            '    send start position + work size + lock state',
            '    dispatch compute pass',
            '    optionally reduce the result buffer',
            '    read back local winners',
            '    decode damage + Echo choice + main-Echo choice + optional weapon',
          ],
        },
      ],
    },
    {
      id: 'workers-progress',
      title: '14 Worker Execution',
      blocks: [
        {
          type: 'prose',
          text: [
            'The worker layer is the run coordinator. It decides between CPU and GPU execution, splits the compiled search into smaller jobs, dispatches those jobs, merges the returned local winners, and reports progress or cancellation back to the page.',
            'CPU jobs usually describe a slice of the five-Echo combination space. GPU jobs do the same, except Theory search can also hand over explicit generated batches. Each worker keeps its prepared numeric data after the first job so setup cost does not dominate the run.',
            'Progress has two phases when Theory search is active because generating the canonical theory candidates is its own step before scoring begins. Inventory search usually enters the scoring phase immediately.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.12',
          title: 'Worker-pool loop',
          lines: [
            'compile once',
            'choose CPU or GPU execution',
            'split the run into jobs',
            '',
            'for each job:',
            '    send job to a worker',
            '    worker returns local winners + progress delta',
            '    merge local winners into the shared result list',
            '    update progress',
            '',
            'if cancelled:',
            '    stop dispatch and return the best rows seen so far',
          ],
        },
      ],
    },
    {
      id: 'results',
      title: '15 Best-Result Selection',
      blocks: [
        {
          type: 'prose',
          text: [
            'The shared result list removes duplicates by the chosen 5 Echoes only. Main-Echo choice, weapon choice, and worker origin are not part of the identity key. If the same five-Echo build appears more than once, only the higher-damage version survives.',
            'The list is bounded at every stage. Each worker keeps only its strongest local results, and the coordinator also keeps only a bounded overall winner list while it merges those local returns.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.4',
          title: 'Result dedupe rule',
          lines: [
            'key = the chosen 5 Echo ids in sorted order',
            '',
            'if key has never been seen:',
            '    store {key, damage, main-Echo choice, optional weapon}',
            '',
            'if key already exists:',
            '    keep the higher-damage version only',
          ],
        },
      ],
    },
    {
      id: 'materialization',
      title: '16 Result Materialization',
      blocks: [
        {
          type: 'prose',
          text: [
            'The search backends return compact numeric results, not ready-to-render builds. The final stage turns those compact rows back into real Echo identities, real weapon identity if weapon search was enabled, and one visible stat summary.',
            'Single skill results rebuild that summary from the chosen skill damage problem. Rotation results rebuild it from the representative direct-damage template prepared earlier. If weapon search was active, the summary is rebuilt using the winning weapon rather than the currently equipped weapon so the shown stats match the shown damage.',
            'At that point the result is back in form you perceive: five Echoes, one damage value, an optional winning weapon, and one visible stat line.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.13',
          title: 'Final result build',
          lines: [
            'compact result -> chosen Echo identities',
            '               -> optional winning weapon identity',
            '               -> rebuilt visible stats',
            '               -> final damage value',
            '',
            'final result = {',
            '    echoes,',
            '    damage,',
            '    stats,',
            '    optional weapon',
            '}',
          ],
        },
      ],
    },
    {
      id: 'suggestion-contexts',
      title: '17 Suggestion Contexts',
      blocks: [
        {
          type: 'prose',
          text: [
            'The suggestion engines do not build a second damage model. They begin by simulating the current equipped build, choose either one direct target skill or one weighted rotation total, then compress that damage problem into the same kind of fixed numeric inputs used by the full optimizer.',
            'The only major difference is candidate generation. Full optimizer search removes the equipped Echoes and searches a replacement five-Echo space. Recommendation engines usually keep the equipped Echoes in place and ask a narrower counterfactual question.',
            'For Main Stats and Sonata suggestions, the counterfactual also removes main-Echo passive bonus rows from both the candidate score and the current-build baseline. That keeps a currently equipped main Echo effect from leaking into rankings that are supposed to answer only main-stat or set-plan changes.',
            'Suggestions also have one optional path the main optimizer does not: they may include Echo attacks when preparing the target problem. In that case the Echo attack is prepared directly from authored Echo skill data before entering the same fast evaluator.',
            'That Echo-attack allowance is deliberately narrow. It only stays sound in searches where Echo ownership is fixed during scoring. Once the search starts swapping Echo identities, main-Echo semantics become candidate-dependent again, so those searches stay on the stricter packed contract.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.14',
          title: 'Suggestion context build',
          lines: [
            'simulate current equipped build once',
            '',
            'if scoring objective is one selected skill:',
            '    prepare one single skill template',
            '',
            'if scoring objective is rotation:',
            '    prepare one weighted event list',
            '',
            'reuse the same fast evaluator for every suggestion candidate',
          ],
        },
      ],
    },
    {
      id: 'main-stat-set-suggestions',
      title: '18 Main-Stat And Sonata Suggestions',
      blocks: [
        {
          type: 'prose',
          text: [
            'Main-stat suggestions and Sonata suggestions both keep the equipped Echo identities fixed. They change only one structural part of the build description, then rescore the result with the prepared single-skill or rotation setup.',
            'Main-stat suggestions enumerate legal main-stat recipes under the normal five-slot and total-cost rules. Each recipe is applied onto the current Echo shells and rescored with neutral main-Echo passive rows. The current-build baseline shown beside those rows uses the same neutral rows, so an equipped main Echo buff cannot inflate or depress the comparison.',
            'Sonata suggestions do the same kind of reuse over set-piece plans instead of main-stat recipes. The current Echoes are copied with neutralized set ids, candidate Sonata plans are assigned in slot order, and each legal plan is rescored with neutral main-Echo passive rows. Partial-piece baselines are cached so mixed plans that are damage-identical to a simpler standalone partial plan can be discarded as redundant.',
            'The Sonata display is grouped from the scored results rather than from set names. Plans with the same damage and contributing set-effect shape render as one row with grouped set icons and piece counts. Any set effect whose removal does not change the scored damage is not part of the visible plan, even if it appeared in one raw generated set assignment.',
            'The important constraint is that both routes mutate only one axis while keeping the rest of the packed scorer fixed. Main-stat suggestions replace primary-stat assignments over the same Echo shells. Sonata suggestions neutralize set identity, apply one legal plan, then reuse the same shells and the same scoring context. That is what keeps them informative without turning them into a second full optimizer.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.15',
          title: 'Main-stat / Sonata evaluation',
          lines: [
            'prepare fast scoring input from the current equipped build',
            'prepare neutral main-Echo passive rows for this comparison',
            '',
            'for each legal main-stat recipe or Sonata plan:',
            '    apply the modification to the current Echo shells',
            '    score the modified build with neutral main-Echo passive rows',
            '    keep the strongest results',
          ],
        },
      ],
    },
    {
      id: 'weapon-suggestions',
      title: '19 Weapon Suggestions',
      blocks: [
        {
          type: 'prose',
          text: [
            'Weapon suggestions keep the equipped Echoes and the scoring objective, but neutralize the current weapon before candidate scoring begins. Each candidate weapon then adds its own base attack, secondary stat, passive controls, and passive effects onto that neutral baseline.',
            'After those weapon-specific stats and effects are applied, the engine rebuilds the fixed direct skill template or the weighted rotation event list for that weapon. The unchanged Echo build is then rescored under the candidate weapon. When two passive states matter, such as default versus maximized passive state, both are scored and the chosen comparison setting decides ranking.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.16',
          title: 'Weapon evaluation',
          lines: [
            'remove current weapon from the baseline',
            '',
            'for each legal weapon candidate:',
            '    add candidate base attack and secondary stat',
            '    apply candidate passive states and effects',
            '    rebuild the fast scoring input',
            '    score the unchanged Echo build',
          ],
        },
      ],
    },
    {
      id: 'substat-deltas',
      title: '20 Sub stat Delta Scoring',
      blocks: [
        {
          type: 'prose',
          text: [
            'The sub stat-priority view is the smallest suggestions engine in this family. It does not search over alternative Echo identities at all. It encodes the current equipped Echoes once, scores the current damage once, then perturbs one substat key at a time and measures the damage change.',
            'For each sub stat key, the engine computes three counterfactuals: gain from adding the chosen number of roll steps, loss from removing that many steps, and loss from removing the entire currently present amount. Additions are clamped to the legal five-slot ceiling for that sub stat. Removals are clamped to the amount the build actually has. Every perturbation is rescored through the same fast evaluator, then reported both in raw damage and as a percent of current damage.',
            'A "roll step" here is not a gacha roll event. It is one adjacent increment in the authored substat value ladder for that key. For Crit DMG, moving from 12.6% to 13.8% is one step worth 1.2 percentage points. Keys with non-uniform or flat-value ladders use their own authored step tables; the route reads those tables directly instead of assuming one universal increment size.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.17',
          title: 'Sub stat delta evaluation',
          lines: [
            'score current equipped build once',
            '',
            'for each legal sub stat key:',
            '    add a clamped roll amount and rescore',
            '    remove a clamped roll amount and rescore',
            '    remove the full current amount and rescore',
            '',
            'report each damage delta in raw value and percent',
          ],
        },
      ],
    },
  ],
}

const negativeEffectsTopic: DocTopic = {
  id: 'negative-effects',
  code: 'NEG-FX',
  eyebrow: 'Damage model',
  title: 'Negative Effects',
  abstract: 'The two non-standard damage branches: stack-based negative effects and level-based Tune Break.',
  drives: 'Negative-effect skills - Tune Break skills',
  instrument: 'stackRamp',
  instrumentNote: [
    'Shows the per-effect base damage scaled only by enemy defense and resistance, before skill multipliers, amplifiers, vulnerability, and crit.',
  ],
  aliases: ['negative effects', 'afflictions', 'status effects', 'frazzle', 'erosion', 'burst', 'tune break', 'tune rupture'],
  sections: [
    {
      id: 'branch-select',
      title: '01 Branch Select',
      blocks: [
        {
          type: 'prose',
          text: [
            'These skills do not use the ordinary ability-scaling path. The damage router first checks the skill archetype. Tune Break goes to the level-based tune branch. Spectro Frazzle, Aero Erosion, Fusion Burst, Glacio Chafe, and Electro Flare go to the negative-effect branch. Everything else stays on the direct damage path.',
            'Both branches still end in the same general outputs: normal, crit, and average damage across the hit list. The difference is where the starting base comes from and which bonus buckets are allowed to enter before that output is formed.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.1',
          title: 'Damage branch selection',
          lines: [
            'if archetype == tuneRupture:',
            '    use Tune Break branch',
            '',
            'if archetype in {',
            '    spectroFrazzle, aeroErosion, fusionBurst, glacioChafe, electroFlare',
            '}:',
            '    use negative-effect branch',
            '',
            'else:',
            '    use the normal skill damage branch',
          ],
        },
      ],
    },
    {
      id: 'tune-break',
      title: '02 Tune Break',
      blocks: [
        {
          type: 'prose',
          text: [
            'Tune Break damage starts from an authored level table, not from ATK, HP, DEF, or a stack counter. The level is clamped to 1 through 90, rounded, and used as an exact table lookup. The skill hit pattern comes from the Tune Break hit list; when a manual tune hit list is absent, the fallback total scale is 16.',
            'The Tune Break branch also applies an enemy class multiplier. Common enemies use 1. Elite enemies use 3. Calamity and Overlord targets use 14. Tune Break Boost multiplies this branch directly. Crit fields come from the skill itself through Tune Break crit rate and Tune Break crit damage.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.1',
          title: 'Tune Break damage',
          lines: [
            'levelScale = levelTable[clamp(round(level), 1, 90)]',
            'hitScale = sum(hit multipliers)',
            '',
            'classMult = 1 for class 1',
            'classMult = 3 for class 2',
            'classMult = 14 for class 3/4',
            '',
            'bonusMult = (1 + bonuses that would apply)',
            '          * (1 + tuneRupture damage bonus)',
            '          * (1 + Tune Break Boost)',
            '',
            'normal = hitMultiplier',
            '       * levelScale',
            '       * hitScale',
            '       * resistanceMult',
            '       * defenseMult',
            '       * (1 + vulnerability)',
            '       * classMult',
            '       * bonusMult',
            '',
            'crit = normal * tuneCritDamage',
            'avg = crit * tuneCritRate + normal * (1 - tuneCritRate)',
          ],
        },
        {
          type: 'levelTable',
          caption: 'TBL.1',
          title: 'Tune level value',
        },
      ],
    },
    {
      id: 'negative-branch',
      title: '03 Negative Effect Inputs',
      blocks: [
        {
          type: 'prose',
          text: [
            'Negative effects start by resolving how many stacks actually count. Most skills read the live combat-state stack count for that effect. If the skill declares fixed-max mode, the stack count is forced to the skill maximum or, if none is authored there, the effect default cap.',
            'Electro Flare has one extra rule. When the active Electro Flare count is above its default cap, the extra rage count is added as a second Electro Flare base term. A skill can also provide a fixed multiplier value; in that case the normal per-effect stack formula is skipped and the fixed value is turned into base damage through the level scale helper.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.2',
          title: 'Negative-effect stack resolution',
          lines: [
            'if stackMode == fixedStacks:',
            '    stacks = skill.stacks',
            'else:',
            '    stacks = what ever is set',
            '',
            'if effect == Electro Flare and live flare stacks > 10:',
            '    extraStacks = Electro Rage',
            'else:',
            '    extraStacks = 0',
            '',
            'if fixedMv is present:',
            '    base(effect, level, stacks) = fixedMv * levelScale(level) / 10000',
            '',
            'if stacks <= 0 and extraStacks <= 0:',
            '    damage = 0',
          ],
        },
      ],
    },
    {
      id: 'negative-base',
      title: '04 Negative Effect Base',
      blocks: [
        {
          type: 'table',
          columns: ['Effect', 'Base definition'],
          rows: [
            ['Spectro Frazzle', '209.9 + 895.8 * stacks'],
            ['Aero Erosion', 'stacks = 1 -> 1655.1 ; stacks >= 2 -> 4133.45 * stacks - 4132.37'],
            ['Fusion Burst', 'fusionStackValue(stacks) * levelScale(level) / 10000'],
            ['Glacio Chafe', 'glacioStackValue(stacks) * levelScale(level) / 10000'],
            ['Electro Flare', 'electroStackValue(stacks) * levelScale(level) / 10000'],
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.2',
          title: 'Negative-effect base assembly',
          lines: [
            'perStackBase = base(effect, level, stacks)',
            '',
            'if effect == Electro Flare:',
            '    perStackBase += base(Electro Flare, level, extraStacks)',
            '',
            'totalBase = perStackBase * sum(hit multipliers)',
          ],
        },
      ],
    },
    {
      id: 'enemy',
      title: '05 Enemy Multipliers',
      blocks: [
        {
          type: 'formula',
          caption: 'EQ.3',
          title: 'Resistance multiplier',
          lines: [
            'res = enemyRes - resShred',
            '',
            'res < 0:',
            '    resistanceMult = 1 - res / 200',
            '',
            '0 <= res < 75:',
            '    resistanceMult = 1 - res / 100',
            '',
            'res >= 75:',
            '    resistanceMult = 1 / (1 + 5 * res / 100)',
            '',
            'base enemy RES = 100:',
            '    damage = 0',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.4',
          title: 'Defense multiplier',
          lines: [
            'Tune Break:',
            '    enemyDefense = (8 * enemyLevel + 792)',
            '                 * (1 - defShred / 100)',
            '                 * (1 - targetedDefIgnore / 100)',
            '',
            'Negative effects:',
            '    enemyDefense = (8 * enemyLevel + 792)',
            '                 * (1 - defShred / 100)',
            '                 * (1 - targetedDefIgnore / 100)',
            '',
            'defenseMult = (800 + 8 * resonatorLevel)',
            '            / (800 + 8 * resonatorLevel + max(0, enemyDefense))',
          ],
        },
      ],
    },
    {
      id: 'bonuses',
      title: '06 Bonus Path',
      blocks: [
        {
          type: 'prose',
          text: [
            'Tune Break and negative effects do not read the same bonus buckets. Tune Break reads the dedicated tune damage-bonus bucket plus Tune Break Boost. Negative effects read the effect-type bucket for that skill, the effect-specific multiplier bucket, vulnerability, and Final DMG.',
            'For both branches, element RES shred, defense shred, and vulnerability are still element-aware. The effect element is Spectro for Frazzle, Aero for Erosion, Fusion for Burst, Glacio for Chafe, and Electro for Flare.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.5',
          title: 'Tune Break bonus multiplier',
          lines: [
            'tuneBonusMult = (1 + bonuses that would apply)',
            '              * (1 + tuneRupture damage bonus)',
            '              * (1 + Tune Break Boost)',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.6',
          title: 'Negative-effect bonus multiplier',
          lines: [
            'effectBonusMult = (1 + bonuses that would apply)',
            '                * (1 + effect-type amplify)',
            '                * (1 + effect-type damage bonus)',
            '                * (1 + finalDmg)',
            '',
            'effectMultiplier = 1 + effect-specific multiplier',
          ],
        },
      ],
    },
    {
      id: 'crit-output',
      title: '07 Crit And Output',
      blocks: [
        {
          type: 'prose',
          text: [
            'Both branches finish by distributing total damage across the skill hit list and then applying branch-specific crit fields. Tune Break crit comes from the skill Tune Break crit fields. Negative-effect crit comes from the skill negative-effect crit fields plus effect-specific crit buffs.',
            'Hack shares the Tune Break level branch but does not use Tune Break crit fields. It keeps the level-scale and Tune Break Boost side of the formula while treating crit as the neutral path.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.7',
          title: 'Negative-effect output',
          lines: [
            'damage = floor(',
            '    perStackBase',
            '  * sum(hit multipliers)',
            '  * effectBonusMult',
            '  * resistanceMult',
            '  * defenseMult',
            '  * effectMultiplier',
            '  * (1 + vulnerability)',
            ')',
            '',
            'normalHit = damage * hitMultiplier / sum(hit multipliers)',
            'critHit = normalHit * effectCritDamage',
            'avgHit = critHit * effectCritRate + normalHit * (1 - effectCritRate)',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.8',
          title: 'Tune Break output',
          lines: [
            'normalHit = hitMultiplier',
            '          * levelScale',
            '          * resistanceMult',
            '          * defenseMult',
            '          * (1 + vulnerability)',
            '          * classMult',
            '          * tuneBonusMult',
            '',
            'critHit = normalHit * tuneCritDamage',
            'avgHit = critHit * tuneCritRate + normalHit * (1 - tuneCritRate)',
          ],
        },
      ],
    },
  ],
}

export const docTopics: DocTopic[] = [evaluationTopic, optimizerTopic, negativeEffectsTopic]
