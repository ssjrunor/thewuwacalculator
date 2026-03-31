export function OptimizerRules() {
  return (
    <div className="optimizer-rules-modal">
      <h2>{'Rules (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧'}</h2>
      <p>
        The optimizer follows a few behind-the-scenes rules that affect what you see. Keep
        these in mind so results match your expectations {'(＾▽＾)'}.
      </p>
      <ul>
        <li>
          <strong>GPU vs CPU runs:</strong> GPU (WebGPU) is much faster and gets used when
          available. If WebGPU is missing or you stay on CPU, large searches take longer;
          {"you'll also see a reminder the first time you try to run on CPU (if you haven't already)"}
          {' (ง •̀_•́)ง'}.
        </li>
        <li>
          <strong>Echo bag only:</strong> Every build comes from echoes in your bag after
          filters are applied. If the bag is empty or filters hide everything, the optimizer
          has nothing to test and will surface empty/no-combo alerts {'(；・ω・)'}.
        </li>
        <li>
          <strong>Filter strength trimming:</strong> {"The \"Filter Strength\" slider prunes the "}
          bottom slice of your bag using the current stat weights, so a high setting can
          silently drop usable echoes and shrink the search. When optimizing for a combo,
          this trim is skipped, so every filtered echo is considered {'(•̀‿•́)b'}.
        </li>
        <li>
          <strong>Set and main-stat guards:</strong> Allowed Sets (3pc/5pc) and Main Stat
          filters hard-block echoes that {"don't"} match, so tightening them reduces both the
          permutation count and the variety of results. Great for focused builds, less great
          {"for \"show me everything\" runs"} {'(´･ᴗ･ `)'}.
        </li>
        <li>
          <strong>Main echo lock cost check:</strong> Locking a main echo forces it into slot
          {"one; if that makes cost > 12 with your bag, you'll see \"no valid combos.\""}
          {"That's the cost cap doing its job"} {'(๑•̀ㅂ•́)و✧'}.
        </li>
        <li>
          <strong>Range limits are hard stops (single-skill only):</strong> Min/Max fields
          discard any combo that lands outside those numbers. Overly tight ranges can wipe
          out all results even if the bag has plenty of echoes. When optimizing for a combo,
          range limits are ignored so you always see candidates {'(･ω･)ゞ'}.
        </li>
        <li>
          <strong>Combo target changes columns:</strong> Choosing a combo to optimize runs
          the optimizer against your saved rotation totals and hides bonus/amp columns, so
          expect different rankings than for a single skill. Same data, different lens{' '}
          {'(✿◠‿◠)'}.
        </li>
        <li>
          <strong>Progress is live but partial:</strong> HALT stops early but keeps the best
          results found so far; permutation counts and ETAs reflect the current filters and
          can swing as you tweak them. {"Don't panic if the numbers jump around"} {'(≧◡≦)'}.
        </li>
      </ul>
    </div>
  )
}
