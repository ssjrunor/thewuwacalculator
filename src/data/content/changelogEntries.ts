export interface ChangelogEntry {
  type: 'paragraph'
  content: string
}

export interface ChangelogRecord {
  date: string
  shortDesc?: string
  patchVersion?: string
  entries: ChangelogEntry[]
}

export interface ChangelogSection {
  id: 'current' | 'legacy'
  label: string
  entries: ChangelogRecord[]
}

export const currentChangelogEntries: ChangelogRecord[] = [
  {
    date: '30/03/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          The <strong>New Wuwa Calculator</strong> is finally here. The old app had reached the kind of state where even simple changes kept turning into wrestling matches, so i stopped trying to politely patch around it and rebuilt the whole thing from the ground up instead.
        `,
      },
      {
        type: 'paragraph',
        content: `
          New design, cleaner structure, way less "huh??" energy, and a much better foundation for adding things without the entire app threatening to explode dramatically in the background.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Already includes a ton of revamped stuff compared to the original:<br/>
          - Full calculator workspace rework with clearer panes and stronger overview flow.<br/>
          - Inventory, rotations, optimizer, and suggestions systems have all been carried forward into a much saner structure for future updates.<br/>
        `,
      },
      {
        type: 'paragraph',
        content: `
          There is still plenty more to do, obviously, but this remake exists so future features can be added like a normal person instead of performing surgery on a "rare" beef.
        `,
      },
    ],
    shortDesc: `new app, new foundation, way less suffering (〜^∇^)〜`,
  },
  {
    date: '03/04/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          Polished up <strong>Background Mode</strong> a lot more. The wallpaper side of the app should feel way nicer now instead of just being "yes there is technically an image behind the UI" and calling it a day.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Wallpaper picking now uses cleaner preview cards, custom uploads behave better, switching backgrounds feels smoother, and the frosted/glassy look should match the active wallpaper much more naturally across the app.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Also brought over <strong>Set Conditionals</strong> properly. You can now control which set-effect parts the app is allowed to consider for optimization/simulation stuff instead of having to just trust whatever mystery assumptions it was making in the background (Not really but you get the point).
        `,
      },
      {
        type: 'paragraph',
        content: `
          ALSO... cleaned up a bunch of layout and popup styling weirdness while i was in there, so some menus, panels, and calculator sections should feel a bit less cramped and a bit less likely to do silly things.
        `,
      },
    ],
    shortDesc: `Background mode polish + Set Conditionals~! (〜^∇^)〜`,
  },
  {
    date: '07/04/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.3 support</strong> is in now, so <strong>Hiyuki</strong> and <strong>Denia</strong> are both available in the calculator along with their base kit logic, new weapons, and the new sonata sets instead of the patch just sort of staring at the app awkwardly from outside.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Also finished wiring more of the negative-effect side properly. <strong>Glacio Chafe</strong>, <strong>Glacio Bite</strong>, <strong>Electro Flare</strong>, and <strong>Electro Rage</strong> all behave much more like real systems now instead of loose mystery values, and the enemy UI got cleaned up so statuses show up in a way that is way easier to read at a glance.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Brought in preset/default rotations for some of the newer roster too, including <strong>Buling</strong>, <strong>Luuk Herssen</strong>, <strong>Denia</strong>, and <strong>Hiyuki</strong>, so there is less "ok now i guess i manually build the whole thing from scratch" energy when opening them for the first time.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Importing older saved data should behave better now as well. Some older exported resonator setups were getting grumpy after schema changes, so persistence/import handling was tightened up to normalize things more safely instead of just refusing to save and acting dramatic.
        `,
      }
    ],
    shortDesc: `3.3 support, negative effects cleanup and default rotations~! (〜^∇^)〜`,
  },
  {
    date: '11/04/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          The <strong>Optimizer</strong> got a much bigger simulation setup pass. The page is now split into clearer <strong>Simulation Settings</strong>, <strong>Simulation Team</strong>, and <strong>Simulation Results</strong> sections, so the app should feel less like everything was stuffed into one suspiciously powerful drawer.
        `,
      },
      {
        type: 'paragraph',
        content: `
          You can now adjust the optimizer team directly in the optimizer view: active resonator setup, teammate slots, weapons, main echoes, set plans, relevant state toggles, ranks, sequences, and team-facing effects are all much easier to reach without bouncing around the rest of the calculator.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Manual buffs are also less buried now. Common ATK/HP/DEF/Crit/ER/healing values have quick inputs in the optimizer, while the full modifier editor lives behind <strong>Advanced Modifiers</strong> for the more cursed-but-useful stuff.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Equipping optimizer results is safer too. Applying a result now asks whether it should update only the optimizer simulation or both the simulation and the live build.
        `,
      },
    ],
    shortDesc: `More Optimizer sh-... s-stuff~! oh, 3.3.2 beta stuff too i guess (〜^∇^)〜`,
  },
  {
    date: '17/04/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          Rotation editing got some new toys. You can now attach <strong>conditions/state changes directly to features</strong>, so a feature can temporarily set up the state it needs before it gets calculated instead of needing an awkward separate wrapper every time.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The condition editor also got cleaned up into a nicer picker/editing flow. It should be easier to search for the state you want, add multiple changes, tweak values, and generally avoid the old "wait where do i put this again" feeling.
        `,
      },
      {
        type: 'paragraph',
        content: `
          You can also add new actions below a specific rotation feature now, which should make building or adjusting longer rotations less annoying. Less dragging things around like you're defusing a tiny UI bomb.
        `,
      },
      {
        type: 'paragraph',
        content: `
          There are a few smaller rotation UI/readability changes in here too, including a cleaner action preview and more useful team damage breakdowns by contributor and skill type.
        `,
      },
    ],
    shortDesc: `Rotation stuff~! (〜^∇^)〜`,
  },
]

export const latestCurrentChangelogEntry =
  currentChangelogEntries[currentChangelogEntries.length - 1] ?? null

export function getCurrentChangelogToastVersion(entry: ChangelogRecord | null): string {
  if (!entry) {
    return 'none'
  }

  return `${entry.date}:${entry.shortDesc ?? entry.entries[0]?.content ?? 'update'}`
}

export const legacyChangelogEntries: ChangelogRecord[] = [
  {
    date: '20/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `<strong>Sanhua</strong> is now fully functional.`,
      },
    ],
  },
  {
    date: '21/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `<strong>Baizhi</strong> is now fully functional.`,
      },
    ],
  },
  {
    date: '22/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `<strong>Lingyang</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Lupa</strong> is now fully functional.`,
      },
    ],
  },
  {
    date: '23/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `<strong>Zhezhi</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Youhu</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Carlotta</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Cartethyia</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Chixia</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Encore</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Mortefi</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Changli</strong> is now fully functional.`,
      },
    ],
  },
  {
    date: '24/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `<strong>Brant</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Calcharo</strong> is now fully functional.`,
      },
    ],
  },
  {
    date: '25/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `<strong>Yinlin</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Yuanwu</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Jinhsi</strong> is now fully functional.`,
      },
    ],
  },
  {
    date: '26/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `<strong>Xiangli Yao</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Zani</strong> is now fully functional.`,
      },
    ],
  },
  {
    date: '27/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `<strong>YangYang</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Jiyan</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Jianxin</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Rover: Aero Husbando</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Rover: Aero Waifu</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Ciaccona</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Rover: Spectro Husbando</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Rover: Spectro Waifu</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Verina</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Lumi</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Memoke- S-Shorekeeper</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Taoqi</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Danjin</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Camellya</strong> is now fully functional.`,
      },
    ],
  },
  {
    date: '27/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added weapons (just base atk and main stats)`,
      },
    ],
  },
  {
    date: '28/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `All 5 star weapons are now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `All other weapons are now fully functional.`,
      },
    ],
  },
  {
    date: '29/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added echo buffs.`,
      },
      {
        type: 'paragraph',
        content: `Added weapon buffs.`,
      },
    ],
  },
  {
    date: '30/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `<strong>Rover: Havoc Waifu</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Rover: Havoc Husbando</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Roccia</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Cantarella</strong> is now fully functional.`,
      },
      {
        type: 'paragraph',
        content: `Added character buffs.`,
      },
    ],
  },
  {
    date: '30/05/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added rotations >.<.`,
      },
    ],
  },
  {
    date: '06/06/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added ECHOES (WIP >.< (not anymore!)).`,
      },
    ],
  },
  {
    date: '27/06/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added <strong>Phrolova</strong>.`,
      },
      {
        type: 'paragraph',
        content: `Added <strong>Lethean Elegy</strong> rectifier.`,
      },
      {
        type: 'paragraph',
        content: `Added <strong>Dream of the Lost</strong> set echoes.`,
      },
    ],
  },
  {
    date: '07/08/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added <strong>Augusta</strong> and <strong>Iuno</strong>.`,
      },
      {
        type: 'paragraph',
        content: `Added <strong>2.6</strong> beta content.`,
      },
    ],
  },
  {
    date: '13/09/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added all <strong>2.7</strong> beta content excluding <strong>Galbrena</strong>.`,
      },
      {
        type: 'paragraph',
        content: `<strong>Galbrena</strong> will be added later...`,
      },
    ],
  },
  {
    date: '18/09/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added <strong>Galbrena</strong>.`,
      },
    ],
  },
  {
    date: '08/10/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added the new <strong>Guides Page</strong> with in-depth explanations for <em>Rotations</em>, <em>Team Buffs</em>, <em>Damage Calculations</em>, and <em>Echo Scoring</em>... and more stuff yeah...`,
      },
      {
        type: 'paragraph',
        content: `
                        Guides can be accessed from the sidebar navigation or directly through in-app prompts.
                        They're divided into clear categories — such as <strong>Echoes</strong>, <strong>Rotations</strong>, <strong>Team Buffs</strong>, and <strong>Overview</strong> — each covering a specific part of the calculator.

                        You'll often see small <em>"See Guide"</em> buttons or links throughout the app, appearing where you'd expect them to be.
                        Clicking one of these instantly opens the relevant section or takes you to that category's page in the <strong>Guides</strong> tab, letting you learn directly in context without hunting through menus.
                    `,
      },
    ],
    shortDesc: `New <strong>Guides Page</strong> added~! Learn everything without leaving the app (〜^∇^)〜`,
  },
  {
    date: '09/10/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added <strong>confirmation modals</strong> across key actions — including <em>Clear Rotation</em>, <em>Unequip All Echoes</em>, and <em>Delete</em> operations — to prevent accidental clicks and data loss.`,
      },
      {
        type: 'paragraph',
        content: `
                These confirmations appear before performing irreversible actions and let you review your choice before proceeding.
                They follow the same styling as other popups, using the same smooth open/close animations and adaptive color scheme.
                You can also cancel instantly without breaking your current workflow.
                Basically: fewer "oops" moments, more peace of mind.
            `,
      },
    ],
    shortDesc: `Added <strong>confirmation modals</strong>~! No more accidental oopsies (〜^∇^)〜`,
  },
  {
    date: '10/10/2025',
    entries: [
      {
        type: 'paragraph',
        content: `
                Updated <strong>Galbrena's Afterflame</strong> and <strong>Qiuyuan's Inherent Skill: Quietude Within</strong> to correctly function as <em>Damage Taken</em> effects instead of <em>additive Damage Bonus</em>.
                The English text originally described these as damage bonuses, but the Chinese text specified them as damage taken modifiers.
                With <strong>Galbrena's</strong> official release confirming the CN behavior, both effects have been adjusted to match the in-game mechanics — which also implies that <strong>Qiuyuan's Inherent Skill: Quietude Within</strong> should follow the same rule.
                Apparently, <em>Kuro's localization team</em> decided that "translation accuracy" was just another optional buff. (￣▽￣*)ゞ
                `,
      },
    ],
    shortDesc: `Updated <strong>Galbrena</strong> & <strong>Qiuyuan</strong>. Their effects now apply as <em>Damage Taken</em>`,
  },
  {
    date: '13/10/2025',
    entries: [
      {
        type: 'paragraph',
        content: `
                Introduced the new <strong>Echo Presets</strong> system~!
                Save, manage, and reapply full Echo loadouts across your characters with just one click.
            `,
      },
      {
        type: 'paragraph',
        content: `
                Each preset remembers your exact Echo setup — including main stats, substats, and set bonuses.
                You can now create build templates, compare setups, or instantly reapply your favorite configurations between characters.
                Presets also sync automatically with your current equipped Echoes, showing when a saved build matches your runtime loadout.
            `,
      },
      {
        type: 'paragraph',
        content: `
                A new <em>Echo Presets</em> category has also been added to the <strong>Guides Page</strong>, explaining how to use and manage them efficiently.
            `,
      },
    ],
    shortDesc: `New <strong>Echo Presets</strong> system~! (〜^∇^)〜`,
  },
  {
    date: '13/10/2025',
    entries: [
      {
        type: 'paragraph',
        content: `
                Added full <strong>Font Customization</strong>~!
                You can now personalize the calculator's text style to match your vibe — clean, minimal, or classy.
            `,
      },
      {
        type: 'paragraph',
        content: `
                Pick your favorite font and watch the entire interface update instantly — no reloads, no delay.
                Your chosen font is saved locally and will persist across sessions, even after closing the browser.
                All supported fonts are fully theme-aware for perfect readability in both light and dark modes.
            `,
      },
    ],
    shortDesc: `Added <strong>Font Customization</strong>~! (〜^∇^)〜`,
  },
  {
    date: '23/10/2025',
    entries: [
      {
        type: 'paragraph',
        content: `Added <strong>Buling</strong> and <strong>Chisa</strong>.`,
      },
      {
        type: 'paragraph',
        content: `Added <strong>2.8</strong> beta content.`,
      },
    ],
    shortDesc: `Added <strong>2.8</strong> beta content~! (〜^∇^)〜`,
  },
  {
    date: '24/10/2025',
    entries: [
      {
        type: 'paragraph',
        content: `
            Instantly create randomized or optimized Echo builds for testing, theorycrafting, and stat benchmarking.
            The generator can simulate thousands of builds using adjustable parameters such as <em>bias</em>, <em>roll quality</em>, and <em>energy regen goals</em>.
        `,
      },
    ],
    shortDesc: `New <strong>Echo Generator</strong> system added~! (〜^∇^)〜`,
  },
  {
    date: '28/10/2025',
    entries: [
      {
        type: 'paragraph',
        content: `
            You can now load in a premade rotation for most characters in the <strong>Rotation</strong> section. Only released characters for now...
        `,
      },
    ],
    shortDesc: `Added <strong>Premade Rotations</strong>~! (〜^∇^)〜`,
  },
  {
    date: '31/10/2025',
    entries: [
      {
        type: 'paragraph',
        content: `
            Introduced brand-new <strong>Themes</strong>~!
            Enjoy the elegant the playful <strong>Pastel Pink</strong>, cool <strong>Pastel Blue</strong>, and vibrant <strong>Vibrant Citrus</strong> light modes... PLUS the shimmering <strong>Glassy Rainbow</strong> and <strong>Scarlet Nebula</strong> (a deep crimson semi-gloss dark theme with ember glows) dark mode themes.
            `,
      },
      {
        type: 'paragraph',
        content: `
            This update also introduces a visually different theme selector. You can now visually choose your preferred <em>light</em> and <em>dark</em> mode themes using color swatches instead of dropdowns.
            `,
      },
    ],
  },
  {
    date: '08/11/2025',
    entries: [
      {
        type: 'paragraph',
        content: `
                Added <strong>Blocks</strong> in rotations~!
            `,
      },
      {
        type: 'paragraph',
        content: `
                Tbh i'm not sure yet how useful this will be for most, but hey, it's here now.
            `,
      },
    ],
    shortDesc: `Added <strong>Blocks</strong> in rotations~! (〜^∇^)〜`,
  },
  {
    date: '26/11/2025',
    entries: [
      {
        type: 'paragraph',
        content: `
                Big update~! The <strong>Echo Optimizer</strong> and the new
                <strong>Suggestions</strong> panel (Main Stats + Sonata Sets) are finally live.
                This one's been cooking in the background for a while, so it's a bit chunky~. (｡•̀ᴗ-)✧
            `,
      },
      {
        type: 'paragraph',
        content: `
                <strong>Optimizer:</strong><br/>
                - Automatically searches your Echo bag for high-damage builds based on your chosen skill.<br/>
                - Lets you lock a main Echo, filter by main stats and cost patterns, and cap how many results you see.<br/>
                - Shows ranked results with damage comparisons so you can quickly spot upgrades over your current set.
            `,
      },
      {
        type: 'paragraph',
        content: `
                <strong>New Suggestions panel:</strong><br/>
                - <strong>Main Stat</strong> suggester that proposes full main-stat layouts per Echo slot,
                  ranked by damage on your selected target skill.<br/>
                - <strong>Sonata Set</strong> suggester that tests valid 2pc / 3pc / 5pc plans against your
                  current Echo setup and only shows combos that actually change damage.<br/>
                - Preview + Apply flow so you can inspect suggested builds before committing them to your character.
            `,
      },
      {
        type: 'paragraph',
        content: `
                There are probably still some edge cases lurking around (especially with weird cost patterns or
                echo templates), but the core loop for "let the app think really hard for you" is now in place.
                More polish and knobs will come later once this settles in.
            `,
      },
    ],
    shortDesc: `BIG update: Optimizer + Suggestions ( · ❛ ֊ ❛)`,
  },
  {
    date: '07/12/2025',
    patchVersion: '3.0.1 (Beta)',
    entries: [
      {
        type: 'paragraph',
        content: `Added <strong>3.0.1</strong> beta content to the calculator.`,
      },
      {
        type: 'paragraph',
        content: `
                - All currently released characters are supported; 3.0 characters have initial Tune Rupture data.<br/>
                - All new Echoes and Sonata sets have been added to the data model.<br/>
                - Most new weapons are wired in; a few are still waiting for official EN data.
            `,
      },
      {
        type: 'paragraph',
        content: `Reworked how buffs and stats are stored and applied: everything now flows through a unified <strong>"buff path"</strong> system instead of a patchwork of special cases. This should make future characters, Echoes, and weapons much easier to support.`,
      },
      {
        type: 'paragraph',
        content: `Added an in-app <strong>Calculator Status</strong> window so you can quickly see coverage, known issues, and patch info without digging through the full changelog.`,
      },
    ],
    shortDesc: `3.0.1 beta content~! (and some other stuff) (〜^∇^)〜`,
  },
  {
    date: '15/12/2025',
    patchVersion: '3.0',
    entries: [
      {
        type: 'paragraph',
        content: `Echo Generator has been fixed and improved, with updated set filters, main echo focus, and ER targets.`,
      },
      {
        type: 'paragraph',
        content: `All characters have been updated for the current patch.`,
      },
      {
        type: 'paragraph',
        content: `All 3.0 icons and assets have been added.`,
      },
    ],
    shortDesc: `3.0 status update + Echo Generator fixes (〜^∇^)〜`,
  },
  {
    date: '03/01/2026',
    entries: [
      {
        type: 'paragraph',
        content: `Happy 2026~! Optimizer GPU runs are now wildly faster (single-skill up to ~900M combos/sec on capable GPUs) and use less memory.`,
      },
      {
        type: 'paragraph',
        content: `Suggestions picked up combo/rotation handling, so the Randomizer and friends can respect your rotation context.`,
      },
      {
        type: 'paragraph',
        content: `Mornye should behave correctly in the optimizer now; Suggestions fix is still cooking.`,
      },
    ],
    shortDesc: `New year tune-up: faster optimizer + rotation-ready Suggestions (〜^∇^)〜`,
  },
  {
    date: '19/01/2026',
    patchVersion: '3.1.2 (Beta)',
    entries: [
      {
        type: 'paragraph',
        content: `Added <strong>3.1.2</strong> beta content to the calculator.`,
      },
      {
        type: 'paragraph',
        content: `
                - All currently released characters are supported.<br/>
                - All new Echoes and Sonata sets have been added to the data model.<br/>
                - All new weapons are wired in.
            `,
      },
      {
        type: 'paragraph',
        content: `Reworked <strong>Tune Rupture</strong>: i don't necessarily understand it well enough to give that much of a breakdown but it's correct right now for
                Calamity/Overlord class enemies, other enemy classes will be supported on a future update. <strong>Tune Rupture</strong> will also be brought to all characters (so not just lynae).`,
      },
    ],
    shortDesc: `3.1.2 beta content~! (and some other stuff) (〜^∇^)〜`,
  },
  {
    date: '24/01/2026',
    patchVersion: '3.1.4 (Beta)',
    entries: [
      {
        type: 'paragraph',
        content: `Added and updated stuff for <strong>3.1.4</strong> beta content in the calculator.`,
      },
      {
        type: 'paragraph',
        content: `
                - Enemy section fully redesigned: pick any in\u2011game enemy with auto-filled level, class, and per-element RES.<br/>
                - Custom enemy editing now shows live RES values with clamped inputs, so tuning break tests are faster and safer.<br/>
            `,
      },
    ],
    shortDesc: `3.1.4 beta content~! | New enemy section (〜^∇^)〜`,
  },
  {
    date: '02/03/2026',
    patchVersion: '3.2.0 (Beta)',
    entries: [
      {
        type: 'paragraph',
        content: `Added and updated stuff for <strong>3.2.0</strong> beta content in the calculator.`,
      },
      {
        type: 'paragraph',
        content: `
                SIGRIKA.<br/>
            `,
      },
    ],
    shortDesc: `3.2.0 beta content~! (〜^∇^)〜`,
  },
  {
    date: '05/03/2025',
    patchVersion: '3.2.0 (Beta)',
    entries: [
      {
        type: 'paragraph',
        content: `UX pass for <strong>Suggestions</strong> and <strong>Optimizer</strong> around Sonata set planning and run feedback.`,
      },
      {
        type: 'paragraph',
        content: `
                - Added a shared <strong>Set Conditionals</strong> configuration flow so <strong>YOU</strong> can now toggle what buffs a set should factor in Suggestions and Optimizer calculations.<br/>
                - Due to this, Set-plan suggestion and Optimizer damage/ranking now follows your active condition toggles for more realistic comparisons.<br/>
            `,
      },
      {
        type: 'paragraph',
        content: `
                Updated text descriptions and their intended effects for <strong>Sigrika</strong><br/>
            `,
      },
    ],
    shortDesc: `NEW Set Config options (〜^∇^)〜`,
  },
]

export const changelogSections: ChangelogSection[] = [
  {
    id: 'current',
    label: 'Current',
    entries: currentChangelogEntries,
  },
  {
    id: 'legacy',
    label: 'Legacy',
    entries: legacyChangelogEntries,
  },
]
