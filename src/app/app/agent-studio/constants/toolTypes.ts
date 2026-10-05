
import { FileSearch, Globe, Zap } from 'lucide-react'

export const TOOL_TYPES = {
  source: {
    name: 'Source',
    icon: FileSearch,
    color: 'bg-yellow-500',
    description: '파일 및 데이터 소스'
  },
  mcp: {
    name: 'MCP',
    icon: null,
    color: 'bg-black',
    textColor: 'text-white',
    description: 'Model Context Protocol'
  },
  webSearch: {
    name: 'Web Search',
    icon: Globe,
    color: 'bg-green-500',
    description: '실시간 웹 검색'
  },
  functionCalling: {
    name: 'Function Calling',
    icon: Zap,
    color: 'bg-blue-500',
    description: '커스텀 함수 호출'
  },
}