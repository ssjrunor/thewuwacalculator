/*
  Author: Runor Ewhro
  description: authored changelog entry data rendered by the changelog page and
               update toast surfaces.
*/

export interface ChngEnt {
  type: 'paragraph'
  content: string
}

export interface WnShot {
  kind: 'image' | 'video' | 'card'
  src?: string
  resId?: string
  poster?: string
  ar?: number
  caption?: string
  alt?: string
}

export type WnLayout = 'stage' | 'split' | 'splitReverse' | 'text'
export type WnGridSpan = {
  columns?: number | 'full'
  rows?: number
}

export interface WnSection {
  id: string
  kicker?: string
  title?: string
  body?: string[]
  media?: WnShot[]
  layout: WnLayout
  span?: WnGridSpan
  // text acts can point at an in-app page; the whole card becomes a link
  href?: string
  linkText?: string
}

export interface WnEntry {
  id: string
  date: string
  signal: string
  tag: string
  title: string
  summary: string
  lede: string
  hero?: WnShot
  sections: WnSection[]
}

export interface ChngRcrd {
  /** stable id for the latest notice and published entries. */
  id?: string
  date: string
  shortDesc?: string
  patchVersion?: string
  whatsNew?: Omit<WnEntry, 'date'>
  entries: ChngEnt[]
}

export interface ChngSctn {
  id: 'current' | 'legacy'
  label: string
  entries: ChngRcrd[]
}

const CHNG_ASSETS = '/assets/app/changelog'
const S_2026_07_06 = `${CHNG_ASSETS}/2026-07-06`
const S_2026_07_21 = `${CHNG_ASSETS}/2026-07-21`
const S_2026_10_05 = `${CHNG_ASSETS}/2026-10-05`

