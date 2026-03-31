import type { ReactNode } from 'react'

export const modalContent: Record<string, ReactNode> = {
  emptyEchoBag: (
    <div>
      <h2>{'(⊙ _ ⊙ ) well this is awkward... your bag is empty.'}</h2>
      <p>
        The optimizer {"can't"} run because your{' '}
        <span className="highlight">Echo Bag</span> currently has no usable echoes.
        It only works with echoes that are in your bag (and pass your filters), so with
        an empty bag there are literally <strong>no combinations</strong> to test.
      </p>
      <p>To get meaningful optimizer results, {"you'll"} want to:</p>
      <ul>
        <li>
          <strong>Add echoes to your bag</strong> from the Echoes tab (manually or via
          the parser).
        </li>
        <li>
          Make sure your <strong>{"filters aren't hiding everything"}</strong> {"– try loosening "}
          {"set filters or decreasing the \"Filter Strength\" if you've already added echoes."}
        </li>
      </ul>
      <p>
        Once your bag has some echoes, the optimizer will be able to generate valid 5-piece,
        {'cost \u2264 12 combinations and show you the best-performing builds instead of an empty list.'}
      </p>
      <p className="optimizer-modal-note">
        {'TL;DR: no echoes in, no optimizations out. Fill your bag first, then rerun the optimizer ദ്ദി(˵ •̀ ᴗ - ˵ ) ✧.'}
      </p>
    </div>
  ),

  noValidCombos: (
    <div>
      <h2>{'(￣﹃￣) your filters are a bit too powerful...'}</h2>
      <p>
        Your <span className="highlight">Echo Bag</span> does have echoes, but with the
        current settings the optimizer {"couldn't"} find <strong>any valid combinations</strong>.
        In other words, the filters are so strict that nothing passes the rules.
      </p>
      <p>Typical reasons this happens:</p>
      <ul>
        <li>
          Your <strong>Echo Bag</strong> has echoes but not enough to form at least 1 combination of echoes
          {'where their summed up costs is valid (\u2264 12).'}
        </li>
        <li>
          The <strong>Filter Strength</strong> is too high, so almost all echoes
          are thrown away before combos are built.
        </li>
        <li>
          Your <strong>set plan</strong> is impossible with the echoes in your bag
          {"(for example, forcing a 5-piece set you don't actually have enough pieces for)."}
        </li>
        <li>
          A <strong>main echo lock</strong> is set on an echo that makes it impossible
          {'to build a valid cost \u2264 12, 5-piece combo around it.'}
        </li>
      </ul>
      <p>To fix it, try one or more of these:</p>
      <ul>
        <li>Decrease the <strong>Filter Strength</strong> so more echoes survive.</li>
        <li>Relax or clear some <strong>sonata set constraints</strong>.</li>
        <li>
          Temporarily <strong>remove the main echo lock</strong> to see if valid combos
          appear again.
        </li>
      </ul>
      <p>
        Once at least one valid combination exists, the optimizer will show a non-zero
        {'permutation count and you\'ll be able to run it normally.'}
      </p>
      <p className="optimizer-modal-note">
        {'TL;DR: Make sure you have usable echoes in your bag and soften the filters a bit, then try again (ง •̀_•́)ง.'}
      </p>
    </div>
  ),

  rangeLimitsTooStrict: (
    <div>
      <h2>{'｡°(°.◜ᯅ◝°)°｡ range limits said "no" to everything'}</h2>
      <p>
        The optimizer <strong>did</strong> run and it <strong>did</strong> find echo
        combinations, but every single one was thrown out by your{' '}
        <span className="highlight">Range Limits</span>.
      </p>
      <p>
        In other words: there <em>are</em> {'valid cost \u2264 12, 5-piece builds formed from the echoes in your bag, '}
        just none that satisfy all the min/max constraints you set for your range limits.
      </p>
      <p>Common situations where this happens:</p>
      <ul>
        <li>
          You set very high <strong>minimums</strong> on several stats at once
          (e.g., Crit Rate, Crit DMG, ATK%, and Energy Regen all {"needing \"endgame\" values"}).
        </li>
        <li>
          You added tight <strong>maximums</strong> that conflict with your minimums
          {'(for example, Crit Rate \u2265 70% but \u2264 60%).'}
        </li>
      </ul>
      <p>How to loosen the chokehold:</p>
      <ul>
        <li>Really, just clear them.</li>
        <li>Only enforce hard caps on one or two at a time until you see results again.</li>
      </ul>
      <p>
        After you dial the limits back, rerun the optimizer. As soon as at least one build
        fits inside your <span className="highlight">Range Limits</span>, results will start appearing again.
      </p>
      <p className="optimizer-modal-note">
        {'TL;DR: the builds exist, your ranges just fenced them out. Widen the gate a bit and try again (˶ᵔ ᵕ ᵔ˶).'}
      </p>
    </div>
  ),

  gpuNotAvailable: (
    <div>
      <h2>{'(╯°□°）╯︵ ┻━┻ your GPU said "not today."'}</h2>
      <p>
        The <span className="highlight">Optimizer</span> {"can't"} run on GPU right now because
        this browser / device {"doesn't"} fully support{' '}
        <strong>WebGPU</strong> or {"didn't"} allow the GPU context to be created.
      </p>
      <p>Common reasons this happens:</p>
      <ul>
        <li>{"Your browser doesn't support WebGPU yet, or it's behind a flag."}</li>
        <li>
          {"You're on an older / low-power device where GPU compute isn't exposed to the web."}
        </li>
        <li>
          The GPU driver or browser blocked WebGPU for safety / compatibility reasons.
        </li>
      </ul>
      <p>What you can do about it:</p>
      <ul>
        <li>
          Try a <strong>modern Chromium-based browser</strong> (like the latest Chrome
          or Edge) with WebGPU enabled.
        </li>
        <li>
          Make sure your browser is <strong>up to date</strong>, then reload the page.
        </li>
        <li>
          Or just switch the optimizer to <strong>CPU mode</strong> {"– it's slower, but "}
          it will still find good builds.
        </li>
      </ul>
      <p className="optimizer-modal-note">
        {"TL;DR: your setup can't run the GPU path right now. Use CPU mode or try a newer browser / device and then flip GPU back on ( •̀ω•́ )✧"}
      </p>
    </div>
  ),

  firstTimeOptimizer: (
    <div>
      <h2>{'Hey... 𐔌՞ ܸ.ˬ.ܸ՞𐦯'}</h2>
      <p>
        Quick heads up before you hit <span className="highlight">Run</span>:
        the compute engine is currently set to <strong>CPU</strong>.
        {" CPU mode works everywhere\u2026 but it's also the "}
        <strong>{"\"this might take a while\""}</strong> option.
      </p>
      <p>
        If your device supports it, switching to <strong>GPU (WebGPU)</strong> is{' '}
        <strong>dramatically faster</strong> and makes big search runs feel instant-ish.
        {"It won't break anything if it doesn't work, you can always flip back to CPU."}
      </p>
      <p className="optimizer-modal-recommended">
        <strong>Recommended:</strong>
      </p>
      <ul>
        <li>
          Try <strong>GPU</strong> first. {"If it runs, you're living in the future."}
        </li>
        <li>
          {"If GPU fails or isn't supported, CPU will still work (just slower)."}
        </li>
      </ul>
      <p className="optimizer-modal-note">
        {'TL;DR: GPU is the turbo button. Give it a shot. Worst case, you fall back to CPU and still get good builds.'}
      </p>
    </div>
  ),

  comboModePending: (
    <div>
      <h2>Combo Mode UI is in place, but the optimizer backend is not wired yet.</h2>
      <p>
        You can switch between <span className="highlight">Skill</span> and{' '}
        <span className="highlight">Combo</span> and browse the target combo choices,
        but running combo optimization is still pending implementation.
      </p>
      <p>
        For now, switch back to <strong>Skill</strong> mode to run the optimizer.
      </p>
    </div>
  ),
}
