/*
  Author: Runor Ewhro
  description: the reported fallback for a team without a translation: the app's context rotation, with the supplied
               team and builds.
*/

import type { CombatScenario } from '../../domain/entities/combatScenario'
import type { InterpreterEnvironment, InterpretationResult, InterpretationOptions, RuntimeRecord } from './types'
import { prepareEditorSources } from './editor/catalog'
import { buildTeamPreamble } from './editor/preamble'
import { cleanupGeneratedRotation } from './editor/cleanup'

// the context member's first authored rotation, preceded by the team preamble and cleaned as the editor cleans it;
// the result is marked partial and records `cause` as its omission
export async function catalogRotationFallback(environment: InterpreterEnvironment, input: CombatScenario,
  cause: RuntimeRecord, options: InterpretationOptions = {}): Promise<InterpretationResult> {
  const scenario = structuredClone(input)
  const pairs = await Promise.all(scenario.team.members.map(async member =>
    [member.resonatorId, await environment.gameData(`resonators/runtime-bundles/${member.resonatorId}`)] as const))
  const resonators = Object.fromEntries(pairs) as Record<string, RuntimeRecord>
  const context = scenario.team.members.find(member => member.id === scenario.contextMemberId)!
  const source = resonators[context.resonatorId].source
  const body = structuredClone(source.rotations?.[0]?.items ?? [])
  // unowned features, conditions and runtime writes belong to the context member, through attached nodes and forks
  const bindOwner = (node: RuntimeRecord): void => {
    if (node.type === 'feature' || node.type === 'condition') node.resonatorId ??= context.resonatorId
    for (const change of node.changes ?? []) if (change.path?.startsWith('runtime.')) change.resonatorId ??= context.resonatorId
    for (const children of [node.attached?.features, node.attached?.conditions, ...Object.values(node.passForks ?? {})]) {
      for (const child of children ?? []) bindOwner(child)
    }
  }
  body.forEach(bindOwner)
  const editor = prepareEditorSources({ scenario, resonators, echoes: environment.echoSources,
    sonataDefinitions: environment.sonataDefinitions })
  const items = [...buildTeamPreamble(editor.preambleChoices, context.resonatorId, editor.preambleValues), ...body]
  options.onBeforeCleanup?.(items)
  // the authored rotation starts with the context member on field
  scenario.initialOnFieldMemberId = context.id
  scenario.program.program = cleanupGeneratedRotation(items, editor.activeOtherControls, editor.preambleChoices).items
  return { status: 'interpreted', scenario, duration: 0, diagnostics: { partial: true, readsBuildStats: true,
    timingModel: 'catalog-context-fallback', omissions: [{ code: 'catalog-context-rotation-fallback', cause }] } }
}
