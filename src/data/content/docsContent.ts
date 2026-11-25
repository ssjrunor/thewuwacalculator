/*
  Author: Runor Ewhro
  description: defines structured reference content for simulation math and build evaluation.
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

/** renders the live grade ladder from the evaluation module. */
export interface DocLadderBlock {
  type: 'ladder'
  caption: string
  title: string
}

/**
 * renders the live tune break level table from the engine. shows the key
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

/** selects the topic's interactive calculation example. */
export type DocInstrument = 'anchorScale' | 'stackRamp' | 'searchSpace' | 'none'

export interface DocTopic {
  id: string
  /** stable short topic code, e.g. "SCORE". */
  code: string
  eyebrow: string
  title: string
  abstract: string
  summary?: string
  drives: string
  instrument: DocInstrument
  /** calculation caveats for the selected instrument. */
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
    'The chart uses illustrative damage values to demonstrate the 0%, 100%, and 200% reference points. Actual values are computed for the selected build using the rules below.',
    'The 0% reference removes all Echoes. The 100% reference allows up to 16 damage-affecting or required Energy Regen substats among 25 total, with a shared budget of 32 moves between possible substat values. The 200% reference maximizes damage substats while meeting its Energy Regen requirement. Their damage values change with the resonator, weapon, team, controls, and preserved utility requirements.',
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
            'The score compares active build damage with generated references in one standardized combat situation: 0% is the no-Echo baseline, 100% is the constrained investment benchmark, and 200% is the maximum-value benchmark. Scores can exceed 100%; section 12 describes the separate Echo-card quality reference.',
            'Evaluation uses standardized levels and enemy settings for comparable scores. It sets the resonator to level 90, maximizes skills and trace nodes, and raises the equipped weapon to its maximum level. It uses a level 100 enemy with 20% RES. Your Echoes, weapon choice and rank, sequence, team, and active controls stay as configured.',
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
            'Echo stat data supplies legal primary main stats by Echo cost, the fixed secondary stat by Echo cost, the available substats, and their possible roll values. Echo catalog data supplies each Echo cost and eligible Sonata sets. Sonata set data supplies set piece thresholds, set effects, utility set state controls, stack limits, and the operations that turn those states into stat or damage effects.',
          ],
        },
        {
          type: 'table',
          columns: ['Loaded data', 'Scoring use'],
          rows: [
            ['Resonator seed', 'selects the evaluation rotation used to compute active damage and reference damage'],
            ['Current resonator state', 'provides weapon, Echoes, active controls, stack values, combat state, and team links'],
            ['Echo stat table', 'defines legal main stats, fixed secondary stats, available substats, and possible roll values'],
            ['Echo catalog', 'defines cost, set membership, and which Echoes can be selected as the main Echo'],
            ['Sonata set definitions', 'define piece activation, utility states, stack controls, and set effects'],
            ['Enemy profile and team state', 'provide inputs to the damage evaluator for active and reference builds'],
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
      title: '05 When References Change',
      blocks: [
        {
          type: 'prose',
          text: [
            'The 0%, 100%, and 200% reference damage values set the build-score scale. The app can reuse them when an Echo edit changes only the equipped build’s damage and leaves the generated reference builds unchanged.',
            'The equipped build changes the generated references through its Energy Regen target, completed utility Sonata sets and their active effects, or a selected main Echo support effect that also applies to teammates. Other substats and ordinary main stats change the equipped build’s damage without changing the references. Sonata pieces and self-only main Echo effects can still change a reference if they change the Energy Regen target.',
            'The equipped build always uses its actual Echoes, Sonata effects, and main Echo effect. The 100% and 200% references are generated from possible Echo builds; they carry over the equipped build’s required utility sets and team-supporting main Echo when applicable.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.3',
          title: 'When reference damage can be reused',
          lines: [
            'referenceInputs = {',
            '    current situation with Echo stats removed,',
            '    enemy profile,',
            '    team state,',
            '    targetER from equipped build,',
            '    completed utility set ids and piece counts,',
            '    active utility set control values,',
            '    preserved support main Echo id',
            '}',
            '',
            'if stored reference damage exists for referenceInputs:',
            '    skip reference search',
            '    re-score equipped build against stored reference damage',
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
            'Reference builds use five Echoes that could exist in Wuthering Waves. For example, a 4-4-3-3-3 build containing Hoartoise cannot have a five-piece Tidebreaking Courage set if no eligible Echo combination can form it. The search checks possible Echo costs, Sonata sets, main Echo choices, and primary main stats. It rejects combinations that cannot preserve a required utility set or main Echo support effect.',
            'One Echo can contribute to each of two different Sonata sets. The search accepts five distinct Echo-and-set combinations and rejects a repeated Echo in the same set.',
            'Before choosing substats, the search decides the five Echo costs, their Sonata sets, and the main Echo effect. It applies those choices before comparing damage in the same combat situation used for the equipped build.',
            'The 0% reference uses no Echo stats, Sonata effects, or main Echo effect. The 100% and 200% references search possible five-Echo builds with different substat limits.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.4',
          title: 'Generated reference builds',
          lines: [
            'referenceBuilds = []',
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
            '            prepare Echo stats, Sonata effects, and main Echo effect',
            '            discard builds with identical Sonata and main Echo effects',
            '            referenceBuilds.push(prepared generated build)',
            '',
            'baselineDamage = damage(without Echoes)',
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
            'For each possible Echo and Sonata combination, the search checks which stats can change damage before trying primary main stats and substats. It adds a high value for every possible stat, measures damage, then removes one stat at a time. If removing a stat changes damage, the search considers it when choosing main stats and substats.',
            'The search ranks the possible Echo and Sonata combinations by damage from main stats alone. It tries 100% substats on the first 32 combinations and 200% substats on the first 128. Each combination tries at most 256 main-stat choices. These fixed limits keep the report responsive, but a stronger legal build could exist beyond them.',
            'Energy Regen is skipped for resonators that ignore it. When the equipped build has an Energy Regen target, the search includes it even if it does not directly increase damage.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.5',
          title: 'Useful-stat probe',
          lines: [
            'probe = candidate build with primary main stats removed',
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
            'for each Echo in the candidate build:',
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
      title: '08 Substat Limits And Values',
      blocks: [
        {
          type: 'prose',
          text: [
            'The 100% reference gives each of five Echoes five different substats, for 25 total. At most 16 may affect damage or supply the Energy Regen needed to match the equipped build. The others use their lowest possible values.',
            'Two of the damage-affecting substats must be copies of the fifth-highest damage stat for that candidate.',
            'The reference starts each substat at its lowest possible value and has a shared budget of 32 moves to higher values, including Energy Regen. It ranks damage stats by the gain from adding one at its lowest value after the main stats and required Energy Regen have been set. Energy Regen counts toward both limits but is excluded from that damage ranking.',
            'For the two highest-ranked damage stats, each copy can move up by at most floor(29% of its possible moves). Every copy of the lowest-ranked damage stat chosen must move up by at least ceil(50% of its possible moves). These required moves count toward the 32-move budget. A build is rejected if it cannot satisfy the limits together.',
            'These moves describe how the app selects possible values for a hypothetical build; A Crit Rate substat has seven moves from its lowest to highest value, while flat ATK has three. Each adjacent value counts as one move even when the gaps between values differ.',
          ],
        },
        {
          type: 'table',
          columns: ['Quantity', '100% reference', '200% reference'],
          rows: [
            ['Substats across five Echoes', '25; five different substats per Echo', '25; five different substats per Echo'],
            ['Copies of one substat', 'up to 5', 'up to 5'],
            ['Can match a main stat', 'yes', 'yes'],
            ['Damage-affecting or needed ER substats', 'at most 16', 'up to 25'],
            ['Value-selection budget', '32 moves between possible values, including ER', 'highest damage-stat values; ER matched separately'],
            ['Fifth-highest damage stat', 'at least 2 copies', 'not required'],
            ['Two highest-ranked damage stats', 'each copy capped at floor(0.29 * maximum moves)', 'highest possible value'],
            ['Lowest-ranked selected damage stat', 'each copy raised by at least ceil(0.5 * maximum moves)', 'highest possible value'],
            ['Substat values', 'possible rolls chosen individually', 'highest values, with exact ER reservation'],
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.2',
          title: 'Moves between possible substat values',
          lines: [
            'moves(stat, value) = position after the lowest possible value',
            'the lowest value costs 0; each next possible value costs 1',
            '',
            'Crit Rate: 6.3, 6.9, ..., 10.5',
            '    moves(6.9) = 1; moves(10.5) = 7',
            '',
            'Flat ATK: 30, 40, 50, 60',
            '    moves(40) = 1; moves(60) = 3',
            '',
            'Flat HP: 320, 360, 390, 430, 470, 510, 540, 580',
            '    moves(360) = 1; moves(390) = 2',
            '',
            'If Crit Rate and Crit DMG are the two highest-ranked damage stats:',
            '    each has 7 possible increases; floor(7 * 0.29) = 2',
            '    every Crit Rate substat is capped at 7.5%',
            '    every Crit DMG substat is capped at 15.0%',
            '',
            'If flat ATK is the lowest-ranked selected damage stat:',
            '    ceil(3 * 0.5) = 2 moves per copy',
            '    every flat ATK substat must reach at least 50',
            '    two copies consume 4 of the shared 32 moves',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.3',
          title: '100% reference limits',
          lines: [
            'total substats = 25',
            '5 different substats per Echo',
            'at most 5 copies of any one substat across the build',
            'damage-affecting substats + required ER substats <= 16',
            'copies of the fifth-highest damage stat >= 2',
            'all other substats use their lowest legal values',
            '',
            'each value must be a possible in-game roll',
            'sum(moves(stat, value)) <= 32, including ER',
            'two highest-ranked damage stats: each copy’s moves <= floor(maximum moves * 0.29)',
            'lowest-ranked selected damage stat: each copy’s moves >= ceil(maximum moves * 0.5)',
            'ER is excluded from the damage-stat ranking',
            'generated combat ER >= equipped combat ER, unless ER is ignored',
            '',
            'Unused moves are allowed when no legal higher value helps.',
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
            'The 100% reference tries one to five Energy Regen substats, each with a possible in-game value. Each one counts toward the limit of 16 damage-affecting or required Energy Regen substats, and choosing a higher Energy Regen value uses some of the 32 shared moves. The generated total may exceed the target when that is the smallest available roll combination that reaches it; both scoring and the report use the resulting total. A build that cannot meet Energy Regen within these limits is rejected. The 200% reference uses its separate maximum-value rule while preserving the exact missing Energy Regen total.',
            'If the equipped build has a completed utility Sonata set, the generated 100% and 200% builds use the same set, piece count, active controls, and stack values.',
            'The equipped build uses its selected main Echo effect. Generated reference builds can choose another eligible main Echo unless the equipped one has a support effect that applies beyond its wearer. In that case they keep the same main Echo. A self-only effect does not lock the choice, though any Energy Regen it supplies still contributes to the equipped build’s Energy Regen target.',
          ],
        },
        {
          type: 'table',
          columns: ['Equipped-build input', 'Anchor behavior'],
          rows: [
            ['Energy Regen total', 'becomes a target the generated reference build must satisfy unless the resonator ignores ER'],
            ['Completed utility Sonata set', 'becomes a required generated set plan entry with the same set id and max piece count'],
            ['Utility set controls', 'use the same active values and stacks for preserved utility sets'],
            ['Support main Echo effect', 'requires generated reference builds to use that main Echo'],
            ['Self-only main Echo effect', 'unlocked; any ER it supplies contributes to the preserved ER target'],
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
            '    choose the lowest combination of possible values meeting missingER',
            '    count those ER substats toward the limit of 16',
            '    reject if their values use more than 32 moves',
            '    choose the other substats, then spend any remaining moves',
            '',
            'keep the candidate with the highest damage',
            'if missingER is zero: choose no ER substats',
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
            '    apply Sonata effects with preserved utility control values',
            '',
            'for each generated mainEchoChoice:',
            '    if requiredMainEcho exists and choice.echo.id != requiredMainEcho.id:',
            '        reject',
            '    apply choice.mainEchoEffect to the generated build',
          ],
        },
      ],
    },
    {
      id: 'substat-fill',
      title: '10 Choosing Substats',
      blocks: [
        {
          type: 'prose',
          text: [
            'For each possible number of Energy Regen substats, the 100% search ranks damage stats by how much one minimum-value copy adds. It first chooses two copies of the fifth-highest damage stat, then adds other damage-affecting substats with the largest immediate gains until it reaches the limit of 16, counting the required Energy Regen substats. Any remaining places on the Echoes receive stats that do not affect damage in this context, at their lowest possible values. Even a weak stat counts toward the limit if it can affect damage.',
            'The search first gives every copy of the lowest-ranked selected damage stat its required value, at least halfway up its list of possible rolls. It then chooses higher possible values for the selected damage substats one move at a time, taking the largest immediate damage gain while respecting the limits on the two highest-ranked stats. Required increases and Energy Regen values use the same 32-move budget. For the eight strongest initial builds, a final pass tries exchanging substats of the same value rank and moving one value increase from one substat to another while keeping every limit. This is a search heuristic, not proof that no stronger build exists. The final 25 substats are assigned to five Echoes, and scoring and the report use those same values.',
            'The 200% search separately chooses the highest-value substats across its first 128 Echo and Sonata combinations. The 0% reference remains the no-Echo build.',
          ],
        },
        {
          type: 'formula',
          caption: 'FLOW.8',
          title: 'How the 100% substats are chosen',
          lines: [
            'choose enough possible ER rolls to meet the equipped ER total',
            'rank damage stats by gain from one lowest-value copy; exclude ER',
            'choose two copies of the fifth-highest damage stat',
            'choose damage-affecting substats up to the limit of 16, counting ER',
            'fill all 25 places with other substats at their lowest possible values',
            'allow at most five copies of any stat across the build',
            '',
            'give each copy of the lowest-ranked selected damage stat its required value',
            'reject if that conflicts with another limit or uses too many moves',
            'movesRemaining = 32 - ERMoves - requiredDamageStatMoves',
            'choose the allowed next value with the largest damage gain',
            'apply it and subtract one move; repeat while a move helps',
            'refine the eight strongest builds with legal substat and value exchanges',
            '',
            'distribute the 25 substats over five Echoes without duplicates on an Echo',
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
            'The build score compares four damage values: the equipped build, the no-Echo 0% reference, the generated 100% reference, and the generated 200% reference. Below 100%, it measures damage between the no-Echo and 100% values. Above 100%, it measures damage between the 100% and 200% values.',
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
            'Echo score measures the quality of the equipped Echoes. Once a simulation reference is available, the five cards are scored together against one damage-derived substat target. The combined Echo-quality percentage uses those same points. Build score separately measures rotation damage against its 0%, 100%, and 200% reference builds.',
            'The Echo-quality reference keeps the equipped Echoes, Sonata sets, and primary main stats, clears their substats, then chooses 25 substats at their highest possible values, with at most five copies of any one stat. It uses the current combat and rotation context. Values beyond the point where they stop improving damage, such as excess Crit Rate, receive no extra credit. The search finds a legal reference; global optimality is unproven.',
            'This Echo-quality reference is separate from the 100% build-score reference, which limits damage-affecting and required Energy Regen substats to 16 and shares 32 moves between possible values. Changing equipped substats does not move the Echo-quality target. Changing the main stats, weapon, team, or other combat context can rebuild it. An Echo’s points can still change when another Echo changes because copies of the same substat share a point budget.',
            'A matching primary main stat is worth 44 points. Matching uses how many times each main stat appears at each Echo cost in the reference; extra copies do not each earn another 44 points. Other main stats can receive partial credit from weights at that Echo cost. The fixed secondary main stat affects damage but earns no separate quality points.',
            'Each selected substat contributes up to 21 points. A stat absent from the reference receives zero. Energy Regen substats and Energy Regen / Healing Bonus primary main stats are excluded from both earned points and the possible total. Energy Regen still counts toward the 16-substat limit and 32-move budget in the separate 100% build-score reference.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.6',
          title: 'Loadout substat credit',
          lines: [
            'for each scored substat selected by the reference:',
            '    n = number of copies of this substat in the reference',
            '    target = useful reference total, capped at n * maximum legal value',
            '    actual = sum of this substat across equipped Echoes',
            '             (each individual value capped at its legal maximum)',
            '',
            '    availablePoints = 21 * n * min(1, actual / target)',
            '    share these points in proportion to each Echo’s value',
            '    cap each Echo at 21 points for this substat',
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
            'This reference selects five copies each of Crit Rate, Crit DMG, ATK%, flat ATK, and Heavy Attack DMG Bonus. Each stat has a 105-point budget. The effective weights below are points per stat unit before the useful-total and per-Echo caps. They are specific to this sample; changing Phoebe’s context can change the selected stats, counts, and useful totals.',
          ],
        },
        {
          type: 'table',
          columns: ['Phoebe stat', 'Reference copies', 'Useful total', 'Points per unit before caps'],
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
            'The selected 25 substats at their highest values reach 100% Echo quality.',
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
            'effectiveWeight(stat) = generatedWeight(stat) * flatFactor(stat)',
            'ceiling = highest effectiveWeight among scorable legal substats',
            'scale = 1 / ceiling, or 1 if no positive ceiling exists',
            '',
            'subPoints(stat) = 21 * value / maximum legal substat value',
            '                    * effectiveWeight(stat) * scale',
            '',
            'mainWeight = generatedWeight(stat) / highest legal main weight at this cost',
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
            'Crit Value equals twice Crit Rate plus Crit DMG.',
            'An echo instance/slot compute CV from sub stats only (as per usual). When looking at the full build though, it computes based on the aggregated total (from main stats and sub stats). The Echo totals badge colors the full-build number by averaging it back toward a one-Echo badge scale.',
            'That averaging first subtracts a crit-main baseline of 44 CV per 4-cost Echo, capped at two. Only 4-cost Echoes can roll a crit main stat (+44 CV each). A 44111 lineup reaches 298 raw CV; a standard 43311 reaches 254. A full 5-slot build fits at most two 4-cost Echoes under the 12-cost budget (4+4+1+1+1). Subtracting up to two crit mains judges both lineups on substat CV alone: each reduces to 210 (5 x 42) and reaches 100%. Three or more 4-cost Echoes require empty slots (444 uses three). The discount cap and divide-by-five keep those builds below 100%.',
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
            'Every five-Echo layout scores 100% regardless of its cost split. Removing a slot lowers the score by about 20%. The 444 layout scores 81% because the cap does not discount its third Crit main stat.',
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
    'Counts come from a Phoebe build with 175 saved Echoes and 9 rotation features. The app calculates these counts directly.',
    'Optimizer counts cover Inventory and Theory search. Suggestion counts cover the actual Main Stats and Set Plans routes for Phoebe\'s selected direct target and default rotation.',
    'Inventory search size depends on how many Echoes you have. A small inventory can produce fewer five-Echo combinations than Theory search; a large one can produce more. On Inventory searches, the GPU count can exceed the CPU count because it includes combinations above the 12-cost limit. Theory search derives its own main-stat filter and removes equivalent builds. Main Stat and Set Plan suggestions keep the equipped Echo identities and use neutral main-Echo passive bonuses. Choosing a rotation target changes how each suggestion is scored, not how many candidates are generated.',
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
            'This app\'s optimizer engine is a very delicate and adorable little munchkin (Yes it is). It balances expressive searches with speed, accuracy, and memory use.',
            'The engine has two layers. First, Simulation resolves skills, team and enemy state, active controls, rotation events and effects for the selected scenario. It then stores the values needed for repeated scoring in fixed-length numeric arrays. The scorer uses those arrays to calculate damage for each candidate build without resolving the scenario again.',
            'The scoring loop runs once per candidate. Inventory search can test hundreds of millions or even billions of five-Echo combinations; the GPU path makes searches of that size practical. Theory search first removes duplicate combinations, then scores the remaining distinct builds. Suggestions test fewer builds but use the same scoring routine because they may still evaluate thousands of alternatives.',
            'The fast evaluator scores candidates from the prepared numeric data. A single-skill target uses one damage setup. A rotation target uses one setup per recorded damage event and combines their damage using stored weights. For each candidate, the evaluator adds its Echo stats, prepared Sonata bonuses and main-Echo bonuses, then calculates damage and displayed stats. It does not replay the rotation or resolve effects and controls again.',
            'Preparation happens once per search. Any work left in the repeated scoring loop runs for every candidate, legal main-Echo choice and recorded rotation damage event, and sometimes for every weapon choice. The optimizer and Suggestions therefore simulate the scenario and encode its data before scoring candidates.',
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
          columns: ['Term', 'Meaning', 'Why it matters'],
          rows: [
            ['packed setup', 'One fixed numeric view of a damage problem: compiled stats, enemy factors, skill-specific fields, toggles, and metadata stored in one numeric array.', 'CPU workers, GPU shaders, and suggestion routes can all score the same problem without reopening runtime objects.'],
            ['fast evaluator', 'The repeated scorer that takes the packed setup plus encoded Echo rows, set rows, and main-Echo rows and returns damage and visible stats.', 'This is the only part allowed to run once per candidate at scale.'],
            ['hot loop', 'The inner repeated candidate-evaluation path inside inventory search, theory search, and the suggestion engines.', 'Its cost is multiplied across the entire search space.'],
            ['prep stage', 'The one-time phase that simulates rotations, resolves selected skills, applies effects, removes current Echoes when needed, prepares set effects, and encodes scoring inputs.', 'These calculations run once per search.'],
            ['materialization', 'The final phase that turns compact winning rows back into concrete Echo ids, weapon ids, and display stats.', 'Object reconstruction runs after search for the few winners shown in the UI.'],
          ],
        },
        {
          type: 'table',
          columns: ['Allowed inside the hot loop', 'Pushed out before the hot loop'],
          rows: [
            ['sum encoded Echo stat rows', 'rebuild the combat graph'],
            ['count distinct set pieces and add prepared set rows', 'replay the rotation sequence'],
            ['add one chosen main-Echo bonus row', 'resolve authored effect registries'],
            ['apply one packed scoring setup or a stored weighted list of them', 'resolve scenario logic from runtime controls'],
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
            'The full optimizer removes the equipped Echoes before scoring replacement builds. The rest of the combat state stays fixed. Suggestions keep the equipped Echoes and change only the part being compared, such as main stats or Sonata sets.',
            'The scoring objective is independent of candidate generation: single-skill and rotation runs use the same damage evaluator, while inventory, theory, and recommendation searches generate candidates differently.',
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
            'Candidate scoring uses simulated damage events from the optimized character in supported damage families, with each event weighted by its contribution to the original total.',
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
            'Each available Echo is encoded once as a numeric row containing its primary main stat, fixed secondary stat, and substats; parallel arrays store cost, Sonata set, and an identity for counting distinct Echo/set pairs. Candidate scoring reads these arrays directly.',
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
            'The combination-index data provides an exact or estimated search-space size for progress reporting and a deterministic mapping from job range to candidate combinations for CPU and GPU workers. With an unlocked main Echo, each legal five-Echo choice is tested under up to five main-Echo choices. The visible progress count includes those additional tests.',
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
            'The fast evaluator combines the fixed template with each candidate’s Echo stats, set bonuses, and selected main-Echo bonuses to compute damage.',
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
            'Rotation search creates a fixed numeric template for every kept damage event from the earlier simulation. Each template retains its original rotation weight.',
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
            'Inventory search evaluates legal combinations of five distinct Echoes with total cost at most 12.',
            'A locked main Echo does not shrink the build to four slots. The build still has five Echoes. The lock only says that the winning five-Echo candidate must contain one specific Echo, and that only that Echo can be treated as the chosen main Echo when the candidate is scored.',
            'A separate count of legal combinations supplies the progress bar and displayed search size; it estimates work, not damage.',
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
            'Theory search generates Echo candidates from the catalog. It keeps the current build’s substat profiles and varies Echo identity, cost, Sonata set, allowed main stat, and main-Echo choice. It scores those candidates with the same calculation used by Inventory search.',
            'The generated row space contains many equivalent final builds. Before scoring, slot permutations with the same total stats collapse into one canonical ordering. Set-plan variants that differ only by a redundant promoted 1-piece set also collapse. Scoring receives one representative per distinct theoretical build.',
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
            'The single-skill CPU search scores assigned five-Echo candidates within the 12-cost limit against the selected skill and retains the strongest results.',
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
            'The rotation CPU path reuses candidate-build reconstruction. It evaluates every kept rotation event for the candidate build, multiplies each event by its stored weight, and sums the results into one rotation total.',
            'The stat-limit gate moves to the end. Rotation search first finds the best weighted total for the candidate build, then rebuilds one representative visible stat line for that winning version and checks the stat limits there. So the damage total comes from many weighted events while the visible stat gate comes from one representative skill.',
            'Rotation weapon search prepares an event-template list for each candidate weapon before rescoring the Echo candidate. Weapons can change multiple fixed quantities in the rotation score.',
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
            'The GPU path solves the same search problem under the same rules, math, and constraints. Repeated scoring runs on the graphics processor.',
            'All long-lived numeric arrays are uploaded once: Echo rows, prepared Sonata bonuses, costs, type identities, main-Echo bonus rows, fixed damage templates, stat limits, and combination-index data. Individual GPU jobs then only send small run-specific values such as their start range, job size, and main-Echo lock state.',
            'Single-skill and rotation search use separate GPU kernels for fixed damage and weighted event lists; theory search batches candidates without merging their scores.',
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
            'CPU jobs usually describe a slice of the five-Echo combination space. GPU jobs do the same, and Theory search can also hand over explicit generated batches. Each worker retains prepared numeric data after the first job to amortize setup cost.',
            'Theory search reports candidate generation and scoring separately; inventory search usually begins with scoring.',
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
            'Search workers return compact numeric results. Before displaying a result, the app resolves its Echo IDs, optional weapon ID, and stat summary.',
            'Single skill results rebuild that summary from the chosen skill damage problem. Rotation results use the representative direct-damage template prepared earlier. With weapon search active, the summary uses the winning weapon and matches the displayed damage.',
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
            'They differ mainly in which builds they test. The full optimizer searches for replacement five-Echo loadouts. Suggestions usually keep the equipped Echoes and change only main stats, Sonata sets, weapons, or substats.',
            'Main Stat and Sonata suggestions exclude main-Echo passive bonuses from both proposed builds and the current-build baseline. This lets the ranking measure the main-stat or Sonata change without including the equipped main Echo’s passive.',
            'Suggestions also have one optional path the main optimizer does not: they may include Echo attacks when preparing the target problem. In that case the Echo attack is prepared directly from authored Echo skill data before entering the same fast evaluator.',
            'Echo attacks can be included only when the selected main Echo stays the same for every candidate. If a search can change Echo identities, the attack depends on the candidate and cannot be prepared once for the whole search.',
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
            'Main Stat and Sonata suggestions keep the equipped Echoes. Each candidate changes either the main stats or the Sonata assignments, then uses the prepared skill or rotation calculation to score the result.',
            'Main Stat suggestions generate allowed main-stat combinations under the five-slot and 12-cost rules. They apply each combination to the equipped Echoes and score it without main-Echo passive bonuses. The displayed current-build baseline also excludes those bonuses, isolating the main-stat change.',
            'Sonata suggestions keep the equipped Echoes, clear their set assignments, and test allowed Sonata plans in slot order. Each plan is scored without main-Echo passive bonuses. The engine caches partial-set results and removes mixed plans that deal the same damage as a simpler partial plan.',
            'The Sonata display groups scored results by damage and contributing set effects. Equivalent plans render as one row with grouped set icons and piece counts. Any set effect whose removal does not change the scored damage is absent from the visible plan, even if it appeared in a raw generated assignment.',
            'Each suggestion type changes one part of the equipped build while using the same prepared damage calculation. Main Stat suggestions change main stats; Sonata suggestions change set assignments. Neither searches for different Echoes.',
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
            '    apply the modification to the equipped Echoes',
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
            'Weapon suggestions score each candidate against the equipped Echoes and selected objective, starting from a weapon-neutral baseline and applying that weapon’s base attack, secondary stat, passive controls, and effects.',
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
            'Substat Priority keeps the equipped Echoes. It scores the current build once, then changes one substat at a time to measure the damage gained or lost.',
            'For each substat, the engine measures damage after adding the selected number of value steps, removing that many steps, or removing the whole current amount. Additions stop at the maximum allowed across five Echo slots. Removals stop at the amount the build has. Each result shows the damage change and its percentage of current damage.',
            'A value step advances a substat to its next legal value; for Crit DMG, 12.6% to 13.8% is one step of 1.2 percentage points, and other substats use their own legal values.',
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
            'The Tune Break branch also applies enemy max Off-Tune: the enemy class multiplier times 2.8. Common enemies use 2.8, Elite enemies use 8.4, and Calamity and Overlord targets use 39.2. Tune Break Boost multiplies this branch directly. Crit fields come from the skill itself through Tune Break crit rate and Tune Break crit damage.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.1',
          title: 'Tune Break damage',
          lines: [
            'levelScale = levelTable[clamp(round(level), 1, 90)]',
            'classMult = 1 for class 1, 3 for class 2, 14 for class 3/4',
            'enemyMaxOffTune = classMult * 2.8',
            '',
            'bonusMult = (1 + tuneRupture damage bonus)',
            '          * (1 + Tune Break Boost)',
            '          * (1 + Final DMG)',
            '',
            'normal = hitMultiplier',
            '       * levelScale',
            '       * resistanceMult',
            '       * defenseMult',
            '       * (1 + vulnerability)',
            '       * enemyMaxOffTune',
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
            'Tune Rupture and Hack:',
            '    res = enemyRes - resShred - resIgnore',
            '',
            'Negative effects (RES Ignore does not apply):',
            '    res = enemyRes - resShred',
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
            'Tune Rupture and Hack:',
            '    enemyDefense = (8 * enemyLevel + 792)',
            '                 * (1 - defShred / 100)',
            '                 * (1 - totalMatchingDefIgnore / 100)',
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
            'Tune Break ignores Amplify and reads the dedicated tune damage-bonus bucket plus Tune Break Boost. Negative effects read only their own skill Amplify and explicitly matching effect-type Amplify. They also read the effect-type damage-bonus bucket, the effect-specific multiplier bucket, vulnerability, and Final DMG. Ordinary skills sum all matching Amplify sources before applying one multiplier.',
            'For both branches, element RES shred, defense shred, and vulnerability are still element-aware. The effect element is Spectro for Frazzle, Aero for Erosion, Fusion for Burst, Glacio for Chafe, and Electro for Flare.',
            'Tune Rupture and Hack include general DEF Ignore and matching element, skill-type, and skill-specific DEF Ignore. Negative effects retain their explicitly targeted DEF Ignore rules.',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.5',
          title: 'Tune Break bonus multiplier',
          lines: [
            'tuneBonusMult = (1 + tuneRupture damage bonus)',
            '              * (1 + Tune Break Boost)',
            '              * (1 + Final DMG)',
          ],
        },
        {
          type: 'formula',
          caption: 'EQ.6',
          title: 'Negative-effect bonus multiplier',
          lines: [
            'effectBonusMult = (1 + own skill amplify + matching effect-type amplify)',
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
            'Hack uses the Tune Break level scale and Boost fields. Its crit path is neutral.',
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
            '          * enemyMaxOffTune',
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
