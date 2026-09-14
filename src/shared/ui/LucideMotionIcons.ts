/*
  Author: Runor Ewhro
  Description: App-wide Lucide Motion exports with the responsive size contract
               used by the shared icon controls.
*/

import type { ComponentProps, ComponentType, ElementType } from 'react'
import {
  ArrowDown as MotionArrowDown,
  ArrowRight as MotionArrowRight,
  ArrowUp as MotionArrowUp,
  Ban as MotionBan,
  ChartColumn as MotionBarChart3,
  CheckCheck as MotionCheckCheck,
  ChevronDown as MotionChevronDown,
  ChevronRight as MotionChevronRight,
  ChevronsDown as MotionChevronsDown,
  ChevronsDownUp as MotionChevronsDownUp,
  ChevronsUpDown as MotionChevronsUpDown,
  ChevronsLeft as MotionChevronsLeft,
  ChevronsRight as MotionChevronsRight,
  ClipboardPaste as MotionClipboardPaste,
  Columns3 as MotionColumns3,
  Command as MotionCommand,
  Copy as MotionCopy,
  CopyPlus as MotionCopyPlus,
  CornerDownLeft as MotionCornerDownLeft,
  CornerLeftUp as MotionCornerLeftUp,
  Crosshair as MotionCrosshair,
  DecimalsArrowLeft as MotionDecimalsArrowLeft,
  DecimalsArrowRight as MotionDecimalsArrowRight,
  Download as MotionDownload,
  Eraser as MotionEraser,
  FolderInput as MotionFolderInput,
  GitCompare as MotionGitCompare,
  GripVertical as MotionGripVertical,
  Layers as MotionLayers,
  ListEnd as MotionListEnd,
  ListPlus as MotionListPlus,
  MessageSquarePlus as MotionMessageSquarePlus,
  MessageSquareText as MotionMessageSquareText,
  Microchip as MotionMicrochip,
  Minus as MotionMinus,
  PanelRight as MotionPanelRight,
  Pencil as MotionPencil,
  Percent as MotionPercent,
  Play as MotionPlay,
  Plus as MotionPlus,
  Power as MotionPower,
  PowerOff as MotionPowerOff,
  Radio as MotionRadio,
  RadioOff as MotionRadioOff,
  Redo2 as MotionRedo2,
  Repeat as MotionRepeat,
  RotateCcw as MotionRotateCcw,
  RotateCwSquare as MotionRotateCwSquare,
  Save as MotionSave,
  Scissors as MotionScissors,
  Search as MotionSearch,
  Settings as MotionSettings,
  Share2 as MotionShare2,
  Sparkles as MotionSparkles,
  SquareDashedMousePointer as MotionSquareDashedMousePointer,
  SquarePen as MotionSquarePen,
  Swords as MotionSwords,
  TextQuote as MotionTextQuote,
  Timer as MotionTimer,
  Trash2 as MotionTrash2,
  TriangleAlert as MotionTriangleAlert,
  Undo2 as MotionUndo2,
  Unlink as MotionUnlink,
  X as MotionX,
  Columns3Cog as MotionColumns3Cog,
  Columns4 as MotionColumns4,
  Workflow as MotionWorkflow,
  ListOrdered as MotionListOrdered,
} from 'lucide-react-motion'

type ResponsiveMotionIcon<T extends ElementType> = ComponentType<
  Omit<ComponentProps<T>, 'size'> & { size?: number | string }
>

function responsive<T extends ElementType>(Icon: T): ResponsiveMotionIcon<T> {
  return Icon as unknown as ResponsiveMotionIcon<T>
}

export const ArrowDown = responsive(MotionArrowDown)
export const ArrowRight = responsive(MotionArrowRight)
export const ArrowUp = responsive(MotionArrowUp)
export const Ban = responsive(MotionBan)
export const BarChart3 = responsive(MotionBarChart3)
export const CheckCheck = responsive(MotionCheckCheck)
export const ChevronDown = responsive(MotionChevronDown)
export const ChevronRight = responsive(MotionChevronRight)
export const ChevronsDown = responsive(MotionChevronsDown)
export const ChevronsDownUp = responsive(MotionChevronsDownUp)
export const ChevronsUpDown = responsive(MotionChevronsUpDown)
export const ChevronsLeft = responsive(MotionChevronsLeft)
export const ChevronsRight = responsive(MotionChevronsRight)
export const ClipboardPaste = responsive(MotionClipboardPaste)
export const Columns3 = responsive(MotionColumns3)
export const Command = responsive(MotionCommand)
export const Copy = responsive(MotionCopy)
export const CopyPlus = responsive(MotionCopyPlus)
export const CornerDownLeft = responsive(MotionCornerDownLeft)
export const CornerLeftUp = responsive(MotionCornerLeftUp)
export const Crosshair = responsive(MotionCrosshair)
export const DecimalsArrowLeft = responsive(MotionDecimalsArrowLeft)
export const DecimalsArrowRight = responsive(MotionDecimalsArrowRight)
export const Download = responsive(MotionDownload)
export const Eraser = responsive(MotionEraser)
export const FolderInput = responsive(MotionFolderInput)
export const GitCompare = responsive(MotionGitCompare)
export const GripVertical = responsive(MotionGripVertical)
export const Layers = responsive(MotionLayers)
export const ListEnd = responsive(MotionListEnd)
export const ListPlus = responsive(MotionListPlus)
export const MessageSquarePlus = responsive(MotionMessageSquarePlus)
export const MessageSquareText = responsive(MotionMessageSquareText)
export const Microchip = responsive(MotionMicrochip)
export const Minus = responsive(MotionMinus)
export const PanelRight = responsive(MotionPanelRight)
export const Pencil = responsive(MotionPencil)
export const Percent = responsive(MotionPercent)
export const Play = responsive(MotionPlay)
export const Plus = responsive(MotionPlus)
export const Power = responsive(MotionPower)
export const PowerOff = responsive(MotionPowerOff)
export const Radio = responsive(MotionRadio)
export const RadioOff = responsive(MotionRadioOff)
export const Redo2 = responsive(MotionRedo2)
export const Repeat = responsive(MotionRepeat)
export const RotateCcw = responsive(MotionRotateCcw)
export const RotateCwSquare = responsive(MotionRotateCwSquare)
export const Save = responsive(MotionSave)
export const Scissors = responsive(MotionScissors)
export const Search = responsive(MotionSearch)
export const Settings = responsive(MotionSettings)
export const Share2 = responsive(MotionShare2)
export const Sparkles = responsive(MotionSparkles)
export const SquareDashedMousePointer = responsive(MotionSquareDashedMousePointer)
export const SquarePen = responsive(MotionSquarePen)
export const Swords = responsive(MotionSwords)
export const TextQuote = responsive(MotionTextQuote)
export const Timer = responsive(MotionTimer)
export const Trash2 = responsive(MotionTrash2)
export const TriangleAlert = responsive(MotionTriangleAlert)
export const Undo2 = responsive(MotionUndo2)
export const Unlink = responsive(MotionUnlink)
export const X = responsive(MotionX)
export const Columns3Cog = responsive(MotionColumns3Cog)
export const Columns4 = responsive(MotionColumns4)
export const Workflow = responsive(MotionWorkflow)
export const ListOrdered = responsive(MotionListOrdered)
