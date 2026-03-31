import { useEffect, useMemo, useState } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { InventoryBuildEntry, InventoryEchoEntry } from '@/domain/entities/inventoryStorage'
import {
  cloneEchoForSlot,
  cloneEchoLoadout,
  getBuildSnapshotSignature,
} from '@/domain/entities/inventoryStorage'
import { useAppStore } from '@/domain/state/store'
import { selectActiveRuntime } from '@/domain/state/selectors'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { getWeaponById } from '@/domain/services/weaponCatalogService'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility.ts'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'
import { useToastStore } from '@/shared/util/toastStore.ts'
import { InventoryModal } from '@/modules/calculator/components/inventory/InventoryModal'
import { EchoEditModal } from '@/modules/calculator/components/inventory/modals/EchoEditModal'

// manages the inventory modal layer and the echo/build equip flows.
export function CalculatorInventoryLayer() {
  const inventoryOpen = useAppStore((state) => state.inventoryOpen)
  const setInventoryOpen = useAppStore((state) => state.setInventoryOpen)
  const runtime = useAppStore(selectActiveRuntime)
  const updateActiveResonatorRuntime = useAppStore((state) => state.updateActiveResonatorRuntime)
  const [editingInventoryEchoEntryId, setEditingInventoryEchoEntryId] = useState<string | null>(null)
  const {
    closing: inventoryClosing,
    hide: hideInventoryModal,
    open: inventoryDialogOpen,
    show: showInventoryModal,
    visible: inventoryVisible,
  } = useAnimatedVisibility(300)
  const modalPortalTarget = getMainContentPortalTarget()

  useEffect(() => {
    if (inventoryOpen) {
      showInventoryModal()
      return
    }

    hideInventoryModal(() => {
      if (!inventoryOpen) {
        setEditingInventoryEchoEntryId(null)
      }
    })
  }, [hideInventoryModal, inventoryOpen, showInventoryModal])

  if (!runtime) {
    return null
  }

  const activeSeed = getResonatorSeedById(runtime.id)

  return (
    <>
      {inventoryVisible ? (
        <MountedInventoryLayer
          runtime={runtime}
          activeSeedName={activeSeed?.name ?? runtime.id}
          visible={inventoryVisible}
          open={inventoryDialogOpen}
          closing={inventoryClosing}
          portalTarget={modalPortalTarget}
          editingInventoryEchoEntryId={editingInventoryEchoEntryId}
          onClose={() => {
            setInventoryOpen(false)
            setEditingInventoryEchoEntryId(null)
          }}
          onEditInventoryEchoEntry={setEditingInventoryEchoEntryId}
          onCloseEchoEditor={() => setEditingInventoryEchoEntryId(null)}
          onEquipInventoryEcho={(entry, slotIndex) => {
            updateActiveResonatorRuntime((prev) => {
              const nextEchoes = [...prev.build.echoes]
              nextEchoes[slotIndex] = cloneEchoForSlot(entry.echo, slotIndex)
              return {
                ...prev,
                build: {
                  ...prev.build,
                  echoes: nextEchoes,
                },
              }
            })
          }}
          onEquipInventoryBuild={(entry) => {
            const seed = getResonatorSeedById(runtime.id)
            const savedWeapon = entry.build.weapon.id ? getWeaponById(entry.build.weapon.id) : null
            const weaponTypeMatches = !seed || !savedWeapon || savedWeapon.weaponType === seed.weaponType

            updateActiveResonatorRuntime((prev) => ({
              ...prev,
              build: {
                ...prev.build,
                ...(weaponTypeMatches ? { weapon: { ...entry.build.weapon } } : {}),
                echoes: cloneEchoLoadout(entry.build.echoes),
              },
            }))

            if (!weaponTypeMatches) {
              useToastStore.getState().show({
                content: `Oof... ${savedWeapon?.name ?? 'saved weapon'} isn't compatible with ${seed?.name ?? 'this resonator'}. Geared in echoes tho. ദ്ദി˙ ᴗ ˙ )`,
                variant: 'warning',
              })
            } else {
              useToastStore.getState().show({
                content: `Geared~ ദ്ദി ˉ꒳ˉ )✧`,
                variant: 'success',
                duration: 3000,
              })
            }
          }}
        />
      ) : null}
    </>
  )
}

