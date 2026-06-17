/*
  Author: Runor Ewhro
  Description: Authored guide categories and structured content for the in-app
               guides page.
*/

export interface GuideSection {
  title: string
  blocks: GuideBlock[]
}

export interface GuideArticle {
  id: string
  title: string
  summary: string
  sections: GuideSection[]
}

export interface GuideCategory {
  id: string
  title: string
  summary: string
  aliases?: string[]
  articles: GuideArticle[]
}

export type GuideBlock =
  | {
    type: 'paragraph'
    text: string[]
  }
  | {
    type: 'bullets'
    items: string[]
  }
  | {
    type: 'definitions'
    items: Array<{ term: string, description: string }>
  }
  | {
    type: 'note'
    tone?: 'info' | 'warning'
    text: string
  }
  | {
    type: 'formula'
    lines: string[]
    note?: string
  }
  | {
    type: 'example'
    title: string
    setup: string[]
    observation: string[]
    takeaway: string[]
  }
  | {
    type: 'steps'
    items: Array<{ title: string, description: string }>
  }
  | {
    type: 'comparison'
    leftLabel: string
    rightLabel: string
    rows: Array<{ label: string, left: string, right: string }>
  }
  | {
    type: 'statTable'
    rows: Array<{
      stat: string
      structure: string
      meaning: string
      surfaces: string
    }>
  }
  | {
    type: 'warningList'
    items: string[]
  }
  | {
    type: 'image'
    src: string
    alt: string
    caption: string
  }
  | {
    type: 'imagePlaceholder'
    title: string
    caption: string
  }

const paragraph = (...text: string[]): GuideBlock => ({ type: 'paragraph', text })
const bullets = (...items: string[]): GuideBlock => ({ type: 'bullets', items })
const definitions = (...items: Array<[string, string]>): GuideBlock => ({
  type: 'definitions',
  items: items.map(([term, description]) => ({ term, description })),
})
const note = (text: string, tone: 'info' | 'warning' = 'info'): GuideBlock => ({
  type: 'note',
  tone,
  text,
})
const formula = (lines: string[], noteText?: string): GuideBlock => ({
  type: 'formula',
  lines,
  note: noteText,
})
const example = (
  title: string,
  setup: string[],
  observation: string[],
  takeaway: string[],
): GuideBlock => ({
  type: 'example',
  title,
  setup,
  observation,
  takeaway,
})
const steps = (...items: Array<[string, string]>): GuideBlock => ({
  type: 'steps',
  items: items.map(([title, description]) => ({ title, description })),
})
const comparison = (
  leftLabel: string,
  rightLabel: string,
  ...rows: Array<[string, string, string]>
): GuideBlock => ({
  type: 'comparison',
  leftLabel,
  rightLabel,
  rows: rows.map(([label, left, right]) => ({ label, left, right })),
})
const statTable = (...rows: Array<[string, string, string, string]>): GuideBlock => ({
  type: 'statTable',
  rows: rows.map(([stat, structure, meaning, surfaces]) => ({
    stat,
    structure,
    meaning,
    surfaces,
  })),
})
const warningList = (...items: string[]): GuideBlock => ({ type: 'warningList', items })
const image = (src: string, alt: string, caption: string): GuideBlock => ({
  type: 'image',
  src,
  alt,
  caption,
})
const section = (title: string, ...blocks: GuideBlock[]): GuideSection => ({ title, blocks })
const article = (
  id: string,
  title: string,
  summary: string,
  ...sections: GuideSection[]
): GuideArticle => ({
  id,
  title,
  summary,
  sections,
})

