import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

interface AgentRequest {
  messages: Array<{ role: string; content: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  planning: 'Thinking...',
  extracting_tool_calls: 'Looking things up...',
  executing_tools: 'Loading physician profile...',
  executing_tool: 'Loading physician profile...',
  streaming_analyst_results: 'Preparing your session...',
  interpreting_question: 'Thinking...',
  generating_sql: 'Looking things up...',
  postprocessing_sql: 'Almost ready...',
  reasoning_agent_stop: 'Reviewing...',
  reevaluating_plan: 'Thinking...',
  proceeding_to_answer: 'Preparing response...',
};

// Pad payload to >1KB to force proxy/browser stream flush
const FLUSH_PAD = ' '.repeat(1024);

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const send = (data: object) =>
    encoder.encode(JSON.stringify(data) + FLUSH_PAD + '\n');

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Always validate session — no insecure cookie-prefix fallback
        const session = await getSessionFromRequest(request);
        if (!session) {
          controller.enqueue(send({ type: 'error', message: 'Unauthorized' }));
          controller.close();
          return;
        }

        const { messages } = (await request.json()) as AgentRequest;

        console.log('[cortex] user:', session.username, '| message count:', messages.length);
        console.log('[cortex] first user message:', messages[0]?.content?.slice(0, 200));

        const account = process.env.SNOWFLAKE_ACCOUNT || '';
        const pat = process.env.SNOWFLAKE_PAT || process.env.SNOWFLAKE_PASSWORD || '';

        if (!account || !pat) {
          controller.enqueue(send({ type: 'error', message: 'Missing Snowflake configuration' }));
          controller.close();
          return;
        }

        const agentUrl = `https://${account}.snowflakecomputing.com/api/v2/databases/CORTEX_TESTING/schemas/PUBLIC/agents/PITCHMD:run`;

        const formattedMessages = messages.map((m) => ({
          role: m.role,
          content: [{ type: 'text', text: m.content }],
        }));

        const agentResponse = await fetch(agentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${pat}`,
            'Accept': 'text/event-stream',
            'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
          },
          body: JSON.stringify({
            messages: formattedMessages,
            stream: true,
            role: 'APP_SVC_ROLE',
          }),
        });

        if (!agentResponse.ok) {
          const errText = await agentResponse.text();
          // Scrub auth tokens before logging
          const safeErr = errText.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
          console.error('[cortex] Agent error:', agentResponse.status, safeErr.slice(0, 500));
          controller.enqueue(send({ type: 'error', message: `Agent request failed: ${agentResponse.status}` }));
          controller.close();
          return;
        }

        const reader = agentResponse.body?.getReader();
        if (!reader) {
          controller.enqueue(send({ type: 'error', message: 'No response body from agent' }));
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        // Map of content_index -> highest-sequence-number chunk seen for that index
        const contentMap = new Map<number, { seq: number; text: string }>();
        const seenStatuses = new Set<string>();
        let rawChunkCount = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          rawChunkCount++;
          if (rawChunkCount <= 3) {
            console.log(`[cortex] raw chunk ${rawChunkCount}:`, chunk.slice(0, 300));
          }
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;

            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'generic' && parsed.status === 'error') {
                console.error('[cortex] tool error:', parsed.name, JSON.stringify(parsed.content));
              }

              if (parsed.status && STATUS_LABELS[parsed.status]) {
                const label = STATUS_LABELS[parsed.status];
                if (!seenStatuses.has(label)) {
                  seenStatuses.add(label);
                  controller.enqueue(send({ type: 'status', message: label }));
                }
              }

              if (
                typeof parsed.text === 'string' &&
                typeof parsed.content_index === 'number' &&
                typeof parsed.sequence_number === 'number'
              ) {
                const existing = contentMap.get(parsed.content_index);
                if (!existing || parsed.sequence_number > existing.seq) {
                  contentMap.set(parsed.content_index, {
                    seq: parsed.sequence_number,
                    text: parsed.text,
                  });
                }
              }
            } catch {
              // skip unparseable lines
            }
          }
        }

        console.log('[cortex] raw chunks received:', rawChunkCount);
        console.log('[cortex] contentMap keys:', Array.from(contentMap.keys()));

        // FIX: the old logic dropped content_index=0 whenever any higher index existed,
        // silently discarding the entire response if the agent placed its answer at index 0.
        // Correct approach: collect ALL indices, sort ascending, join — then strip any
        // leading chunk that contains only the physician list / tool-use preamble
        // (identified by having no [VOICE_MODEL:] tag and being the sole index=0 chunk
        // when higher-index content also exists with the actual roleplay response).
        const allIndices = Array.from(contentMap.keys()).sort((a, b) => a - b);
        const hasHigherIndices = allIndices.some((k) => k > 0);

        let fullText: string;

        if (hasHigherIndices) {
          // Prefer the highest-index content block — this is the agent's final answer
          // after tool use. Index 0 in this case is typically the intermediate
          // "let me look that up" narration, not the roleplay response.
          const higherContent = allIndices
            .filter((k) => k > 0)
            .map((k) => contentMap.get(k)!.text)
            .join('');
          const lowerContent = contentMap.get(0)?.text ?? '';

          // If the higher-index content looks like a real physician response
          // (has an emotion/voice/duration tag, or substantial text), use it.
          // Otherwise fall back to joining everything.
          const higherLooksReal =
            higherContent.includes('[EMOTION:') ||
            higherContent.includes('[VOICE_MODEL:') ||
            higherContent.includes('[SESSION_DURATION:') ||
            higherContent.trim().length > 80;

          fullText = higherLooksReal
            ? higherContent.trim()
            : (lowerContent + higherContent).trim();
        } else {
          // Only index 0 exists — use it unconditionally (was the original bug)
          fullText = (contentMap.get(0)?.text ?? '').trim();
        }

        console.log('[cortex] assembled response (first 500):', fullText.slice(0, 500));

        if (!fullText) {
          controller.enqueue(send({ type: 'error', message: 'Agent returned an empty response' }));
        } else {
          controller.enqueue(send({ type: 'done', text: fullText }));
        }
      } catch (error: any) {
        console.error('[cortex] Agent error:', error?.message);
        controller.enqueue(send({ type: 'error', message: 'Failed to reach Cortex Agent' }));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'X-Accel-Buffering': 'no',
      'Cache-Control': 'no-cache',
    },
  });
}