function MountedInventoryLayer(props: {
  runtime: NonNullable<ReturnType<typeof selectActiveRuntime>>
  activeSeedName: string
  visible: boolean
  open: boolean
  closing: boolean
  portalTarget: HTMLElement | null
  editingInventoryEchoEntryId: string | null
  onClose: () => void
  onEditInventoryEchoEntry: (entryId: string | null) => void
  onCloseEchoEditor: () => void
  onEquipInventoryEcho: (entry: InventoryEchoEntry, slotIndex: number) => void
  onEquipInventoryBuild: (entry: InventoryBuildEntry) => void
}) {
  const profilesById = useAppStore((state) => state.calculator.profiles)
  const inventoryEchoes = useAppStore((state) => state.calculator.inventoryEchoes)
  const inventoryBuilds = useAppStore((state) => state.calculator.inventoryBuilds)
  const addBuildToInventory = useAppStore((state) => state.addBuildToInventory)
  const updateInventoryBuild = useAppStore((state) => state.updateInventoryBuild)
  const removeInventoryBuild = useAppStore((state) => state.removeInventoryBuild)
  const clearInventoryBuilds = useAppStore((state) => state.clearInventoryBuilds)
  const updateEchoInInventory = useAppStore((state) => state.updateEchoInInventory)
  const removeEchoFromInventory = useAppStore((state) => state.removeEchoFromInventory)
  const clearInventoryEchoes = useAppStore((state) => state.clearInventoryEchoes)

  const editingInventoryEchoEntry = props.editingInventoryEchoEntryId
    ? inventoryEchoes.find((entry) => entry.id === props.editingInventoryEchoEntryId) ?? null
    : null

  const buildUsageNamesById = useMemo(
    () => {
      const usageNamesBySignature = new Map<string, string[]>()

      for (const [resonatorId, profile] of Object.entries(profilesById)) {
        const signature = getBuildSnapshotSignature({
          weapon: profile.runtime.build.weapon,
          echoes: profile.runtime.build.echoes,
        })

        const existing = usageNamesBySignature.get(signature)
        const resonatorName = getResonatorSeedById(resonatorId)?.name ?? resonatorId

        if (existing) {
          existing.push(resonatorName)
          continue
        }

        usageNamesBySignature.set(signature, [resonatorName])
      }

      return Object.fromEntries(
        inventoryBuilds.map((entry) => [entry.id, usageNamesBySignature.get(getBuildSnapshotSignature(entry.build)) ?? []]),
      ) as Record<string, string[]>
    },
    [inventoryBuilds, profilesById],
  )

  return (
    <>
      <InventoryModal
        visible={props.visible}
        open={props.open}
        closing={props.closing}
        portalTarget={props.portalTarget}
        resonatorId={props.runtime.id}
        currentBuild={{
          weapon: props.runtime.build.weapon,
          echoes: props.runtime.build.echoes,
        }}
        inventoryEchoes={inventoryEchoes}
        inventoryBuilds={inventoryBuilds}
        buildUsageNamesById={buildUsageNamesById}
        onClose={props.onClose}
        onEquipInventoryEcho={props.onEquipInventoryEcho}
        onEditInventoryEcho={(entry: InventoryEchoEntry) => props.onEditInventoryEchoEntry(entry.id)}
        onRemoveInventoryEcho={removeEchoFromInventory}
        onClearInventoryEchoes={clearInventoryEchoes}
        onSaveCurrentBuild={() => {
          addBuildToInventory({
            resonatorId: props.runtime.id,
            resonatorName: props.activeSeedName,
            build: {
              weapon: { ...props.runtime.build.weapon },
              echoes: cloneEchoLoadout(props.runtime.build.echoes),
            },
          })
        }}
        onEquipInventoryBuild={props.onEquipInventoryBuild}
        onUpdateInventoryBuildName={(entryId, name) => updateInventoryBuild(entryId, { name })}
        onRemoveInventoryBuild={removeInventoryBuild}
        onClearInventoryBuilds={clearInventoryBuilds}
      />

      {editingInventoryEchoEntry ? (
        <EchoEditModal
          visible={true}
          open={true}
          closing={false}
          portalTarget={props.portalTarget}
          echo={editingInventoryEchoEntry.echo}
          slotIndex={0}
          onSave={(updated: EchoInstance) => {
            updateEchoInInventory(editingInventoryEchoEntry.id, updated)
            props.onCloseEchoEditor()
          }}
          onClose={props.onCloseEchoEditor}
        />
      ) : null}
    </>
  )
}