export const gdCtgr: GuideCategory[] = [
  {
    id: 'resonators',
    title: 'Resonators',
    summary: 'How resonator progression, sequences, kit modes, status controls, and the Max button shape the active runtime.',
    aliases: ['Resonator', 'Characters', 'Character'],
    articles: [
      article(
        'resonator-progression-and-kit-state',
        'Progression and Kit State',
        'What the resonator pane owns beyond just picking a character.',
        section(
          'The resonator runtime',
          paragraph(
            'The resonator surface owns the active character identity and the character-side pieces of the runtime: level, skill levels, resonance chain, trace nodes, and kit state controls. Those choices feed damage rows, rotations, suggestions, optimizer evaluation, team summaries, and overview readouts.'
          ),
          definitions(
            ['Level and skills', 'The normal progression values used by scaling and skill multipliers.'],
            ['Resonance chain', 'The active sequence level, which can unlock or change kit effects and available controls.'],
            ['Trace nodes', 'Passive progression nodes that add stats or enable kit effects when active.'],
            ['Kit state control', 'A visible control for a resonator-owned stack, toggle, mode, or mutually exclusive state.']
          ),
          note('If a damage result changes after editing the resonator pane, the rest of the app is usually just reflecting that new runtime state.'),
        ),
        section(
          'Mode and status controls',
          paragraph(
            'Some resonators have states that are too important to hide behind a silent default. When a resonator supports an explicit resonance mode or special status, the app surfaces that choice as a visible mode/status control so the active scenario is clear before anything calculates from it.'
          ),
          definitions(
            ['Mode control', 'A mutually exclusive choice such as which form, stance, or resonance mode the runtime should evaluate.'],
            ['Status toggle', 'An on/off or stack style control for a state that may or may not be active in the current scenario.'],
            ['Visible assumption', 'A scenario choice shown in the UI instead of being guessed silently by the calculator.']
          ),
          warningList(
            'If a newer kit has several possible states, check its visible mode/status controls before trusting the result.',
            'Changing modes can change which follow-up controls matter, because some states only exist inside one mode.',
            'A selected mode is part of the runtime, so rotations, suggestions, optimizer, and team calculations all read it.'
          ),
        ),
      ),
      article(
        'resonator-max-button',
        'The Max Button',
        'What the resonator Max action fills in and what it does not promise.',
        section(
          'What Max does',
          paragraph(
            'The resonator Max button is broader than a level shortcut. It maxes the normal progression pieces, then resolves the strongest authored runtime states for that resonator under the current sequence.'
          ),
          bullets(
            'Sets resonator level to 90 and skill levels to 10.',
            'Turns on available trace nodes.',
            'Fills supported resonator mode/status controls to their max or preferred max state.',
            'Respects mutually exclusive mode groups instead of trying to turn impossible states on together.',
            'Uses the current sequence when deciding which sequence-gated controls can be maxed.'
          ),
          note('Max is a ceiling helper. It is useful for quickly setting up a high-output scenario, but it is still worth reviewing the visible controls if you want to model a specific real rotation.'),
        ),
      ),
    ],
  },
  {
    id: 'rotations',
    title: 'Rotations',
    summary: 'How authored rotation structure becomes execution, totals, inspection contexts, and saved records.',
    aliases: ['Rotations', 'Rotation'],
    articles: [
      article(
        'rotation-mental-model',
        'Rotation Mental Model',
        'What the rotation system stores and what the simulator actually derives from it.',
        section(
          'Authored structure versus computed output',
          paragraph(
            'A rotation is authored state, not a frozen result. The node list stores what should execute, in what order, under which conditions, and with which loop or weighting rules. Damage, healing, shield, and contribution totals are computed later from that authored structure against the current build, team state, and enemy state.'
          ),
          definitions(
            ['Authored structure', 'The nodes you keep in the editor. This includes features, conditions, repeat blocks, uptime blocks, loop markers, enabled state, and when rules.'],
            ['Computed output', 'The execution trace, per skill results, inspection rows, and rotation totals produced when the simulator runs the authored structure.'],
            ['Execution order', 'The simulator reads nodes in order. Earlier state changes can affect later feature rows.'],
            ['Context', 'The active resonator build, teammate state, enemy profile, set conditionals, custom bonuses, and selected targets that exist at simulation time.']
          ),
          comparison(
            'Authored',
            'Computed',
            ['What it stores', 'Node definitions, loop markers, weights, conditions, saved metadata', 'Damage rows, healing rows, shield rows, totals, breakdowns, inspection snapshots'],
            ['When it changes', 'When you edit the rotation itself', 'Whenever authored structure or combat context changes'],
            ['Persistence', 'Saved rotations keep it directly', 'Saved summaries and snapshots may keep a computed view of it']
          ),
          note('If a result looks wrong, check authored structure first, then check shared combat context. The simulator is only answering the scenario it was given.'),
        ),
      ),
      article(
        'rotation-node-types',
        'Node Types and Tree Structure',
        'What each rotation node type does and why it exists.',
        section(
          'Core node types',
          definitions(
            ['Feature', 'Runs one feature definition. This is the node that usually creates damage, healing, shield, tune rupture, negative effect, or another measurable output row.'],
            ['Condition', 'Applies runtime changes without creating a damage row by itself. This is where stack changes, toggles, enemy status updates, and similar scenario state are authored.'],
            ['Repeat', 'Executes its child list several times. It is direct repetition, not a named loop context.'],
            ['Uptime', 'Executes its child list inside a weighted branch. The branch contributes only by its uptime ratio.'],
            ['Loop start and loop end', 'Create a named loop context with run counters. Loop contexts can be targeted by when rules and are used by loop aware summaries.']
          ),
          comparison(
            'Repeat',
            'Loop',
            ['Main purpose', 'Repeat a child list a fixed number of times', 'Create named iteration context with run numbering'],
            ['Condition targeting', 'No per run context is created', 'When rules can target specific runs'],
            ['Summary meaning', 'Raw repeated execution', 'Loop aware summaries can normalize by total configured runs'],
            ['Authoring helper', 'Good for compact duplication', 'Good for modeling windows, passes, or repeated phases']
          ),
          paragraph(
            'Loopify is a structural helper that wraps the selected nodes with a loop start and loop end marker. It does not invent new feature behavior. It only gives the wrapped nodes a named iteration context.'
          ),
        ),
      ),
      article(
        'rotation-loops-and-iteration-semantics',
        'Loops and Iteration Semantics',
        'How loop markers, run counts, wrap modes, and summary normalization work.',
        section(
          'What loop markers mean',
          paragraph(
            'A loop start defines a loop id, desc, color, and run count. A matching loop end closes that loop id inside the same sibling list. The simulator keeps track of the active run number and the total configured run count while any node inside that loop is executing.'
          ),
          definitions(
            ['Forward loop', 'The loop end appears after the loop start. The loop body is the range between them.'],
            ['Wrap end loop', 'The loop end appears before the loop start in the same list. The loop body wraps across the list boundary.'],
            ['Wrap start loop', 'There is no end marker. The loop starts at the start marker, runs through the rest of the list, then stops when it returns to the start marker.'],
            ['Loop run', 'The current numbered pass through that loop. Inspection rows and when rules can reference it directly.'],
            ['Loop run count', 'The configured number of total runs for that loop.']
          ),
          image(
            '/assets/guides/loop-forward.png',
            'Forward loop boundary example in the rotation editor',
            'Forward case. The end marker appears after the start marker, so the loop body is the range between them.'
          ),
          image(
            '/assets/guides/loop-wrap-end.png',
            'Wrap end loop boundary example in the rotation editor',
            'Wrap end case. The end marker appears before the start marker in the same list, so the loop body wraps across the list boundary.'
          ),
          image(
            '/assets/guides/loop-wrap-start.png',
            'Wrap start loop boundary example in the rotation editor',
            'Wrap start case. There is no end marker, so the loop starts at the start marker and continues until execution returns to that marker.'
          ),
        ),
        section(
          'How summaries treat loops',
          steps(
            ['Execute each run', 'The simulator still emits one execution entry for each run. A loop with 3 runs creates three loop-scoped entries when the body contains one feature node.'],
            ['Stamp loop context', 'Each entry inside the loop carries the current run number and the total configured runs for that loop. Nested loops carry more than one loop context at once.'],
            ['Normalize loop aware totals', 'Rotation totals, contribution breakdowns, and saved loop total previews divide looped rows by their configured run counts before they are added together.'],
            ['Keep run specific inspection', 'Run specific inspection rows still exist. Normalization is for summary interpretation, not for hiding per run execution.']
          ),
          example(
            'Three run loop with one finisher',
            [
              'Loop A runs 3 times.',
              'The loop body contains one feature row worth 40,000 average damage each run.',
              'A finisher outside the loop is worth 120,000 average damage.',
            ],
            [
              'The simulator emits three loop feature entries and one finisher entry.',
              'The personal rotation total is interpreted as 40,000 from the loop window plus 120,000 from the finisher, for 160,000 average damage.',
              'This is because the loop window is normalized by its 3 configured runs before it joins the summary.',
            ],
            [
              'If the same loop had only 1 run, there would be no difference between raw and normalized totals.',
              'If a row sits inside nested loops, the divisor multiplies across loop run counts. A row inside a 2 run outer loop and a 3 run inner loop is normalized by 6 in loop aware summary surfaces.',
            ],
          ),
          warningList(
            'Loop normalization does not mean the raw execution list disappears. The per run trace still exists.',
            'If you are comparing summary rows to raw inspection rows, remember that the summary may be an average style view of repeated passes.',
            'Saved loop marker totals depend on computed entries. If there is no computed run data yet, the loop inspector cannot show a meaningful total.'
          ),
        ),
      ),
      article(
        'rotation-repeat-and-uptime',
        'Repeat Blocks, Uptime Blocks, and Weighting',
        'How structural blocks differ from loop markers.',
        section(
          'Repeat versus uptime',
          paragraph(
            'Repeat blocks and uptime blocks are structural execution tools. They are not interchangeable. Repeat duplicates child execution. Uptime scales branch contribution by a ratio.'
          ),
          definitions(
            ['Repeat block', 'Evaluates its child list the requested number of times. If the repeat count resolves to 0, nothing inside it contributes.'],
            ['Uptime block', 'Evaluates its child list inside a weighted branch. A 30 percent uptime block contributes 30 percent of its branch output to totals.'],
            ['Setup branch', 'An uptime block can apply setup items before its weighted branch items execute. This is useful when a buff needs to exist before the weighted branch is measured.']
          ),
          example(
            'Repeat and uptime are not the same',
            [
              'A repeat block with times = 3 around a 10,000 damage feature produces 30,000 raw damage before other context changes.',
              'An uptime block with ratio = 0.3 around a 10,000 damage feature contributes 3,000 average damage to the parent summary.',
            ],
            [
              'Repeat models discrete duplication.',
              'Uptime models partial presence inside the total window.',
            ],
            [
              'Use repeat when the event actually happens several times.',
              'Use uptime when the effect exists for part of the window and should be weighted accordingly.',
            ],
          ),
        ),
      ),
      article(
        'rotation-conditions-and-when-rules',
        'Conditions and When Rules',
        'How node gating, feature setup changes, loop targeted rules, and inspection contexts interact.',
        section(
          'What when rules do',
          paragraph(
            'A when rule decides whether a node executes for the current context. That context can include normal condition logic and loop run selection. When a loop rule is missing for a covering loop, the editor treats that as all runs active for that loop.'
          ),
          definitions(
            ['Condition expression', 'The logical rule that determines whether the node should run at all.'],
            ['Loop rule', 'A list of loop ids and allowed run numbers for that node.'],
            ['Covering loop', 'A loop whose boundaries include the edited node. Only those loops are relevant for that node.'],
            ['Inspection context', 'One concrete combination of loop runs such as Loop A #2/3 plus Loop B #1/2.']
          ),
          example(
            'Only on the second pass',
            [
              'Loop A runs 3 times.',
              'A condition node applies a crit buff only on run 2.',
              'A feature row after it exists on all three runs.',
            ],
            [
              'The feature row has three inspection contexts.',
              'Only the Loop A #2/3 context sees the extra buff.',
              'If no loop rule had been authored, all three runs would be active by default.',
            ],
            [
              'When rules are usually needed when one pass through a loop has a different state than the others.',
            ],
          ),
          warningList(
            'If a node appears to stop running after loop edits, inspect its when rules first.',
            'Short loop chips in the editor refer to the loop that actually covers that node, not every loop in the rotation.',
            'A disabled node and a filtered out node look similar in totals, but they are different authoring states.'
          ),
        ),
        section(
          'Feature-level conditions',
          paragraph(
            'A feature row can carry setup changes directly. These changes apply to that feature evaluation path before the feature is calculated, which is useful when one hit needs a temporary stack, toggle, enemy status, or formula override that does not deserve a separate visible condition node in the tree.'
          ),
          definitions(
            ['Condition node', 'A standalone rotation node that mutates runtime or enemy state for later nodes.'],
            ['Feature condition', 'A setup change attached to one feature row and evaluated with that feature.'],
            ['Formula stat', 'A formula-local adjustment such as MV Add, MV Scale, fixed damage, damage bonus, vulnerability, or similar values under the Formula Stats browser entry.']
          ),
          comparison(
            'Condition node',
            'Feature condition',
            ['Best for', 'State that should affect several later nodes', 'State that only belongs to one feature row'],
            ['Tree visibility', 'Appears as its own node in the rotation tree', 'Lives inside the feature editor'],
            ['Typical examples', 'Turn on a stance before a combo, add an enemy status for a window', 'Make one hit guaranteed crit, add formula MV to one hit, consume a one-hit stack']
          ),
          note('Use feature conditions for local setup. Use condition nodes when the state should remain visible as a step in the authored rotation and affect more than one following row.'),
        ),
        section(
          'Adding condition changes',
          paragraph(
            'The conditions editor uses the same condition picker model for normal runtime values, enemy values, and formula stats. The browser chooses what path to edit, then the directive card controls how the value is applied.'
          ),
          steps(
            ['Choose a target', 'Open Add Conditions from a feature or condition editor and pick the runtime, enemy, or Formula Stats entry you want to change.'],
            ['Pick the operation', 'Use the directive card to set, add, scale, or otherwise apply the value according to the available operation for that path.'],
            ['Scope it with when rules if needed', 'If the feature sits inside loops, use when rules when the change should only exist for specific loop runs.'],
            ['Inspect the result', 'Use the damage row inspection context to verify that the expected run or feature sees the changed value.']
          ),
          warningList(
            'Formula stats are per-row overlays, not permanent manual buffs.',
            'Feature-attached conditions should not be used to hide major rotation steps that users need to understand later.',
            'If two attached changes write the same path, the later directive in that feature setup is the one that wins for that path.'
          ),
        ),
      ),
      article(
        'rotation-live-saved-and-team-state',
        'Live Rotations, Saved Rotations, and Team Rotations',
        'How current state, saved state, teammate links, and import or export boundaries relate.',
        section(
          'State boundaries',
          comparison(
            'Live',
            'Saved',
            ['What it is', 'The current rotation attached to the active runtime', 'A persisted inventory record with metadata and optional summary or snapshot'],
            ['When it updates', 'Immediately when the editor or combat context changes', 'Only when you save, import, edit, rename, or delete the saved record'],
            ['Resonator scope', 'Current active resonator', 'Stored with a resonator id and resonator name'],
            ['Load behavior', 'Already active', 'Loading can overwrite current entries and may switch the active resonator']
          ),
          paragraph(
            'Team rotations are a third layer. A personal rotation belongs to one resonator. A team rotation summary adds the enabled linked teammate rotations that are selected for the active setup. Those teammate links can point at live teammate state or a saved teammate rotation entry.'
          ),
          note('Loading a saved rotation from another resonator is a larger state change than loading one from the active resonator. It switches resonator context and then applies the rotation.'),
        ),
        section(
          'Import, export, and saved metadata',
          bullets(
            'Rotation JSON export keeps authored items, mode, resonator identity, duration, note, team selection, and any saved snapshot or summary that already exists on the entry.',
            'Imported rotations are normalized into fresh node ids so they do not collide with existing editor state.',
            'Duration and DPS are saved metadata. They do not cause extra execution by themselves.',
            'Summary fields are descriptive. They do not replace live recomputation once the rotation is loaded back into the calculator.'
          ),
        ),
      ),
      article(
        'rotation-totals-and-breakdown-rows',
        'Reading Rotation Totals and Breakdown Rows',
        'How personal totals, team totals, support rows, and contribution tables should be interpreted.',
        section(
          'Total families',
          definitions(
            ['Personal rotation total', 'The active resonator only. Damage totals come from damage rows. Healing and shield are kept in separate aggregation buckets.'],
            ['Team rotation total', 'The combined damage of the active resonator plus enabled linked teammate rotations.'],
            ['Contributor breakdown', 'How much average damage each resonator contributes to the team total.'],
            ['Skill type breakdown', 'How much average damage each skill family contributes inside the selected total view.'],
            ['Support rows', 'Healing and shield totals shown beside damage summaries when those aggregation buckets are non zero.']
          ),
          example(
            'Damage plus support in one rotation',
            [
              'A rotation deals 500,000 average damage, heals for 30,000, and creates 18,000 shield value.',
            ],
            [
              'The damage total remains 500,000 in the main total row.',
              'Healing and shield appear as separate support rows because they are tracked in their own aggregation buckets.',
            ],
            [
              'Do not add support rows into the main damage total unless you are intentionally making your own combined utility metric.',
            ],
          ),
          note('Normal, Crit, and Average columns are direct views of the same resolved row. Average is not a separate simulation mode.'),
        ),
      ),
    ],
  },
  {
    id: 'echoes',
    title: 'Echoes',
    summary: 'How the active five piece loadout, bag inventory, main echo behavior, and authored echo instances work.',
    aliases: ['Echoes'],
    articles: [
      article(
        'echo-loadout-rules',
        'Loadout Rules and Slot Roles',
        'What the equipped echo surface is actually modeling.',
        section(
          'The active echo build',
          paragraph(
            'The echo pane is the active resonator loadout. It holds up to five equipped echoes and enforces the 12C total cost budget used by the rest of the app, including suggestions and optimizer flows.'
          ),
          definitions(
            ['Equipped echo', 'An echo currently attached to one of the five live loadout slots. Its main stats, secondary stat, substats, set id, and main echo flag feed the build immediately.'],
            ['Main echo slot', 'The first equipped slot. This is the slot whose echo can expose main echo skill text and state controls.'],
            ['Total cost', 'The combined echo cost of the equipped loadout. The shipped UI shows this against the 12C cap.'],
            ['Legal loadout', 'A five slot arrangement that respects the app cost rules and uses real echo definitions.']
          ),
          comparison(
            'Equipped',
            'Bag',
            ['Affects current build', 'Yes, immediately', 'No, until equipped'],
            ['Resonator specific', 'Only because it is attached to the current runtime', 'Shared inventory state'],
            ['Typical use', 'Current active build', 'Reusable stock for later equip, compare, save, or optimize actions']
          ),
        ),
      ),
      article(
        'echo-instance-identity',
        'Echo Instance Identity and Inventory State',
        'How the app distinguishes one echo instance from another.',
        section(
          'Identity and persistence',
          paragraph(
            'An echo instance is more than an echo id. The saved instance also carries its set assignment, main stat values, substats, main echo flag, and identity. Two copies of the same echo definition can still be different inventory entries if their authored stats are different.'
          ),
          bullets(
            'Saving an equipped echo to the bag creates or preserves a reusable inventory entry.',
            'Removing an echo from the current loadout does not delete the inventory copy unless you explicitly remove it from the bag.',
            'Saved builds and optimizer results reference concrete echo instances, not abstract names only.'
          ),
          example(
            'Same echo definition, different instance value',
            [
              'You own two copies of the same 3C echo.',
              'One has Crit Rate and Resonance Skill rolls.',
              'The other has Energy Regen and HP percent rolls.',
            ],
            [
              'They are the same echo family but not the same inventory instance.',
              'Optimizer, score, and saved build behavior can treat them very differently.',
            ],
            [
              'Whenever a result depends on your actual bag, echo identity matters as much as echo name.',
            ],
          ),
        ),
      ),
      article(
        'echo-main-stats-and-substats',
        'Main Stats, Substats, and Roll Interpretation',
        'How authored echo stats map into build math.',
        section(
          'What the editor changes',
          paragraph(
            'Main stat edits, set changes, and substat edits rewrite the authored echo instance itself. There is no separate preview stat mask inside the equip surface. If the value is on the echo, it is part of the active build.'
          ),
          definitions(
            ['Primary main stat', 'The build defining main stat line on that echo cost tier. This is the line most score systems weight heavily.'],
            ['Secondary main stat', 'The fixed secondary line tied to the echo cost tier. It still contributes to total stats but is not treated as the chosen primary roll.'],
            ['Substats', 'The secondary authored lines that usually define roll quality and specialization.'],
            ['Roll quality', 'How strong a value is compared with the known range for that stat line.']
          ),
          example(
            'Why one small edit moves several surfaces',
            [
              'A 4C echo is edited from ATK% to Crit Rate.',
              'The echo keeps the same identity, set, and substats.',
            ],
            [
              'Final stats change immediately.',
              'Damage results move because crit rate changes expected value.',
              'Echo score can also change because the character specific scoring table values the main stat differently.',
            ],
            [
              'One echo edit can change damage, score, suggestions, and optimizer baselines at the same time because all of those systems read the same loadout.',
            ],
          ),
        ),
      ),
      article(
        'echo-main-echo-and-sets',
        'Main Echo Effects and Sonata Sets',
        'How the active main echo and set counts affect runtime behavior.',
        section(
          'Main echo behavior',
          paragraph(
            'The main echo slot can expose active skill text and state controls. Some main echo definitions add a visible damage row. Others only add conditions, buffs, or options that modify later calculations.'
          ),
          definitions(
            ['Main echo effect', 'The active skill or stateful effect exposed by the equipped main echo.'],
            ['Selected set id', 'The set affiliation stored on each echo instance.'],
            ['Active set bonus', 'A set effect that becomes available once the equipped counts satisfy its threshold.']
          ),
          note('Set logic uses the selected set ids on the equipped echoes. Suggestions that rewrite set plans are changing those set assignments, not inventing extra hidden set pieces.'),
        ),
      ),
      article(
        'echo-quick-setup',
        'Quick Setup Forge',
        'How the Echoes pane can generate a valid loadout from partial choices.',
        section(
          'What Quick Setup builds',
          paragraph(
            'Quick Setup is a loadout forge for the active resonator. It can generate between one and five equipped echoes from the pieces you specify, then fills the missing parts with valid random choices.'
          ),
          definitions(
            ['Echo count', 'How many equipped echo slots the generated loadout should contain. If the current build has no echoes, the modal starts at five.'],
            ['Main stat slot', 'A chosen cost and primary main stat for one generated echo. Empty slots are filled randomly.'],
            ['Substat template', 'A reusable set of up to five substats that can be copied onto one or more generated echoes.'],
            ['Multiplier', 'How many echoes should receive that substat template. Template multipliers can add up to the echo count, and any remaining echoes get random substats.'],
            ['Sonata plan', 'The set-piece plan Quick Setup should try to satisfy while choosing echo definitions and set ids.'],
            ['Main echo', 'The desired catalog echo for the first slot. If it cannot fit the current plan, Quick Setup treats it like an unset main echo and picks a valid one instead.']
          ),
          note('Quick Setup writes real echo instances into the active build. It is not a preview layer, so generated stats, sets, and main echo state immediately feed the rest of the calculator.'),
        ),
        section(
          'How starting values are chosen',
          paragraph(
            'The modal starts from the current echo build instead of a blank template. Existing main stats, costs, set plan, main echo, and substat patterns are read from the equipped echoes so you can adjust the current build rather than rebuild it from zero.'
          ),
          bullets(
            'Existing substat sets are deduped by their stat keys; order does not matter.',
            'Repeated matching substat sets become one template with a higher multiplier.',
            'Adding a new substat template duplicates the previous template when one exists.',
            'Clear All removes the authored choices so the next generated loadout is mostly random within the remaining rules.'
          ),
        ),
        section(
          'Validity and random filling',
          paragraph(
            'Quick Setup only generates legal echo arrangements. The chosen echo count, cost choices, set plan, and main echo choice are considered together before the final loadout is produced.'
          ),
          warningList(
            'An invalid main echo is shown as invalid in the picker, but generation still continues by selecting a random valid main echo.',
            'If a main stat, substat template, or set plan slot is left empty, that part is intentionally random-filled.',
            'The generated build is not bag constrained. It creates usable echo instances for the runtime rather than selecting saved inventory entries.'
          ),
        ),
      ),
      article(
        'echo-surface-totals-and-scores',
        'Echo Stats, CV, and Surface Totals',
        'How the echo surfaces summarize the current equipped loadout.',
        section(
          'What the summary badges mean',
          paragraph(
            'The echo surface can summarize the equipped loadout with total stat rows, Crit Value, and build score. These are summary helpers. They do not replace the full final stat tree or damage formulas.'
          ),
          definitions(
            ['Echo Stats', 'The aggregated stat lines contributed by the currently equipped echoes only.'],
            ['CV', 'Crit Value, computed as Crit Rate x 2 plus Crit Damage. It only describes crit concentration.'],
            ['Build score', 'A normalized score percentage across the whole equipped echo loadout using the active resonator scoring weights.']
          ),
          note('Use Echo Stats when you want to know what the echoes themselves contribute. Use Overview and Damage Results when you need the full final build after weapon, traces, team, enemy, and manual bonuses are included.'),
        ),
      ),
      article(
        'echo-set-conditionals',
        'Set Effect Conditionals',
        'Telling the app which set bonuses you actually use, so suggestions and optimizer rankings match your real play.',
        section(
          'What this modal is for',
          paragraph(
            'Most sonata sets have bonuses that only kick in under specific conditions, like a teammate role you may not run, a stack count you may not hit, or a long uptime your rotation cannot keep. By default the app assumes every part is active. This modal lets you turn off the parts that do not match how you actually play, so suggestions and optimizer rankings reflect your real damage rather than a theoretical ceiling.'
          ),
          note('Settings here only change rankings. They never delete or modify the set itself, and you can flip a part back on at any time.'),
        ),
        section(
          'When you might want to turn a part off',
          bullets(
            'A set bonus needs a teammate type you do not bring (for example a healer or a specific element).',
            'A bonus needs many stacks or a long uptime your rotation cannot maintain.',
            'A bonus only triggers in conditions you skip during a real fight.',
            'You want to see how the ranking would look without an optional bonus before farming for it.'
          ),
          example(
            'Did you know?',
            [
              'A 5 piece set bonus triggers when a teammate uses Liberation, but you usually play solo or with a different team.',
            ],
            [
              'Suggestions and the optimizer were treating that bonus as fully active, pushing the set up the ranking unfairly.',
            ],
            [
              'Turning the part off drops the set toward its realistic rank for your actual team. The recommendation you see now is the one that will actually perform for you.',
            ],
          ),
        ),
        section(
          'Using the modal',
          definitions(
            ['Search', 'Type a set name, set id, or a phrase from a bonus description to narrow the cards.'],
            ['Piece filter', 'Tap All, 2PC, 3PC, or 5PC to focus on one piece tier at a time.'],
            ['Sort', 'Reorder by set id, name, or how many of the set\'s bonuses are toggleable.'],
            ['Toggle all visible', 'The row at the top flips every bonus you can currently see on and off in one click. The dashed state means some are on and some are off inside your current filter.'],
            ['Per part toggle', 'Each row inside a card is one set bonus. The small counter on the card header shows how many bonuses on that set are still on.']
          ),
          note('Bonuses that only apply to teammates are not shown here. Those belong to the other resonators in your team and you change them from each teammate\'s view.'),
        ),
        section(
          'What changes when you toggle',
          comparison(
            'Bonus on (default)',
            'Bonus off',
            ['Suggestions', 'Counted in the score for set plans and weapon picks', 'Removed from the score so other sets compete fairly'],
            ['Optimizer rows', 'Included when ranking your bag', 'Skipped, so builds that depended on it slide down the list'],
            ['Damage on the main calculator', 'The set still works the same way in your normal damage results', 'Same as the on state, these toggles only affect ranking flows']
          ),
          note('Each resonator has its own list of off bonuses. A change you make on one character does not carry to another, so feel free to disable a bonus for a sub-DPS without affecting your main.'),
        ),
        section(
          'Good habits',
          bullets(
            'Open this modal once after you settle on a team comp. Most of your toggles stay set after that.',
            'When suggestions or optimizer ranks look surprising, check here first, a single off bonus can reshuffle the top results.',
            'If you change teams, revisit the toggles. A bonus that was unrealistic in one team can become reliable in another.'
          ),
        ),
      ),
    ],
  },
  {
    id: 'suggestions',
    title: 'Suggestions',
    summary: 'How suggestion engines choose targets, evaluate candidate recipes, and expose inspect or apply flows.',
    aliases: ['Suggestions', 'Random Echoes'],
    articles: [
      article(
        'suggestion-target-model',
        'Target Skill and Evaluation Model',
        'What the suggestion engines are actually optimizing.',
        section(
          'The chosen target defines the answer',
          paragraph(
            'Suggestions do not search for a universally correct build. They rank candidates against one current evaluation target. In direct mode that target is a chosen damage feature row. In rotation mode the target is the current personal rotation damage model.'
          ),
          definitions(
            ['Direct mode', 'Suggestions optimize around one eligible direct damage feature row.'],
            ['Rotation mode', 'Suggestions optimize around the current personal rotation damage result instead of one direct skill row.'],
            ['Weight map', 'A stat importance map derived from the current target so the engine knows which stats matter most for this scenario.'],
            ['Current comparison', 'The delta between the candidate and the currently equipped build under the same runtime assumptions.']
          ),
          example(
            'Same character, different target',
            [
              'Target A is a Resonance Skill nuke.',
              'Target B is a rotation that includes basic attacks, liberation damage, and coordinated hits.',
            ],
            [
              'Target A may push heavy skill specific or crit focused choices.',
              'Target B may spread value across several families because the rotation contains more than one important source.',
            ],
            [
              'If suggestion output changes after you switch the target, that is expected. The question you asked the engine changed.',
            ],
          ),
        ),
      ),
      article(
        'suggestions-main-stat-recipes',
        'Main Stat Suggestions',
        'What a main stat suggestion row represents and what it does not represent.',
        section(
          'Recipe based suggestions',
          paragraph(
            'Main stat suggestions search legal main stat recipes under the echo cost budget. They are recipe suggestions for the current loadout, not bag constrained optimizer results.'
          ),
          bullets(
            'The engine explores legal main stat combinations up to the current slot count and 12C budget.',
            'The result row tells you which main stats the engine wants on each cost tier.',
            'Applying the result rewrites the active equipped echo state to match that recipe output.'
          ),
          comparison(
            'Main stat suggestion',
            'Optimizer result',
            ['Inventory constrained', 'No', 'Yes'],
            ['What it changes', 'Main stat recipe on the current loadout model', 'Concrete loadout assembled from bag entries'],
            ['Best use', 'Learn what stat pattern the current target wants', 'Find the best real build you can equip right now']
          ),
        ),
      ),
      article(
        'suggestions-set-plans',
        'Set Plan Suggestions',
        'How suggested set plans are evaluated.',
        section(
          'Set plans change set ids, not echo identities',
          paragraph(
            'Set plan suggestions neutralize the current loadout set assignments, apply candidate set piece plans, then re-evaluate the same equipped echo shells under those plan choices. This isolates the value of the set plan itself.'
          ),
          definitions(
            ['Set plan', 'A compact description such as 5pc one set, or mixed partial set counts, assigned back onto the current five echo slots.'],
            ['Base average', 'The current no plan baseline used for comparison.'],
            ['Feasible plan', 'A plan that is valid for the current slot count and supported plan rules.']
          ),
          example(
            'Set plan without changing substats',
            [
              'Two candidate plans are compared on the same current echo shells.',
              'Only set ids change between those candidates.',
            ],
            [
              'A plan can win because its set effects outperform the current plan even before any substat farming is considered.',
            ],
            [
              'Read set suggestions as set logic guidance first. Use optimizer later if you want a bag constrained answer.',
            ],
          ),
        ),
      ),
      article(
        'suggestions-weapons',
        'Weapon Suggestions',
        'Finding the weapon that best fits your current target and team, then equipping it without losing your previous weapon\'s settings.',
        section(
          'What you are picking between',
          paragraph(
            'Weapon suggestions look at every weapon your character can use and rank them against the skill or rotation you are currently optimizing for. The list reads top to bottom by how much damage each weapon would give you. Your equipped weapon does not change until you press Apply on a row, so you can browse without committing to anything.'
          ),
          note('Like the other suggestion lists, this ranking moves when you change the target skill or rotation. If you switch to a different feature row, expect the order to shuffle.'),
        ),
        section(
          'Choosing a mode',
          paragraph(
            'The Mode setting at the top of the config decides how the app treats each weapon\'s passive when it scores them.'
          ),
          comparison(
            'Default',
            'Max',
            ['What it asks', 'How strong is the weapon at its baseline passive', 'How strong is the weapon when its passive is fully active'],
            ['When to use it', 'You want realistic numbers for fights where you cannot keep stacks up', 'You want the ceiling, what could this weapon do if I played it perfectly'],
            ['What it changes', 'Uses each weapon\'s default passive value', 'Uses the maximum value you set on the Passives tab']
          ),
          paragraph(
            'Both mode is a compromise, it scores every weapon twice and shows you the one that the "Rank by" picker chooses. Useful if you want a quick side-by-side without leaving the config.'
          ),
        ),
        section(
          'Limiting the search by rarity',
          paragraph(
            'Standard weapons are the ones every account has access to. They share one rank setting because the same standard weapon plays identically on every character. The rest of the rarities each have their own row with a visibility toggle and a rank picker.'
          ),
          bullets(
            'Turn a rarity Off when you have no realistic way to get those weapons. They drop out of the list entirely.',
            'Leave a rarity On at the rank you actually have (or plan to have). Most 5 stars are R1 unless you have pulled dupes.',
          ),
          note('These rarity rules apply across every character, not just your current resonator. The thinking is that a weapon\'s rank does not change depending on who is holding it.'),
        ),
        section(
          'The Passives tab',
          paragraph(
            'Some weapons have a passive that scales with stacks, stances, or a toggle. The Passives tab lets you tell the app the largest value of that state you can actually keep up during your rotation. The list only shows weapons that are currently in the search, so flipping a rarity off also hides those weapon\'s state rows.'
          ),
          example(
            'Did you know?',
            [
              'A weapon\'s passive scales up to 4 stacks of a buff, but your rotation can only realistically keep 2 stacks active most of the time.',
            ],
            [
              'Leaving the passive at its 4 stack max in Max mode credits the weapon with damage you do not actually deal.',
              'Disabling the passive entirely throws away the 2 stacks you do get.',
            ],
            [
              'Set the max to 2 instead. The weapon now competes on what you can actually sustain, not on its theoretical ceiling.',
            ],
          ),
          note('Use Off when a state really does not apply to your play. Use a lower max when the state applies but the listed maximum is unrealistic.'),
        ),
        section(
          'Inspect vs Apply',
          comparison(
            'Inspect',
            'Apply',
            ['What it does', 'Opens a detailed view so you can see why a weapon ranked where it did', 'Equips the weapon, sets the rank, and updates the passive controls on your build'],
            ['Does it change my build', 'No, it is read only', 'Yes, your active weapon and its passive settings change immediately'],
            ['Best for', 'Comparing the top few options before committing', 'Adopting the winner as your working build']
          ),
          paragraph(
            'When you Apply, the app clears your previous weapon\'s passive controls before writing the new one\'s. This is on purpose, leftover toggles from your old weapon should not bleed into the new one. The new weapon goes in at the rank shown on the row, which means standard weapons use the shared rank setting rather than whatever rank you had before.'
          ),
        ),
        section(
          'Things to watch for',
          warningList(
            'The ranking is target specific. A weapon that wins for your skill nuke can lose for your full rotation, and vice versa.',
            'Switching modes (Default vs Max) can reorder the list a lot when some weapons depend on hard to reach states.',
            'If a weapon you expected to see is missing, check the rarity row... its rarity might be turned off.',
            'Standard weapon ranks live in this config, so changing the rank here changes the rank on every standard weapon you equip from a suggestion.'
          ),
        ),
      ),
      article(
        'suggestions-random-generation',
        'Random Echo Generation',
        'What the generator synthesizes and how its controls influence the result.',
        section(
          'Synthetic loadouts',
          paragraph(
            'Random generation is deliberately not bag constrained. It synthesizes valid echo sets, main stats, and substats, then evaluates those generated builds against the same suggestion context used elsewhere.'
          ),
          definitions(
            ['Bias', 'How strongly the generator favors the current weight map instead of spreading probability more evenly across legal stat choices.'],
            ['Roll quality', 'The quality band the generator samples around when it creates substats. Higher values trend closer to stronger rolls.'],
            ['Target Energy Regen', 'A soft target that adds or replaces Energy Regen where needed until the generated set reaches the requested threshold.'],
            ['Set preferences', 'Optional rules that force or guide the generated build toward chosen set piece counts.']
          ),
          example(
            'Why a generated build can beat your inventory',
            [
              'Your current bag is missing strong Crit Rate and Energy Regen combinations.',
              'The generator is allowed to synthesize idealized legal echoes.',
            ],
            [
              'The generated build can outperform your real bag because it is answering a ceiling question, not an inventory question.',
            ],
            [
              'Use random generation for expectation setting and theory, not for claiming that your current account can equip the exact result.',
            ],
          ),
        ),
      ),
      article(
        'suggestions-inspect-and-apply',
        'Inspect, Apply, and Common Misreadings',
        'How to treat suggestion output once it has been ranked.',
        section(
          'Preview versus state change',
          comparison(
            'Inspect',
            'Apply',
            ['Meaning', 'Show the candidate in a readable concrete form', 'Write the candidate into active build state'],
            ['Persistence', 'No state mutation by itself', 'Mutates current equipped state immediately'],
            ['Best use', 'Understand why the candidate won', 'Adopt the candidate as your current working build']
          ),
          warningList(
            'A suggestion can be locally correct for the chosen target and still be wrong for another target.',
            'A set suggestion and a main stat suggestion are not the same question, even when they appear on the same page.',
            'Random generation answers a synthetic ceiling question. Optimizer answers a bag constrained question.'
          ),
        ),
      ),
    ],
  },
  {
    id: 'optimizer',
    title: 'Optimizer',
    summary: 'How the optimizer searches real inventory, prunes candidates, applies constraints, and exposes sim or live apply flows.',
    aliases: ['Optimizer'],
    articles: [
      article(
        'optimizer-search-space',
        'Search Space and Inventory Filtering',
        'What the optimizer is allowed to search before ranking results.',
        section(
          'Inventory mode',
          paragraph(
            'In Inventory mode the optimizer searches your real bag entries. Every result row must be buildable from filtered inventory echoes that survive the current rules, set allowances, main stat restrictions, ownership rules, and cost limits. Theorymax mode swaps this candidate pool out for the full catalog and is covered in its own article.'
          ),
          definitions(
            ['Filtered inventory', 'The inventory echoes still eligible after current rule filters are applied.'],
            ['Combination count', 'The number of legal loadout combinations that remain after filtering and main echo constraints.'],
            ['Locked main echo', 'A forced main echo choice that remains in the search even if later filters are aggressive.'],
            ['Keep percent filter', 'A weight based pruning pass that keeps only the strongest slice of echoes for direct mode search.'],
            ['Exclude equipped', 'An Inventory mode switch that removes echoes currently equipped by other resonators from the candidate pool.']
          ),
          note('The keep percent filter is an Inventory-mode pruning shortcut for direct target search. Rotation mode keeps the full filtered pool because a simple direct weight prune is less reliable there. Theorymax does not use keep percent at all.'),
        ),
        section(
          'Avoiding borrowed gear',
          paragraph(
            'Exclude equipped is for account-realistic searches. If you already have echoes assigned to other resonators and do not want this optimizer run to steal them, turn it on before starting the run.'
          ),
          bullets(
            'The current optimizer resonator can still use its own equipped echoes.',
            'Turning the switch off returns to the old behavior where every inventory echo can compete, even if another build is already using it.'
          ),
          note('If you are trying to find the absolute strongest arrangement across your whole bag, leave Exclude equipped off. If you are trying to improve one build without disturbing the rest of your roster, turn it on.'),
        ),
      ),
      article(
        'optimizer-targets-and-objectives',
        'Targets, Weight Maps, and Objectives',
        'Why the optimizer ranks one build above another.',
        section(
          'One objective at a time',
          paragraph(
            'Like suggestions, the optimizer ranks by one current objective. In target mode it optimizes a selected skill. In rotation mode it optimizes the selected rotation payload. The same bag can produce different winners when the objective changes.'
          ),
          definitions(
            ['Target mode', 'One selected skill or eligible row is the optimization objective.'],
            ['Rotation mode', 'The selected rotation items become the objective instead of one direct row.'],
            ['Weight map', 'A marginal value map estimated from the current target so filters and helpers know which stats move the selected objective most.']
          ),
          example(
            'Why a lower score echo can still be part of the top result',
            [
              'One echo has a better broad score but spreads value across unused stats.',
              'Another echo has lower broad score but has the exact element or skill type bonus the selected target wants.',
            ],
            [
              'The optimizer can prefer the narrower piece because it is solving the chosen objective, not a generic quality metric.',
            ],
            [
              'Optimizer rank is objective specific. Echo score is broader and more human readable, but less exact for one target.',
            ],
          ),
        ),
      ),
      article(
        'optimizer-constraints-and-failures',
        'Constraints, Locked State, and No Result Cases',
        'How constraints change the search and why a run can fail to produce a winner.',
        section(
          'Hard boundaries',
          paragraph(
            'Main echo locks, allowed sets, stat minimums, and other constraints all shrink the legal search space before ranking happens. A higher damage candidate that violates one required limit is not a valid result.'
          ),
          bullets(
            'Locked main echo keeps that main echo in the search and forces the rest of the loadout around it.',
            'Stat constraints apply to final resolved stats, not to one isolated echo row.',
            'If the set plan or filters are impossible with the current bag, the optimizer can correctly return no valid result.'
          ),
          warningList(
            'No result does not always mean the engine failed. It often means your constraints removed every legal build.',
            'Tight Energy Regen, set, and main echo constraints can combine into an impossible search faster than expected.',
            'If a result seems too weak, check whether stronger candidates were filtered out by a hard limit rather than by rank.'
          ),
        ),
      ),
      article(
        'optimizer-result-rows',
        'Result Rows, Preview, and Apply Modes',
        'How to read a ranked result and what happens when it is equipped.',
        section(
          'What a row contains',
          definitions(
            ['Result row', 'One ranked candidate loadout built from real inventory entries.'],
            ['Preview', 'A concrete inspection surface that lets you see the echoes behind the rank.'],
            ['Current delta', 'The difference between the candidate and the current optimizer baseline under the same target.'],
            ['Base row', 'The current equipped baseline shown so candidates can be compared against something real.']
          ),
          comparison(
            'Sim',
            'Sim and Live',
            ['Where it applies', 'Optimizer simulation state only', 'Optimizer simulation state and the live resonator runtime'],
            ['Best use', 'Keep experimenting inside optimizer without touching the live build', 'Adopt the candidate into your real calculator state']
          ),
          note('Applying a result to Sim lets you continue optimizer work in a sandbox. Applying to Sim and Live carries the result back into the normal calculator runtime and can switch to the optimizer resonator if another one is active.'),
        ),
      ),
      article(
        'optimizer-theorymax-mode',
        'Theorymax Mode',
        'Asking the optimizer "where would my current rolls do the most damage" instead of "what is the best build out of my bag".',
        section(
          'A different question',
          paragraph(
            'Inventory mode answers a practical question: out of the echoes you actually own, which loadout hits the hardest right now. Theorymax answers a planning question: if you kept the substats you are already wearing but were free to change the echo itself, the set, the cost, and the main stat at each slot, where would those substats do the most damage. The substats stay yours. Echo identity, set, cost, main stat, and optionally weapon choice are up for grabs.'
          ),
          comparison(
            'Inventory',
            'Theorymax',
            ['What it picks from', 'Echoes in your bag right now', 'Any echo from the catalog that fits your filters'],
            ['Your substats', 'Whatever the picked bag echo has', 'The substats you are wearing today, kept slot for slot'],
            ['Main stat, set, echo identity', 'Whatever the bag echo brings', 'The mode chooses what works best for your target'],
            ['Weapon', 'Uses the current optimizer weapon setup', 'Uses the equipped weapon unless Include weapons is turned on'],
            ['What you can equip', 'Right away from your bag', 'Only after farming the echoes the result is asking for']
          ),
          note('Theorymax is anchored to the echoes you have equipped. Empty slots are skipped, and the substats at each slot are the ones currently on your build. It is a ceiling for the rolls you already have, not a wishlist over perfect rolls.'),
        ),
        section(
          'Include weapons',
          paragraph(
            'Theorymax has an Include weapons switch. When it is off, Theorymax uses the weapon already assigned to the optimizer runtime. When it is on, each candidate can also search compatible weapons and keep the weapon that scores best for that exact build.'
          ),
          definitions(
            ['Equipped weapon mode', 'The result answers the echo ceiling question while holding your current weapon fixed.'],
            ['Include weapons mode', 'The result answers the echo ceiling question and the weapon ceiling question together.'],
            ['Weapon column', 'A result column shown when weapon search is active so you can see which weapon the row selected.']
          ),
          warningList(
            'Weapon-aware Theorymax is a bigger ceiling question than normal Theorymax. A winning row may depend on a weapon you are not currently using.',
            'The selected weapon is part of the result interpretation. If you compare it against an Inventory run with a fixed weapon, remember that both the echoes and the weapon may have changed.',
            'Applying a weapon-aware Theorymax result can update the runtime weapon and its evaluated passive state so the preview/live build matches what was scored.'
          ),
        ),
        section(
          'How to read a result',
          paragraph(
            'A Theorymax row tells you: this is the echo identity, this is the set, this is the main stat at each slot, and your current substats placed into that build would output this damage. If Include weapons is on, the row also shows the weapon chosen for that build. Click a row to preview the full build in the inspection pane just like with Inventory results. The substats you see in the preview are the ones from your equipped slots, only the slot, set, main stat, and maybe weapon changed.'
          ),
          bullets(
            'The set badges show the set plan the ceiling wants.',
            'The cost number is the total cost of the assembled five slots, capped at 12.',
            'The main echo icon is the catalog echo Theorymax wants in your main slot.',
            'The weapon icon appears when Include weapons is active and shows the weapon selected for that result.',
            'The damage column is what your current substats would do in that build.'
          ),
        ),
        section(
          'What you can still constrain',
          paragraph(
            'All the constraints you set for Inventory mode keep working in Theorymax. Anything you exclude in settings stays excluded, so you can guide the search toward farming plans you actually care about.'
          ),
          bullets(
            'Allowed sets cut the catalog before the search starts. Sets you exclude never show up in a result.',
            'Set conditionals you turned off still get muted. The ceiling drops to the bonuses you actually trigger.',
            'Cost stays capped at 12 across the five slots. Theorymax will not return an illegal build.',
            'Locking a main echo forces that echo into your main slot and rebuilds the rest of the loadout around it.',
            'The main stat filter restricts which main stats the result is allowed to ask for.'
          ),
          note('If Theorymax returns nothing, it usually means your filters left no legal build anywhere in the catalog, not just nothing in your bag. Loosen a constraint and try again.'),
        ),
        section(
          'When Theorymax is worth running',
          example(
            'Did you know?',
            [
              'You just finished farming a fresh set of well rolled echoes and want to know if you should keep grinding for more pieces.',
            ],
            [
              'Run Inventory first to set your floor, the best build out of your current bag.',
              'Run Theorymax next. The top result is your ceiling for the substats you are wearing.',
            ],
            [
              'A small gap between the two means farming more echoes will not move your damage much. A large gap usually points at one specific change: a different main echo, a different set, or one main stat, that would unlock the rest.',
            ],
          ),
          steps(
            ['Pick the same target', 'Use the same skill or rotation in both modes so the comparison is fair.'],
            ['Run Inventory', 'This is your floor: the best you can equip right now.'],
            ['Switch to Theorymax', 'Same target, same constraints. The winner here is your ceiling.'],
            ['Look at the gap', 'Small gap means your bag is already close to ideal. Big gap means there is a specific upgrade worth farming.'],
            ['Try focused filters', 'Lock a main echo, narrow allowed sets, or tighten main stats to see how the ceiling changes when you commit to a farming plan.']
          ),
        ),
        section(
          'Applying a Theorymax result',
          paragraph(
            'Apply works the same way as Inventory: choose Sim to try the build inside the optimizer sandbox, or Sim & Live to push it onto your active resonator as well. The difference is that the echoes Theorymax equips are not bag entries, they only exist in your runtime state. Your bag is untouched. If the result came from Include weapons mode, the chosen weapon and the passive state the search evaluated are applied with it.'
          ),
          comparison(
            'Sim',
            'Sim & Live',
            ['Where the build shows up', 'Only inside the optimizer pane', 'Optimizer pane and your live calculator surfaces'],
            ['Best use', 'Comparing the ceiling against your current build without touching your live damage results', 'Stress testing your full damage pipeline against the ceiling for the same scenario'],
            ['Inventory impact', 'No new echoes are added to your bag', 'No new echoes are added to your bag']
          ),
          warningList(
            'Applying Theorymax to Live will change the damage shown in your normal calculator until you swap back. This is the ceiling showing up everywhere, not your real build.',
            'Theorymax echoes do not save to your bag automatically. Your previous build is still in your bag, ready to be re-equipped.',
            'If Include weapons was on, the applied build can change weapon state as well as echo state.',
            'If you change something the search depends on allowed sets, main stat filter, set conditionals, or weapon-search settings, re-run Theorymax before trusting the old results.'
          ),
        ),
      ),
      article(
        'optimizer-cpu-and-gpu-paths',
        'CPU and GPU Backends',
        'What backend choice changes and what it does not change.',
        section(
          'Execution path, not meaning',
          paragraph(
            'CPU and GPU are backend choices for how the optimizer searches, batches, and evaluates combinations. They do not change what a result row means. The objective, filters, constraints, and final resolved candidate interpretation stay the same.'
          ),
          bullets(
            'GPU paths can batch and reduce candidates differently for speed.',
            'CPU paths can be easier to reason about when debugging one concrete run.',
            'The backend can change performance and practical batch sizing without changing the user facing meaning of rank 1.'
          ),
        ),
      ),
    ],
  },
  {
    id: 'team-effects',
    title: 'Team Effects',
    summary: 'How teammate sourced effects change the shared combat context and team rotation totals.',
    aliases: ['Team Buffs'],
    articles: [
      article(
        'team-effect-sources',
        'Sources of Team Effects',
        'Where support effects come from and what they change.',
        section(
          'Shared combat context',
          paragraph(
            'Team sourced effects are not isolated to the pane that toggled them. Once active, they become part of the shared combat context used by damage rows, suggestions, optimizer evaluation, and rotation summaries.'
          ),
          definitions(
            ['Weapon effects', 'Teammate weapon passives that can modify the active resonator.'],
            ['Echo or set effects', 'Team wide support value coming from equipped echo choices or active set bonuses.'],
            ['Kit support effects', 'Resonator specific support logic such as shred, vulnerability, healing support, or buff windows.'],
            ['Configurable effect', 'An effect that needs explicit user state such as stacks, toggles, or selected options before it can be resolved.']
          ),
          note('The important question is whether the effect exists in the shared runtime context, not which pane you used to author it.'),
        ),
      ),
      article(
        'team-effect-configuration',
        'Automatic Versus Configurable Effects',
        'Why some support effects just exist and others ask for scenario input.',
        section(
          'Scenario input matters',
          bullets(
            'Always on effects can be resolved directly from known build data.',
            'Configurable effects expose controls because the app cannot guess stack count, mode, or target state safely.',
            'If a teammate effect has no visible impact, check whether its prerequisite toggle or condition is still off.'
          ),
          example(
            'Support effect with a toggle',
            [
              'A teammate passive only applies after a certain combat state is reached.',
            ],
            [
              'The app keeps the effect configurable instead of assuming that state is always active.',
            ],
            [
              'This prevents inflated default totals and keeps optimizer or suggestion output tied to the chosen scenario.',
            ],
          ),
        ),
      ),
      article(
        'team-rotation-links',
        'Linked Teammate Rotations',
        'How teammate rotation selections feed team totals.',
        section(
          'Live and saved teammate links',
          paragraph(
            'Each enabled teammate link tells the active resonator which teammate rotation to include in team mode. That selection can point at current live teammate state or a saved teammate rotation entry.'
          ),
          comparison(
            'Personal total',
            'Team total',
            ['Included entries', 'Only the active resonator', 'Active resonator plus enabled linked teammate rotations'],
            ['Breakdown meaning', 'Usually skill family emphasis', 'Contributor emphasis and combined skill family emphasis']
          ),
          note('If team totals look unchanged, check whether the teammate link is enabled and whether the selected teammate rotation actually contains contributing rows.'),
        ),
      ),
    ],
  },
  {
    id: 'enemy-and-combat-state',
    title: 'Enemy and Combat State',
    summary: 'How enemy level, resistances, Tower mode, negative effects, and enemy status fields affect calculations.',
    aliases: ['Enemies', 'Enemy'],
    articles: [
      article(
        'enemy-profile-basics',
        'Enemy Profile Basics',
        'What the selected enemy controls for every combat calculation.',
        section(
          'Global target state',
          paragraph(
            'Enemy state is global calculator context. The selected enemy profile affects every row that depends on defense, resistance, class, or tracked enemy status.'
          ),
          definitions(
            ['Enemy level', 'Used by defense resolution. Higher target levels usually reduce final damage.'],
            ['Resistance table', 'The per attribute resistance profile used by direct damage formulas.'],
            ['Enemy class', 'Target class metadata used by specialized paths such as tune rupture scaling.'],
            ['Source', 'Catalog or custom. Custom enemies keep your edits as their own target profile.']
          ),
        ),
      ),
      article(
        'enemy-resistance-and-tower-mode',
        'Resistances and Tower Mode',
        'How the app interprets catalog enemies and endgame mode.',
        section(
          'Target assumptions',
          paragraph(
            'Catalog enemies bring a base resistance table. Tower mode then applies the app Tower of Adversity resistance interpretation on top of that base profile. A custom enemy can override the target state more directly.'
          ),
          bullets(
            'Changing Tower mode changes the target assumptions for the selected enemy profile rather than creating a separate damage formula family.',
            'Enemy state is shared across the calculator. A new enemy profile affects damage rows, suggestions, optimizer evaluation, and rotation totals at once.',
            'Selecting another preset preserves tracked tune strain instead of discarding that status field.'
          ),
        ),
      ),
      article(
        'enemy-negative-effects-and-status',
        'Negative Effects, Tune Strain, and Specialized State',
        'What the extra enemy side controls mean.',
        section(
          'Tracked status fields',
          paragraph(
            'The app also tracks enemy side status beyond base resistances. Negative effects such as Spectro Frazzle and Aero Erosion can feed specialized damage families. Tune strain is a tracked enemy status value from 0 to 10 that can be edited directly or changed inside rotation condition steps.'
          ),
          definitions(
            ['Negative effect', 'A target side state used by specialized damage families and effect logic.'],
            ['Tune strain', 'A tracked enemy status field preserved on the enemy profile and exposed to both the enemy surface and rotation conditions.'],
            ['Persistence', 'These values stay active until you change them because they belong to shared combat state, not one temporary result row.']
          ),
          note('If changing a tracked status does not move a particular row, that row probably does not read that status path. Not every damage family uses every enemy side field.'),
        ),
      ),
    ],
  },
  {
    id: 'custom-bonuses',
    title: 'Custom Bonuses',
    summary: 'How manual quick buffs and scoped custom modifiers enter the shared buff pool.',
    aliases: ['Custom Buffs', 'Custom Bonuses'],
    articles: [
      article(
        'custom-bonus-purpose',
        'What a Custom Bonus Represents',
        'Why custom bonuses exist and when to use them.',
        section(
          'Purpose',
          paragraph(
            'Custom bonuses are the manual override layer for scenarios the default data model does not already express. They are appropriate when the effect is real for your scenario but should not be hard coded into the base resonator, weapon, or echo data.'
          ),
          definitions(
            ['Quick buff', 'A direct top level stat entry such as ATK percent, Crit Rate, or Healing Bonus.'],
            ['Modifier', 'A scoped authored bonus that targets a base stat, top stat, attribute bucket, skill type bucket, or one named skill or tab.'],
            ['Scope', 'The level at which the modifier applies inside the formula tree.']
          ),
        ),
      ),
      article(
        'custom-bonus-scope',
        'Scope and Formula Placement',
        'Why the same number can mean very different things depending on scope.',
        section(
          'Scope controls where the number lands',
          comparison(
            'Global',
            'Scoped',
            ['Typical effect', 'Changes many rows at once', 'Changes only matching rows'],
            ['Examples', 'ATK percent, Crit Rate, DMG Bonus', 'Aero damage bonus, Resonance Skill bonus, one specific skill modifier'],
            ['Troubleshooting', 'Check the number if totals look too high everywhere', 'Check the scope if only one family moved']
          ),
          bullets(
            'Base stat modifiers feed the core ATK, HP, or DEF calculation before later damage modifiers are applied.',
            'Top stat modifiers change scalar bonus paths like damage bonus, amplify, vulnerability, or tune break boost.',
            'Attribute and skill type modifiers only apply when the current row matches that attribute or skill family.',
            'Skill scoped modifiers are the narrowest. They only affect the matched skill id or tab rule.'
          ),
        ),
      ),
      article(
        'custom-bonus-presets',
        'Quick Imports with Presets',
        'How to quickly add game-accurate buffs without manual entry.',
        section(
          'Automated Imports',
          paragraph(
            'Instead of manually entering every stat and scope, you can use Presets to import effects directly from the game data catalog. This is especially useful for representing buffs from teammate weapons, echo sets, or main echo skills.'
          ),
          paragraph(
            'You can find the Presets tool in the Advanced Modifiers section of the optimizer. Look for the sparkle icon next to the "Add" button.'
          ),
          bullets(
            'Source Filters: Narrow down choices by Echoes, Sonata Sets, or Weapons.',
            'Target Filters: Filter by who receives the buff (Self, Active Resonator, or the whole Team).',
            'Configurable Controls: Adjust refinement levels, stacks, or state toggles before importing.',
          ),
          note(
            'Once imported, a preset becomes a standard manual modifier. You can still edit its numbers or change its scope if your scenario requires a custom variation.'
          ),
        ),
      ),
      article(
        'custom-bonus-examples-and-pitfalls',
        'Examples and Common Pitfalls',
        'How to reason about custom bonus output.',
        section(
          'Worked examples',
          example(
            'Global ATK percent versus Resonance Skill bonus',
            [
              'A global ATK percent modifier increases base ability for every ATK scaling skill.',
              'A Resonance Skill damage bonus only affects rows whose skill type matches Resonance Skill.',
            ],
            [
              'The ATK percent modifier usually moves more than one surface at once.',
              'The skill type modifier is narrower and usually easier to isolate in the formula view.',
            ],
            [
              'If the wrong rows moved, the scope was probably broader than intended.',
            ],
          ),
          warningList(
            'Custom bonuses stack with everything else already in the build. They are not replacement values.',
            'A narrow skill scoped modifier can look ineffective if you are inspecting a different row than the one it targets.',
            'If a manual value seems too strong, inspect whether it was placed on a global top stat instead of an attribute or skill specific scope.'
          ),
        ),
      ),
    ],
  },
  {
    id: 'damage-results',
    title: 'Damage Results',
    summary: 'How to read direct rows, support rows, sub hits, formulas, and rotation summaries.',
    aliases: ['Damage & Scaling', 'Damage'],
    articles: [
      article(
        'damage-result-columns',
        'Result Columns and Row Families',
        'What the main numbers on the damage surfaces actually mean.',
        section(
          'Normal, Crit, and Average',
          definitions(
            ['Normal', 'The resolved non critical output after stat scaling, buffs, defense, and resistance.'],
            ['Crit', 'The same resolved row with the current critical damage multiplier applied.'],
            ['Average', 'Expected value from the current crit rate and crit damage. It is not a separate execution path.'],
            ['Row family', 'Damage, healing, shield, tune rupture, negative effect, or another specialized result type.']
          ),
          formula(
            [
              'normal = resolved non critical output',
              'crit = normal x crit damage',
              'avg = critRate x crit + (1 - critRate) x normal',
            ],
            'When crit rate reaches 100 percent, Average collapses to Crit for critical damage rows.',
          ),
          example(
            'Expected value is not a guess',
            [
              'Normal = 10,000',
              'Crit = 20,000',
              'Crit Rate = 70 percent',
            ],
            [
              'Average = 0.7 x 20,000 + 0.3 x 10,000 = 17,000',
            ],
            [
              'Average is a deterministic expected value view of the same row, not a separate simulation setting.',
            ],
          ),
        ),
      ),
      article(
        'damage-subhits-and-grouping',
        'Sub Hits, Grouped Rows, and Family Breakdowns',
        'Why some rows expand into more detail.',
        section(
          'When sub hit rows appear',
          paragraph(
            'A skill can resolve as several hits. The calculator can show a grouped parent row and then sub hit rows when the hit structure is meaningfully more detailed than one single strike.'
          ),
          definitions(
            ['Sub hit row', 'A lower level hit breakdown under a grouped result.'],
            ['Grouped row', 'A parent row that represents the combined output of several sub hits or several related rows.'],
            ['Breakdown row', 'A summary split such as skill type contribution or teammate contribution.']
          ),
          note('If a row has only one hit with count 1, sub hit rows are usually suppressed because there is nothing useful to decompose.'),
        ),
      ),
      article(
        'damage-formula-reading',
        'Formula Reading Guide',
        'How to follow the detailed formula view from top to bottom.',
        section(
          'Reading order',
          paragraph(
            'The formula panel is there to explain the path to the number. Read it in stages: base stat scaling, skill multiplier or hit multiplier, additive flats, then defense or resistance resolution, then outgoing bonus layers such as damage bonus, amplify, vulnerability, and crit.'
          ),
          formula(
            [
              'base ability = finalAtk x atkScale + finalHp x hpScale + finalDef x defScale + finalER x erScale',
              'row normal = (base ability x hit multiplier + flat damage) x defense x resistance x outgoing modifiers',
              'row crit = normal x crit damage',
            ],
            'Specialized rows such as tune rupture or negative effects use their own dedicated branch, but the panel still follows a base then modifier reading order.',
          ),
          warningList(
            'If a modifier is absent from the formula panel, that row did not use it in the resolved context.',
            'A visible stat in Overview does not guarantee that every skill row consumes it.',
            'Formula panels explain one selected row, not the whole build at once.'
          ),
        ),
      ),
      article(
        'damage-rotation-summary-interpretation',
        'Rotation Summary Interpretation',
        'How the result page totals should be read when rotations are involved.',
        section(
          'Loop aware summary reading',
          paragraph(
            'Rotation summary totals are derived from the simulated entries, but loop aware summary surfaces normalize repeated loop rows by configured run counts before adding them together. This is why a repeated loop window can behave like an average contribution rather than a raw unqualified sum.'
          ),
          example(
            'Loop window plus finisher',
            [
              'A looped skill runs 3 times and averages 40,000 per run.',
              'A finisher outside the loop averages 120,000.',
            ],
            [
              'The summary reads as 40,000 from the loop window plus 120,000 from the finisher, not 240,000 from a raw three run sum.',
            ],
            [
              'Use inspection views when you need per run detail. Use totals when you need representative contribution inside the rotation summary.',
            ],
          ),
          comparison(
            'Personal rotation',
            'Team rotation',
            ['Who is counted', 'Active resonator only', 'Active resonator plus enabled teammate links'],
            ['Breakdown emphasis', 'Skill family contribution', 'Contributor share and combined family contribution']
          ),
        ),
      ),
      article(
        'damage-healing-shield-and-specialized-rows',
        'Healing, Shield, Tune, and Specialized Rows',
        'How non standard rows differ from direct damage rows.',
        section(
          'Support and specialized output',
          paragraph(
            'Healing and shield rows are not just recolored damage rows. They use dedicated formula branches and are summarized in separate aggregation buckets. Tune rupture and negative effect rows also use specialized computation paths.'
          ),
          definitions(
            ['Healing row', 'A support row resolved through healing bonus paths. Its meaningful number is its average value.'],
            ['Shield row', 'A support row resolved through shield bonus paths. Its meaningful number is its average value.'],
            ['Tune rupture row', 'A specialized row that uses tune rupture scaling, enemy class data, vulnerability, amplify, and tune break boost.'],
            ['Negative effect row', 'A specialized row that reads the relevant enemy side negative effect state and that effect family specific logic.']
          ),
          note('Healing and shield summaries are shown in their own support rows because the main damage total stays damage only.'),
        ),
      ),
    ],
  },
  {
    id: 'scoring-and-stat-weights',
    title: 'Scoring and Stat Weights',
    summary: 'How final stat structure, echo scores, build scores, crit value, and weight maps should be interpreted.',
    aliases: ['Build and Echo Scoring', 'Scoring'],
    articles: [
      article(
        'stats-structure-reference',
        'Stat Structure Reference',
        'How the app groups stats before they are consumed by formulas.',
        section(
          'Core stat families',
          statTable(
            ['ATK, HP, DEF', 'Each has base and final values. Final = base x (1 + percent) + flat.', 'Core scaling stats used by many direct damage, healing, and shield formulas.', 'Overview, Damage, Echoes, Custom Bonuses'],
            ['Crit Rate, Crit DMG, Energy Regen, Healing Bonus', 'Top level scalar stats on final stats.', 'Read directly by formulas that care about them.', 'Overview, Damage, Echoes, Custom Bonuses'],
            ['Attribute buckets', 'One universal all bucket plus per element buckets.', 'Element damage bonus, shred, vulnerability, crit modifiers, and similar scoped stats.', 'Overview, Damage, Custom Bonuses'],
            ['Skill type buckets', 'One universal all bucket plus per skill family buckets.', 'Family specific bonus, crit modifiers, shred, and vulnerability.', 'Overview, Damage, Custom Bonuses'],
            ['Negative effect buckets', 'Per negative effect family tracking.', 'Specialized rows such as Spectro Frazzle or Aero Erosion use these values.', 'Damage, Enemy, Rotation conditions'],
            ['Flat Damage, Amplify, DMG Bonus, DEF Ignore, DEF Shred, DMG Vulnerability, Shield Bonus, Tune Break Boost, Special', 'Top level modifier paths with their own formula entry points.', 'These are not interchangeable. They land at different points in the formula chain.', 'Overview, Damage, Custom Bonuses']
          ),
          paragraph(
            'Overview groups these stats for readability, but formulas consume them by scope. A universal all bucket and a matching element or skill type bucket can both contribute to the same row at the same time.'
          ),
        ),
      ),
      article(
        'score-vocabulary',
        'Score Vocabulary',
        'What the visible score badges actually include.',
        section(
          'Primary score terms',
          definitions(
            ['Echo score', 'A character specific score for one echo based on its primary main stat and substats compared against that character weight table.'],
            ['Build score', 'The normalized combined score of all five equipped echoes for the active resonator.'],
            ['Crit Value', 'Crit Rate x 2 plus Crit Damage. It only measures crit concentration.'],
            ['Weight table', 'The character specific priority map that tells the score model which stats matter more.']
          ),
          paragraph(
            'The score model normalizes each echo against a character specific theoretical maximum. Flat stats are intentionally discounted compared with their percent family equivalents, and the active resonator weight table decides what counts as valuable.'
          ),
        ),
      ),
      article(
        'roll-quality-and-ranges',
        'Roll Quality and Range Interpretation',
        'How to read a line value before you even care about damage.',
        section(
          'Range relative quality',
          paragraph(
            'Roll quality is about where a stat line lands inside its known range. A line near the top of its range is a stronger roll than the same stat near the bottom, even before character weights are applied.'
          ),
          example(
            'Same stat, different quality',
            [
              'Two echoes both have Crit Rate.',
              'One has a low roll near the minimum range.',
              'The other has a high roll near the maximum range.',
            ],
            [
              'Both lines are still valuable, but the second line is contributing more of the stat the build cares about.',
            ],
            [
              'Roll quality tells you how strong the line itself is. Weighting tells you how relevant that line is for this resonator.',
            ],
          ),
        ),
      ),
      article(
        'character-weights-and-relevance',
        'Stat Weights and Character Relevance',
        'Why the same echo can score differently for different resonators.',
        section(
          'Weights change the meaning of a line',
          paragraph(
            'Echo score is not a universal item level. The weight map is character specific. A stat line that is excellent for one resonator can be much less valuable for another if their target rows do not consume it well.'
          ),
          example(
            'Heavy attack line on two different resonators',
            [
              'Resonator A gets a large share of output from Heavy Attack rows.',
              'Resonator B mostly cares about healing or Resonance Skill output.',
            ],
            [
              'The same Heavy Attack line can score highly on Resonator A and only modestly on Resonator B.',
            ],
            [
              'Scores always answer "for whom?" before they answer "how good?"',
            ],
          ),
        ),
      ),
      article(
        'score-limitations',
        'Why a High Score Can Still Be Wrong',
        'What the score system is good at and what it is not.',
        section(
          'Use score as guidance, not as a universal verdict',
          bullets(
            'High echo score usually means the piece has strong relevant lines for the selected resonator.',
            'High build score does not guarantee highest output for every target skill or rotation.',
            'Crit Value can be impressive while still hiding missing Energy Regen, element bonus, healing bonus, or other critical context.',
            'A lower score piece can win in optimizer or target testing if it is better aligned with the chosen objective.'
          ),
          note('Score is strongest as a broad farming and sorting aid. Optimizer and damage results are stronger when the question is one exact target under one exact scenario.'),
        ),
      ),
    ],
  },
  {
    id: 'overview-and-build-state',
    title: 'Overview and Build State',
    summary: 'What the overview surface summarizes and how its readouts relate to the underlying runtime.',
    aliases: ['OverviewLayer', 'Overview'],
    articles: [
      article(
        'overview-surface-purpose',
        'What Overview Is Summarizing',
        'Why the overview page exists and what data it compresses.',
        section(
          'A read mostly summary surface',
          paragraph(
            'Overview is the cross section of the active build. It pulls together final stats, echo quality, rotation totals, top contributors, equipped assets, and selected profile state so you can reason about the build without opening every editing pane.'
          ),
          bullets(
            'Overview is mostly derived output.',
            'Most direct editing still happens in the dedicated resonator, weapon, echo, team, enemy, custom bonus, or rotation surfaces.',
            'If a value changes in Overview, the source change usually happened somewhere else in the runtime.'
          ),
        ),
      ),
      article(
        'overview-stat-groups',
        'Stat Groups and Summary Cards',
        'How Overview groups the final stat tree.',
        section(
          'Grouped final stats',
          paragraph(
            'Overview exposes base versus bonus versus total for core stats, then surfaces secondary percent style stats, then groups attribute and skill type damage modifiers. This keeps the final stat tree readable while still reflecting the same final stats used by formulas.'
          ),
          definitions(
            ['Base', 'The starting value before bonus layers are added.'],
            ['Bonus', 'The difference between final and base for the displayed stat.'],
            ['Total', 'The final resolved stat value consumed by formulas.']
          ),
          note('Echo Stats on the echo pane are narrower than Overview stats. Overview includes the full build context, not just echo contributions.'),
        ),
      ),
      article(
        'overview-rotation-and-profile-readouts',
        'Rotation and Profile Readouts',
        'How build identity and performance snapshots appear in Overview.',
        section(
          'High level performance readouts',
          bullets(
            'Personal rotation and team rotation badges summarize the current simulation state for the selected profile.',
            'Top skill type and top contributor summaries are there to show where output is concentrated.',
            'Portrait, weapon, and echo badges help confirm that you are looking at the intended runtime and not another saved or inspected state.'
          ),
        ),
      ),
    ],
  },
  {
    id: 'saved-builds-and-presets',
    title: 'Saved Builds and Presets',
    summary: 'How saved echoes, saved builds, and saved rotations are stored, matched, renamed, loaded, and removed.',
    aliases: ['Build Presets', 'Inventory Builds'],
    articles: [
      article(
        'saved-record-types',
        'Saved Record Types',
        'What each saved record family stores.',
        section(
          'Three different saved families',
          definitions(
            ['Saved echo', 'One reusable echo inventory entry.'],
            ['Saved build', 'A snapshot of weapon plus five echoes for one resonator.'],
            ['Saved rotation', 'A persisted rotation entry with authored nodes, metadata, and optional summary or snapshot fields.']
          ),
          comparison(
            'Saved build',
            'Saved rotation',
            ['Primary purpose', 'Restore a full equipment snapshot', 'Restore a full authored rotation snapshot'],
            ['Key payload', 'Weapon plus echo loadout', 'Rotation items plus mode, duration, note, team, and optional summary']
          ),
        ),
      ),
      article(
        'saved-live-matching-and-usage',
        'Live Matching and Usage Labels',
        'How saved records relate to current state.',
        section(
          'Matching the current build',
          paragraph(
            'Saved builds can be marked Live when their snapshot matches the current weapon and echo snapshot. That match is based on the actual build payload, not only on the saved name.'
          ),
          bullets(
            'Usage labels help show where an inventory echo or build is already being referenced.',
            'A saved record being marked Live does not mean it is locked. It only means the current runtime matches it right now.',
            'Changing the live build after that point breaks the match until the live state lines up again.'
          ),
        ),
      ),
      article(
        'saved-load-overwrite-and-delete',
        'Load, Overwrite, Rename, and Delete Semantics',
        'What happens when you act on a saved record.',
        section(
          'State changing actions',
          warningList(
            'Loading a saved build or rotation overwrites the current active state for that surface.',
            'Renaming changes metadata only. It does not rewrite the build or rotation payload.',
            'Deleting removes the saved record. It does not automatically delete unrelated live state that happened to match it.'
          ),
          note('Saved records are persistence tools. They are meant to be loaded back into live state when you want that snapshot again.'),
        ),
      ),
    ],
  },
  {
    id: 'import-export-and-sync',
    title: 'Import, Export, and Sync',
    summary: 'How image import, JSON import and export, legacy backup conversion, and Google Drive snapshot sync behave.',
    aliases: ['Import/Export', 'Sync'],
    articles: [
      article(
        'import-echo-parser',
        'Echo Image Import',
        'What the screenshot parser can import and what it cannot.',
        section(
          'Parser scope',
          paragraph(
            'The image parser only imports echoes. It does not import the rest of the build. This makes it safe to use when you only want to capture echo instances without touching weapon, enemy, or rotation state.'
          ),
          image(
            '/assets/sample-import-image.png',
            'Sample echo import format used by the image parser',
            'The parser expects the same image format shown in the built in sample.',
          ),
          warningList(
            'The image size (must be 1920 x 1080).',
            'The image itself. The parser is tuned for the expected Wuwa bot style export and works best with English text.',
          ),
        ),
      ),
      article(
        'import-rotation-json-and-legacy-backups',
        'Rotation JSON and Legacy Backup Import',
        'What each JSON import path moves.',
        section(
          'Different JSON paths carry different payloads',
          comparison(
            'Rotation JSON import',
            'Legacy backup import',
            ['Main payload', 'Saved rotation entries', 'Old app snapshot conversion'],
            ['Typical result', 'Adds normalized saved rotations with fresh ids', 'Builds a current persisted app snapshot from legacy data'],
            ['What it includes', 'Rotation items, metadata, optional snapshot and summary', 'Profiles, enemy, inventory echoes, inventory builds, and suggestion state'],
            ['What it does not currently include', 'Unrelated calculator state', 'Saved rotations are not imported in the current legacy app state path']
          ),
          note('Legacy import is a conversion path, not a literal byte for byte restore. The old payload is translated into the current persisted state schema.'),
        ),
      ),
      article(
        'sync-local-and-google-drive',
        'Local Persistence and Google Drive Backup',
        'How saved calculator state is stored and restored.',
        section(
          'Snapshot behavior',
          paragraph(
            'The app persists separate domain slices locally for layout, session, profiles, optimizer context, suggestions, inventory echoes, inventory builds, and inventory rotations. Google Drive sync uploads the current persisted snapshot into the appData folder and restore downloads the newest stored snapshot.'
          ),
          bullets(
            'Drive backup keeps the newest 10 snapshots by pruning older files.',
            'Restore reads the latest available Drive snapshot, not an arbitrary earlier file.',
            'Drive sync uses the connected Google account, the Drive appData scope, and the lightweight Google identity data needed to keep that session attached to the right account.',
            'A restored snapshot replaces current persisted state with the imported snapshot once it is accepted.'
          ),
        ),
      ),
    ],
  },
  {
    id: 'app-behavior-and-controls',
    title: 'App Behavior and Controls',
    summary: 'Shared interaction rules around persistence, history, confirmations, toasts, and selection mode.',
    aliases: ['UI Controls', 'App Controls'],
    articles: [
      article(
        'app-persistence-model',
        'Persistence Model',
        'Which major app surfaces keep durable state.',
        section(
          'Durable versus transient',
          paragraph(
            'The app persists layout preferences, session state, resonator profiles, optimizer context, suggestions state, and inventory collections as separate local slices. Results, previews, and many temporary modal states are transient and are rebuilt from persisted state or current runtime when needed.'
          ),
          bullets(
            'Inventory echoes, builds, and rotations are durable collections.',
            'The active session and selected enemy are durable session state.',
            'Suggestion settings and optimizer context persist so those surfaces can resume from previous work.',
            'A preview panel or inspection view is usually transient and can be rebuilt.'
          ),
        ),
      ),
      article(
        'app-selection-confirmations-and-toasts',
        'Selection Mode, Confirmations, and Toasts',
        'How the app communicates state changing actions.',
        section(
          'Interaction patterns',
          paragraph(
            'Shared selection mode lets some dense surfaces switch from one item actions to batch actions. Confirmation modals are used for destructive or overwrite style operations. Toasts are used for non blocking status such as copy, paste, import, save, or apply results.'
          ),
          definitions(
            ['Selection mode', 'A temporary interaction mode where clicks target selected items and batch actions instead of normal single item actions.'],
            ['Confirmation modal', 'A blocking prompt used before destructive or large overwrite style actions.'],
            ['Toast', 'A short notification confirming that a non blocking action succeeded, failed, or needs attention.']
          ),
          note('If the app asks for confirmation, it is usually because the next action would overwrite or delete meaningful state.'),
        ),
      ),
      article(
        'app-history-and-restore-behavior',
        'History, Undo, and Restore Behavior',
        'How history works when it is enabled.',
        section(
          'History rules',
          paragraph(
            'App History stores labeled persisted snapshots so undo and redo can restore earlier calculator state. Labels are built from the kind of change that happened, such as Equipped Echoes, Weapon, Team Setup, Rotation, Suggestions, or Inventory collections.'
          ),
          bullets(
            'Undo and redo are only available while history is enabled.',
            'Turning history off clears past and future stacks instead of keeping stale restore points.',
            'History capacity is bounded, so older entries are trimmed when the stack exceeds the selected size.',
            'Restore is snapshot based. Undoing one change can revert several visible surfaces if they were part of the same recorded state change.'
          ),
        ),
      ),
    ],
  },
]
