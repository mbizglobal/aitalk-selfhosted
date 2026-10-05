
import { CustomNode, setGlobalAddToolHandler } from './CustomNode'
import { ToolNode } from './ToolNode'
import { NoteNode } from './NoteNode'
import { IfElseNode } from './IfElseNode'
import { ApiNode } from './ApiNode'
import { FunctionCallingNode } from './FunctionCallingNode'
import { DataSheetsNode } from './DataSheetsNode'
import { MCPLogo } from './icons/MCPLogo'

export const nodeTypes = {
  custom: CustomNode,
  note: NoteNode,
  ifelse: IfElseNode,
  tool: ToolNode,
  api: ApiNode,
  functionCalling: FunctionCallingNode,
  dataSheets: DataSheetsNode,
}

export {
  CustomNode,
  ToolNode,
  NoteNode,
  IfElseNode,
  ApiNode,
  FunctionCallingNode,
  DataSheetsNode,
  MCPLogo,
  setGlobalAddToolHandler,
}