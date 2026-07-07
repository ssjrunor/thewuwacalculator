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
    summary: 'Set the active character, progression, sequence, traces, and visible kit state.',
    aliases: ['Resonator', 'Characters', 'Character'],
    articles: [
      article(
        'resonator-progression-and-kit-state',
        'Progression and Kit State',
        'Set the character-side values that damage, rotations, teams, suggestions, and optimizer runs read.',
        section(
          'Edit the active runtime',
          steps(
            ['Pick a resonator', 'Open the resonator pane and choose the character to edit. This changes the character attached to the live build.'],
            ['Set progression', 'Set level, skill levels, resonance chain, and trace nodes from the visible controls.'],
            ['Set kit state', 'Use any mode, stack, and status controls shown for that resonator. These values become part of the live scenario.'],
            ['Review dependent panes', 'Damage rows, rotation output, team summaries, suggestions, and optimizer baselines read the same live runtime.']
          ),
          definitions(
            ['Runtime', 'The current build, character state, team state, enemy state, and manual state used for calculations.'],
            ['Trace node', 'A passive progression node that adds stats or enables a kit effect.'],
            ['Kit state', 'A visible resonator-owned mode, stack, toggle, or status value.']
          ),
        ),
      ),
      article(
        'resonator-max-button',
        'The Max Button',
        'Fill the visible resonator progression controls to their authored high state.',
        section(
          'What Max changes',
          bullets(
            'Sets level to 90.',
            'Sets skill levels to 10.',
            'Turns available trace nodes on.',
            'Sets supported kit controls to their authored high state for the current sequence.',
            'Keeps mutually exclusive mode groups as a single active choice.'
          ),
          paragraph(
            'Max writes real live state. Edit any field after pressing it to model a lower level, lower skill level, different mode, or different stack state.'
          ),
        ),
      ),
    ],
  },
  {
    id: 'rotations',
    title: 'Rotations',
    summary: 'Author feature rows, state changes, repeats, loops, uptime blocks, and read the computed output.',
    aliases: ['Rotations', 'Rotation'],
    articles: [
      article(
        'rotation-mental-model',
        'Draft Versus Result',
        'Separate the rotation you edit from the output produced by the simulator.',
        section(
          'Two layers',
          comparison(
            'Draft',
            'Result',
            ['Stores', 'Nodes, order, enabled state, loop markers, repeat counts, uptime weights, and when rules', 'Damage, healing, shield, tune, status, and contribution rows'],
            ['Changes when', 'You edit the rotation tree', 'The tree or shared combat state changes'],
            ['Saved by', 'Saved rotations and rotation imports', 'Rotation summaries, result views, and preview panels']
          ),
          definitions(
            ['Node', 'One editable entry in the rotation tree.'],
            ['Execution trace', 'The ordered output produced after the simulator runs the tree.'],
            ['Combat state', 'Build stats, team effects, enemy profile, set state, manual buffs, and temporary rotation state.']
          ),
        ),
      ),
      article(
        'rotation-node-types',
        'Choose the Right Node Type',
        'Pick the block that matches the action you are trying to model.',
        section(
          'Node roles',
          definitions(
            ['Feature', 'Runs one skill, echo, support action, tune action, healing entry, shield entry, or other authored feature.'],
            ['Condition', 'Changes runtime state without creating its own damage row.'],
            ['Repeat', 'Runs its child nodes a fixed number of times.'],
            ['Uptime', 'Runs its child nodes under a weighted contribution ratio.'],
            ['Loop start and end', 'Creates named loop context with run numbers for nodes inside the loop.']
          ),
          steps(
            ['Add output with Feature', 'Select the feature kind, then choose the skill or action from the feature picker.'],
            ['Add setup with Condition', 'Place the condition before the feature rows that need the state change.'],
            ['Compact repeated actions with Repeat', 'Put the repeated nodes inside the repeat block and set the count.'],
            ['Model a phase with Loop', 'Wrap the phase in matching loop markers and set the run count on the loop.']
          ),
        ),
      ),
      article(
        'rotation-loops-and-iteration-semantics',
        'Use Loops Without Misreading Totals',
        'Create loop windows, target individual runs, and read loop-aware totals.',
        section(
          'Loop authoring',
          definitions(
            ['Loop id', 'The name that connects the start marker, end marker, run rules, and loop summaries.'],
            ['Run count', 'The number of passes the loop executes.'],
            ['Run number', 'The current pass while nodes inside the loop are executing.'],
          ),
          image(
            '/assets/guides/loop-forward.png',
            'Forward loop boundary example in the rotation editor',
            'Forward loop. The end marker appears after the start marker, so the loop body is the range between them.'
          ),
          image(
            '/assets/guides/loop-wrap-end.png',
            'Wrap end loop boundary example in the rotation editor',
            'Wrap end loop. The end marker appears before the start marker in the same list, so the body wraps across the list boundary.'
          ),
          image(
            '/assets/guides/loop-wrap-start.png',
            'Wrap start loop boundary example in the rotation editor',
            'Wrap start loop. There is no end marker, so the loop starts at the start marker and continues until execution returns to it.'
          ),
          steps(
            ['Add the loop markers', 'Insert a loop start and matching loop end around the nodes that repeat.'],
            ['Set the run count', 'Edit the loop count on the marker control.'],
            ['Target a run', 'Open a node when rule and select the loop id plus run number.'],
            ['Read the total', 'Loop-aware summary rows average repeated loop bodies by the configured run count. Raw inspection still shows the executed rows.']
          ),
        ),
      ),
      article(
        'rotation-repeat-and-uptime',
        'Repeat, Uptime, and Weighting',
        'Choose direct duplication or weighted contribution.',
        section(
          'Repeat compared with uptime',
          comparison(
            'Repeat',
            'Uptime',
            ['What it does', 'Executes child nodes multiple times', 'Executes child nodes under a contribution ratio'],
            ['Control', 'Count', 'Percent or ratio'],
            ['Output', 'Repeated rows enter the trace', 'Weighted rows enter totals with scaled contribution'],
            ['Common control location', 'Rotation tree repeat node', 'Rotation tree uptime node']
          ),
          steps(
            ['Set repeat count', 'Use Repeat for actions that happen more than once in the authored sequence.'],
            ['Set uptime ratio', 'Use Uptime for actions or effects that occupy only part of the measured window.'],
            ['Place setup first', 'Put setup nodes before the repeated or weighted feature rows that need them.']
          ),
        ),
      ),
      article(
        'rotation-conditions-and-when-rules',
        'Conditions and When Rules',
        'Apply state changes and restrict rows to the intended execution window.',
        section(
          'Condition controls',
          definitions(
            ['Condition node', 'A visible state change in the rotation tree.'],
            ['Feature condition', 'A state change attached directly to one feature row.'],
            ['When rule', 'A filter that lets a node run only in selected loop runs or selected execution context.'],
            ['Runtime path', 'The internal state field changed by a condition. Labels on the control describe the user-facing state.']
          ),
          steps(
            ['Add a condition node', 'Place it before every feature row that needs the changed state.'],
            ['Attach a feature condition', 'Open the feature row and add local setup when only that row needs the change.'],
            ['Set a when rule', 'Select the loop id and run range that the node belongs to.'],
            ['Inspect the row', 'Open the computed row details to confirm the active state used for that feature.']
          ),
        ),
      ),
      article(
        'rotation-live-saved-and-team-state',
        'Live, Saved, and Team Rotation State',
        'Load rotations without mixing up the editor, saved records, and teammate links.',
        section(
          'Rotation locations',
          definitions(
            ['Live rotation', 'The rotation currently attached to the active resonator in the calculator.'],
            ['Saved rotation', 'A stored rotation record that can be loaded back into live state.'],
            ['Team rotation link', 'A teammate rotation selected by the team pane for team contribution calculations.'],
            ['Imported rotation', 'A rotation loaded from a JSON payload or older backup format.']
          ),
          steps(
            ['Edit live state', 'Change nodes in the rotation pane to change the active resonator rotation.'],
            ['Save a copy', 'Save the current rotation before loading another record if the current draft needs to stay available.'],
            ['Load a record', 'Loading replaces the live rotation for the selected resonator.'],
            ['Set teammate links', 'Open team configuration and choose which saved or live teammate rotation contributes to team summaries.']
          ),
        ),
      ),
      article(
        'rotation-totals-and-breakdown-rows',
        'Read Rotation Totals and Breakdowns',
        'Interpret summary rows, contribution rows, and support rows from the computed trace.',
        section(
          'Displayed output',
          definitions(
            ['Normal', 'Damage with no critical hit applied.'],
            ['Crit', 'Damage when the row crits.'],
            ['Average', 'Expected damage after crit rate and crit damage are applied.'],
            ['Contribution row', 'A grouped row showing how much a skill family, source, teammate, or loop section adds to the total.'],
            ['Support row', 'Healing, shield, tune, or status output tracked outside the main damage total.']
          ),
          steps(
            ['Read top totals first', 'Start with the total and average columns for the full simulated rotation.'],
            ['Open breakdown rows', 'Expand skill, source, teammate, and loop rows to see where the total comes from.'],
            ['Compare loop summaries carefully', 'Loop-aware totals show repeated windows as averaged contribution; raw row details still show each executed entry.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'echoes',
    title: 'Echoes',
    summary: 'Equip echo instances, set stats, choose the main echo, and manage set conditionals.',
    aliases: ['Echo', 'Echoes'],
    articles: [
      article(
        'echo-loadout-rules',
        'Loadout Rules and Slot Roles',
        'Fill the five active echo slots and understand what each slot controls.',
        section(
          'Active loadout',
          definitions(
            ['Slot', 'One of the five equipped echo positions on the active build.'],
            ['Cost', 'The echo cost value used by loadout validation and set planning.'],
            ['Main echo', 'The equipped echo whose active echo skill is selected for echo-skill features and main echo effects.'],
            ['Sonata set', 'The set id on each echo. Two-piece, three-piece, and five-piece logic reads these ids.']
          ),
          steps(
            ['Equip an echo', 'Choose an echo instance for an empty slot or replace the current slot item.'],
            ['Set cost and set', 'Pick the echo identity and sonata set shown on that slot.'],
            ['Choose main echo', 'Mark the intended echo as the main echo when the active echo skill matters.'],
            ['Check validation text', 'Read any cost, duplicate, or set messages shown by the pane.']
          ),
        ),
      ),
      article(
        'echo-instance-identity',
        'Echo Instance Identity and Inventory State',
        'Track the difference between a catalog echo and the actual item in your bag.',
        section(
          'Instance fields',
          definitions(
            ['Catalog echo', 'The base game echo identity: name, cost, element, image, and possible main stats.'],
            ['Echo instance', 'One owned item with a selected set, main stat, substats, level, and tuning state.'],
            ['Inventory owner', 'The build or bag location currently holding the instance.'],
            ['Duplicate identity', 'Two items may share the same catalog echo while still being different instances.']
          ),
          steps(
            ['Edit the equipped instance', 'Changes to level, stat rolls, set, and main stat apply to the actual equipped item.'],
            ['Move items through inventory actions', 'Use equip, unequip, replace, and inventory modal actions to control where the instance is stored.'],
            ['Check ownership labels', 'Inventory labels show whether an item is equipped, available, or tied to another build.']
          ),
        ),
      ),
      article(
        'echo-main-stats-and-substats',
        'Main Stats, Substats, and Roll Interpretation',
        'Set the stat lines that feed build totals and echo scoring.',
        section(
          'Stat controls',
          definitions(
            ['Main stat', 'The primary stat line on the echo. The available list depends on echo cost and slot rules.'],
            ['Substat', 'A secondary roll line on the echo. Each substat has a stat type and value.'],
            ['Roll value', 'The numeric value on the substat row.'],
            ['CV', 'Crit Value. In the app it is shown as crit rate times two plus crit damage.']
          ),
          steps(
            ['Select main stat', 'Choose the stat from the slot main-stat picker.'],
            ['Add substats', 'Fill each roll row with the stat kind and value.'],
            ['Use normalized labels', 'Element and skill-family labels use game-facing names when available.'],
            ['Read totals', 'Echo stat totals update the active build immediately.']
          ),
        ),
      ),
      article(
        'echo-main-echo-and-sets',
        'Main Echo Effects and Sonata Sets',
        'Control which echo skill and set effects the build can read.',
        section(
          'Echo skill and set state',
          definitions(
            ['Main echo skill', 'The active echo action available to rotation feature rows.'],
            ['Two-piece set', 'A set effect active when at least two equipped echoes share the set id.'],
            ['Three-piece set', 'A set effect active when at least three equipped echoes share the set id.'],
            ['Five-piece set', 'A set effect active when all five equipped echoes share the set id.'],
            ['Set conditional', 'A visible control for a set effect whose state, stacks, or mode is not automatic.']
          ),
          steps(
            ['Assign the main echo', 'Set the main echo marker on the equipped echo that supplies the active echo skill.'],
            ['Build set counts', 'Equip echoes with matching sonata set ids to activate the intended set parts.'],
            ['Open set conditionals', 'Turn on stack or mode controls for set effects that expose configurable state.']
          ),
        ),
      ),
      article(
        'echo-quick-setup',
        'Quick Setup Forge',
        'Generate a full equipped echo loadout from selected constraints.',
        section(
          'Forge flow',
          steps(
            ['Open Quick Setup', 'Start from the echo pane quick setup action.'],
            ['Choose set plan', 'Select the sonata set arrangement the generated loadout will use.'],
            ['Choose main stats', 'Pick the main stat pattern for each cost slot.'],
            ['Generate', 'The forge writes real echo instances into the active build.'],
            ['Edit after generation', 'Adjust level, set, main stat, substats, and main echo status from the normal echo controls.']
          ),
          definitions(
            ['Generated instance', 'A new equipped item created by Quick Setup.'],
            ['Set plan', 'The requested distribution of sonata set ids across the five slots.']
          ),
        ),
      ),
      article(
        'echo-surface-totals-and-scores',
        'Echo Stats, CV, and Surface Totals',
        'Read the echo-only totals shown by the echo pane.',
        section(
          'Echo pane numbers',
          definitions(
            ['Echo stats', 'The stat contribution from equipped echoes before non-echo build context is added.'],
            ['Surface total', 'A summary value shown on the echo pane for the current equipped loadout.'],
            ['Score', 'The app score assigned by the active scoring table and current target context.'],
            ['CV', 'Crit rate times two plus crit damage from the echo stat lines.']
          ),
          comparison(
            'Echo pane',
            'Full build output',
            ['Stat source', 'Equipped echo instances', 'Character, weapon, echoes, team, enemy, and manual state'],
            ['Purpose', 'Inspect echo loadout state', 'Read the complete scenario result'],
            ['Changes from teammate state', 'No direct teammate totals', 'Yes, when team effects are active']
          ),
        ),
      ),
      article(
        'echo-set-conditionals',
        'Set Effect Conditionals',
        'Set stacks and modes for sonata effects that expose configurable state.',
        section(
          'Conditional controls',
          steps(
            ['Open the set conditional panel', 'Use the set conditional controls from the echo or build state surface.'],
            ['Select the set part', 'Choose the set effect part shown for the active equipped sets.'],
            ['Set stacks or mode', 'Use the visible input, select, or toggle for that effect.'],
            ['Recheck affected output', 'Damage rows, suggestions, optimizer baselines, and summaries read the updated set state.']
          ),
          definitions(
            ['Automatic set effect', 'A set effect active from equipped set counts with no extra user control.'],
            ['Configurable set effect', 'A set effect that needs a visible stack, mode, or on/off state.'],
            ['Part', 'The two-piece, three-piece, or five-piece portion of the set definition.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'suggestions',
    title: 'Suggestions',
    summary: 'Rank main stats, set plans, weapons, substats, and generated echoes against the selected target.',
    aliases: ['Suggestions', 'Suggestion'],
    articles: [
      article(
        'suggestion-target-model',
        'Pick the Right Target',
        'Choose the row or rotation that suggestion lists rank against.',
        section(
          'Target controls',
          definitions(
            ['Target skill', 'One selected feature row or skill family used as the ranking objective.'],
            ['Rotation target', 'A full rotation output used as the ranking objective.'],
            ['Current build baseline', 'The live build state used as the starting point before a candidate change is tested.'],
            ['Candidate', 'One generated main-stat plan, set plan, weapon, substat pattern, or echo loadout being ranked.']
          ),
          steps(
            ['Select the target', 'Pick the target row, skill, or rotation from the suggestion surface controls.'],
            ['Set list options', 'Adjust rarity, set, rank, generation, or filter controls for the suggestion type.'],
            ['Run or refresh', 'Use the surface action to rebuild the ranking after changing target or options.'],
            ['Inspect a row', 'Open a candidate row to see the candidate state and score or damage comparison.']
          ),
        ),
      ),
      article(
        'suggestions-main-stat-recipes',
        'Main Stat Suggestions',
        'Rank echo main-stat combinations for the current target.',
        section(
          'Reading the list',
          definitions(
            ['Recipe', 'A five-slot main-stat pattern.'],
            ['Locked slot', 'A slot kept at its current main stat while recipes are generated.'],
            ['Delta', 'The candidate result compared with the current build baseline.'],
            ['Rank row', 'One candidate recipe sorted by the selected objective.']
          ),
          steps(
            ['Choose slot rules', 'Lock or unlock slots from the recipe controls.'],
            ['Pick target', 'Select the target skill or rotation.'],
            ['Review ranked recipes', 'Read the sorted rows and open a candidate to inspect its main-stat pattern.'],
            ['Apply a recipe', 'Use the apply action to write selected main stats to the active echo slots.']
          ),
        ),
      ),
      article(
        'suggestions-set-plans',
        'Set Plan Suggestions',
        'Rank sonata set distributions for the equipped slots.',
        section(
          'Plan controls',
          definitions(
            ['Set plan', 'A proposed sonata set assignment across the five equipped slots.'],
            ['Active set parts', 'The two-piece, three-piece, and five-piece effects created by the candidate plan.'],
            ['Current plan', 'The set ids currently equipped on the active build.']
          ),
          steps(
            ['Select allowed sets', 'Choose which sonata sets can appear in generated plans.'],
            ['Set target', 'Pick the skill or rotation objective.'],
            ['Read candidates', 'Compare the ranked set plans and their score or damage deltas.'],
            ['Apply plan', 'Write the selected set ids onto the equipped echo instances.']
          ),
        ),
      ),
      article(
        'suggestions-weapons',
        'Weapon Suggestions',
        'Rank weapons and ranks for the current target.',
        section(
          'Weapon list controls',
          definitions(
            ['Rank', 'The weapon passive rank used for evaluation.'],
            ['Rarity row', 'A filter and rank control group for weapons of the same rarity or source group.'],
            ['Passive state', 'Any weapon-owned stack, mode, or toggle exposed by the app for evaluation.'],
            ['Inspect', 'The row action that opens the candidate weapon details before applying it.']
          ),
          steps(
            ['Choose rarity visibility', 'Turn weapon rarity groups on or off from the list controls.'],
            ['Set ranks', 'Select the rank value for each group.'],
            ['Set passive controls', 'Adjust visible weapon state controls for the candidates.'],
            ['Inspect and apply', 'Open a row to review it, then apply to equip the weapon and selected rank.']
          ),
        ),
      ),
      article(
        'suggestions-substat-priority',
        'Substat Priority',
        'Read which substats move the selected target the most from the current build.',
        section(
          'Priority tables',
          definitions(
            ['Gain table', 'Shows the expected change from adding more of a substat family.'],
            ['Current value table', 'Shows the value already present on the current build.'],
            ['Roll chunk', 'The stat increment used by the table when comparing one substat family with another.'],
            ['Reserved stat', 'A stat the model keeps available for required Energy Regen or similar target needs.']
          ),
          steps(
            ['Select target', 'Pick the target skill or rotation.'],
            ['Read top rows', 'Higher rows show stronger next-roll direction for the selected target.'],
            ['Compare current value', 'Use the current value table to see which existing rolls are carrying the build.'],
            ['Change target to rerank', 'Switching from one skill to a full rotation can change the table order.']
          ),
        ),
      ),
      article(
        'suggestions-random-generation',
        'Random Echo Generation',
        'Generate and rank random echo loadouts under selected rules.',
        section(
          'Generation controls',
          definitions(
            ['Batch', 'A group of generated loadouts evaluated together.'],
            ['Generation rule', 'A selected limit for sets, main stats, costs, or stat families.'],
            ['Candidate loadout', 'A complete generated five-echo build.'],
            ['Apply generated', 'The action that writes the candidate loadout to the active build.']
          ),
          steps(
            ['Set generation rules', 'Choose the allowed sets, main stats, and other limits shown by the surface.'],
            ['Run generation', 'Start the generator and wait for ranked candidates.'],
            ['Inspect a candidate', 'Open the candidate details to review its five echoes and score.'],
            ['Apply selected loadout', 'Write the candidate echoes into the active build from the row action.']
          ),
        ),
      ),
      article(
        'suggestions-inspect-and-apply',
        'Inspect and Apply',
        'Move a ranked suggestion into the active build after reviewing the row.',
        section(
          'Row actions',
          definitions(
            ['Preview', 'A candidate view that shows the state before it is written to the build.'],
            ['Apply', 'Writes the candidate change to the active live build.'],
            ['Delta', 'The difference between the current build baseline and the candidate evaluation.'],
            ['Baseline', 'The state of the build before the candidate is applied.']
          ),
          steps(
            ['Open the row', 'Inspect the candidate details from the ranked list.'],
            ['Check what changes', 'Review the displayed weapon, echo, set, or stat fields that will be written.'],
            ['Apply deliberately', 'Use the row apply action only for the candidate you want on the live build.'],
            ['Save after applying', 'Create a saved record if the updated build needs to be kept as a reusable snapshot.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'benchmark',
    title: 'Benchmark',
    summary: 'Refresh the benchmark report, read target comparisons, and use the showcase view.',
    aliases: ['Benchmark', 'Build Benchmark', 'Showcase'],
    articles: [
      article(
        'benchmark-report',
        'Benchmark Report',
        'Read the current build against generated benchmark targets.',
        section(
          'Report sections',
          definitions(
            ['Current build', 'The live build being measured.'],
            ['100 percent target', 'The generated target build used as the lower benchmark comparison.'],
            ['200 percent target', 'The generated target build used as the higher benchmark comparison.'],
            ['Per-step change', 'The table showing how one stat increment changes the selected target.'],
            ['Current build state', 'The table showing how current stat investment is valued by the selected target.']
          ),
          steps(
            ['Open Benchmark', 'Navigate to the benchmark route for the active build.'],
            ['Refresh the report', 'Use refresh after changing the build, target, or benchmark settings.'],
            ['Compare target cards', 'Read current, 100 percent, and 200 percent cards side by side.'],
            ['Read stat tables', 'Use per-step rows for next-stat direction and current-state rows for existing investment.']
          ),
        ),
      ),
      article(
        'showcase-view',
        'Showcase View',
        'Create a presentation card from the current benchmark context.',
        section(
          'Showcase controls',
          definitions(
            ['Showcase card', 'The presentation view built from the selected resonator, build, stats, and benchmark context.'],
            ['Card preset', 'A saved visual layout and style set for the card.'],
            ['Export', 'The action that copies or downloads the rendered card.']
          ),
          steps(
            ['Open Showcase', 'Switch from the benchmark route into the showcase view.'],
            ['Choose card settings', 'Select the visual preset, visible stat groups, and any card options shown.'],
            ['Review displayed data', 'Check the resonator, weapon, echo, stat, and benchmark fields on the card.'],
            ['Export the card', 'Use copy or download from the showcase actions.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'optimizer',
    title: 'Optimizer',
    summary: 'Select search scope, objective, constraints, engine path, and apply the result you choose.',
    aliases: ['Optimizer', 'Optimize'],
    articles: [
      article(
        'optimizer-search-space',
        'Choose What the Optimizer Can Use',
        'Define which echoes, weapons, and slots the optimizer may search.',
        section(
          'Search inputs',
          definitions(
            ['Inventory search', 'Uses echo instances from your bag under the selected filters.'],
            ['Theory mode', 'Uses generated stat arrangements based on the active build and theory settings.'],
            ['Include weapon', 'Adds weapon candidates to the search instead of keeping the current weapon fixed.'],
            ['Locked slot', 'Keeps a slot fixed while other slots are searched.'],
            ['Exclude equipped', 'Removes echoes already equipped on other builds from the candidate pool.']
          ),
          steps(
            ['Choose mode', 'Select inventory search or theory mode from the optimizer controls.'],
            ['Set inventory filters', 'Pick included sets, costs, locked slots, equipped handling, and candidate limits.'],
            ['Set weapon inclusion', 'Turn weapon inclusion on only when weapon candidates need to be ranked with echo candidates.'],
            ['Start search', 'Run the optimizer after search scope and objective controls are set.']
          ),
        ),
      ),
      article(
        'optimizer-targets-and-objectives',
        'Pick the Right Objective',
        'Tell the optimizer which result the candidates are ranked by.',
        section(
          'Objective controls',
          definitions(
            ['Skill objective', 'Ranks candidates by one selected feature or skill result.'],
            ['Rotation objective', 'Ranks candidates by full rotation output.'],
            ['Combo objective', 'Ranks candidates by the configured combined target rows.'],
            ['Base row', 'The live-build row shown beside optimizer results for comparison.']
          ),
          steps(
            ['Select objective type', 'Choose skill, rotation, or combo from the objective controls.'],
            ['Pick target rows', 'Select the skill row, rotation, or combo entries shown for that objective.'],
            ['Review base row', 'Use the base row to compare the live build with optimizer candidates.'],
            ['Run again after target changes', 'Target changes require a new search to update result order.']
          ),
        ),
      ),
      article(
        'optimizer-constraints-and-failures',
        'Constraints, Locked State, and No Result Cases',
        'Tighten or loosen the legal candidate set.',
        section(
          'Constraint controls',
          definitions(
            ['Constraint', 'A rule that a candidate must satisfy before it can appear in results.'],
            ['Minimum stat', 'A lower bound for a stat such as Energy Regen or crit rate.'],
            ['Maximum stat', 'An upper bound for a stat.'],
            ['Locked main stat', 'A requirement that a slot keep its current main stat.'],
            ['No result', 'The optimizer could not find a candidate inside every selected rule.']
          ),
          steps(
            ['Add stat limits', 'Set minimums or maximums for required stat targets.'],
            ['Lock required state', 'Lock slots, sets, or main stats that cannot change.'],
            ['Run the search', 'The optimizer filters illegal candidates before ranking legal ones.'],
            ['Loosen rules if empty', 'Remove or widen constraints when no result appears.']
          ),
        ),
      ),
      article(
        'optimizer-result-rows',
        'Result Rows, Preview, and Apply Modes',
        'Read candidate rows and choose where a candidate is written.',
        section(
          'Result actions',
          definitions(
            ['Result row', 'One legal candidate build sorted by the selected objective.'],
            ['Preview', 'A non-written view of the candidate build and output.'],
            ['Apply to sim', 'Writes the candidate into optimizer simulation state.'],
            ['Apply to live', 'Writes the candidate into the normal calculator build state.'],
            ['Delta', 'The difference between the candidate row and the displayed base row.']
          ),
          steps(
            ['Open a result', 'Inspect the candidate echoes, weapon, stats, and output.'],
            ['Preview before writing', 'Use preview to compare without changing live state.'],
            ['Apply to sim', 'Keep experimenting in optimizer state after adopting a candidate there.'],
            ['Apply to live', 'Move the selected candidate into the active calculator build.']
          ),
        ),
      ),
      article(
        'optimizer-theorymax-mode',
        'Theorymax Mode',
        'Search generated roll arrangements instead of owned inventory items.',
        section(
          'Theory controls',
          definitions(
            ['Theory mode', 'A generated search over possible roll arrangements rather than the exact bag.'],
            ['Theory percent', 'The stat budget level used by the theory search.'],
            ['Theory slot', 'A slot included in generated theory arrangements.'],
            ['Theory weapon inclusion', 'A search mode where generated echo arrangements and weapon candidates are evaluated together.']
          ),
          steps(
            ['Turn on theory mode', 'Switch the optimizer mode before setting theory controls.'],
            ['Choose theory percent', 'Select the generated stat budget level.'],
            ['Set slot and set rules', 'Choose which slots, sets, and main stats the generated candidates may use.'],
            ['Run and compare', 'Read theory results against the live base row and any inventory-search results you want to compare manually.']
          ),
        ),
      ),
      article(
        'optimizer-cpu-and-gpu-paths',
        'Choosing CPU or GPU',
        'Select the execution path for optimizer searches.',
        section(
          'Engine controls',
          comparison(
            'CPU',
            'GPU',
            ['Where it runs', 'JavaScript worker path', 'WebGPU path when available in the browser'],
            ['Availability', 'Available broadly', 'Shown only when WebGPU support is available'],
            ['Progress', 'Reports through worker progress', 'Reports through GPU batch progress'],
            ['Fallback', 'Can run without GPU support', 'Falls back by switching to CPU controls']
          ),
          steps(
            ['Pick an engine', 'Select CPU or GPU from the optimizer engine controls.'],
            ['Start search', 'Run the optimizer with the selected search scope.'],
            ['Read progress', 'Use the progress text and result count to track the running search.'],
            ['Switch engines', 'Change engine path and rerun if browser support or search size calls for a different path.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'team-effects',
    title: 'Team Effects',
    summary: 'Enable teammate effects, configure exposed state, and link teammate rotations.',
    aliases: ['Team', 'Teams', 'Teammates'],
    articles: [
      article(
        'team-effect-sources',
        'Where Team Effects Come From',
        'Know which teammate fields can affect the active resonator.',
        section(
          'Team sources',
          definitions(
            ['Team slot', 'A teammate position configured beside the active resonator.'],
            ['Team effect', 'A buff, debuff, status, or support output supplied by a teammate.'],
            ['Source kind', 'The origin of the effect, such as resonator kit, weapon, echo, set, or manual buff.'],
            ['Target', 'The resonator or team member receiving the effect.']
          ),
          steps(
            ['Add teammate', 'Open the team pane and choose the resonator in a team slot.'],
            ['Enable effect groups', 'Turn on the teammate effect groups shown for that slot.'],
            ['Check target labels', 'Read active, self, and team labels to see who receives the effect.'],
            ['Return to results', 'Damage and summary rows update from the configured team state.']
          ),
        ),
      ),
      article(
        'team-effect-configuration',
        'Automatic Versus Configurable Effects',
        'Set teammate effect state only where a visible control exists.',
        section(
          'Effect controls',
          definitions(
            ['Automatic effect', 'An effect applied from selected teammate state with no extra control.'],
            ['Configurable effect', 'An effect with a visible rank, stack, toggle, mode, or value control.'],
            ['Effect card', 'The UI entry showing the effect label, source, target, and controls.']
          ),
          steps(
            ['Open team configuration', 'Select the teammate and effect group to edit.'],
            ['Set visible controls', 'Choose stacks, modes, ranks, and toggles on configurable effect cards.'],
            ['Leave automatic entries alone', 'Automatic entries only need their source or teammate enabled.'],
            ['Review active summaries', 'Read the team summary to confirm which effects are currently included.']
          ),
        ),
      ),
      article(
        'team-rotation-links',
        'Linked Teammate Rotations',
        'Attach teammate rotations to team contribution output.',
        section(
          'Rotation linking',
          definitions(
            ['Linked rotation', 'A live or saved rotation selected for a teammate slot.'],
            ['Team contribution', 'Output from teammate rows included in the team summary.'],
            ['Link state', 'The selected teammate rotation and whether it is enabled.']
          ),
          steps(
            ['Open the teammate slot', 'Use the team pane configuration for the teammate.'],
            ['Choose rotation source', 'Select live rotation or a saved rotation record.'],
            ['Enable the link', 'Turn on the linked rotation for team contribution output.'],
            ['Read team rows', 'Open team summaries or rotation breakdowns to see teammate contribution rows.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'enemy-and-combat-state',
    title: 'Enemy and Combat State',
    summary: 'Pick enemy profile, resistance mode, and combat-side statuses.',
    aliases: ['Enemy', 'Enemies', 'Combat'],
    articles: [
      article(
        'enemy-profile-basics',
        'Enemy Profile Basics',
        'Set the enemy level, defense, and profile used by calculations.',
        section(
          'Enemy controls',
          definitions(
            ['Enemy profile', 'The selected enemy template and its base combat fields.'],
            ['Enemy level', 'The level used by defense and mitigation calculations.'],
            ['Defense modifier', 'The enemy-side defense adjustment shown on the enemy surface.'],
            ['Combat state', 'Enemy-side status values that rows may read during calculation.']
          ),
          steps(
            ['Choose profile', 'Select the enemy from the enemy picker.'],
            ['Set level', 'Adjust enemy level from the visible level control.'],
            ['Set defense fields', 'Edit defense modifiers or tower fields shown by the surface.'],
            ['Recalculate rows', 'Damage output reads the current enemy profile immediately.']
          ),
        ),
      ),
      article(
        'enemy-resistance-and-tower-mode',
        'Resistances and Tower Mode',
        'Set element resistance and tower-style enemy fields.',
        section(
          'Resistance fields',
          definitions(
            ['Resistance', 'The enemy mitigation value for an element or damage family.'],
            ['Tower mode', 'A preset enemy configuration for tower-style scenarios.'],
            ['Profile override', 'A field changed away from the selected enemy default.']
          ),
          steps(
            ['Select enemy mode', 'Choose normal profile state or tower mode from the enemy controls.'],
            ['Edit resistances', 'Change the resistance fields that apply to the target element.'],
            ['Check override labels', 'Read any labels that show a value no longer matches the enemy default.'],
            ['Compare output', 'Return to damage rows to see the result under the selected resistance state.']
          ),
        ),
      ),
      article(
        'enemy-negative-effects-and-status',
        'Negative Effects, Tune Strain, and Specialized State',
        'Set combat statuses that specific rows may read.',
        section(
          'Status fields',
          definitions(
            ['Negative effect', 'An enemy-side status applied by a skill, echo, set, weapon, or manual entry.'],
            ['Tune strain', 'A specialized status field used by tune-related rows.'],
            ['Specialized state', 'A named combat state path surfaced only for rows that support it.']
          ),
          steps(
            ['Open status controls', 'Use the enemy or combat state panel that exposes the status.'],
            ['Set stacks or value', 'Enter the active stack count, value, or toggle state.'],
            ['Run the relevant row', 'Only rows that read that status path will change.'],
            ['Clear state', 'Return the control to its neutral value when the status is not part of the scenario.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'custom-bonuses',
    title: 'Custom Bonuses',
    summary: 'Add manual modifiers, choose scope, and import preset modifiers from game data.',
    aliases: ['Custom Buffs', 'Manual Buffs', 'Buffs', 'Bonuses'],
    articles: [
      article(
        'custom-bonus-purpose',
        'What a Custom Bonus Represents',
        'Create a manual modifier that is not already handled by a visible built-in control.',
        section(
          'Manual entry fields',
          definitions(
            ['Manual buff', 'A user-created modifier entry added to the runtime.'],
            ['Modifier', 'One stat, damage, resistance, amp, or specialized effect applied by the entry.'],
            ['Source label', 'The text used to identify where the manual entry came from.'],
            ['Enabled state', 'Whether the manual entry is currently included in calculations.']
          ),
          steps(
            ['Open custom buffs', 'Use the custom buffs surface for the active build or team context.'],
            ['Add an entry', 'Create a manual buff and name the source clearly.'],
            ['Add modifiers', 'Choose each modifier type, stat, target, and value.'],
            ['Toggle the entry', 'Turn the entry on or off from the manual buff list.']
          ),
        ),
      ),
      article(
        'custom-bonus-scope',
        'Choose the Right Buff Type',
        'Set who receives the manual modifier.',
        section(
          'Buff type labels',
          definitions(
            ['Active', 'Applies to the active resonator result being calculated.'],
            ['Self', 'Applies to the source resonator itself.'],
            ['Team', 'Applies to teammates or group-facing targets. Other specialized scopes are grouped under this label in preset browsing.']
          ),
          steps(
            ['Pick the type first', 'Choose Active, Self, or Team before adding modifiers.'],
            ['Set modifier target', 'For damage or skill-family modifiers, select the element or skill family from the modifier row.'],
            ['Review list labels', 'The manual buff row shows the target and source so the receiving side is clear.']
          ),
        ),
      ),
      article(
        'custom-bonus-presets',
        'Quick Imports with Presets',
        'Create manual buff entries from game-data preset effects.',
        section(
          'Preset catalog',
          definitions(
            ['Preset', 'A game-data buff source that can be converted into one or more manual modifiers.'],
            ['Source kind', 'The preset origin: echo, set, weapon, or resonator source.'],
            ['Buff type filter', 'The Active, Self, or Team filter in the preset modal.'],
            ['Selected effect', 'A preset modifier row selected for import.']
          ),
          steps(
            ['Open presets', 'Use the preset button in the custom buffs header.'],
            ['Filter the catalog', 'Filter by source kind, buff type, search text, or weapon rank controls shown by the modal.'],
            ['Select entries', 'Click each preset modifier row that needs to become a manual buff entry.'],
            ['Add selected', 'Confirm the modal action to create the selected manual buff entries.'],
            ['Edit after import', 'Adjust values, labels, enabled state, or scope from the manual buff list.']
          ),
        ),
      ),
      article(
        'custom-bonus-entry-review',
        'Check Manual Entries',
        'Review manual buffs after adding or importing them.',
        section(
          'Entry review',
          steps(
            ['Check duplicates', 'Look for manual entries that duplicate built-in resonator, weapon, set, echo, or team controls already enabled.'],
            ['Check value type', 'Percent modifiers and flat modifiers appear as separate modifier kinds.'],
            ['Check target family', 'Element, skill type, damage bonus, resistance, and amp fields target different calculation paths.'],
            ['Check enabled state', 'Disabled manual entries stay in the list but do not affect output.']
          ),
          definitions(
            ['Flat value', 'A direct numeric addition to the selected stat path.'],
            ['Percent value', 'A percentage modifier for the selected stat or damage path.'],
            ['Target family', 'The element, skill type, damage family, or stat path selected on a modifier row.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'damage-results',
    title: 'Damage Results',
    summary: 'Read damage rows, subhits, formulas, rotation summaries, and support output.',
    aliases: ['Damage', 'Results', 'Formulas'],
    articles: [
      article(
        'damage-result-columns',
        'Read the Main Result Columns',
        'Understand the columns on damage rows.',
        section(
          'Column meanings',
          definitions(
            ['Normal', 'Resolved damage without a critical hit.'],
            ['Crit', 'Resolved damage if the row crits.'],
            ['Average', 'Expected value using current crit rate and crit damage.'],
            ['Multiplier', 'The skill or authored multiplier used by the row.'],
            ['Hits', 'The count of hits represented by the row.']
          ),
          steps(
            ['Pick a row', 'Select the skill or feature row to inspect.'],
            ['Read Average for expected output', 'Average is the default comparison value for most ranking surfaces.'],
            ['Read Normal and Crit for range', 'Normal and Crit show the low and high crit-state result for that row.'],
            ['Open details for inputs', 'Use row details to inspect formula pieces, buffs, debuffs, and state.']
          ),
        ),
      ),
      article(
        'damage-subhits-and-grouping',
        'Sub Hits, Grouped Rows, and Breakdowns',
        'Expand compound rows into their parts.',
        section(
          'Expanded output',
          definitions(
            ['Sub hit', 'One component hit inside a compound skill row.'],
            ['Grouped row', 'A row that combines several sub hits or related parts under one displayed total.'],
            ['Breakdown', 'An expanded view showing how the total is assembled.']
          ),
          steps(
            ['Expand a grouped row', 'Open the row details or disclosure control.'],
            ['Read sub hit totals', 'Each visible sub hit shows its own normal, crit, and average values.'],
            ['Compare with parent total', 'The grouped parent row combines the expanded parts shown underneath it.']
          ),
        ),
      ),
      article(
        'damage-formula-reading',
        'Formula Reading Guide',
        'Read the visible formula breakdown for a row.',
        section(
          'Formula pieces',
          definitions(
            ['Base stat', 'The stat used as the starting value, such as ATK, HP, DEF, or a converted stat.'],
            ['Scaling', 'The skill multiplier or authored scaling value.'],
            ['Bonus', 'Damage bonus and related additive modifier groups.'],
            ['Amplify', 'Multiplicative modifier groups applied after additive bonus groups.'],
            ['Enemy mitigation', 'Defense, resistance, and enemy-side reductions.']
          ),
          steps(
            ['Open formula details', 'Select the row details action on a damage result.'],
            ['Read top to bottom', 'Formula panels show the main stages in the order the app displays them.'],
            ['Open modifier groups', 'Expand groups to see which active sources contributed values.'],
            ['Compare rows', 'Use formula details on two rows to see which stage differs.']
          ),
        ),
      ),
      article(
        'damage-rotation-summary-interpretation',
        'Read Rotation Summaries',
        'Interpret totals that come from a simulated rotation.',
        section(
          'Summary fields',
          definitions(
            ['Rotation total', 'The combined output of the simulated rotation under the selected summary rules.'],
            ['DPS', 'Rotation total divided by the displayed duration.'],
            ['Contribution', 'A grouped share of the total by skill, source, teammate, or loop.'],
            ['Loop-aware total', 'A total that averages repeated loop windows by configured run count.']
          ),
          steps(
            ['Read total and duration', 'Start with the total, DPS, and displayed rotation duration.'],
            ['Open contribution groups', 'Expand skill, source, teammate, and loop groups to see the total split.'],
            ['Compare raw details separately', 'Raw execution rows show executed entries; summary rows may group or average them.']
          ),
        ),
      ),
      article(
        'damage-healing-shield-and-specialized-rows',
        'Healing, Shield, Tune, and Specialized Rows',
        'Read non-damage output that appears beside damage results.',
        section(
          'Support rows',
          definitions(
            ['Healing row', 'A row whose output is healing rather than damage.'],
            ['Shield row', 'A row whose output is shield value rather than damage.'],
            ['Tune row', 'A row tied to tune strain, tune rupture, or a specialized tune output.'],
            ['Specialized row', 'A row with a custom output family defined by its feature.']
          ),
          steps(
            ['Open the support section', 'Find healing, shield, tune, and specialized rows in their own result groups.'],
            ['Read their own totals', 'Support rows are not folded into the main damage total unless the surface explicitly says so.'],
            ['Open details', 'Inspect the formula and active state the same way as a damage row.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'saved-builds-and-presets',
    title: 'Saved Builds and Presets',
    summary: 'Save, load, rename, overwrite, and delete build records.',
    aliases: ['Saved', 'Presets', 'Builds'],
    articles: [
      article(
        'saved-record-types',
        'Saved Record Types',
        'Identify what each saved record contains before loading it.',
        section(
          'Record types',
          definitions(
            ['Build record', 'A saved resonator build snapshot with equipment and relevant state.'],
            ['Rotation record', 'A saved rotation tree.'],
            ['Preset', 'A reusable authored setup created by the app or user.'],
            ['Backup', 'A larger saved payload for import, export, or sync.']
          ),
          steps(
            ['Open saved records', 'Use the saved builds or saved rotations surface.'],
            ['Read record type', 'Check the label before loading, overwriting, or deleting.'],
            ['Open details', 'Inspect owner, resonator, timestamp, and included state fields.']
          ),
        ),
      ),
      article(
        'saved-live-matching-and-usage',
        'Live Matching and Usage Labels',
        'Read labels that compare saved records with live state.',
        section(
          'Labels',
          definitions(
            ['Live match', 'The saved record matches the current live state for the compared fields.'],
            ['Different from live', 'At least one compared field differs from the current live state.'],
            ['In use', 'The record is currently selected or linked by a live surface.'],
            ['Owner', 'The resonator or build context associated with the record.']
          ),
          steps(
            ['Compare before loading', 'Read live-match and owner labels on the record row.'],
            ['Open linked surfaces', 'Use in-use labels to find where a record is currently referenced.'],
            ['Save new state', 'Create a new record when the live build has changed and needs its own snapshot.']
          ),
        ),
      ),
      article(
        'saved-load-overwrite-and-delete',
        'Load, Overwrite, Rename, and Delete Semantics',
        'Use saved-record actions without mixing them up.',
        section(
          'Record actions',
          definitions(
            ['Load', 'Copies the saved record into live state.'],
            ['Overwrite', 'Replaces the saved record with the current live state.'],
            ['Rename', 'Changes the saved record name only.'],
            ['Delete', 'Removes the saved record from storage.']
          ),
          steps(
            ['Load into live', 'Use Load when the saved state needs to become the active state.'],
            ['Overwrite from live', 'Use Overwrite when the current active state needs to replace that record.'],
            ['Rename for organization', 'Use Rename to change the label without changing the record contents.'],
            ['Delete old records', 'Use Delete only for records no longer needed.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'import-export-and-sync',
    title: 'Import, Export, and Sync',
    summary: 'Bring in echo screenshots, rotation JSON, legacy backups, and Google Drive backups.',
    aliases: ['Import', 'Export', 'Sync', 'Backup'],
    articles: [
      article(
        'import-echo-parser',
        'Echo Image Import',
        'Create echo entries from supported echo images.',
        section(
          'Import flow',
          definitions(
            ['Image import', 'A parser flow that reads echo stat fields from an uploaded image.'],
            ['Parsed field', 'A detected echo name, set, main stat, substat, or value.'],
            ['Review step', 'The confirmation step before parsed fields are written into state.']
          ),
          steps(
            ['Open image import', 'Use the echo import action from the echo or inventory surface.'],
            ['Upload image', 'Select the supported echo screenshot or image file.'],
            ['Review parsed fields', 'Correct any name, set, stat, or value before saving.'],
            ['Save the echo', 'Write the reviewed echo into the target slot or inventory location.']
          ),
        ),
      ),
      article(
        'import-rotation-json-and-legacy-backups',
        'Rotation JSON and Legacy Backup Import',
        'Import rotation files and older app backup payloads.',
        section(
          'Import types',
          definitions(
            ['Rotation JSON', 'A file containing a rotation tree.'],
            ['Legacy backup', 'An older full-state payload converted into the current state shape during import.'],
            ['Import preview', 'The review step showing what the payload contains before it is written.']
          ),
          steps(
            ['Choose import action', 'Open the import action for rotations or backup data.'],
            ['Select file', 'Pick the JSON or backup file.'],
            ['Review preview', 'Read the resonator, rotation, build, and storage fields shown by the importer.'],
            ['Confirm import', 'Write the imported state after the preview matches what you intend to load.']
          ),
        ),
      ),
      article(
        'sync-local-and-google-drive',
        'Local Persistence and Google Drive Backup',
        'Control browser storage and Drive backup state.',
        section(
          'Storage paths',
          definitions(
            ['Local storage', 'The browser storage used by the app on the current device and browser profile.'],
            ['Drive backup', 'A Google Drive copy of app state created through the sync controls.'],
            ['Export file', 'A downloaded backup payload that can be imported later.'],
            ['Sync status', 'The displayed sign-in, upload, download, or error state for Drive operations.']
          ),
          steps(
            ['Check local state', 'Open settings or data management to see local storage controls.'],
            ['Export backup', 'Download a backup file before large state changes.'],
            ['Sign in for Drive', 'Use the Google Drive sign-in action before upload or download.'],
            ['Upload or restore', 'Choose the sync action that matches whether local state or Drive state is the source.']
          ),
        ),
      ),
    ],
  },
  {
    id: 'app-behavior-and-controls',
    title: 'App Behavior and Controls',
    summary: 'Understand persistence, selection mode, confirmations, toasts, history, and restore actions.',
    aliases: ['Controls', 'State', 'History'],
    articles: [
      article(
        'app-persistence-model',
        'Persistence Model',
        'Know which app state survives refresh and which state is only temporary.',
        section(
          'State locations',
          definitions(
            ['Persisted state', 'Saved browser state that returns after refresh.'],
            ['Session state', 'Temporary UI state that may reset when the surface closes or reloads.'],
            ['Live calculator state', 'The active resonator, build, rotation, enemy, team, and manual state currently used by calculations.'],
            ['Derived state', 'Computed output rebuilt from live state rather than stored directly.']
          ),
          steps(
            ['Edit live state', 'Normal calculator controls update live state and persist where the app stores that domain.'],
            ['Refresh to reload', 'Persisted state returns after page refresh in the same browser profile.'],
            ['Export for transfer', 'Use backup export or sync to move state to another device or browser.']
          ),
        ),
      ),
      article(
        'app-selection-confirmations-and-toasts',
        'Selection Mode, Confirmations, and Toasts',
        'Read short-lived UI feedback and selection controls.',
        section(
          'Control feedback',
          definitions(
            ['Selection mode', 'A temporary mode where clicking entries selects them for a batch action.'],
            ['Confirmation', 'A prompt shown before overwriting, deleting, importing, or replacing important state.'],
            ['Toast', 'A short message confirming an action, warning about state, or reporting an error.'],
            ['Batch action', 'An action applied to multiple selected entries at once.']
          ),
          steps(
            ['Enter selection mode', 'Use the selection control on lists that support multi-select.'],
            ['Select entries', 'Click entries to add or remove them from the selected set.'],
            ['Confirm destructive actions', 'Read the confirmation text before approving overwrite, delete, import, or replace actions.'],
            ['Read toast text', 'Use toast messages to confirm completion or identify the action that failed.']
          ),
        ),
      ),
      article(
        'app-history-and-restore-behavior',
        'History, Undo, and Restore Behavior',
        'Use app history and restore controls to return to earlier state.',
        section(
          'History controls',
          definitions(
            ['Undo', 'Reverts the most recent supported state change.'],
            ['Redo', 'Reapplies a reverted supported state change.'],
            ['Restore', 'Loads state from a saved record, backup, or prior snapshot.'],
            ['History entry', 'A stored state transition available to the history controls.']
          ),
          steps(
            ['Use undo after an edit', 'Run undo immediately after a supported edit to return to the previous state.'],
            ['Use redo after undo', 'Run redo to reapply the reverted edit.'],
            ['Restore from a record', 'Load a saved build, rotation, backup, or sync payload when a larger state reset is needed.'],
            ['Save before broad changes', 'Create a record or backup before large imports, batch edits, or optimizer applies.']
          ),
        ),
      ),
    ],
  },
]
