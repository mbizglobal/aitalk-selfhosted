import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import OpenAI from 'openai'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { prompt } = await request.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Invalid prompt' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { aiProviders: true, zki: true }
    })

    if (!user?.aiProviders?.providers || !user.encryptedDataKey) {
      return NextResponse.json({
        error: 'OpenAI API key not found. Please add your API key in Settings.'
      }, { status: 400 })
    }

    let apiKey: string
    try {
      const providersConfig = JSON.parse(user.aiProviders.providers)
      if (!providersConfig.openai?.apiKey) {
        return NextResponse.json({
          error: 'OpenAI API key not found. Please add your API key in Settings.'
        }, { status: 400 })
      }
      let dataKey: Buffer
      if (user.zkiId && user.zki?.masterKey) {
        dataKey = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
      } else {
        dataKey = await decryptDataKey(Buffer.from(user.encryptedDataKey))
      }
      apiKey = decrypt(Buffer.from(providersConfig.openai.apiKey, 'base64'), dataKey)
    } catch (error) {
      return NextResponse.json({
        error: 'Failed to decrypt API key. Please reconfigure your API key.'
      }, { status: 400 })
    }

    const openai = new OpenAI({ apiKey })

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a JSON Schema generator. Given a user description, generate a valid JSON Schema.

Rules:
1. Return ONLY valid JSON (no markdown, no explanations)
2. Include "name" field (snake_case schema name)
3. Include "schema" field with the JSON Schema structure
4. All schemas must include "additionalProperties": false
5. All properties must be in the "required" array
6. Use clear, descriptive property names (snake_case)
7. Add helpful descriptions for each property

Example output:
{
  "name": "event_data",
  "schema": {
    "type": "object",
    "properties": {
      "event_name": {
        "type": "string",
        "description": "Name of the event"
      },
      "date": {
        "type": "string",
        "description": "Event date in ISO format"
      }
    },
    "required": ["event_name", "date"],
    "additionalProperties": false
  }
}`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })

    const responseText = completion.choices[0]?.message?.content

    if (!responseText) {
      throw new Error('No response from OpenAI')
    }

    let parsedResponse
    try {
      parsedResponse = JSON.parse(responseText)
    } catch (error) {
      console.error('Failed to parse OpenAI response:', responseText)
      throw new Error('Invalid JSON response from AI')
    }

    if (!parsedResponse.name || !parsedResponse.schema) {
      throw new Error('Invalid schema structure')
    }

    return NextResponse.json({
      name: parsedResponse.name,
      schema: parsedResponse.schema
    })

  } catch (error: any) {
    console.error('[Generate Schema] Error:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to generate schema' 
    }, { status: 500 })
  }
}