export const curChngEnts: ChngRcrd[] = [
  {
    date: '30/03/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          The <strong>New Wuwa Calculator</strong> is available. I rebuilt the app to make future changes easier.
        `,
      },
      {
        type: 'paragraph',
        content: `
          It has a new design and a simpler structure for future features.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The update includes:<br/>
          - A rebuilt calculator workspace with clearer panels and overview.<br/>
          - Updated inventory, rotations, optimizer, and suggestions systems.<br/>
        `,
      },
      {
        type: 'paragraph',
        content: `
          The new structure supports further features and updates.
        `,
      },
    ],
    shortDesc: `new app and updated structure`,
  },
  {
    date: '03/04/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>Background Mode</strong> has updated wallpaper controls and styling.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Wallpaper selection uses preview cards. Custom uploads and background switching are improved, and translucent panels adjust to the selected wallpaper.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Set Conditionals</strong> let you choose which set effects simulation and optimization include.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Menus, panels, and calculator sections have updated spacing and popup styling.
        `,
      },
    ],
    shortDesc: `background mode and set conditionals`,
  },
  {
    date: '07/04/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.3 support</strong> adds <strong>Hiyuki</strong>, <strong>Denia</strong>, their base kits, new weapons, and new sonata sets.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Glacio Chafe</strong>, <strong>Glacio Bite</strong>, <strong>Electro Flare</strong>, and <strong>Electro Rage</strong> now have explicit behavior. Enemy statuses are easier to read.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Added default rotations for <strong>Buling</strong>, <strong>Luuk Herssen</strong>, <strong>Denia</strong>, and <strong>Hiyuki</strong>.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Import handling now normalizes older resonator exports after schema changes.
        `,
      }
    ],
    shortDesc: `3.3 support, negative effects, and default rotations`,
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
          You can attach <strong>conditions and state changes directly to features</strong> for use during calculation.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The condition editor has updated search, value editing, and support for multiple changes.
        `,
      },
      {
        type: 'paragraph',
        content: `
          You can add actions below a selected rotation feature.
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
  {
    date: '18/05/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.4 support</strong> is in now, so <strong>Lucilla</strong>, <strong>Lucy</strong> and <strong>Rebecca</strong> are available in the calculator along with their base kit logic and new weapons.
        `,
      },
      {
        type: 'paragraph',
        content: `
          That's pretty much it :P
        `,
      },
    ],
    shortDesc: `3.4 support... mostly~! (〜^∇^)〜`,
  },
  {
    date: '31/05/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>Rotation loops</strong> let you repeat a section without duplicating its actions.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Saved rotations can include a <strong>note</strong> and <strong>duration</strong>, show <strong>DPS</strong>, and sort by DPS.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The app has its own <strong>context menus</strong> now. They are enabled by default, can be turned off in settings, and show up across heavier calculator surfaces so actions like delete, select, and batch editing are not trapped behind tiny scattered buttons anymore.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Selection / batch editing</strong> is new on a bunch of item-heavy surfaces too. Inventory items, echoes, overview profiles, live rotation nodes, and saved rotations can be handled in groups now, so managing bigger sets of stuff should be much less one-by-one.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Clipboard support is new too.</strong> You can copy, cut, and paste supported calculator items now, including echoes, overview profiles, live rotation nodes, and saved rotations, so moving setups around does not have to be a full manual rebuild every time.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Echo inventory has a compact view</strong> available in settings. Paste, import, and loadout movement have been updated.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Weapon suggestions</strong> now show available weapon options.
        `,
      },
      {
        type: 'paragraph',
        content: `
          There is also a <strong>new optimizer mode</strong>. The optimizer side has more result tooling, more reusable result rows/filters, better teammate setup pieces, and new generated-build plumbing for the newer search flow.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The <strong>Guides</strong> system was redone too. The general guides page now has searchable guide content, cleaner deep linking, a better reader flow, and updated guide copy for the newer systems.
        `,
      },
      {
        type: 'paragraph',
        content: `
          App settings have more preferences. Saved data, imports, exports, history, and backups have updated handling for schema changes.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Overview profiles</strong> support copy, paste, overwrite, batch deletion, and switching.
        `,
      }
    ],
    shortDesc: `loops, context menus, clipboard, batch editing, guides, and other new stuff 〜⁠(⁠꒪⁠꒳⁠꒪⁠)⁠〜`,
  },
  {
    date: '09/06/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.4 got a much more real pass now.</strong> <strong>Lucilla</strong>'s, <strong>Lucy</strong>'s, and <strong>Rebecca</strong>'s kit logic have been updated, and the rest of the 3.4 assets/data are in too.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Resonance modes and special statuses are also much more explicit now. Resonators that need a real <strong>mode/status switch</strong> now show one directly, so stuff like mode forms, special gear states, and kit assumptions are less "i hope the calculator knows what i mean" and more actual buttons you can look at.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Default rotations</strong> got another pass as well. <strong>Denia</strong>'s preset rotation was updated, and <strong>Lucy</strong> / <strong>Rebecca</strong> now have starting rotations too.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Theory optimizer</strong> can include weapons in its search. Inventory optimizer has an <strong>Exclude equipped</strong> toggle.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The <strong>Max</strong> button now sets relevant modes, states, weapon passives, and kit switches along with levels and traces.
        `,
      },
      {
        type: 'paragraph',
        content: `
          There are a lot of smaller cleanup pieces underneath this, but the short version is: newer kits should feel less half-wired, optimizer setup should be less annoying, and the app should be better at making its assumptions visible.
        `,
      },
    ],
    shortDesc: `3.4 live updated (and other stuff)~! (〜^∇^)〜`,
  },
  {
    date: '17/06/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.5 beta support</strong> has started with <strong>Suisui</strong> and <strong>Yangyang: Xuanling</strong> added to the calculator.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The new 3.5 beta weapons <strong>Azure of Heaven</strong> and <strong>Dew Imbiber</strong> are also available.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The Echoes pane also has a new <strong>Quick Setup</strong> flow. It can generate a loadout from a chosen echo count, main stats and costs, repeated substat templates, sonata plan, and main echo choice, while filling anything left open with valid random picks.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Rotation editing got a cleaner <strong>Add Conditions</strong> pass too. Feature rows can carry their own setup changes now, including formula-level stat edits, so rotations can model "this hit happens after this temporary state" without needing extra loose condition nodes everywhere.
        `,
      },
    ],
    shortDesc: `3.5 beta, echo quick setup, and rotation conditions stuff~! (〜^∇^)〜`,
  },
  {
    date: '24/06/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.5 beta support</strong> continues with <strong>Suisui</strong> and <strong>Yangyang: Xuanling</strong> 3.5.3 changes added to the calculator and... <strong>Rover: Aero</strong> added to the calculator.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The new 3.5 beta echoes and sonata sets are also available.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Check out the notes i left~ :P
        `,
      }
    ],
    shortDesc: `More 3.5.3 beta stuff~! (〜^∇^)〜`,
  },
  {
    date: '06/07/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.5 beta support</strong> continues with <strong>Suisui</strong>, <strong>Yangyang: Xuanling</strong> and <strong>Rover: Aero</strong> 3.5.6 changes added to the calculator along side the 3.5 weapons.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The <strong>build scoring system</strong> got reworked. It's less stat oriented and more damage oriented now.
        `,
      },
      {
        type: 'paragraph',
        content: `
          This also comes with a <strong>report</strong> now: it lines up a baseline, a benchmark, and a maxed version of your build, with the upgrade paths between them in the Benchmark page.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Separately, the <strong>Suggestions</strong> pane got a <strong>substat priority</strong> readout: it reads your sub stats against an ideal floor and ceiling, then breaks down each sub stat's contribution, share and quality, plus what one roll is worth.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The benchmark page includes a <strong>showcase card</strong> with resonator, team, echoes, and score details. The <strong>Customize</strong> panel controls portrait, backdrop, colors, fonts, and custom CSS.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Added a <strong>Docs</strong> page with interactive examples of scoring and calculation methods.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Removed the old <strong>Overview</strong> page. The benchmark and showcase cards provide its information.
        `,
      }
    ],
    whatsNew: {
      id: '2026-07-06-scoring',
      signal: '06.07',
      tag: 'UPDATE',
      title: 'The scoring system, reworked',
      summary:
        'The build score now sims your damage and reports baseline-to-max builds. Separately: a sub stat priority readout in Suggestions, showcase cards with splash art, a new docs page, and Overview removed.',
      lede:
        "Build score now simulates your build's damage and compares it with baseline and ideal builds.",
      hero: {
        kind: 'image',
        src: `${S_2026_07_06}/benchmark-page.png`,
        ar: 1454 / 808,
        alt: 'Benchmark page: a 119% SS score on the scale, with echo loadout and build stats',
        caption: 'You can see a lot on here.',
      },
      sections: [
        {
          id: 'score',
          kicker: 'Build score',
          title: 'One scale, three anchors',
          body: [
            'Your build is put on a single scale: a baseline at 0%, the benchmark at 100%, and a theoretical max at 200%. The result reads as a percentage and a grade, on a ladder- blah blah blah... you get the point.',
            'It no longer just grades how closely your echoes match a set of stat weights; it sims your whole build, and the report lines up a baseline, a benchmark, and a maxed version of your setup with the upgrade paths between them.',
          ],
          layout: 'stage',
        },
        {
          id: 'substat-priority',
          kicker: 'Suggestions',
          title: 'Which subs tats are worth it',
          body: [
            'A separate feature, over in the Suggestions section: a sub stat priority readout. It rolls out an ideal set of subs tats for your target, taken at their lowest and highest values, and reads your current build against that floor and ceiling while keeping your energy-regen investment intact.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_07_06}/substat-build-benchmark.png`,
              ar: 773 / 221,
              alt: 'Sub stat priority: current build read against an ideal floor and ceiling',
              caption: 'Your current build, an ideal floor, and an ideal ceiling.',
            },
          ],
          layout: 'stage',
        },
        {
          id: 'substat-priority-detail',
          body: [
            'It then breaks down each sub stat: how much damage it contributes, its share of the build, and its roll quality, alongside what adding or dropping a single roll is worth.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_07_06}/current-build-state.png`,
              ar: 773 / 459,
              alt: 'Current build state table: per sub stat contribution, share and quality',
              caption: 'Per-substat contribution, share and quality.',
            },
            {
              kind: 'image',
              src: `${S_2026_07_06}/per-step-gain-loss.png`,
              ar: 773 / 459,
              alt: 'Per-step change table: damage and value gained or lost per sub stat step',
              caption: 'Per-step gain and loss.',
            },
          ],
          layout: 'stage',
        },
        {
          id: 'showcase',
          kicker: 'Showcase',
          title: 'The best part (imho).',
          body: [
            'The same page has a separate showcase view. It turns a build into this: resonator, team, echoes, stats and the score, drawn from the data the resonator\'s data.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_07_06}/showcase-card-sample.png`,
              ar: 1984 / 1440,
              alt: 'A finished showcase card for Phoebe with portrait, team, echoes and an SS score',
              caption: 'I made this one myself ദ്ദി( ˘̀ ֊ ˘́).',
            },
          ],
          layout: 'splitReverse',
        },
        {
          id: 'splash',
          kicker: 'Splash art',
          title: 'I-it moves..?',
          body: [
            'The portrait supports animated Live2D splash art. Toggle it on the card or page.',
          ],
          media: [
            {
              kind: 'card',
              resId: '1506',
              caption: 'Pretty cool huh?',
            },
          ],
          layout: 'split',
        },
        {
          id: 'customize',
          kicker: 'Customize',
          title: 'It\'s ugly? Do it yourself! hmph! (˶˃⤙˂˶)',
          body: [
            'Swap the portrait and backdrop, change the colours and type, or drop straight into custom CSS.',
            'These settings are saved per resonator, and uploaded images are stored as links so they stay put between sessions.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_07_06}/customize.png`,
              ar: 288 / 756,
              alt: 'The Customize panel: portrait, backdrop, colour, base type, per-text styles and custom CSS',
              caption: 'Edit stuff..',
            },
          ],
          layout: 'splitReverse',
        },
        {
          id: 'docs',
          kicker: 'Docs',
          title: 'Behind the scenes..',
          body: [
            'The Docs page explains scoring and negative-effect calculations with interactive examples.',
          ],
          layout: 'text',
          href: '/docs',
          linkText: 'SEE SEE!!',
        },
        {
          id: 'overview',
          kicker: 'Overview',
          title: 'The overview page is gone...',
          body: [
            'The Overview page was removed. The build score report and showcase card provide its information.',
          ],
          layout: 'text',
        },
      ],
    },
    shortDesc: `Scoring rework, new suggestions feature and new pages~! (〜^∇^)〜`,
  },
  {
    date: '09/07/2026',
    entries: [
      {
        type: 'paragraph',
        content: `Version 3.5 update.`,
      }
    ],
  },
  {
    date: '21/07/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          The <strong>Team Setup</strong> page got a full visual rebuild. Teammates now sit in a connected lineup with clearer roles, team count, quick member actions, and richer weapon, echo, and effect summaries at a glance.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Teammate editing is much more complex now too. Each teammate has a focused editor for loadout, effects, echoes, and buffs, so saved builds, weapons, echo loadouts, team effects, and manual buffs are all easier to manage in one place.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Saved echo browsing got a cleaner presentation with sharper echo cards, clearer stat rows, score and CV labels, set icons, equipped-by markers, and a larger selected-echo detail view on wide screens.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The <strong>Optimizer</strong> now has an advanced inventory view for including or excluding saved echoes from a run, with visible included/excluded states and the same search, cost, and sonata filtering style as the rest of the app.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Resonator, weapon, echo, and enemy item menus were refreshed with larger artwork, cleaner badges, stronger selected states, and more useful detail rows. Recommended weapons now stand out more clearly as well.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Combat setup got more readable in a few places: enemy combat effects now show Tune Strain responder cards with live breakdowns, and resonator pages now show Outro Skill cards when a character has one.
        `,
      },
    ],
    whatsNew: {
      id: '2026-07-21-team-setup',
      signal: '21.07',
      tag: 'UPDATE',
      title: 'New Stuff!!',
      summary:
        'Team Setup has a new lineup display, teammate editing is much deeper (and cleaner), optimizer inventory control is easier to see, and choice menus got a larger visual refresh.',
      lede:
        'The team side of the calculator got a big redesign. The lineup is easier to read, teammate editing is no longer a tiny side stop, and the menus for choosing resonators, weapons, echoes and enemies',
      sections: [
        {
          id: 'team-lineup',
          kicker: 'Team Setup',
          title: 'The lineup now..',
          body: [
            'Team members appear in one connected row.',
            'Each row shows weapon, main echo, sonata pieces, and team effects.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_07_21}/teampane.png`,
              ar: 3360 / 1854,
              alt: 'Team Setup page with connected teammate rows and visible loadout summaries',
              caption: 'Swap, configure, or remove teammates straight from the row.',
            },
          ],
          layout: 'stage',
        },
        {
          id: 'teammate-editor',
          kicker: 'Teammates',
          title: 'One place for loadout, effects, echoes, and buffs',
          body: [
            'Each teammate now gets a larger editor split around the work you actually do: loadout, effects, echoes, and buffs.',
            'Saved builds, weapon choices, echo slots, team effects, and manual buffs all live together now, so teammate setup involves much less jumping between separate calculator pages.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_07_21}/teamconfig.png`,
              ar: 3360 / 1854,
              alt: 'Teammate editor showing loadout cards, weapon choices, stats, and section tabs',
              caption: 'Teammate setup has its own space now.',
            },
          ],
          layout: 'splitReverse',
        },
        {
          id: 'optimizer-inventory',
          kicker: 'Optimizer',
          title: 'Decide which saved echoes are allowed',
          body: [
            'Optimizer inventory search now has an advanced view for including or excluding saved echoes from a run.',
            'Included echoes stay bright, excluded echoes dim out, and status badges make it obvious what will be used before the run starts.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_07_21}/optimizerinv.png`,
              ar: 3360 / 1854,
              alt: 'Optimizer inventory view with included and excluded echo cards',
              caption: 'Useful when you want the optimizer to respect a smaller echo pool.',
            },
          ],
          layout: 'split',
        },
        {
          id: 'item-menus',
          kicker: 'Item Menus',
          title: 'Bigger cards, clearer choices',
          body: [
            'Resonator, weapon, echo, and enemy menus got a shared visual refresh. Item cards use larger artwork, clearer selected states, compact detail rows, and stronger badges.',
            'Weapons can show recommended picks more clearly, echoes show cost and sonata information more cleanly, and resonators carry more visible attribute and weapon context.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_07_21}/resopicker.png`,
              ar: 3360 / 1854,
              alt: 'Resonator menu with large character cards and metadata rows',
              caption: 'Resonators are much easier to scan.',
            },
            {
              kind: 'image',
              src: `${S_2026_07_21}/weaponpicker.png`,
              ar: 3360 / 1854,
              alt: 'Weapon menu with large weapon cards, stat rows, and recommendation badges',
              caption: 'Recommended weapons stand out now.',
            },
            {
              kind: 'image',
              src: `${S_2026_07_21}/echopicker.png`,
              ar: 3360 / 1854,
              alt: 'Echo menu with cost filters, sonata filtering, and large echo cards',
              caption: 'Echo choices got the same treatment.',
            },
          ],
          layout: 'stage',
        },
        {
          id: 'combat-details',
          kicker: 'Combat Details',
          title: 'More effect information is visible where it matters',
          body: [
            'Enemy combat effects now show Tune Strain responder cards with live values and breakdowns, so the status is not just hidden behind a number.',
            'Resonator pages also show Outro Skill cards when a character has one, including the relevant text and controls right alongside the rest of their kit.',
          ],
          layout: 'text',
          span: { columns: 'full' },
        },
      ],
    },
    shortDesc: `New Stuff~! (〜^∇^)〜`,
  },
  {
    date: '25/07/2026',
    patchVersion: '3.6.1 beta',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.6.1 beta data</strong> is now included.
        `,
      },
      {
        type: 'paragraph',
        content: `
          Settings also gained new preferences for switching beta game data on or off and controlling compact export behavior, so data-source and backup choices are easier to manage from the app itself.
        `,
      },
    ],
    shortDesc: `3.6.1 beta data + new preferences`,
  },
  {
    date: '30/07/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>Rotation sharing is properly here now.</strong> Saved rotations can generate a share token or full link, copy either one, or still export a file. Short remote links use the Worker/KV path when available, and the app falls back to an encoded token when it is not.
        `,
      },
      {
        type: 'paragraph',
        content: `
          The calculator shell also has a compact <strong>team summary</strong>. It gives quick access to active/support switching, skill data, add/swap/remove teammate actions, and teammate config.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Suggestions and weapon picks got a presentation pass.</strong> Main-stat, set-plan, weapon, and random-build results use clearer ranked rows/cards now; weapon suggestions have an inspection view.
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Benchmark and rotation math had some correctness cleanup too.</strong> Tune Strain now respects the actual team-derived setup, benchmark Tune Strain uses the benchmark team, uptime setup effects scale into their body rows properly.
        `,
      },
    ],
    shortDesc: `Rotation sharing and more~! (〜^∇^)〜`,
  },
  {
    date: '01/08/2026',
    patchVersion: '3.6.1 beta',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.6.1 beta data</strong> has been updated.
        `,
      }
    ],
    shortDesc: `3.6.1 beta update`,
  },
  {
    date: '08/08/2026',
    patchVersion: '3.6.5 beta',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.6.5 beta</strong> stuff.
        `,
      }
    ],
    shortDesc: `3.6.5 beta update`,
  },
  {
    date: '15/08/2026',
    patchVersion: '3.6.7 beta',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.6.7 beta</strong> stuff.
        `,
      }
    ],
    shortDesc: `3.6.7 beta update`,
  },
  {
    date: '18/08/2026',
    patchVersion: '3.6 live',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.6 patch</strong> stuff.
        `,
      }
    ],
    shortDesc: `3.6 patch update`,
  },
  {
    date: '06/09/2026',
    patchVersion: '3.7.0 beta',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.7.0 beta data</strong> is now included.
        `,
      }
    ],
    shortDesc: `3.7.0 beta update`,
  },
  {
    date: '28/09/2026',
    patchVersion: '3.7 live',
    shortDesc: '3.7 patch update',
    entries: [
      {
        type: 'paragraph',
        content: `
          Added <strong>3.7.1 beta</strong> changes for <strong>Suoming</strong>, <strong>Hsin</strong>, and <strong>Blooming Jadehaven</strong>.
        `},
      {
        type: 'paragraph',
        content: `Updated <strong>Suoming</strong>'s <strong>Unison Boon</strong> stack limit.`,
      }
    ],
  },
  {
    date: '28/09/2026',
    patchVersion: '3.7 live',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.7 patch</strong> stuff.
        `,
      }
    ],
    shortDesc: `3.7 patch update`,
  },
  {
    date: '07/10/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>Calculator &amp; Build Pages</strong><br/>
          - <strong>The calculator page is gone.</strong> No more sidebar, no more toolbar full of panes.<br/>
          - The app is now five pages that all share the same build: <strong>Modulation</strong>, <strong>Rotation</strong>, <strong>Showcase</strong>, <strong>Optimizer</strong> and <strong>Suggestions</strong>.<br/>
          - The Benchmark board became the main page you build on, and the old calculator panes were folded into it.<br/>
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Navigation &amp; Home</strong><br/>
          - Getting around is one header row now, with Docs, Guides, Changelog and Calibration tucked into a <strong>Read</strong> menu.<br/>
          - The's a new  <strong>Home</strong> (it used to just drop you into the calculator), with a note from me, the newest arrivals and some other stuff.<br/>
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Rotation</strong><br/>
          - <strong>Rotation</strong> moved out of its pane and onto its own page.<br/>
          - Personal and team rotations are one thing now: you set a team and do whatever, add opening steps before the main loop, and after a run you get a cleaner view plus a Builds section showing every member's echoes and weapon.<br/>
          - Saved rotations can be compared side by side on one field.<br/>
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Showcase</strong><br/>
          - <strong>Showcase</strong> is its own page too, and has a second card layout, <strong>Detailed</strong>.<br/>
          - The Classic card was redone alongside it.<br/>
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Optimizer &amp; Suggestions</strong><br/>
          - The <strong>Optimizer</strong> UI was rebuilt from the ground up: the old settings console is replaced by the same board as the other build pages, and picking a result previews it right on your build.<br/>
          - <strong>Suggestions</strong> got its own page as well, with ranked results that also preview on your build.<br/>
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Calibration &amp; Guides</strong><br/>
          - Settings is now <strong>Calibration</strong>, redesigned, with a new <strong>Rover</strong> setting so you can stick to the male Rover, the female Rover, or keep both.<br/>
          - The <strong>Guides</strong> were rewritten around real screenshots of the app.<br/>
        `,
      },
      {
        type: 'paragraph',
        content: `
          <strong>Note</strong><br/>
          These are all the noteworthy changes, there are a lot more but they're all just UI redesigns.
        `,
      },
    ],
    whatsNew: {
      id: '2026-10-05-rebuild',
      signal: '05.10',
      tag: 'UPDATE',
      title: 'New... EVERYTHING!? („°0°„)',
      summary:
        'The calculator page is gone: five pages share one build now. Plus a real Home, Rotation and Showcase on their own pages, a rebuilt Optimizer, and Calibration in place of Settings.',
      lede:
        "Yeah.. this one's a lot. The old calculator page with its sidebar and pile of panes is gone, and pretty much everything around it got redone too. Here's what actually changed.",
      hero: {
        kind: 'image',
        src: `${S_2026_10_05}/modulation-page.webp`,
        ar: 2158 / 1120,
        alt: 'Modulation page: the header with five pages, the roster, Phoebe\'s build card, a 131% SSS+ score band, the Echo loadout and Build Stats',
        caption: 'Look familiar? The Benchmark board is where you build now.',
      },
      sections: [
        {
          id: 'pages',
          kicker: 'The rebuild',
          title: 'Better cohesion',
          body: [
            'The calculator page used to be its own little world, with Benchmark and Optimizer bolted on the side. Now there are five pages and they all share the same build, so switching from Modulation to Showcase to Rotation never loses your place.',
            'The Benchmark board you already know became the main page, and everything the old calculator panes did lives on it now.',
          ],
          layout: 'stage',
        },
        {
          id: 'navigation',
          kicker: 'Getting around',
          title: 'Easier navigation',
          body: [
            'The header lists five pages and a Read menu for Docs, Guides, Changelog, and Calibration.',
            'The Home page opens before the calculator and includes the previous About content.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_10_05}/header-read.webp`,
              ar: 2400 / 460,
              alt: 'The header with the five pages on the left and the Read menu open on the right',
              caption: 'Docs, Guides, Changelog, and Calibration are in Read.',
            },
          ],
          layout: 'stage',
        },
        {
          id: 'rotation',
          kicker: 'Rotation',
          title: 'Rotations got a whole page',
          body: [
            'No more Personal and Team tabs: there\'s one rotation for the team, and the roster details panel picks who\'s in it. You can set up opening steps before the main loop, and every run ends with a Timeline and a Builds section showing what each member had on.',
            'Saved rotations sit together on one field now, and you can line a few up and compare them.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_10_05}/rot-details.webp`,
              ar: 576 / 392,
              alt: 'The rotation roster details panel for Phoebe with her two teammates',
              caption: 'The team, picked from the roster.',
            },
            {
              kind: 'image',
              src: `${S_2026_10_05}/rot-builds.webp`,
              ar: 656 / 980,
              alt: 'The Builds section of a rotation\'s totals: each member\'s echoes, set and weapon',
              caption: 'Everyone\'s build, right next to the result.',
            },
            {
              kind: 'image',
              src: `${S_2026_10_05}/rot-saved-field.webp`,
              ar: 1568 / 545,
              alt: 'Saved rotations laid out together on one field',
              caption: 'Saved rotations, all on one line.',
            },
          ],
          layout: 'stage',
        },
        {
          id: 'showcase',
          kicker: 'Showcase',
          title: 'Detailed Showcase layout',
          body: [
            'Showcase moved to its own page and gained a Detailed card layout. The Classic card was also updated.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_10_05}/sc-detailed.webp`,
              ar: 1288 / 935,
              alt: 'The Detailed showcase card for Phoebe',
              caption: 'Detailed layout.',
            },
            {
              kind: 'image',
              src: `${S_2026_10_05}/sc-classic.webp`,
              ar: 1288 / 935,
              alt: 'The redone Classic showcase card for Phoebe',
              caption: 'And the new Classic.',
            },
          ],
          layout: 'splitReverse',
        },
        {
          id: 'optimizer',
          kicker: 'Optimizer',
          title: 'Bye bye, settings console',
          body: [
            'The rebuilt Optimizer has its own page. Selecting a result previews it on your build before applying it.',
            'Suggestions got the same treatment on its own page, with ranked results that preview the same way.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_10_05}/opt-preview.webp`,
              ar: 1204 / 983,
              alt: 'The Optimizer board: a result previewed on the Echo loadout above the ranked results',
              caption: 'A result, tried on before you keep it.',
            },
            {
              kind: 'image',
              src: `${S_2026_10_05}/sug-main-stats.webp`,
              ar: 1473 / 812,
              alt: 'Suggestions: main stat options ranked by damage',
              caption: 'Suggestions, ranked.',
            },
          ],
          layout: 'stage',
        },
        {
          id: 'popups',
          kicker: 'Pop-ups',
          title: 'Same look everywhere',
          body: [
            'Pop-ups now share a common style. The echo editor, sonata conditions, weapon search, and team picker have updated layouts.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_10_05}/sim-echo-editor.webp`,
              ar: 1508 / 788,
              alt: 'The new echo editor with a column of possible rolls for each substat',
              caption: 'The new echo editor.',
            },
            {
              kind: 'image',
              src: `${S_2026_10_05}/sug-set-config.webp`,
              ar: 1277 / 952,
              alt: 'Sonata set conditions: sets listed with their pieces and the conditions under each',
              caption: 'Sonata set conditions.',
            },
          ],
          layout: 'stage',
        },
        {
          id: 'calibration',
          kicker: 'Calibration',
          title: 'Settings, but prettier',
          body: [
            'Settings is now Calibration and got a full redesign. It also has something new: a Rover setting, for anyone who only ever plays one of them.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_10_05}/app-rover.webp`,
              ar: 1568 / 744,
              alt: 'The Rover setting on Calibration, with a switch to the male Rover waiting to be confirmed',
              caption: 'Pick your Rover (or keep both).',
            },
            {
              kind: 'image',
              src: `${S_2026_10_05}/app-look-theme.webp`,
              ar: 1562 / 784,
              alt: 'Calibration\'s theme slots for Light, Dark and Background mode',
              caption: 'The new look for themes.',
            },
          ],
          layout: 'split',
        },
        {
          id: 'guides',
          kicker: 'Guides',
          title: 'Guides with pictures!',
          body: [
            'Guides now use app screenshots to show each step.',
          ],
          media: [
            {
              kind: 'image',
              src: `${S_2026_10_05}/guides.webp`,
              ar: 2402 / 944,
              alt: 'A guide page: a screenshot of the score band with numbered marks and the matching steps below',
              caption: 'Much better than before, trust me.',
            },
          ],
          layout: 'split',
          href: '/guides',
          linkText: 'SEE SEE!!',
        },
      ],
    },
    shortDesc: `New... EVERYTHING!? („°0°„)`,
  },
  {
    date: '23/10/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>optimizer</strong> and <strong>suggestions</strong> can select default rotations, the current live rotation, other live scenarios, and saved rotations containing the resonator in question. saved sources supply their team/environment while using the current searched build
        `,
      },
      {
        type: 'paragraph',
        content: `
          for the <storng>optimizer</storng>, added cost-aware combination enumeration, cput/gpu pruning, specialized target shaders, adaptive batch sizing, and pipelined gpu readbacks. theory searches also gain pruning and revised buffer scheduling (tldr; more speed, better performance)
        `,
      },
      {
        type: 'paragraph',
        content: `
          for the <strong>opimizer</strong>, results consistently use the weapon selected by the search. rotation constraints and displayed rows use the final set of stats. retained results receive more precise cpu rescoring, and a result deduplication bug during table growth is fixed
        `,
      },
      {
        type: 'paragraph',
        content: `
          main-echo search in <strong>sonata set plan suggestions</strong> considers compatible equipped cost classes, including useful off-set main echoes. also, you can now see the main echo in the result list ui
        `,
      },
      {
        type: 'paragraph',
        content: `
          in the <strong>optimizer</strong>, rotation results now show the final stat damage bonus column. sonata set conditional controls now show previously hidden teammate targeted effects
        `,
      }
    ],
    shortDesc: `searcher systems optimizations`,
  },
  {
    id: '2026-10-24-3-8-1-beta',
    date: '24/10/2026',
    patchVersion: '3.8.1 beta',
    entries: [
      {
        type: 'paragraph',
        content: `
          <strong>3.8.1 beta data</strong> is now included. Well, that's just <strong>Lily</strong> and <strong>Lullaby</strong>.
        `,
      }
    ],
    shortDesc: `3.8.1 beta update (,; ⩌ ;,)`,
  },
  {
    id: '2026-10-27-16-26',
    date: '27/10/2026',
    entries: [
      {
        type: 'paragraph',
        content: `
          new <strong>Mornye Tools</strong> import. import your resonators, weapons, and Echoes from a <strong>Mornye Tools</strong> export; also, the app header’s wuwa bot card import button becomes a menu for game data, build-card screenshots, and shared rotations. app backup import area also accepts these formats.
        `,
      },
      {
        type: 'paragraph',
        content: `
          imported builds, rotations, screenshots, and backups now consistently resolve to your selected Rover gender, including related skills, buffs, and saved settings (they lowkey didn't before now haha..)
        `,
      },
      {
        type: 'paragraph',
        content: `
          for the <strong>opimizer</strong>, results consistently use the weapon selected by the search. rotation constraints and displayed rows use the final set of stats. retained results receive more precise cpu rescoring, and a result deduplication bug during table growth is fixed
        `,
      },
      {
        type: 'paragraph',
        content: `
          corrected manual buff calculations. they were being counted twice in some calculations, which could inflate displayed stats and damage.
        `,
      },
      {
        type: 'paragraph',
        content: `
          corrected Hecate sonata options. Hecate now supports all its seven valid Sonata sets.
        `,
      }
    ],
    shortDesc: `full(-ish) game data import`,
  },
]

export const ltstCurChngE =
  curChngEnts[curChngEnts.length - 1] ?? null

export function getLinkedWhatsNew(entry: ChngRcrd | null): WnEntry | null {
  if (!entry?.whatsNew) {
    return null
  }

  return {
    date: entry.date,
    ...entry.whatsNew,
  }
}

export function getWhatsNewEntries(): WnEntry[] {
  return curChngEnts
    .flatMap((entry) => {
      const whatsNew = getLinkedWhatsNew(entry)
      return whatsNew ? [whatsNew] : []
    })
    .reverse()
}

export function getLatestWhatsNew(): WnEntry | null {
  return getWhatsNewEntries()[0] ?? null
}

export function getCurChngTs(entry: ChngRcrd | null): string {
  if (!entry) {
    return 'none'
  }

  return `${entry.date}:${entry.shortDesc ?? entry.entries[0]?.content ?? 'update'}`
}

export const legChngEnts: ChngRcrd[] = [
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
                        They're divided into clear categories such as <strong>Echoes</strong>, <strong>Rotations</strong>, <strong>Team Buffs</strong>, and <strong>Overview</strong>, each covering a specific part of the calculator.

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
        content: `Added <strong>confirmation modals</strong> across key actions including <em>Clear Rotation</em>, <em>Unequip All Echoes</em>, and <em>Delete</em> operations to prevent accidental clicks and data loss.`,
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
                Updated <strong>Galbrena's Afterflame</strong> and <strong>Qiuyuan's Inherent Skill: Quietude Within</strong> to use <em>Damage Taken</em> effects.
                The English text originally described these as damage bonuses, but the Chinese text specified them as damage taken modifiers.
                With <strong>Galbrena's</strong> official release confirming the CN behavior, both effects have been adjusted to match the in-game mechanics which also implies that <strong>Qiuyuan's Inherent Skill: Quietude Within</strong> should follow the same rule.
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
                Each preset remembers your exact Echo setup including main stats, substats, and set bonuses.
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
                You can now personalize the calculator's text style to match your vibe clean, minimal, or classy.
            `,
      },
      {
        type: 'paragraph',
        content: `
                Pick your favorite font and watch the entire interface update instantly, no reloads, no delay.
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
            The theme selector now uses color swatches for <em>light</em> and <em>dark</em> modes.
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
        content: `Buffs and stats now use a unified <strong>"buff path"</strong> system to support future characters, echoes, and weapons.`,
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

export const chngSctn: ChngSctn[] = [
  {
    id: 'current',
    label: 'Current',
    entries: curChngEnts,
  },
  {
    id: 'legacy',
    label: 'Legacy',
    entries: legChngEnts,
  },
]
