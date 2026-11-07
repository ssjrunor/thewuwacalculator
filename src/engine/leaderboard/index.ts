/*
  Author: Runor Ewhro
  description: the only engine surface the leaderboard service may import.
*/

export { indexTeammateBuilds, teamSlotKey } from './teammateBuilds'
export type { ResolvedTeammate, TeammateBuildsFile, TeammateEcho, TeammateLayout, TeammateOutfit } from './teammateBuilds'

// card + scenario definition -> scenario input -> CombatScenario.
export { scenarioDefs } from './scenarioDefs'
export type { ScenarioDefsInput, ScenariosFile } from './scenarioDefs'
export { buildScenarioInput, canonicalResonatorId, snapshotEchoes, snapshotIssues, teammateEchoes } from './scenarioInput'
export type { CatalogEcho, ScenarioInputDeps } from './scenarioInput'
export { scenarioInputDeps } from './scenarioInputDeps'
export { createScenario, modeControlKey, scenarioMemberId, scenarioResonatorIds } from './scenario'

// team action plans (data/actions.json) and the identity their seats use.
export { assertActionPlan } from '@/domain/rotationActions/actionPlan'
export { resonatorForms } from '@/domain/rotationActions/identities'
export type { ActionPlan } from '@/domain/rotationActions/types'

// ruleset -> scoring session -> one scenario's score -> the build's best.
export { LEADERBOARD_ENGINE_VER, ROTATION_GEN_VER } from './version'
export { canonicalJson, sha256Hex } from '@/domain/leaderboard/canonical'
export { openRuleset, refsKey, rulesetVersionIssues, RulesetError } from './rulesetReader'
export type { OpenedRuleset, RulesetFiles } from './rulesetReader'
export { bindRulesetGameData, openScoringSession, ScoringDataConflict } from './scoringSession'
export type { ScoringSession } from './scoringSession'
export { pendingRotationExecutor, scoreScenario } from './scoreScenario'
export type { ExecutionRequest, ExecutionResult, ProgramDocument, RotationExecutor, RotationGenerator, ScenarioScore, ScenarioScoringContext } from './scoreScenario'
export { scenariosForResonator, scoreBuild } from './scoreBuild'
export type { BuildScores } from './scoreBuild'
export { buildScore, validAnchors } from './scoreFormula'
export type { ScoreAnchors } from './scoreFormula'
export { pickBest } from './pickBest'
export type { RankableScore } from './pickBest'
export { leaderboardWeaponRank, STANDARD_WEAPON_IDS } from './weaponRank'
export { ALL_SEQUENCES, computeReferences, pendingReferenceSearch } from './references'
export type { ReferenceRequest, ReferenceResult, ReferenceRun, ReferenceSearch } from './references'
