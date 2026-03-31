const cuteMessages = [
  // personalized messages for signed-in users.
  "Heeeeyyy, fabulous {userName}~! (⁄⁄>ω<⁄⁄)♡ I hope you brought your sparkle today! You’re here! You’re finally here! ＼(≧▽≦)／",
  "Guess who just logged in? The one and only {userName}! (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧ My day just got 1000% better! ～(￣▽￣～) Welcome back, superstar!! ☆彡",
  "Be still my heart! It’s {userName}! (づ｡◕‿‿◕｡)づ Sending you the biggest, fluffiest virtual hug! (っ˘ω˘ς) May your coffee be strong and your code run perfectly! (☞ﾟヮﾟ)☞",
  "Did someone say {userName} was here?! (⁄ ⁄•⁄ω⁄•⁄ ⁄)⁄ You’re making me blush! So happy to see your bright virtual face! (*≧▽≦)ﾉ Let's make some magic~ ☆⌒(> _ < )",
  "Ding ding!! (￣▽￣)ノ A wild {userName} appeared! ヽ(★ω★)ノ You win the prize for 'Most Delightful Person to Show Up Today!' ＼(≧◡≦)/",
  "Psst... {userName}! (¬‿¬ ) Just wanted to say you’re awesome! (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧ Now go conquer the whatever, you glorious human!! (ง •̀_•́)ง",
  "Oh my goodness, it’s the legendary {userName}! (⊙﹏⊙✿) The site just wasn’t the same without you~ Welcome!! (つ≧▽≦)つ",
  "Hello there, {userName}! (＾▽＾)／ Your presence has officially unlocked 'Extreme Happiness Mode'!! ＼(￣▽￣)／",
  "Hold the phone! (╯✧▽✧)╯ It’s {userName}! Everything stops now because YOU are the main event! ＼(＾▽＾)／ YIPPEEE!! (งˆ▽ˆ)ง",
  "A friendly wave for {userName}! ヾ(・ω・*)ノ May your cookies be fresh and your internet fast! (≧∇≦)/ So glad you’re here~!",
  "Look who popped in! {userName}! (ﾉ≧∀≦)ﾉ Time to party~!! Ｏ(≧∇≦)Ｏ I even baked a digital cake just for you~ ヽ(〃＾▽＾〃)ﾉ",
  "I was just thinking about you, {userName}! (ღ✪v✪) Coincidence?! Nope—destiny!! (つ✧ω✧)つ",
  "The stars aligned and delivered {userName} to my screen~ ☆彡 You’re the best! Don’t let anyone tell you otherwise!! (≧◡≦)/",
  "Oh happy day!! ヾ(＠^▽^＠)ﾉ {userName} has graced us with their presence~ Time to buckle up and have some fun!! ヽ(＾Д＾)ﾉ",
  "Is that {userName} I see? (o_O) You’re looking radiant today~ ✧(>o<)✧ Thanks for brightening this little corner of the web~ (´▽`ʃ♡ƪ)",
  "Stop scrolling!! (ﾉ≧ڡ≦) Official welcome notification for {userName}! We missed your sparkle~ (≧ω≦)b",
  "My favorite user {userName} is here!! (*≧∀≦*) Prepare for a blast of sunshine and good vibes~ (☞ﾟヮﾟ)☞",
  "Welcome to the VIP section, {userName}! (๑˃̵ᴗ˂̵)و You deserve all the sparkly good things today~ ☆～（ゝ。∂）",
  "Hey {userName}! (✿◠‿◠) Virtual high-five incoming!! ✋ Glad you dropped by~ ( ´ ▽ ` )ﾉ",
  "System alert!! ( ⚆ _ ⚆ ) Pure wonderfulness detected! Must be {userName}! ヽ(♡‿♡)ノ Have an amazing time here!",
  "Hello hello, {userName}~! (•‿•)ゝ It’s me, your friendly site greeter~ Ready to embark on digital adventures~ o(〃＾▽＾〃)o",
  "It’s time for some internet fun with {userName}! ヽ(＾Д＾)ﾉ Let the good times roll~!! (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧",
  "Top of the day to you, {userName}! (⌒▽⌒)☆ Hope you feel refreshed and ready to sparkle~ (❁´◡`❁)",
  "A giant, enthusiastic YES! {userName} is in the house~ (っ＾▿＾)っ Welcome welcome welcome~ (≧◡≦)",
  "Just a little note to say hi to {userName}~ (ﾉ´ヮ`)ﾉ*: ･ﾟ You make everything brighter just by existing~ (ღ˘⌣˘ღ)",
]

