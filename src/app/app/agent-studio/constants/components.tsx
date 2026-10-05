
import {
  Bot,
  Circle,
  Puzzle,
  Square,
  FileSearch,
  Globe,
  Zap,
  Webhook,
  MessageSquare,
  MessageSquareText,
  Slack,
  Workflow,
  RefreshCw,
  UserCheck,
  Database,
  Pause,
  Clock,
  Inbox,
  Send,
  DatabaseZap,
  Phone, LayoutGrid } from 'lucide-react'

export const SendGridIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 256 256"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M256,0 L256,170.667 L170.667,170.667 L170.667,256 L0,256 L0,170.667 L0,85.333 L85.333,85.333 L85.333,0 L256,0 Z" fill="#9DD6E3"/>
    <polygon fill="#3F72AB" points="0 256 85.335 256 85.335 170.663 0 170.663"/>
    <polygon fill="#00A9D1" points="170.667 170.667 256 170.667 256 85.333 170.667 85.333"/>
    <polygon fill="#00A9D1" points="85.333 85.333 170.667 85.333 170.667 0 85.333 0"/>
    <polygon fill="#2191C4" points="85.333 170.665 170.667 170.665 170.667 85.333 85.333 85.333"/>
    <polygon fill="#3F72AB" points="170.667 85.333 256 85.333 256 0 170.667 0"/>
  </svg>
)

export const SmsIcon = MessageSquareText

export const TelegramIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="tg-grad" x1="50" y1="2" x2="50" y2="98" gradientUnits="userSpaceOnUse">
        <stop stopColor="#37AEE2"/>
        <stop offset="1" stopColor="#1E96C8"/>
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="50" fill="url(#tg-grad)"/>
    <path d="M44 60l-1.4 14.6s-.6 4.5 3.9 0c4.5-4.5 8.7-7.9 8.7-7.9" fill="#A9C9DD"/>
    <path d="M29 55l-14.8-4.8s-1.8-.7-1.2-2.4c.1-.3.4-.6 1-.9 3.2-2.3 60-22.7 60-22.7s1.7-.5 2.5-.2c.5.2.8.5 1 1 .1.3.1 1.2.1 1.3 0 .4-.05.7-.08 1.3-.35 5.6-10.7 47.3-10.7 47.3s-.6 2.5-2.9 2.6c-1.1 0-2.3-.5-3-1.2-4.4-3.7-19.4-13.9-22.7-16.1-.1-.1-.3-.2-.3-.5 0-.2.2-.5.2-.5s26.2-23.3 26.9-25.7c.05-.19-.15-.29-.42-.21-1.8.6-31.9 19.8-35.3 21.8-.2.1-.6.05-.7.05z" fill="#fff"/>
  </svg>
)

export const basicComponents = [
  { id: 'chat-widget', name: 'Start / Chat Widget', icon: MessageSquare, color: 'bg-green-500', showLeftHandle: false },
  { id: 'telegram-start', name: 'Start / Telegram', icon: null, color: 'bg-gray-200', showLeftHandle: false },
  { id: 'pstn-start', name: 'Start / PSTN', icon: Phone, color: 'bg-teal-500', showLeftHandle: false },
  { id: 'schedule', name: 'Start / Schedule', icon: Clock, color: 'bg-purple-500', showLeftHandle: false },
  { id: 'app-start', name: 'Start / App', icon: LayoutGrid, color: 'bg-amber-500', showLeftHandle: false },
  { id: 'subworkflow-start', name: 'Start / Sub-workflow', icon: Puzzle, color: 'bg-pink-500', showLeftHandle: false },
  { id: 'ai', name: 'AI', icon: Bot, color: 'bg-blue-500' },
  { id: 'end', name: 'End', icon: Circle, color: 'bg-green-500' },
]

export const toolComponents = [
  { id: 'source', name: 'Source', icon: FileSearch, color: 'bg-yellow-500' },
  { id: 'mcp', name: 'MCP', icon: null, color: 'bg-black' },
  { id: 'web-search', name: 'Web search', icon: Globe, color: 'bg-green-500' },
  { id: 'subworkflow', name: 'Sub-workflow', icon: Puzzle, color: 'bg-pink-500' },
  // { id: 'function-calling', name: 'Function Calling', icon: Zap, color: 'bg-blue-500' },
  // { id: 'webhook', name: 'Webhook', icon: Webhook, color: 'bg-purple-500' },
]

export const inOutComponents = [
  // { id: 'slack', name: 'Slack', icon: Slack, color: 'bg-purple-500', showLeftHandle: false },
]

export const flowComponents = [
  { id: 'condition', name: 'If / else', icon: Workflow, color: 'bg-orange-500' },
  { id: 'while', name: 'While', icon: RefreshCw, color: 'bg-orange-600' },
  { id: 'wait', name: 'Wait', icon: Pause, color: 'bg-orange-400' },
  // { id: 'user-approval', name: 'User approval', icon: UserCheck, color: 'bg-orange-400' },
]

export const dataComponents = [
  { id: 'data-sheets', name: 'Data Sheets', icon: Database, color: 'bg-indigo-500' },
  { id: 'store', name: 'RAG Store', icon: DatabaseZap, color: 'bg-emerald-500' },
  // { id: 'mysql', name: 'MySQL/MariaDB', icon: Database, color: 'bg-cyan-500' },
]

export const appsComponents = [
  { id: 'sendgrid', name: 'SendGrid', icon: null, color: 'bg-[#00A9D1]' },
  { id: 'telegram', name: 'Telegram', icon: null, color: 'bg-gray-200' },
  { id: 'sms_infobip', name: 'SMS', icon: MessageSquareText, color: 'bg-sky-500' },
  { id: 'imap', name: 'IMAP', icon: Inbox, color: 'bg-indigo-500' },
  { id: 'smtp', name: 'SMTP', icon: Send, color: 'bg-purple-500' },
  { id: 'httpRequest', name: 'HTTP Request', icon: Globe, color: 'bg-orange-500' },
  // { id: 'pstn', name: 'PSTN', icon: Phone, color: 'bg-teal-500' },
]

export const etcComponents = [
  { id: 'note', name: 'Note', icon: Square, color: 'bg-gray-500' },
]
