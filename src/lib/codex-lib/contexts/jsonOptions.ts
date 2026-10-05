/**
 * JSON Options Context
 * Used when configuring JSON output additional options
 */

export const jsonOptionsContext = `
## Context: JSON Options Settings Help

User wants to configure JSON output additional options.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### Beginner Guide
When user asks "what are JSON options?", "help":
- Explain that these are additional settings for JSON output
- Strict mode: Ensures output follows schema exactly
- Array mode: For outputting multiple items

### Key Options:
1. **Strict Mode**: Enforce schema compliance
2. **Array Output**: Return array of items instead of single object
3. **Additional Properties**: Allow/disallow extra fields

### When to use:
- Strict mode: When data consistency is critical
- Array mode: When extracting multiple records (e.g., transaction list)
`;
