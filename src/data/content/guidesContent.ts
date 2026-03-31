export interface GuideArticle {
  title: string
  type: string
  shortDesc: string
  content: string
}

export interface GuideSection {
  category: string
  guides: GuideArticle[]
}

export const guideSections: GuideSection[] = [
  {
    category: 'Rotations',
    guides: [
      {
        title: 'Using the Rotations Section',
        type: 'article',
        shortDesc: 'Learn how to record, organize, and optimize skill rotations in the calculator.',
        content: `
                <p>The <strong>Rotations Section</strong> lets you create and manage skill sequences for your character, whether you want to test a short combo or simulate full team damage rotations. Every entry you add contributes to a running total, which updates live as you experiment.</p>

                <h4>1. Adding Skills</h4>
                <p>Click <strong>+ Skill</strong> to open a categorized menu showing all your character's attacks, skills, and effects. Each group (Normal Attack, Resonance Skill, Liberation, etc.) can be expanded or collapsed. Selecting a skill adds it to your current rotation list with its name, icon, and damage preview.</p>
                <p>You can also <strong>edit existing entries</strong> by clicking the pencil icon next to them — this reopens the skill menu so you can swap that entry for another ability while keeping its multiplier.</p>

                <h4>2. Adding Blocks</h4>
                <p>Click <strong>+ Block</strong> to add an empty block. Skills can be dragged and dropped into the body of a block to add the skill to that block, dragging a skill out of a block will remove it from the block. Grass is green, sky is blue.</p>
                <p>You can click the Eye icon to collapse and expand a block. Click the pencil icon to open up the block's preview and properly inspect it's skill entries.</p>

                <h4>3. Reordering Skills and Blocks</h4>
                <p>Click and drag skills in the list to change their order. The order doesn't impact the skill entry or rotation totals.</p>

                <h4>4. Multipliers</h4>
                <p>Each skill has a small numeric field labeled <strong>×</strong>. This acts as a multiplier — for example, entering 3 simulates using that skill three times in a row. The total rotation damage reflects all multipliers instantly.</p>

                <h4>5. Skill and Block Action Buttons</h4>
                <p>Click on the lock icon on a skill or block entry to toggle its <strong>locked</strong> state. When locked on skill, the skill snapshot is frozen: its damage will no longer update when buffs, weapon stats, or character levels change. When locked on block, all skill entries in the block will be locked.</p>
                <p>Click on the Power icon on a skill or block entry to toggle its <strong>disabled</strong> state. When disabled on skill, the skill's calculated damage, healing or shield effect will not be factored into the total rotation calculation. When locked on block, all skill entries in the block will be disabled.</p>

                <h4>6. Clearing and Editing</h4>
                <p>Use the <span style="color: red; font-weight: bold;">Clear</span> button to remove all entries and start fresh. Each entry also includes delete and edit buttons for precise management.</p>

                <h4>7. Team Rotations</h4>
                <p>The <strong>Team Rotation</strong> system lets you combine multiple characters' saved rotations into one synchronized total. This feature appears in the <strong>Team Buffs</strong> section once your active character has at least one teammate added to the team and those teammates have their own recorded or saved rotations.</p>

                <p>Each teammate will appear inside an expandable <strong>Rotations</strong> section, showing a dropdown selector and a summary of their damage totals — <strong>Normal</strong>, <strong>Crit</strong>, and <strong>Average</strong>.</p>

                <p>From the dropdown, you can pick which version of that teammate's rotation to include:
                <ul>
                <li><strong>Live</strong> — their current on-screen rotation and character setup.</li>
                <li><strong>Saved</strong> — one of their previously stored rotations.</li>
                </ul>
                When you select a rotation, it's immediately linked to your active character's team rotation data.</p>

                <p>Next to each teammate entry, you'll find an <strong>Enable</strong> checkbox. This determines whether that teammate's rotation is currently contributing to the total team damage output. You can toggle it on or off to compare performance with and without specific teammates.</p>

                <p>The selected teammate rotation values update live, displaying their total <strong>Normal</strong>, <strong>Crit</strong>, and <strong>Average</strong> damage in the panel. Once all active teammates are configured and enabled, the calculator combines their totals with your own in the <strong>Team Rotation Summary</strong> located beneath the Damage section. Each character's contribution percentage is displayed clearly to show who carried the fight.</p>

                <p>When you <strong>save a Team Rotation</strong>, the system stores just your main character's state and the linked teammate rotations.</p>

                <h4>8. Saving and Loading Rotations</h4>
                <p>When you're satisfied with a sequence, click the large <strong>＋</strong> button to save it. For team rotations, you'll find this save button in the <strong>Team</strong> tab, to save a team rotation you'll need to have at least <span style="font-weight: bold" >ONE</span> teammate's rotation enabled.</p>
                <p>Saved rotations are stored globally and can be accessed later from the <strong>Saved</strong> tab. You can rename them inline, sort by date, total damage, or name, and delete old ones anytime.</p>

                <p>You can also <strong>export</strong> or <strong>import</strong> rotations as <code>.json</code> files, making it easy to share builds with other players. Importing a file from a different character <span style="font-weight: bold">WILL NOT WORK</span>. Mismatched data from being applied so rotations always stay consistent with their intended character.</p>
                <p>Keep in mind that loading a saved personal or team rotation will <code style="color: red; font-weight: bold;">OVERWRITE</code> your current character's state with the saved one.</p>

                <h4>9. Sorting and Filtering Saved Rotations</h4>
                <p>In the <strong>Saved</strong>/<strong>Team</strong> tab, you can:</p>
                <ul>
                    <li>Sort by <em>Date</em>, <em>Name</em>, or <em>Total Damage</em>.</li>
                    <li>Switch between ascending and descending order.</li>
                    <li>Filter to view only rotations for a specific character.</li>
                </ul>
                <p>Each saved entry shows Normal, Crit, and Average damage values, along with the date it was created. You can also export <span style="font-weight: bold">rotation files</span> or load the saved character's <span style="font-weight: bold">full character state</span> from here directly.</p>

                <p>To make filtering easier, a <strong>Smart Filter</strong> option is available beside the <strong>Saved Rotations</strong> and <strong>Saved Team Rotations</strong> titles. When enabled, the system automatically detects your <strong>active character</strong> and filters the lists to show only the rotations relevant to them. Turning it off restores full manual control, allowing you to browse all saved rotations freely.</p>

                <p><strong>Smart Filter</strong> is remembered between sessions, so your preference persists even after reloading the page.</p>

                <h4>10. Total Damage Summaries</h4>
                <p>At the bottom of the Damage section, a <strong>Rotation Summary</strong> shows the total Normal, Crit, and Average values for your sequence. It also breaks down damage contribution by type (e.g., Basic, Skill, Liberation). If any healing or shielding abilities were used, these appear in separate totals in <span style="color: limegreen; font-weight: bold;">green</span> and <span style="color: #838383; font-weight: bold;">gray</span> respectively.</p>
                <p>When a valid team rotation is active, you'll see a <strong>Team Damage Summary</strong> below, showing each character's percentage contribution to the total output.</p>

                <h4>11. Basic Rotations (<a href="https://www.prydwen.gg/wuthering-waves" target="_blank" rel="noopener noreferrer">Prydwen</a>)</h4>
                <p>The <strong>Basic</strong> button in the <strong>Rotations</strong> section automatically loads a preset rotation sourced from <strong>Prydwen</strong>. These are curated "baseline" combos for each character, designed to help you get started or compare against your own builds.</p>

                <p>If a character has a rotation available in the database, clicking the <strong>Basic</strong> button will instantly apply it. Additionally, if a character has no existing rotation, their <strong>Prydwen</strong> rotation will load in automatically once.</p>

                <p>Note that <strong>beta characters</strong> will not have a Prydwen rotation until they are officially released in the game and receive one from <strong>Prydwen</strong>.</p>

                <h4>12. Advanced Tips</h4>
                <ul>
                    <li><strong>Snapshot Behavior:</strong> Locking skills allows testing "snapshot" buffs — like when a skill's damage is fixed at activation even if later buffs expire.</li>
                    <li><strong>Skill Visibility:</strong> Hidden or disabled skills (like passive or auto-applied damage types) won't appear in the menu or totals to prevent clutter.</li>
                    <li><strong>Subhits:</strong> If you enable <em>"Show Sub-Hits"</em> in the Damage Section, individual hit components appear with tooltips, helping analyze multi-hit or DOT effects.</li>
                </ul>

                <p>The Rotations system is designed to feel like a training ground — flexible, responsive, and easy to adjust. Combine it with the Buffs and Echo panes to model real gameplay scenarios and fine-tune your builds with precision.</p>
            `
      }
    ]
  },
  {
    category: 'Echoes',
    guides: [
      {
        title: 'Using the Echoes Pane',
        type: 'article',
        shortDesc: 'Learn how to equip, edit, and manage Echoes in your character setup.',
        content: `
                <p>The <strong>Echoes Pane</strong> lets you equip up to five Echoes per character, view their stats, and manage your builds efficiently. It's designed to mirror the in-game experience while giving you full customization and control.</p>

                <h4>1. Equipping Echoes</h4>
                <p>Each of the five Echo slots can hold one Echo. Click an empty slot or an existing Echo to open the <strong>Echo Menu</strong>, where you can browse available Echoes. Echoes are grouped by their <strong>cost tiers (1, 3, or 4)</strong>, and the total cost must stay under 12.</p>
                <p>To clear everything, click the <strong>Unequip All</strong> button next to Import Echo.</p>

                <h4>2. Echo Information</h4>
                <p>Each Echo displays its <strong>name, icon, cost, main stats,</strong> and <strong>set affiliation</strong>. Hover over an Echo to see its detailed description and any set bonuses it contributes toward.</p>

                <h4>3. Editing Stats</h4>
                <p>Click on an equipped echo stats space to open it's <strong>Edit Substats Modal</strong>. Here you can:
                <ul>
                    <li>View or change its main stats (like HP%, ATK%, or Attribute Bonus).</li>
                    <li>Edit up to five substats directly using dropdowns and value inputs.</li>
                    <li>Add new substats using the <strong>+</strong> button, initialized with default values.</li>
                    <li>Switch between available <strong>sonata set options</strong> using the icon toggle icons.</li>
                    Changes made her will need to be saved by clicking on the save button.
                </ul>
                Changes are applied instantly and reflected in your total Echo stats summary.</p>

                <h4>4. Echo Bag</h4>
                <p>Your <strong>Echo Bag</strong> acts as a shared collection across all characters. You can store Echoes you've created or parsed from screenshots (see below), and later equip them onto any character. The bag opens as a scrollable menu where you can manage saved Echoes, edit them, or transfer them into active slots.</p>

                <h4>5. Parsing Echoes from Screenshots</h4>
                <p>The built-in <strong>Echo Parser</strong> uses OCR (Optical Character Recognition) to extract Echo data directly from screenshots. Upload an image or drag it into the parser area, and it will automatically detect the Echo's:
                <ul>
                    <li>Name and cost</li>
                    <li>Main and substats</li>
                    <li>Associated set</li>
                </ul>
                See more under the <strong>Echo Importing</strong> guide category.</p>

                <h4>6. Managing Sets and Bonuses</h4>
                <p>Echoes belonging to the same sonata set automatically grant <strong>2-piece</strong>, <strong>3-piece</strong> or <strong>5-piece bonuses</strong>, depending on how many are equipped. The system displays these bonuses in real time under your character's stats and contributes to the final damage calculations.</p>

                <h4>7. The Main Echo Slot</h4>
                <p>One slot is designated as your <strong>Main Echo</strong>. Echoes placed here grant an additional active effect or buff. Some of these buffs are <strong>toggleable</strong> or <strong>stackable</strong> — if available, you'll see small checkboxes or dropdowns beside the description to control them.</p>

                <h4>8. Did you know?</h4>
                <p>Hovering over individual substats let you see their roll values as percentages.</p>

                <h4>9. Derived Metrics</h4>
                <p>The Overview includes advanced metrics like <strong>Crit Value (CV)</strong> and <strong>Build Score</strong>, which evaluate how optimized your build is. These are derived automatically:</p>
                <ul>
                    <li><strong>Crit Value (CV):</strong> A combined score from Crit Rate and Crit DMG — used to measure offensive balance.</li>
                    <li><strong>Build Score:</strong> A normalized build quality metric based on Echo substat efficiency and scoring. (See more under the <strong>Build and Echo Scoring</strong> guide category.</li>
                </ul>
                 `
      }
    ]
  },
  {
    category: 'Enemies',
    guides: [
      {
        title: 'Using the Enemy Section',
        type: 'article',
        shortDesc: 'Pick a target, tweak its resistances/level, and set up one custom enemy.',
        content: `
                <p>The <strong>Enemy Section</strong> lets you choose which foe your calculations target. You can swap enemies, adjust their level and resistances, flip endgame mode, and keep one custom enemy for special cases.</p>

                <h4>1. Selecting an enemy</h4>
                <ul>
                  <li>Click the enemy icon to open the <strong>Menu</strong>.</li>
                  <li>Filter the list by <strong>Attribute</strong> or <strong>Class</strong>; each row shows an attribute icon.</li>
                  <li>Picking one sets it as the active target. Use the level slider or input field (1–120) to match whatever.</li>
                </ul>

                <h4>2. Resistances & ToA</h4>
                <ul>
                  <li>Resistances show for all elements with their icons. Values come from the selected enemy.</li>
                  <li>Toggle <strong>Endgame / Overworld</strong>. Endgame bumps any 10% res to 20% and 40% res to 60% for every attribute; adjusts level when enabled.</li>
                </ul>

                <h4>3. Custom enemy</h4>
                <ul>
                  <li>Click <strong>EDIT</strong> to jump to your custom enemy. If none exists, one is created from the current target and saved.</li>
                  <li>Custom enemy has editable resistances (0–100) and a class picker (Common/Elite/Overlord/Calamity).</li>
                  <li>Only one custom enemy exists; it persists between sessions.</li>
                  <li><strong>DELETE</strong> <a href="https://tenor.com/bzsbK.gif" target="_blank" rel="noopener noreferrer">deletes</a> it.</li>
                </ul>

                <h4>4. Tunability & debuffs</h4>
                <ul>
                  <li><strong>Tune Strain</strong> slider adds stacks that amplify tune-break buffs for certain characters.</li>
                  <li>Negative effects (Spectro Frazzle, Aero Erosion, Havoc Bane, Electro Flare) live here too—set them to match your scenario.</li>
                </ul>

                <h4>5. Persistence</h4>
                <ul>
                  <li>Your chosen enemy, level, Endgame state, and any custom enemy edits are saved automatically and aren't tied to a character.</li>
                </ul>
                `
      }
    ]
  },
  {
    category: 'Random Echoes',
    guides: [
      {
        title: 'Generating Random Echoes',
        type: 'article',
        shortDesc: 'Generate ranked Echo builds using set filters, main echo focus, and stat-weighted scoring.',
        content: `
              <p>
                The <strong>Random Echo Generator</strong> lives in the <strong>Suggestions</strong> tab and creates
                full 5-Echo loadouts, then ranks them using the same damage engine as the main optimizer.
              </p>

              <h4>1. Where to find it</h4>
              <ul>
                <li>Open the <strong>Suggestions</strong> tab in the left pane.</li>
                <li>Switch to the <strong>Random Echoes</strong> view.</li>
              </ul>

              <h4>2. Quick start</h4>
              <ol>
                <li>Choose a <strong>Target Skill</strong> (the skill the generator will optimize damage for).</li>
                <li>Optionally pick a <strong>Main Echo</strong> to focus the main slot around.</li>
                <li>Set <strong>Bias</strong> and <strong>Roll Quality</strong> to shape how "good" the rolls look.</li>
                <li>If you care about rotations, set a <strong>Target Energy Regen</strong> (e.g. 120–150%).</li>
                <li>Adjust any <strong>Sonata plans</strong> if you want specific 2p/5p setups.</li>
                <li>Click <strong>Regenerate</strong> to roll a batch of builds.</li>
              </ol>

              <h4>3. Key settings</h4>
              <ul>
                <li>
                  <strong>Target Skill</strong> –
                  The skill used for scoring. Stat weights and damage are computed around this skill.
                </li>
                <li>
                  <strong>Main Echo Focus</strong> –
                  Tells the generator which Echo (and cost) should sit in the main slot. Leave empty for fully free combos.
                </li>
                <li>
                  <strong>Bias</strong> (0–1) –
                  Controls how often "desirable" stats (based on your stat weights) show up on substats.
                  Low bias = more scuffed, realistic rolls. High bias = more cracked, min-maxed rolls.
                </li>
                <li>
                  <strong>Roll Quality</strong> (0–1) –
                  Controls how close each substat roll is to its max tier. Low = low/mid rolls, high = near-perfect rolls.
                </li>
                <li>
                  <strong>Target Energy Regen</strong> –
                  The generator tries to meet or slightly exceed this ER across the full 5-Echo set.
                </li>
                <li>
                  <strong>Sonata Plan</strong> –
                  Restrict generation to specific 2p/5p combinations (for example "2p+2p", "2pc+3pc" or a full 5p),
                  or leave it open to let the generator mix sets freely.
                </li>
              </ul>

              <h4>4. Reading the results</h4>
              <ul>
                <li>Each row is a full 5-Echo set with its <strong>damage</strong> and/or <strong>Build Score</strong>.</li>
                <li>You can inspect a selected result to see per-Echo main/sub stats and Sonata set breakdown.</li>
                <li>Use the <strong>Apply</strong> button to apply that build to the current character.</li>
              </ul>

              <h4>5. Practical tips</h4>
              <ul>
                <li>Try low bias + mid roll quality to simulate "realistic" farming results.</li>
                <li>Try high bias + high roll quality to see your theoretical ceiling for a given build.</li>
                <li>Change the target skill (e.g. Basic vs Liberation) to see how priorities shift.</li>
                <li>Use the ER target when planning rotation-heavy teams or characters that feel starved for ult uptime.</li>
              </ul>
            `
      }
    ]
  },
  {
    category: 'Echo Presets',
    guides: [
      {
        title: 'Managing Echo Presets',
        type: 'article',
        shortDesc: 'Learn how to create, edit, and apply Echo Presets for faster loadouts and optimized builds.',
        content: `
            <p>The <strong>Echo Presets</strong> system lets you save, organize, and reuse complete Echo loadouts across characters. Presets store your exact Echo configurations including main stats, substats, and sets so you can instantly reapply them without rebuilding from scratch.</p>

            <h4>1. Overview</h4>
            <p>Echo Presets act as customizable templates. Each preset remembers a full set of five Echoe slots and their selected sets, stats, and configurations. You can save your current build or load a preset into another character for testing or optimization.</p>

            <ul>
                <li><strong>Create Preset</strong> – Save your currently equipped Echoes using the <em>Save Preset</em> button.</li>
            </ul>

            <h4>2. Presets View</h4>
            <p>All saved presets appear in the <strong>Presets</strong> panel in your <strong>Echo Bag</strong>, where you can filter and organize them:</p>
            <ul>
                <li>Use the <strong>Filter by Character</strong> dropdown to quickly view presets associated with a specific character.</li>
                <li>Presets show the <strong>character name</strong> it was saved with, <strong>creation date</strong> and characters with the preset equipped for better organization.</li>
            </ul>

            <h4>3. Presets Inspection</h4>
            <p>Click on a preset to inspect it. On this modal you'll see a detailed view of the echoes in this preset.</p>
            <ul>
                <li><strong>Edit Preset Name</strong> – Click <strong>Edit Preset Name</strong> to edit the name of the preset (Presets are saved with the character's name it was saved with by default.</li>
                <li><strong>Equip Preset</strong> – Click <strong>Equip</strong> to apply the preset to the current active character.</li>
                <li><strong>Delete Preset</strong> – Click <strong>Delete</strong> to remove presets permanently.</li>
            </ul>


            <h4>4. Saving from Runtime</h4>
            <p>When you save while viewing a character's current Echoes, the preset automatically records all equipped Echo data—including their <strong>main stats</strong>, <strong>substats</strong>, and <strong>selected set</strong>.</p>
            <ul>
                <li>If a preset already contains an identical combination, it won't create a duplicate.</li>
                <li>Each preset tracks which characters currently have it equipped, syncing automatically as you switch builds.</li>
            </ul>

            <h4>5. Syncing and Equipping</h4>
            <p>Echo presets stay linked with your equipped Echoes through a sync system:</p>
            <ul>
                <li>Whenever you change Echoes, the system checks if they match any saved preset.</li>
                <li>If they do, the preset will automatically appear as <em>equipped</em> under that character's profile.</li>
                <li>Removing or modifying an Echo breaks the link, but the preset remains available for reapplication.</li>
            </ul>
            `
      }
    ]
  },
  {
    category: 'Team Buffs',
    guides: [
      {
        title: 'Using the Team Buffs Section',
        type: 'article',
        shortDesc: 'Learn how to manage Echo, Weapon, and Team buffs and how teammate rotations contribute to total damage.',
        content: `
                <p>The <strong>Team Buffs</strong> section brings together all external effects from teammates that influence your character's stats, from <strong>Echo/Sonata Set</strong> effects to <strong>Weapon</strong> passives and <strong>Teammate</strong> synergy effects. It acts as the central hub for managing and viewing every modifier that affects your character's performance within a team.</p>

                <h4>1. Overview</h4>
                <p>This section automatically compiles three major buff sources:</p>
                <ul>
                    <li><strong>Weapon Buffs</strong> – effects from teammates' weapons.</li>
                    <li><strong>Echo Buffs</strong> – effects from teammates' echoes and sonata sets.</li>
                    <li><strong>Teammate Buffs</strong> – conditional effects provided by your selected teammates, such as shared ATK boosts or healing amplifications.</li>
                </ul>

                <h4>2. Weapon Buffs</h4>
                <p>All weapons with supportive effects are listed automatically under <strong>Weapon Buffs</strong>.</p>
                <ul>
                    <li>Use the <strong>Rank</strong> dropdown beside a weapon to select its refinement (0–5).</li>
                    <li>The passive becomes active only when its rank is above 0, and its value scales accordingly.</li>
                    <li>Changes are reflected instantly in the active character's stats and damage output.</li>
                </ul>

                <h4>3. Echo Buffs</h4>
                <p>All <strong>Echo</strong> and <strong>Sonata Set</strong> bonuses with supportive effects appear here automatically.</p>
                <ul>
                    <li>Toggle switches activate effects like DMG bonuses, healing boosts, or RES shredding.</li>
                    <li>Stackable effects display a dropdown to set the current number of stacks.</li>
                    <li>Adjustments update your final stats and calculations in real time.</li>
                </ul>

                <h4>4. Teammate Buffs</h4>
                <p>When you select <strong>teammates</strong> for your active character, their passive or support effects are also represented here.</p>
                <ul>
                    <li>For example, a support who provides teamwide ATK% or Elemental DMG bonuses will have their effects listed automatically.</li>
                    <li>Some effects may not require you to do anything and are automatically merged into your stats behind the scenes, so no toggle is needed.</li>
                    <li>Others may include toggles or dropdowns to represent active or stack-based buffs, allowing fine control over synergy effects.</li>
                </ul>

                <h4>5. Teammate Rotations</h4>
                <p>Beneath the above, you'll find the <strong>Rotations</strong> section whenever valid team rotations exist. This links your teammates' saved or active rotations directly into the team's total calculation.</p>
                <ul>
                    <li>Each teammate appears with their name, a rotation dropdown, and their total <strong>Normal</strong>, <strong>Crit</strong>, and <strong>Average</strong> damage values.</li>
                    <li>You can switch between different saved rotations for that teammate, or disable them entirely using the <strong>Enable</strong> checkbox.</li>
                    <li>Enabled teammate rotations contribute their totals to your <strong>Team Damage Summary</strong> at the bottom of the Damage Section, giving you a live snapshot of overall team output and percentage contribution per character.</li>
                    <p>See more under the Rotations guide category.</p>
                </ul>

                <p>Use the <strong>Team Buffs</strong> section to fine-tune every cooperative variable affecting your team's performance. Whether you're activating weapon passives, enabling Echo Set bonuses, or syncing teammate rotations, this pane provides a unified overview of how each member's effects combine to shape total output.</p>
            `
      }
    ]
  },
  {
    category: 'Suggestions',
    guides: [
      {
        title: 'Using Main Stat & Sonata Suggestions',
        type: 'article',
        shortDesc: 'Let the calculator propose main stats and Sonata set plans for your current target skill.',
        content: `
        <p>The <strong>Echo Suggestions</strong> panel is split into two modes:
        <strong>Main Stats</strong> and <strong>Sonata Sets</strong>.
        Both are built on top of the same damage engine as the main calculator and
        use your selected <strong>Target Skill</strong> to rank options.</p>

        <h4>1. Picking a Target Skill</h4>
        <p>At the top of the panel, you'll see a <strong>Target Skill</strong> selector.
        This controls what the suggester is trying to optimize around.</p>
        <ul>
          <li>Click the <strong>Target Skill</strong> box to open the skill menu.</li>
          <li>Skills are grouped by tab (Basic, Heavy, Skill, Liberation, etc.).</li>
          <li>Once you pick a skill, the suggester re-runs in the background using that skill's damage weights.</li>
        </ul>
        <p>The same target skill is used for both <strong>Main Stats</strong> and <strong>Sonata Sets</strong>.</p>

        <h4>2. Main Stats View</h4>
        <p>The <strong>Main Stats</strong> tab suggests main stat layouts for each Echo slot
        (HP%, ATK%, Crit Rate, Energy Regen, etc.) and estimates how much damage that layout would do
        compared to your current setup.</p>

        <h5>What you're seeing</h5>
        <ul>
          <li><strong>Rank #</strong> – The ordering from best to worse, based on average damage.</li>
          <li><strong>Cost signature</strong> – The Echo cost pattern (e.g. <code>4 • 4 • 1 • 1 • 1</code>).</li>
          <li><strong>avg: X dmg</strong> – Estimated average damage for the suggested layout on the target skill.</li>
          <li><strong>Current / % change</strong> – Shows how much higher or lower this layout is vs your current build.</li>
          <li><strong>Rows per Echo</strong> – Each row shows one Echo slot:
            <ul>
              <li><strong>Cost N</strong> – That Echo's cost.</li>
              <li><strong>Pills</strong> – The chosen main stats, e.g. <code>ATK%</code>, <code>Crit DMG</code>, <code>Energy Regen</code>, with their suggested values.</li>
            </ul>
          </li>
        </ul>

        <h5>Buttons</h5>
        <ul>
          <li><strong>Target Skill</strong> – Changes which skill the suggestions are optimized for.</li>
          <li><strong>Inspect</strong> – Opens a preview modal that shows a full Echo grid using the suggested main stats,
          so you can visually compare it with your current build before applying.</li>
          <li><strong>Reset Selection</strong> – Jumps back to the top-ranked main stat layout.</li>
        </ul>

        <h5>How it works (simplified)</h5>
        <ul>
          <li>The worker builds candidate main-stat recipes for each slot.</li>
          <li>For each recipe, it simulates a full set of Echoes using your current character, buffs, and weights.</li>
          <li>The damage of the target skill is computed using the same formula as the main Damage page.</li>
          <li>Results are sorted by damage, and only the top few are shown.</li>
        </ul>

        <h4>3. Sonata Sets View</h4>
        <p>The <strong>Sonata Sets</strong> tab suggests 2-piece, 3-piece, and 5-piece Sonata combinations
        that play nicely with your chosen skill and character. It doesn't change your substats or main stat types;
        it only changes <strong>which sets</strong> you're wearing on each Echo.</p>

        <h5>What you're seeing</h5>
        <ul>
          <li><strong>Rank #</strong> – Best to worst, sorted by average damage on the target skill.</li>
          <li><strong>Set badges</strong> – Each badge shows something like <code>2pc Freezing Frost</code>
          with its icon. Hover to see what that set's 2pc / 3pc / 5pc bonus actually does.</li>
          <li><strong>avg: X dmg</strong> – Estimated damage using that exact Sonata combination.</li>
          <li><strong>Current / % change</strong> – How much better or worse this Sonata setup is than your current one.</li>
        </ul>

        <h5>Buttons</h5>
        <ul>
          <li><strong>Target Skill</strong> – Same as in the Main Stats view; controls what is being optimized.</li>
          <li><strong>Inspect</strong> – Builds a preview Echo grid using the suggested Sonata set plan:
            <ul>
              <li>Your main stat values and substats are preserved where possible.</li>
              <li>Only the <strong>selected set</strong> on each Echo is changed to match the suggested plan.</li>
              <li>The preview also respects Echo cost and avoids duplicate template Echo IDs where it can.</li>
            </ul>
          </li>
          <li><strong>Reset Selection</strong> – Returns to the highest-ranked Sonata set plan.</li>
        </ul>

        <h5>How Sonata suggestions behave</h5>
        <ul>
          <li>The suggester tries all legal 2pc, 3pc, and 5pc Sonata combinations from the enabled set list.</li>
          <li>Each combination is scored by recomputing damage with that set plan applied.</li>
          <li>Plans that don't change damage compared to "no sets" are ignored.</li>
          <li>If a multi-set combo behaves the same as a single 2pc/3pc baseline (no extra benefit),
          only the standalone version is kept to avoid clutter.</li>
          <li>Before a suggestion is shown, a feasibility check makes sure it's actually possible with:
            <ul>
              <li>Your current Echo <strong>cost pattern</strong>, and</li>
              <li>The available Echo templates (unique IDs) in the database.</li>
            </ul>
          </li>
        </ul>

        <h4>4. How Apply / Preview Works</h4>
        <p>When you click <strong>Inspect</strong> in either mode, a preview modal appears with a 5-Echo grid:</p>
        <ul>
          <li>Each Echo is shown with its icon, cost, selected set, and a relative score bar.</li>
          <li>This view does not immediately overwrite your current build.</li>
          <li>Click <strong>Apply</strong> to save the suggested Echo layout as your new
          <strong>equipped Echoes</strong> for that character.</li>
        </ul>

        <h4>5. Set Conditionals</h4>
        <p>In the <strong>Sonata Sets</strong> view, click <strong>Config</strong> to open <strong>Set Conditionals</strong>.</p>
        <ul>
          <li>Each set is split into condition parts (base piece effects, stack components, and trigger-based parts).</li>
          <li>Turn parts <strong>on/off</strong> to match your scenario before ranking suggestions.</li>
          <li>Disabled parts are excluded from set-plan scoring, so recommendations stop assuming unrealistic uptime.</li>
          <li>These toggles are saved per character and reused by Optimizer, keeping both tools aligned.</li>
        </ul>

        <h4>6. Tips & Use Cases</h4>
        <ul>
          <li>Use <strong>Main Stats</strong> to answer questions like
          "Should I run Crit Rate / Crit DMG or ATK% / Crit DMG on this character?"</li>
          <li>Use <strong>Sonata Sets</strong> to test whether chasing a 5pc is actually worth it over
          mixed 2pc / 3pc setups.</li>
          <li>If results look weird, make sure you've selected the right target skill and that your buffs /
          character level match what you actually play.</li>
        </ul>
      `
      }
    ]
  },
  {
    category: 'Optimizer',
    guides: [
      {
        title: 'Using the Echo Optimizer',
        type: 'article',
        shortDesc: 'Configure filters, run the optimizer, and interpret the best echo combinations for your character.',
        content: `
                <p>The <strong>Echo Optimizer</strong> searches through your available echoes and finds the most efficient combinations for your current character. It respects cost limits, set effects, and your chosen stat priorities to rank the strongest options first.</p>

                <h4>1. Overview</h4>
                <p>The optimizer works on top of your existing <strong>Echo Bag</strong> and filter settings. It takes the echoes that pass your filters, generates all valid 5-piece (cost ≤ 12) combinations, and evaluates their total damage using the same calculation logic as the main Damage Section.</p>
                <p>The result is a sorted list of candidate builds, each showing its sets, total stats, and expected output compared to your current build.</p>

                <h4>2. Echo Source & Filters</h4>
                <p>The optimizer never invents new gear — it only uses echoes you have in your <strong>Echo Bag</strong>. Before running it, make sure your bag is correct and up to date.</p>
                <p>Echoes are filtered using the same options as the main Echo Filters:</p>
                <ul>
                    <li><strong>Filter Strength</strong> – Keeps only the top slice of your bag, based on your selected <em>stat weights</em>. For example, 30% filters out the least preferable 30% of echoes by weighted score.</li>
                    <li><strong>Allowed Sets</strong> – Lets you prioritize or restrict specific sets. These rules constrain which combinations are considered.</li>
                    <li><strong>Main Stat Filter</strong> – Limits which main stats are allowed on certain slots, so you don't get weird or unusable rolls for your target build.</li>
                </ul>
                <p>Whenever you adjust these filters, the optimizer automatically recalculates how many valid combinations exist and shows this number in the control panel.</p>

                <h4>3. Main Echo Slot</h4>
                <p>The <strong>Main Echo</strong> selector lets you pin a specific echo to the main slot. When set, the optimizer only considers combinations that include that echo in slot 1. This is useful when you want to keep a prized 4-cost echo and just optimize the remaining pieces around it.</p>
                <p>Clearing the main echo returns the search to "fully free" mode, allowing any echo to occupy the main slot.</p>

                <h4>4. Stat Range Limits</h4>
                <p>The <strong>Stat Range Limits</strong> panel lets you set <em>hard constraints</em> on the final stats that a build is allowed to have. Instead of just "preferring" certain stats with weights, these limits decide which echo combinations are valid at all.</p>

                <p>For each tracked stat, you'll see a row like this:</p>

                <ul>
                    <li><strong>Label</strong> – The stat name (e.g., ATK%, Crit Rate, Energy Regen).</li>
                    <li><strong>Min</strong> – The minimum allowed total for that stat across the full echo set.</li>
                    <li><strong>Max</strong> – The maximum allowed total for that stat across the full echo set.</li>
                </ul>

                <p>When you type a value in <strong>Min</strong> or <strong>Max</strong>, the optimizer will <strong>discard any combination</strong> whose final total for that stat falls outside the specified range. Combos that fail even one of these checks are never evaluated or shown in the results table.</p>

                <p>This is especially useful when you need to:</p>
                <ul>
                    <li>Guarantee a minimum <strong>Energy Regen</strong> so your rotations stay functional.</li>
                    <li>Enforce a target <strong>Crit Rate</strong> window (e.g., at least 60%, but not more than 80%).</li>
                    <li>Cap certain stats (like ATK% or Crit DMG) to avoid over-investing past a useful point.</li>
                </ul>

                <p>Leave a field blank to ignore that side of the constraint (for example, setting only a minimum but no maximum). If all fields for a stat are empty, that stat places no limits on the optimizer.</p>

                <h4>5. Running the Optimizer</h4>
                <p>Once your filters are ready, click the main <strong>Run</strong> button. The optimizer will:</p>
                <ul>
                    <li>Generate the combinations in batches.</li>
                    <li>Evaluate each batch using the current character, echo stats, and buffs.</li>
                    <li>Keep only the top-scoring results in memory, based on damage or target metric.</li>
                </ul>
                <p>A progress bar and statistics panel show <strong>how many combos have been processed</strong>, the current speed (combos per second), and an estimated remaining time. You can stop the run early using the <strong>HALT</strong> button, keeping the best results found so far.</p>

                <h4>6. Reading the Results Table</h4>
                <p>The optimizer outputs a ranked table of builds. Typical columns include:</p>
                <ul>
                    <li><strong>Sets</strong> – Shows the 2-piece and 5-piece sets active in that combination.</li>
                    <li><strong>Main</strong> – The echo equipped in the main slot (often your 3- or 4-cost echo).</li>
                    <li><strong>∑ Cost</strong> – Total echo cost, which must be ≤ 12 for a valid build.</li>
                    <li><strong>∑ ATK / HP / DEF / ER / CR / CD</strong> – Summed stats from all five echoes.</li>
                    <li><strong>∑ BNS% / AMP%</strong> – Total relevant damage bonuses and amplifications contributed by echo sets and substats.</li>
                    <li><strong>DMG</strong> – The optimizer's estimated damage (or healing/shielding) for this build.</li>
                    <li><strong>DIFF</strong> – The upgrade (or downgrade) as compared to your original build, helping you see how much stronger it is at a glance.</li>
                </ul>

                <h4>7. Inspecting & Equipping Results</h4>
                <p>When you click on a result, you can:</p>
                <ul>
                    <li>Inspect which specific echoes it uses in each slot.</li>
                    <li>Check the exact main and substats contributing to the totals.</li>
                    <li>Optionally <strong>apply</strong> that build to your character, updating the main calculator to use that combination.</li>
                </ul>
                <p>This lets you bounce between "theory" (optimizer results) and "practice" (full damage breakdown in the Damage Section) without manually reassigning echoes one by one.</p>

                <h4>8. Performance Tips</h4>
                <ul>
                    <li><strong>Tighten filters</strong> if the combination count is extremely high. Increasing the filter strength or narrowing allowed sets can dramatically speed things up.</li>
                    <li><strong>Use a main echo lock</strong> when you already know which echo you want in the primary slot, rather than letting the optimizer search every possibility.</li>
                </ul>

                <h4>9. Troubleshooting Results</h4>
                <ul>
                    <li>If you get <strong>no valid combinations</strong>, your filters may be too strict. Loosen set restrictions or reduce filter strength.</li>
                    <li>If results look "worse" than your current build, verify that your <strong>Echo Bag</strong> and equipped echoes are in sync with what you actually want to optimize.</li>
                    <li>If you change your character's build (weapons, buffs, or level), rerun the optimizer to update damage estimates.</li>
                </ul>

                <h4>10. Set Conditionals</h4>
                <p>Open <strong>Set Conditionals</strong> from Character Settings to control which Sonata effect parts are allowed during optimization.</p>
                <ul>
                    <li>Each set part can be toggled on/off (base piece effects, stack parts, and trigger-based parts).</li>
                    <li>Disabled parts are excluded from scoring, which is useful for realistic uptime testing.</li>
                    <li>Enabled parts are counted normally when set-piece requirements are met.</li>
                    <li>These values are shared with Suggestions for the same character, so both tools compare with the same assumptions.</li>
                </ul>

                <p>The optimizer is meant to feel like an automated theorycrafter: you can tell it which stats and sets you care about, and it sifts through the combinatorial chaos to surface the most promising builds.</p>
            `
      }
    ]
  },
  {
    category: 'Custom Buffs',
    guides: [
      {
        title: 'Using Custom Buffs',
        type: 'article',
        shortDesc: 'Add and adjust personal buffs for testing stat variations and conditional bonuses.',
        content: `
                <p>The <strong>Custom Buffs Pane</strong> lets you manually add or adjust stat bonuses that aren't tied to characters, teammates, weapons, or echoes. It's perfect for testing how specific buffs affect your final damage output.</p>

                <h4>1. Main Stats</h4>
                <p>At the top, you'll see inputs for <strong>Attack</strong>, <strong>HP</strong>, and <strong>Defense</strong> — each with a flat and percentage field.
                You can also modify core attributes like <strong>Crit Rate</strong>, <strong>Crit Damage</strong>, <strong>Energy Regen</strong>, and <strong>Healing Bonus</strong>.
                These directly influence your base stats and are reflected instantly in your character summary.</p>

                <h4>2. Damage Modifiers</h4>
                <p>Below, you'll find a large grid of fields controlling how different attack types and elements are boosted.
                These include <strong>Basic, Heavy, Resonance Skill, and Resonance Liberation</strong> damage, as well as attribute bonuses such as <span style="color: rgb(15,205,160); font-weight: bold;">Aero</span>, <span style="color: rgb(62,189,227); font-weight: bold;">Glacio</span>, and <span style="color: rgb(197,52,79); font-weight: bold;">Fusion</span>.
                Each stat can be entered as a percentage value to represent bonus damage.</p>

                <h4>3. Amplify and Shred Effects</h4>
                <p>Amplify modifiers boost damage scaling rather than adding flat bonuses.
                They apply to specific attack types or attributes (e.g., "Basic Attack DMG Amplify" or "Spectro DMG Amplify").
                You can also simulate defensive effects with fields like <strong>Enemy DEF Shred</strong>, <strong>Enemy DEF Ignore</strong>, or <strong>Enemy RES Shred</strong> to test how they impact your damage output.</p>

                <h4>4. Coordinated and Special Damage</h4>
                <p>Coordinated and special damage types, such as <span style="color: rgb(202,179,63); font-weight: bold;">Frazzle</span> or <span style="color: rgb(15,205,160); font-weight: bold;">Erosion</span>, have their own dedicated fields.
                These affect abilities that trigger off allied attacks or secondary damage sources.</p>

                <h4>5. Adjusting Values</h4>
                <p>Simply type numbers into the fields to modify stats.
                Percent-based fields automatically include a "%" symbol, while flat stats are raw numeric values.
                All changes apply instantly to your calculations — no need to press Save.</p>

                <h4>6. Clearing Buffs</h4>
                <p>If you want to reset everything, click the <span style="color: red; font-weight: bold;">Clear All</span> button at the bottom.
                This restores all fields to zero and removes every manually added buff.</p>

                <p>The Custom Buffs pane is ideal for experimentation.
                Whether you're modeling food buffs, temporary effects, or new theories about damage scaling,
                this section gives you total control over the numbers before they merge into your final stat pool.</p>
            `
      }
    ]
  },
  {
    category: 'UI Controls',
    guides: [
      {
        title: 'Toggles, Stacks, and Input Fields Explained',
        type: 'article',
        shortDesc: 'Learn how to use character toggles, stack counters, and input fields — and when they\'re locked, conditional, or not required.',
        content: `
                <p>Each character's section in the calculator includes interactive elements that simulate in-game conditions. These controls let you manually enable buffs, adjust stack counts, or input numeric values to reflect your combat setup more accurately. Understanding how they behave ensures your results match in-game performance.</p>

                <h4>1. Toggles (On/Off Buffs)</h4>
                <p>Toggles are checkboxes used to enable or disable specific states or abilities. When checked, the corresponding buff becomes active and its effects are immediately reflected in your calculations.</p>

                <p>For example, <strong>Zani</strong>'s <span class="highlight">Inferno Mode</span> toggle activates a state where her Basic Attack damage is increased. You can switch it on when testing burst phases or off when simulating downtime.</p>

                <p>Some toggles are <strong>conditional</strong>. <strong>Lupa</strong>'s <span class="highlight">Pack Hunt (2)</span> toggle only activates when your team has exactly three <span style="color: rgb(197,52,79); font-weight: bold;">Fusion</span> Resonators. If that condition isn't met, the toggle is dimmed and displays a message like <em>"Needs 3  <span style="color: rgb(197,52,79); font-weight: bold;">Fusion</span> Resonators in the team."</em> This prevents impossible setups from being activated.</p>

                <p>Other toggles, such as <span class="highlight">Outro Skill</span> buffs like <strong>Binary Butterfly</strong> or <strong>Beacon for the Future</strong>, can be freely toggled at any time, since they represent effects that can occur during normal play.</p>

                <h4>2. Stacks (Layered Buff Counters)</h4>
                <p>Stack counters simulate effects that build up over time or through repeated actions. These appear as dropdowns or numeric selectors labeled <strong>Stacks</strong>.</p>

                <p>For instance, <strong>Lupa</strong>'s <span class="highlight">Hunting Field</span> can stack up to 2 times, granting a  <span style="color: rgb(197,52,79); font-weight: bold;">Fusion DMG Bonus</span> for each stack. You can use the dropdown to select 0, 1, or 2 stacks, and the total buff scales accordingly.</p>

                <p>Similarly, Zani's <span class="highlight">Heliacal Ember</span> uses a numeric input where you can enter the current number of embers (from 0–60). Each stack increases damage dealt by a fixed percentage, making it easy to test full-power states versus minimal ones.</p>

                <p>When a stack-based ability isn't relevant to a character or build, its field simply won't appear.</p>

                <h4>3. Input Fields (Dynamic Values)</h4>
                <p>Numeric input fields let you fine-tune continuous values such as percentages, thresholds, or resource levels. For example, <strong>Energy Regen</strong> sliders and <strong>Blaze Consumed</strong> inputs directly modify the calculations they're tied to.</p>

                <p>In <strong>Zani</strong>'s case, her <span class="highlight">Blaze Consumed</span> input allows values up to 40 (or more for sequence variants). Each number represents how many Blazes are used in her Heavy Attack, directly scaling her damage. These inputs are clamped to valid ranges, so entering an invalid value automatically snaps back to the nearest limit.</p>

                <p>Inputs also respect dependencies — for example, some sliders or dropdowns may be disabled if a prerequisite state isn't active or unlocked by sequence level.</p>

                <h4>4. Level and Sequence Restrictions</h4>
                <p>Some toggles or stack fields are locked until the Resonator reaches a specific level or sequence tier. These are shown with faded color and a tooltip such as <em>"Unlocks at Lv. 70"</em> or <em>"Requires Sequence 3"</em>. When you raise your character level or sequence value in the app, the controls automatically become usable.</p>

                <h4>5. When Controls Aren't Needed</h4>
                <p>If a skill or state is always active by default — for example, a passive buff that doesn't depend on toggles or stacks — no interactive field is shown. The calculator hides unnecessary inputs to reduce clutter and make the layout intuitive.</p>

                <h4>6. How They Work Together</h4>
                <p>Many of these elements interact dynamically. Activating <span class="highlight">Inferno Mode</span> for Zani can affect how her <span class="highlight">Blaze Consumed</span> input contributes to damage. Similarly, enabling <span class="highlight">Pack Hunt</span> for Lupa modifies how her <span class="highlight">Hunting Field</span> stacks scale team-wide bonuses. These interactions ensure your setup behaves like an in-game combat sequence rather than isolated numbers.</p>

                <p>Every toggle, stack, and input updates the calculator in real time — so you can test how buffs combine, explore edge cases, and see exactly how different configurations change your team's performance.</p>
            `
      }
    ]
  },
  {
    category: 'Echo Importing',
    guides: [
      {
        title: 'Using the Echo Parser',
        type: 'article',
        shortDesc: 'Quickly import your equipped Echoes directly from screenshots using OCR and image recognition.',
        content: `
                <p>The <strong>Echo Parser</strong> lets you import your full set of equipped Echoes automatically from a screenshot — no manual stat entry required. It uses OCR (optical character recognition) and image comparison to read the details directly from an image generated by the <strong>Wuthering Waves bot</strong>.</p>

                <h4>1. What It Does</h4>
                <p>This feature scans an image of your Echo setup, detects each Echo's cost, main stat, substats, and set name, and then automatically equips them for the currently selected character. It's a fast, hands-free way to sync your in-game build with the calculator.</p>

                <h4>2. Getting a Valid Image</h4>
                <p>For the parser to work properly, your image must match the expected format:</p>
                <ul>
                    <li>Use the <code>/create</code> command with the <strong>Wuwa bot</strong> on the official Wuthering Waves Discord server (or anywhere else the bot is available).</li>
                    <li>Make sure the image resolution is exactly <strong>1920 × 1080</strong>.</li>
                    <li>Do not crop, resize, or compress the screenshot — even slightly altering dimensions can break detection.</li>
                    <li>The parser currently supports <strong>English text only</strong>.</li>
                    <li>The import is not always 100% accurate — check results after import and make manual corrections if needed.</li>
                </ul>

                <h4>3. Starting the Import</h4>
                <p>Click the <strong>Import Echo</strong> button in the Echoes section (top left). This opens a pop-up with import rules and a sample image preview.</p>
                <ul>
                    <li>You can drag and drop your image into the import window, paste it from your clipboard, or click <strong>Choose Image</strong> to upload it manually.</li>
                    <li>The app automatically validates the resolution before continuing.</li>
                    <li>If the image is invalid (wrong size or format), a red error toast appears.</li>
                </ul>

                <h4>4. Parsing Process</h4>
                <p>Once a valid image is uploaded, the system runs the following steps automatically:</p>
                <ul>
                    <li>Preloads reference icons for all known Echoes and set logos to improve recognition accuracy.</li>
                    <li>Uses OCR (via <strong>Tesseract.js</strong>) to detect text for main stats and substats.</li>
                    <li>Extracts five echo regions across the bottom of the image, matching the exact coordinates used by the Wuwa bot layout.</li>
                    <li>Compares each icon region pixel-by-pixel with stored reference images to determine the Echo's name and set.</li>
                    <li>Applies all parsed Echo data instantly to your current character — including main stats, substats, cost, and set.</li>
                </ul>
                <p>During parsing, a spinner will appear with a loading animation. Once finished, you'll see a success message</p>

                <h4>5. Accuracy Notes</h4>
                <p>The parser is trained for images in the default bot format and English text. It works best when:</p>
                <ul>
                    <li>Text is clear and uncompressed.</li>
                    <li>Stats don't overlap or blur into backgrounds.</li>
                    <li>The image hasn't been modified or taken through screenshots of screenshots (which causes compression artifacts).</li>
                </ul>
                <p>If an imported Echo looks off, you can open it in the <strong>Edit Substats</strong> modal to adjust values or fix stat labels manually.</p>

                <h4>6. Managing Imports</h4>
                <p>After a successful import:</p>
                <ul>
                    <li>Your five Echo slots update instantly with the new data.</li>
                    <li>Each imported Echo automatically gets its proper set icon and name.</li>
                    <li>You can still edit, remove, or replace individual Echoes afterward.</li>
                </ul>

                <h4>7. Behind the Scenes</h4>
                <p>Here's a simplified overview of what happens technically:</p>
                <ul>
                    <li>Each Echo slot's region in the screenshot is mapped to pre-defined coordinates.</li>
                    <li>Each slot's cost, main stat, and substats are extracted as text using OCR.</li>
                    <li>Icon matching runs via pixel comparison between the slot's image region and a preloaded cache of reference icons.</li>
                    <li>The results are passed to a converter that builds real Echo objects and applies them to your current character state.</li>
                </ul>
                <p>This all happens locally in your browser — no external uploads or server-side processing.</p>

                <h4>8. Troubleshooting</h4>
                <ul>
                    <li>If nothing happens after upload, check that the image is exactly 1920×1080.</li>
                    <li>If some stats look wrong, open each Echo's edit window and correct them manually.</li>
                    <li>Images in other languages or formats (like cropped in-game screenshots) aren't supported yet.</li>
                    <li>For repeated errors, try refreshing and importing again — browser caching sometimes interferes with reference images.</li>
                </ul>

                <h4>9. Performance Tips</h4>
                <ul>
                    <li>First import may take a few extra seconds while reference images load; subsequent imports will be much faster.</li>
                    <li>Paste directly from your clipboard (Ctrl+V / Cmd+V) instead of saving locally — it's faster and skips file browsing.</li>
                </ul>

                <h4>10. Disclaimer on Image Format Changes</h4>
                <p><span style="font-weight: bold; color: red">Important:</span> The parser depends entirely on the current format of images generated by the <strong>official Wuthering Waves Discord bot</strong> (or other supported generators). If <strong>Kuro Games</strong> or the maintainers of the bot ever change the image layout, text alignment, or resolution, the parser will no longer recognize data correctly until it's updated. In such cases, results will be unreliable until the parsing coordinates and recognition templates are adjusted.</p>
            `
      }
    ]
  },
  {
    category: 'App Controls',
    guides: [
      {
        title: 'App Actions & Activities',
        type: 'article',
        shortDesc: 'Understand what happens when you save, reset, sync, or interact with features throughout the calculator.',
        content: `
                <h4>1. Saving & Persistence</h4>
                <p>Almost everything you do in the app — selecting characters, changing buffs, editing Echoes, setting up rotations — is saved automatically. This is handled through local storage, so your configuration stays exactly how you left it, even after refreshing or closing the browser.</p>
                <ul>
                    <li><strong>Auto-Save:</strong> Each pane saves its state (Echoes, Rotations, Buffs, Theme, etc.) individually, so updates in one area don't reset another.</li>
                    <li><strong>Session Continuity:</strong> When you reopen the app, your last selected character, layout, and visual theme are restored automatically.</li>
                    <li><strong>Persistent Settings:</strong> Preferences like system theme mode, animation toggles, or Drive Sync authentication are remembered until explicitly cleared.</li>
                </ul>

                <h4>2. App Reset</h4>
                <p>The <strong>Delete</strong> button, found on the Settings page, completely restores the calculator to its default state — as if you were opening it for the very first time. It deletes <strong>everything</strong> stored locally, including saved rotations, equipped Echoes, team compositions, buffs, and all user preferences.</p>

                <ul>
                    <li><strong>Full Data Wipe:</strong> All localStorage data and runtime states are cleared instantly, including saved rotations, team rotations, Echo setups, and character progress.</li>
                    <li><strong>Preference Reset:</strong> Dark/light theme overrides, dropdown selections, and pane-specific toggles are restored to default values.</li>
                    <li><strong>UI Memory:</strong> Clears cached states like last-opened panels, tooltips, and toast history.</li>
                    <li><strong>Global State:</strong> All character- and weapon-specific configurations are deleted, including any custom buffs or conditions you created.</li>
                </ul>

                <p>After confirmation, the app performs a full reload to rebuild a clean environment.
                Your <strong>Google Drive–linked data</strong> (if Drive Sync is enabled) is not deleted automatically — it stays safe on your cloud storage until you manually remove or overwrite it from there.
                Everything else stored locally will be permanently lost.</p>

                <p>Use this action only when you want to start completely fresh or troubleshoot corrupted data. The reset is immediate, irreversible, and cannot be undone once confirmed.</p>

                <h4>3. Theme & System Behavior</h4>
                <p>The calculator's visual theme adapts dynamically:</p>
                <ul>
                    <li><strong>System Mode:</strong> It follows your device's current theme (light or dark) automatically.</li>
                    <li><strong>Manual Toggle:</strong> You can override it with the switch in Settings. The toggle mimics system behavior and updates instantly if your OS theme changes.</li>
                    <li><strong>Visual Consistency:</strong> All panes (Echoes, Rotations, Buffs) share the same theme context, so transitions are smooth and unified.</li>
                </ul>

                <h4>4. Font Customization</h4>
                <p>The calculator now supports full <strong>Font Customization</strong>, allowing you to personalize how text appears across the interface for readability or aesthetics.</p>
                <ul>
                    <li><strong>Font Selector:</strong> Found in the <em>Settings</em> page, it lets you choose from available typefaces that fit different visual moods — from clean modern fonts to elegant serif styles.</li>
                    <li><strong>Live Preview:</strong> Changes take effect instantly across the entire app so you can see how they look before leaving the menu.</li>
                    <li><strong>Persistence:</strong> Your selected font is saved in local storage and re-applied automatically on reload.</li>
                    <li><strong>Compatibility:</strong> Fonts are fully theme-aware — ensuring consistent contrast and legibility in both light and dark modes.</li>
                </ul>
                <p>This feature is especially helpful for users who want stronger accessibility or simply a personalized aesthetic to match their workflow.</p>

                <h4>5. Exporting & Google Drive Sync</h4>
                <p>The app supports exporting and syncing data, especially for advanced users who use multiple devices or want backups:</p>
                <ul>
                    <li><strong>Google Drive Sync:</strong> When enabled, your app state and configurations (Echoes, Rotations, etc.) save securely to your Google Drive in the hidden "AppData" folder.</li>
                    <li><strong>Export / Import:</strong> You can export app data as <code>.json</code> files and import them later, or share with other users.</li>
                </ul>

                <h4>6. Interactive Activities</h4>
                <p>Most parts of the app respond interactively — meaning they update immediately without reloading:</p>
                <ul>
                    <li><strong>Dragging & Dropping:</strong> You can reorder rotation entries, Echoes, or blocks using intuitive drag-and-drop behavior. All changes recalculate live.</li>
                    <li><strong>Popup Messages:</strong> Small toasts appear to confirm actions (e.g., saving to bag, invalid import, success messages). These fade automatically but can be interacted with while visible.</li>
                    <li><strong>Expandable Sections:</strong> Each pane uses collapsible sections (like Buffs, Totals, and Rotations) so you can keep your workspace tidy while focusing on specific areas.</li>
                    <li><strong>Dynamic Tooltips:</strong> Hovering over stats or icons reveals detailed tooltips showing what each number represents, including calculated roll values or set bonuses.</li>
                </ul>
            `
      }
    ]
  },
  {
    category: 'Overview',
    guides: [
      {
        title: 'Using the Overview Section',
        type: 'article',
        shortDesc: 'Get a full, interactive summary of your character\'s build.',
        content: `
                <p>The <strong>Overview Section</strong> gives you a complete visual snapshot of your character's build, combining both style and substance. It merges the <strong>Character Overview</strong> and <strong>Overview Detail Pane</strong> into a single, interactive display where you can view, verify, and showcase your entire setup at a glance.</p>

                <h4>1. Overview Layout</h4>
                <p>The Overview is divided into two complementary panels:</p>
                <ul>
                    <li><strong>Left Panel:</strong> Shows a list of all characters you're ever used.</li>
                    <li><strong>Right Panel:</strong> Displays your character's splash art, name, level, weapon, Echoes, teammates... all that stuff — all dynamically linked to your current configuration.</li>
                </ul>

                <h4>2. Equipped Weapon</h4>
                <p>Beneath the character info, the equipped weapon is shown with its icon, name, and rank. Hovering reveals its passive description and scaling. Any change you make in the <strong>Weapon Pane</strong> like changing its level or refinement immediately updates here.</p>

                <h4>3. Rotation Summary</h4>
                <p>The Overview includes two compact <strong>Rotation Boxes</strong> that summarize damage from your personal and team rotations. They let you review totals, skill-by-skill breakdowns, and teammate contributions without leaving the Overview page.</p>
                <ul>
                  <li><strong>Dropdown:</strong> Each box includes a dropdown that lets you choose which rotation to view — either your <em>live rotation</em> ("Rotation DMG" or "Team Rotation DMG") or any <em>saved rotation</em> by name.</li>
                  <li><strong>Displayed values:</strong> Both boxes show three key numbers:
                    <ul>
                      <li><strong>Normal</strong> – non-critical damage total,</li>
                      <li><strong>CRIT</strong> – critical hit total,</li>
                      <li><strong>AVG</strong> – average combined damage.</li>
                    </ul>
                    Hovering over any value reveals the full formatted number with separators for precision.
                  </li>
                  <li><strong>Click to cycle views:</strong> Clicking inside a rotation box cycles through progressively detailed breakdowns.
                    <ul>
                      <li>First displays the <em>Total</em> (all skills or characters combined).</li>
                      <li>Subsequent clicks move through each component — skills in your personal rotation, or characters in your team rotation.</li>
                    </ul>
                  </li>
                  <li><strong>Contribution:</strong> Contributions (teammates or damage type) are shown as percentage values.</li>
                  <li><strong>Missing breakdowns:</strong> If a saved rotation doesn't yet have detailed breakdown data, you'll see the note <em>"Re-save to see breakdown."</em> Simply load and re-save the rotation to generate its per-skill details.</li>
                  <li><strong>Visibility:</strong> The <em>Personal Rotation Box</em> always appears when you have any personal rotations saved. The <em>Team Rotation Box</em> appears only when valid team rotations exist (e.g., teammates with linked rotations through the Team Buffs section).</li>
                </ul>

                <p><em>Tip:</em> Both boxes behave similarly — but the personal box cycles through <strong>skills</strong>, while the team box cycles through <strong>characters</strong>. Changing the dropdown always resets the view back to "Total."</p>

                <h4>4. Equipped Echoes</h4>
                <p>Below everything all five Echo slots in your current build are listed such that each Echo shows its icon, cost, and set badge ans stats</p>
                <p>It's section provides an instant visual summary of your entire Echo configuration — no need to switch tabs to verify substats or sets.</p>

                <h4>5. Core Combat Stats</h4>
                <p>Next to your the character portrait, your merged combat stats — all calculated in real time using data from weapons, echoes, buffs, and teammates. The grid includes:</p>
                <ul>
                    <li><strong>Base Attributes:</strong> HP, ATK, DEF, and Energy Regen.</li>
                    <li><strong>Offensive Stats:</strong> Crit Rate, Crit DMG, Elemental DMG Bonus, and Skill-specific bonuses.</li>
                </ul>

                <h4>6. Teammate Summary</h4>
                <p>Your selected teammates are displayed as icons. In that same section any <strong>Echo Set</strong> or <strong>Weapon Buffs</strong> from <strong>Team Buffs</strong> show on here.</p>

                <h4>7. Derived Metrics</h4>
                <p>The Overview includes advanced metrics like <strong>Crit Value (CV)</strong> and <strong>Build Score</strong>, which evaluate how optimized your build is. These are derived automatically:</p>
                <ul>
                    <li><strong>Crit Value (CV):</strong> A combined score from Crit Rate and Crit DMG — used to measure offensive balance.</li>
                    <li><strong>Build Score:</strong> A normalized build quality metric based on Echo substat efficiency and scoring. (See more under the <strong>Scoring</strong> guide category.</li>
                </ul>

                <h4>8. Real-Time Updates and Interaction</h4>
                <p>The Overview Section is fully synchronized with the rest of the app:</p>
                <ul>
                    <li>Changing an Echo or stat in any other pane updates the Overview immediately.</li>
                    <li>Swapping weapons or refining passives reflects in both visual display and numeric stats.</li>
                    <li>Enabling or disabling buffs from teammates dynamically adjusts totals shown here.</li>
                </ul>

                <h4>9. Screenshot Export</h4>
                <p>The Overview supports both light and dark modes automatically and is designed for visual exports. You can capture it using the <strong>Screenshot</strong> or <strong>Copy to Clipboard</strong> options in your calculator for easy sharing.</p>

                <p><span style="font-weight: bold; color: red">Important:</span> You can't explicitly change a character's build from this interface.</p>
            `
      }
    ]
  },
  {
    category: 'Damage & Scaling',
    guides: [
      {
        title: 'Understanding the Damage Section',
        type: 'article',
        shortDesc: 'Learn how damage is calculated and how to read skill breakdowns and sub-hits in the results display.',
        content: `
                <p>The <strong>Damage Section</strong> shows the calculated output of every skill or effect for your active character, based on the same combat model described on the <a href="https://wutheringwaves.fandom.com/wiki/Damage" target="_blank" rel="noopener noreferrer"><strong>Wuthering Waves Wiki</strong></a>. It combines your stats, skill multipliers, and combat modifiers into final <strong>Normal</strong>, <strong>CRIT</strong>, and <strong>Average</strong> values.</p>

                <h4>1. How Damage is Calculated</h4>
                <p>Every skill uses scaling values for ATK, HP, or DEF, applies multipliers and bonuses, then adjusts for enemy defense and resistance.</p>
                <pre><code class="language-js">
        Base = (ATK × atkScaling) + (HP × hpScaling) + (DEF × defScaling)
        Final = (Base × Multiplier + FlatBonus)
              × defMult × resMult × (1 + Bonuses) × (1 + Amplifications)
        Crit  = Final × (1 + CritDmg)
        Avg   = (Crit × CritRate) + (Final × (1 - CritRate))
                </code></pre>
                <p>This model also handles DoT effects like <span style="color: rgb(202,179,63); font-weight: bold;">Spectro Frazzle</span> and <span style="color: rgb(15,205,160); font-weight: bold;">Aero Erosion</span> using per-tick multipliers, applied without crit variance but still affected by resistance and DoT amplification.</p>

                <h4>2. Reading the Damage Display</h4>
                <p>Each skill row shows three columns — <strong>Normal</strong>, <strong>CRIT</strong>, and <strong>AVG</strong> — representing the calculated output after all modifiers. Hovering over a number shows its precise value with formatting separators for clarity.</p>

                <ul>
                  <li><strong>Normal:</strong> Damage without crits or variance.</li>
                  <li><strong>CRIT:</strong> Damage with full crit multiplier.</li>
                  <li><strong>AVG:</strong> Weighted damage using current crit rate.</li>
                </ul>

                <h4>3. Sub-Hits and Multi-Hit Skills</h4>
                <p>Some skills, such as multi-hit combos or chained attacks, include expandable <strong>sub-hit breakdowns</strong>. Click the checkbox above the damage section to toggle the detailed breakdown for all skills.</p>
                <ul>
                  <li>Each sub-hit lists its own Normal, CRIT, and AVG values.</li>
                  <li>Hovering over a main skill's hit value shows its sub-hit formula.</li>
                </ul>

                <h4>4. Tips and Visual Cues</h4>
                <ul>
                  <li>Values exceeding certain thresholds are cut off (e.g., 51.8B ).</li>
                  <li>Support skills such as healing and shielding are highlighted.</li>
                  <li>Echo skills show once a main echo with skills that inflict damage is set.</li>
                </ul>

                <h4>6. Summary</h4>
                <p>All values are derived using the same structure as in the <a href="https://wutheringwaves.fandom.com/wiki/Damage" target="_blank" rel="noopener noreferrer">Wuthering Waves damage formula</a>. The interface simply visualizes this computation — showing how scaling, bonuses, and defenses shape each skill's final performance.</p>
              `
      }
    ]
  },
  {
    category: 'Build and Echo Scoring',
    guides: [
      {
        title: 'Understanding the Scoring System',
        type: 'article',
        shortDesc: 'How Echo stats, rolls, and character weights combine into a total build score.',
        content: `
                <p>The calculator uses a dynamic <strong>Scoring System</strong> to evaluate the quality of your Echoes and overall build efficiency. It measures both <strong>substat rolls</strong> and <strong>character-specific stat relevance</strong> to produce consistent, comparable results — expressed through values like <strong>Echo Score</strong>, <strong>Percent Score</strong>, and <strong>Crit Value (CV)</strong>.</p>

                <h4>1. Purpose of the Scoring System</h4>
                <p>In <a href="https://wutheringwaves.fandom.com/wiki/Echo/Stats" target="_blank" rel="noopener noreferrer">Wuthering Waves</a>, Echoes can roll stats with variable strength, and not every stat benefits each character equally. This scoring model solves that by weighting and normalizing each stat based on:</p>
                <ul>
                  <li><strong>Roll quality:</strong> How close the stat is to its maximum possible value.</li>
                  <li><strong>Character weights:</strong> How valuable that stat is for the selected character's kit.</li>
                  <li><strong>Distribution:</strong> How much each Echo contributes to the overall build efficiency.</li>
                </ul>

                <h4>2. Substat Roll Quality</h4>
                <p>Each substat has a known range from its minimum to maximum possible value, divided into several "roll tiers." The calculator grades each substat's strength as a percentage between 0–100 based on its actual rolled value.</p>

                <pre><code class="language-js">
    # Example (ATK%)
    min = 6.4%, max = 11.6%, possibleRolls = 8
    roll = 9.6%
    → Roll Grade = 30 + ((roll - min) / (max - min)) × (100 - 30)
                </code></pre>

                <p>Lower-tier rolls score closer to 30%, while near-perfect rolls approach 100%. This simulates in-game roll variance for consistent comparison.</p>

                <h4>3. Main Stat and Substat Normalization</h4>
                <p>Main stats and substats are normalized by comparing them to ideal reference values per Echo cost tier:</p>
                <ul>
                  <li><strong>Cost 1 Echoes:</strong> HP% / ATK% / DEF% with flat HP as a fixed second stat.</li>
                  <li><strong>Cost 3 Echoes:</strong> Attribute DMG% / Energy Regen% / HP% / ATK% / DEF%, flat ATK fixed second stat.</li>
                  <li><strong>Cost 4 Echoes:</strong> CRIT Rate% / CRIT DMG% / Healing Bonus% / HP% / ATK% / DEF%, with flat ATK as a secondary.</li>
                </ul>

                <pre><code class="language-js">
    # Normalization
    normalizedQuality = (actualValue / idealValue) × 100
    # idealValue used is 44 (crit dmg's main stat value because it's the highest)
                </code></pre>

                <p>This keeps all stats comparable even when using different Echo costs or stat categories.</p>

                <h4>4. Character Weighting</h4>
                <p>Each character in the database has a <strong>stat weight profile</strong> that defines how much value they gain from each stat type. These weights are stored per-character and applied automatically when computing Echo scores.</p>

                <pre><code class="language-js">
    # Example (Pheobe)
    {
        atkPercent: 1,
        atkFlat: 0.75,
        energyRegen: 1,
        critRate: 1,
        critDmg: 1,
        heavyAtk: 0.75,
        spectro: 1
    }
                </code></pre>

                <p>Weights range between <code>0</code> (irrelevant) and <code>1</code> (highly desirable). They ensure the system favors stats that actually scale with the character's kit.</p>

                <h4>5. Echo Score Formula</h4>
                <p>The calculator combines roll quality and stat weights to produce three key metrics for each Echo:</p>

                <pre><code class="language-js">
    mainScore = (mainStatValue × normalizedQuality × weight)
    subScore  = Σ (subStatValue × normalizedQuality × weight)
    totalScore = mainScore + subScore
                </code></pre>

                <p>Every Echo's <code style="font-weight: bold">totalScore</code> represents its contribution to your build's overall power potential, scaled by how relevant those stats are for your character.</p>

                <h4>6. Build Scoring and Percent Score</h4>
                <p>Once all Echoes are scored, the system sums their weighted totals and divides them by the theoretical maximum possible score for that character's top 5 substats:</p>

                <pre><code class="language-js">
    buildScore = (TotalEchoScore / Top5SubstatMax) × 100
                </code></pre>

                <p>This gives your overall build a "Percent Efficiency" score, where 100% would represent a mathematically perfect distribution of substats and main stats for that character.</p>

                <h4>7. Crit Value (CV)</h4>
                <p>As a secondary metric, <strong>CV</strong> (Crit Value) is shown to summarize your offensive potential:</p>

                <pre><code class="language-js">
    CV = (Crit Rate × 2) + Crit DMG
                </code></pre>

                <p>While it's a simpler measure, it's useful for comparing builds of DPS characters that rely heavily on critical scaling.</p>

                <h4>8. How Scores are Displayed</h4>
                <ul>
                  <li><strong>Echo Score:</strong> Appears on each Echo tile (main + sub combined).</li>
                  <li><strong>Build Score:</strong> Shown under the Overview or Stats panels as "Build Score."</li>
                  <li><strong>Crit Value:</strong> Listed alongside Crit Rate and Crit DMG in stat breakdowns.</li>
                </ul>

                <h4>9. Practical Notes</h4>
                <ul>
                  <li>Score weighting is unique per character.</li>
                  <li>Substats are graded using exact in-game roll ranges from the <a href="https://wutheringwaves.fandom.com/wiki/Echo/Stats" target="_blank" rel="noopener noreferrer">Wuthering Waves Wiki</a>.</li>
                  <li>Flat stats generally contribute less unless the character has scaling abilities that justify them.</li>
                </ul>

                <p>The scoring system is built to reflect in-game optimization standards, helping you identify strong Echo rolls, measure build efficiency, and compare setups on equal ground.</p>
              `
      }
    ]
  }
]
