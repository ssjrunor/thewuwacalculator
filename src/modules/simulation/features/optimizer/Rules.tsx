/*
  Author: Runor Ewhro
  Description: Owns rules behavior and state transitions for the optimizer module.
*/

import { ModalHeader } from '@/shared/ui/AppModalShell'

export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="amdl optimizer-rules-modal">
      <ModalHeader over="Optimizer" title={'Rules (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧'} onClose={onClose} />
      <div className="optimizer-rules-modal__body">
        <div className="amdl__prose">
          <p>
            The optimizer follows a few behind-the-scenes rules that affect what you see. Keep
            these in mind so results match your expectations {'(＾▽＾)'}.
          </p>
        </div>

        <div className="amdl__grp">
          <div className="amdl__grp-name">How runs work</div>
          <div className="amdl__prose">
            <p>
              <strong>GPU vs CPU runs.</strong> GPU (<em>WebGPU</em>) is much faster and gets used when
              available. If WebGPU is missing or you stay on CPU, large searches take longer;
              {" you'll also see a reminder the first time you try to run on CPU (if you haven't already)"}
              {' (ง •̀_•́)ง'}.
            </p>
            <p>
              <strong>Progress is live but partial.</strong> <em>HALT</em> stops early but keeps the best
              results found so far; permutation counts and ETAs reflect the current filters and
              can swing as you tweak them. {"Don't panic if the numbers jump around"} {'(≧◡≦)'}.
            </p>
          </div>
        </div>

        <div className="amdl__grp">
          <div className="amdl__grp-name">What gets searched</div>
          <div className="amdl__prose">
            <p>
              <strong>Echo bag only.</strong> Every build comes from echoes in your bag after
              filters are applied. If the bag is empty or filters hide everything, the optimizer
              has nothing to test and will surface empty/no-combo alerts {'(；・ω・)'}.
            </p>
            <p>
              <strong>Filter strength trimming.</strong> {'The "Filter Strength" slider prunes the '}
              bottom slice of your bag using the current stat weights, so a high setting can
              silently drop usable echoes and shrink the search. When optimizing for a combo,
              this trim is skipped, so every filtered echo is considered {'(•̀‿•́)b'}.
            </p>
            <p>
              <strong>Set and main-stat guards.</strong> Allowed Sets (3pc/5pc) and Main Stat
              filters hard-block echoes that {"don't"} match, so tightening them reduces both the
              permutation count and the variety of results. Great for focused builds, less great
              {' for "show me everything" runs'} {'(´･ᴗ･ `)'}.
            </p>
            <p>
              <strong>Main echo lock cost check.</strong> Locking a main echo forces it into slot
              {' one; if that makes cost > 12 with your bag, you\'ll see "no valid combos."'}
              {" That's the cost cap doing its job"} {'(๑•̀ㅂ•́)و✧'}.
            </p>
          </div>
        </div>

        <div className="amdl__grp">
          <div className="amdl__grp-name">Limits and lenses</div>
          <div className="amdl__prose">
            <p>
              <strong>Range limits are hard stops</strong> (single-skill only). Min/Max fields
              discard any combo that lands outside those numbers. Overly tight ranges can wipe
              out all results even if the bag has plenty of echoes. When optimizing for a combo,
              range limits are ignored so you always see candidates {'(･ω･)ゞ'}.
            </p>
            <p>
              <strong>Combo target changes columns.</strong> Choosing a combo to optimize runs
              the optimizer against your saved rotation totals and hides bonus/amp columns, so
              expect different rankings than for a single skill. Same data, different lens{' '}
              {'(✿◠‿◠)'}.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
