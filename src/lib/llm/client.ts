import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { classifyLlmError, PipelineError } from "../errors";

export const MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new PipelineError("ai_auth", "ANTHROPIC_API_KEY is not set");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface LlmCall<T> {
  data: T;
  raw: { request: unknown; response: unknown };
  usage: { inputTokens: number; outputTokens: number };
}

type Block = Anthropic.Messages.ContentBlockParam;

/**
 * Force the model to return data shaped by `schema` via a single tool call,
 * then validate it through zod. Structured output + validation at the boundary
 * is what keeps the LLM inside the rails (e.g. it can only pick a real account
 * code). The static `system` is cache-controlled since it's reused per call.
 */
export async function callStructured<T>(opts: {
  schema: z.ZodType<T>;
  toolName: string;
  toolDescription: string;
  system: string;
  content: Block[];
  maxTokens?: number;
}): Promise<LlmCall<T>> {
  const inputSchema = toJsonSchema(opts.schema);

  const request: Anthropic.Messages.MessageCreateParams = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    system: [
      { type: "text", text: opts.system, cache_control: { type: "ephemeral" } },
    ],
    tools: [
      {
        name: opts.toolName,
        description: opts.toolDescription,
        input_schema: inputSchema as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content: opts.content }],
  };

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropic().messages.create(request);
  } catch (err) {
    throw classifyLlmError(err);
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`Model did not call tool ${opts.toolName}`);
  }

  const data = opts.schema.parse(toolUse.input);
  return {
    data,
    raw: { request: redactRequest(request), response },
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/**
 * The recorded request is persisted to `llm_runs.request` for replay/debugging.
 * Strip base64 document/image payloads first — a scanned PDF is already on disk
 * and in `rawText`; duplicating its megabytes into the DB as JSON serves nothing.
 */
function redactRequest(
  request: Anthropic.Messages.MessageCreateParams,
): Anthropic.Messages.MessageCreateParams {
  return {
    ...request,
    messages: request.messages.map((m) =>
      typeof m.content === "string"
        ? m
        : { ...m, content: m.content.map(redactBlock) },
    ),
  };
}

function redactBlock(block: Block): Block {
  if (
    (block.type === "document" || block.type === "image") &&
    block.source.type === "base64"
  ) {
    const source = {
      ...block.source,
      data: `<redacted ${block.source.data.length} base64 chars>`,
    };
    return { ...block, source } as Block;
  }
  return block;
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}
