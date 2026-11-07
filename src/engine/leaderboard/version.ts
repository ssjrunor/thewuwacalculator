/*
  Author: Runor Ewhro
  description: the versions a ruleset is stamped with and a scorer checks. bump
               LEADERBOARD_ENGINE_VER with any change that can move a score
               (scenario creation, evaluation, the score formula) and
               ROTATION_GEN_VER with any change to rotation generation or its
               rule data. a scorer refuses a ruleset built for other versions.
*/

export const LEADERBOARD_ENGINE_VER = 'lb-engine-14'
export const ROTATION_GEN_VER = 'rotation-gen-18'
