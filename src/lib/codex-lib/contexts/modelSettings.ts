/**
 * Model Settings Context
 * Used when configuring AI node model settings
 */

export const modelSettingsContext = `
## Context: Model Settings Help

User wants to configure AI node model settings.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### Beginner Guide (PRIORITY)

When user asks "what is this?", "explain settings", "what do these settings mean?", "help":
\`\`\`json
{
  "type": "answer",
  "message": "## What are Model Settings?\\n\\nSettings that control **how the AI behaves**.\\n\\n### Key Settings\\n\\n1. **Model**\\n   - Choose which AI engine to use\\n   - GPT-4.1: Fast and economical\\n   - GPT-5: Smarter and more accurate (requires KYC)\\n   - Claude: Strong for long documents\\n\\n2. **Temperature** (GPT-4, Gemini, Claude, etc.)\\n   - 0 = Precise and consistent answers\\n   - 1 = Creative and varied answers\\n\\n3. **Effort** (GPT-5 only)\\n   - low/medium/high reasoning effort\\n\\n4. **Max Tokens**\\n   - Limits response length\\n   - GPT-5: up to 65K\\n   - Others: up to 4K\\n\\n### Get Recommendations\\nJust type **'recommend settings'** and I'll configure optimal settings for your use case!"
}
\`\`\`

### Available Models by Provider:

**OpenAI**:
- gpt-5.1, gpt-5-mini: Latest (requires Organization Verification/KYC)
- gpt-4.1, gpt-4.1-mini: Reliable and cost-effective
- gpt-4o, gpt-4o-mini: Optimized variants

**Gemini**:
- gemini-3-flash-preview, gemini-3-pro-preview: Latest
- gemini-2.5-flash, gemini-2.5-pro: Stable and fast

**Claude**:
- claude-opus-4-6: Most capable
- claude-sonnet-4-6: Balanced (Opus-level coding)
- claude-haiku-4-5: Fast and economical

**DeepSeek**:
- deepseek-chat (V3): General purpose

**Grok**:
- grok-4-1-fast-reasoning: Fast reasoning model (2M context, vision, function calling)

**Mistral**:
- mistral-large-latest: Most capable, 262K context, vision ($0.50/$1.50)
- mistral-small-latest: Fast and economical ($0.06/$0.18)

### GPT-5 Specific Parameters:

GPT-5 models use different parameters than other models:
- **effort**: Reasoning effort level (low/medium/high). Default: medium
- **verbosity**: Response detail level (minimal/low/normal/high). Default: normal
- **summary**: Summary mode (auto/detailed/high/medium/low/null). Default: auto
- **maxTokens**: Range 1024~65536 (much higher than other models)

> **Note**: GPT-5 does NOT use temperature/topP. Use effort/verbosity instead.
> **Note**: GPT-5 requires OpenAI Organization Verification (KYC).

### Standard Parameters (Non-GPT-5):

- **temperature**: 0=precise, 1=creative, max 2. Data extraction: 0, creative writing: 0.7-1.0
- **maxTokens**: Max response length (1~4096). JSON extraction: 2000-4000
- **topP**: Nucleus sampling (0-1). Lower = more focused. Default: 1
- **topK**: Top-K sampling (Gemini only, 1-100). Default: 40

### Additional Options:

- **storeLogs**: Store conversation logs for analytics (OpenAI, Gemini, Grok only)

### RAG-LLM Compatibility:

When Source node is used in workflow:
- **OpenAI Vector Store** requires **OpenAI** as LLM provider
- **Gemini File Search** requires **Gemini** as LLM provider
- **Pinecone** works with any LLM provider

If mismatch detected, Save button is disabled with warning message.

### API Key Requirement:

- Each provider requires its API key configured in Settings
- If API key is missing, warning is shown and Save is disabled
- Configure at: Settings → API Keys

### Use-case Presets:

**For GPT-5:**
- **Data Extraction**: effort=low, verbosity=minimal, maxTokens=8000
- **Creative Writing**: effort=high, verbosity=high, maxTokens=16000
- **Customer Service**: effort=medium, verbosity=normal, maxTokens=4000

**For Other Models:**
- **Data Extraction**: model=gpt-4.1-mini, temperature=0, maxTokens=4000
- **Creative Writing**: model=gpt-4o, temperature=0.8, maxTokens=4096
- **Customer Service**: model=gpt-4.1-mini, temperature=0.3, maxTokens=2000
- **Code Generation**: model=claude-sonnet-4-6, temperature=0.2, maxTokens=4000
- **Document Analysis**: model=claude-sonnet-4-6, temperature=0.3, maxTokens=4096

### Key Capabilities:

**1. Auto-recommend settings**
When user says "recommend", "optimize", "best settings":
- Ask about use case if not clear
- Check if GPT-5 or standard model
- Suggest optimal settings
- Explain why

**2. Explain current settings**
- Describe what each setting does
- Explain current values and their effects
- Note GPT-5 vs standard model differences

**3. Modify settings**
- Change model, temperature/effort, maxTokens
- Apply use-case specific presets

### Directly modifiable fields:

**All models:**
- data.provider (openai, gemini, claude, deepseek, grok, mistral)
- data.model
- data.maxTokens
- data.storeLogs (boolean, OpenAI/Gemini/Grok only)

**GPT-5 models only:**
- data.effort (low/medium/high)
- data.verbosity (minimal/low/normal/high)
- data.summary (auto/detailed/high/medium/low/null)

**Non-GPT-5 models:**
- data.temperature (0-2)
- data.topP (0-1)
- data.topK (1-100, Gemini only)
`;
