/**
 * Source Context
 * Used when configuring Source (RAG) tool for document retrieval
 */

export const sourceContext = `
## Context: Source RAG Settings Help

User wants to configure Source (RAG) tool for document retrieval.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### Beginner Guide
When user asks "what is Source/RAG?", "help":
\`\`\`json
{
  "type": "answer",
  "message": "## What is Source (RAG)?\\n\\nA feature that **searches info from uploaded files**.\\n\\n### How it works\\n1. Upload files (PDF, DOCX, etc.)\\n2. AI analyzes and stores documents\\n3. Ask questions, get answers from relevant parts\\n\\n### Use Cases\\n- Manual-based customer support\\n- Contract content search\\n- Technical document Q&A\\n\\n### RAG Providers\\n- OpenAI Vector Store: For OpenAI models\\n- Gemini File Search: For Gemini models\\n- Pinecone: Works with ALL AI Providers"
}
\`\`\`

---

## NODE CONNECTION (Tool Node)

Source is a **Tool node** that connects to AI node's **tools handle** (bottom).

### Connection Structure
\`\`\`
              [AI Node]
                  │
            tools handle (bottom, orange)
                  │
                  ↓
           [Source Node]
\`\`\`

### How to Connect on Canvas
1. Add **AI node** to canvas
2. Add **Source node** to canvas
3. Drag from AI node's **bottom handle** (orange) to Source node's **top handle**
4. Source automatically appears in AI's "Select tools" dropdown

### Tool Handle Types
| Node | Top Handle | Bottom Handle | Purpose |
|------|------------|---------------|---------|
| AI Node | Input (from previous) | Tools output (orange) | Connect Tool nodes |
| Source Node | Tools input (orange) | None | Receive from AI |

### Multiple Tools
AI node can connect to multiple Tool nodes:
\`\`\`
              [AI Node]
                  │
            tools handle
           ┌────┼────┐
           ↓    ↓    ↓
      [Source] [WebSearch] [MCP]
\`\`\`

### In While Loop
When AI is a Loop Tool inside While:
- Source node connects via AI's tools handle
- Tool settings are copied to AI node for each iteration
- Be mindful of API rate limits

---

### RAG Provider Types:

**1. OpenAI Vector Store**
- Works ONLY with OpenAI models (gpt-*, o1, o3, o4)
- Configured via Agent's Knowledge Base
- Max file size: **512MB**
- Persistent storage (no expiration)
- Auto chunking & embedding

**2. Gemini File Search**
- Works ONLY with Gemini models
- Uses Gemini Files API
- Max file size: **2GB**
- ⚠️ Files **auto-delete after 48 hours** (API fetches directly)
- Auto chunking & embedding

**3. Pinecone**
- Works with **ALL AI Providers** (recommended for multi-provider)
- Requires Pinecone account configuration in Settings
- **No file size limit**, persistent storage
- Supports Namespace, Hybrid Search, Metadata Filtering
- **Supported files**: TXT, MD, JSON only (PDF, DOCX coming soon)

**Pinecone Embedding Models:**
| Model | Provider | Dimension | Needs |
|-------|----------|-----------|-------|
| llama-text-embed-v2 | Pinecone | 1024 | Pinecone only |
| multilingual-e5-large | Pinecone | 1024 | Pinecone only |
| text-embedding-3-small | OpenAI | 1536 | + OpenAI Key |
| text-embedding-3-large | OpenAI | 3072 | + OpenAI Key |
| text-embedding-ada-002 | OpenAI | 1536 | + OpenAI Key |

> **Important**: Embedding Model Dimension must match Pinecone Index Dimension!

### Compatibility Rules:
| RAG Provider | OpenAI | Gemini | Claude | DeepSeek | Grok |
|--------------|--------|--------|--------|----------|------|
| OpenAI Vector Store | ✅ | ❌ Skip | ❌ Skip | ❌ Skip | ❌ Skip |
| Gemini File Search | ❌ Skip | ✅ | ❌ Skip | ❌ Skip | ❌ Skip |
| Pinecone | ✅ | ✅ | ✅ | ✅ | ✅ |

> **Important**: RAG Provider is set in **Settings**, not in Agent Studio.
> If RAG Provider doesn't match AI Provider, Source is silently skipped.

### Context Variables Set by Source Node:
- \`context.ragProvider\`: Current RAG provider type ('openai_vector_store' | 'gemini_file_search' | 'pinecone' | 'none')
- \`context.workflowAiModel\`: AI model from workflow (for compatibility check)
- **OpenAI:**
  - \`context.sourceVectorStoreId\`: OpenAI Vector Store ID
  - \`context.sourceVectorStoreName\`: Vector Store name
- **Gemini:**
  - \`context.geminiFiles\`: Array of { fileId, fileUri, fileName }
- **Pinecone:**
  - \`context.pineconeApiKey\`: Decrypted Pinecone API Key
  - \`context.pineconeConfig\`: { host, indexName, namespace, embeddingApiKey, embeddingModel, dimension }
- \`context.searchResults\`: Retrieved document chunks (RAGSearchResult[])

### Key Capabilities:
1. **Explain RAG**: How document retrieval works
2. **Explain Providers**: Differences between RAG providers
3. **Check Compatibility**: Warn about AI-RAG provider mismatch
4. **Troubleshoot**: Why Source might be skipped

### Settings Explained:
- **RAG Provider**: Set in Settings → AI Agent tab (not Agent Studio)
- **Top-K**: Number of relevant chunks to retrieve (default: **10** for Pinecone)
- **Pinecone Settings**:
  - API Key (required) - from Pinecone Console
  - Index Name (required) - created in Pinecone Console
  - Host URL (optional) - for faster connection
  - Embedding Model (required) - must match Index dimension
  - Namespace (optional) - for data isolation

### Feature Comparison:
| Feature | OpenAI | Gemini | Pinecone |
|---------|--------|--------|----------|
| Setup | API Key only | API Key only | API Key + Index |
| Auto Chunking | ✅ | ✅ | ✅ (custom) |
| Auto Embedding | ✅ | ✅ | ❌ (needs config) |
| Max File Size | 512MB | 2GB | Unlimited |
| Data Retention | Permanent | 48 hours | Permanent |
| Namespace | ❌ | ❌ | ✅ |
| Hybrid Search | ❌ | ❌ | ✅ |
| Cost | OpenAI included | Gemini included | Separate billing |

### Compatibility Warning:
When RAG Provider doesn't match AI Provider:
- Warning logged: "RAG skipped: {provider} only works with {ai} models"
- UI shows red warning in Source Panel
- \`ragProvider\` set to 'none' in context
`;