const genericCuteMessages = [
  // generic messages when there is no signed-in profile name.
  "OH. MY. GOODNESS. You’re here!! ヽ(＾Д＾)ﾉ Welcome to the party~ ＼(☆o☆)／ So thrilled you stopped by~ ヽ(♡‿♡)ノ",
  "A dazzling hello from the entire team!! (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧ Sending the warmest digital welcome~ ヽ(＾Д＾)ﾉ Please enjoy your stay!",
  "Stop what you’re doing and accept this virtual bouquet!! (✿◠‿◠)✿ You are appreciated~ ヽ(＾Д＾)ﾉ",
  "Well hello there, sunshine~ (〃＾▽＾〃) Your arrival just triggered the JOY ALARM~ (ง’̀-‘́)ง Welcome!!",
  "Welcome, welcome, WELCOME~ (ﾉ≧∀≦)ﾉ Pop open the virtual bubbly~ ( ＾◡＾)っ🥂 You made it!",
  "Hey hey, fabulous human~ (≧◡≦)ノ We’re so excited to have you! Don’t be shy~ click all the things! Ｏ(≧∇≦)Ｏ",
  "Greetings, traveler!! ( ＾▽＾)／ You’ve landed in the happiest corner of the web~ (づ｡◕‿‿◕｡)づ",
  "Is it getting warm in here?! (//ω//) That’s the heat of our enthusiasm~ ヾ(＠⌒ー⌒＠)ノ Welcome!",
  "You’ve unlocked the Super Happy Site Experience!! (ﾉ≧∀≦)ﾉ Enjoy your digital adventure~ (＾▽＾)/",
  "Bonjour~ Hola~ Guten Tag~ Ｏ(≧▽≦)Ｏ No matter the language, we’re thrilled to see you here~ (´｡• ω •｡`)",
  "Sending pixelated confetti~ ☆⌒(≧▽​° ) Welcome welcome~ ヾ(＠＾▽＾＠)ﾉ",
  "Look around, stay a while, and let us know if you need anything~ (๑˃̵ᴗ˂̵)و Hello hello!! (＾▽＾)",
  "The adventure begins NOW~ (ง •̀_•́)ง Grab your gear and let’s go~ Ｏ(≧∇≦)Ｏ",
  "A quiet whisper of welcome~ ( ˘ ³˘)っ But actually, a loud HELLO!!! (ノ*°▽°*)",
  "If joy had a sound, it would be YOU showing up~ ♪ヽ( ⌒o⌒)人(⌒-⌒ )v♪",
  "Consider yourself officially greeted with MAXIMUM ENTHUSIASM!! (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧ Welcome~ (＾▽＾)/",
  "Did you just teleport here?! (⊙_◎) That was fast~ (ﾉ´ヮ`)ﾉ*:･ﾟ✧ We’re ready for you!",
  "A big bouncy hello to you~ (≧◡≦)/ Bounce your way around the site~ ヾ(＾∇＾)",
  "Tap tap tap... is this thing on? (•_•) YES! Testing 1-2-3~ Welcome live and loud!! ＼(￣▽￣)／",
  "Just stopping by to wave hi~ (≧◡≦)ノ You got this, superstar~ (๑•̀ㅂ•́)و✧",
  "It’s a beautiful day for browsing~ ( ´ ▽ ` )ﾉ Hope you enjoy every second~ (❁´◡`❁)",
  "We rolled out the virtual red carpet just for you~ (￣▽￣)ノ Come on in~ (＾▽＾)",
  "This is THE place to be~ (•̀ᴗ•́)و ̑̑ Thanks for dropping by~ (ﾉ´ヮ`)ﾉ*:･ﾟ✧",
  "Hello hello hello~ (≧∇≦)/ Can you hear me? Great!! (o^▽^o) Welcome aboard~!",
  "Your presence is a present~ (づ￣ ³￣)づ Thank you for visiting~ ヽ(〃＾▽＾〃)ﾉ",
  "DESTROYYYYYYY~ ୧(๑•̀ᗝ•́)૭",
]

// pick the same style of random cute message the old app used.
export function getCuteMessage(userName?: string | null): string {
  const trimmedName = userName?.trim()
  const pool = trimmedName ? cuteMessages : genericCuteMessages
  const template = pool[Math.floor(Math.random() * pool.length)] ?? genericCuteMessages[0]
  return template.replaceAll('{userName}', trimmedName || 'Lord Arbiter')
}
