import type { LoopwatchEvent } from './events.js';

/**
 * Source-aware validation-evidence extraction shared by the convergence
 * watcher and the scoped git watcher.
 *
 * Adapters preserve source-native payloads (ADR-0004), so the command and
 * exit-code live in different places per source:
 * - Claude: `message.content` blocks — `tool_use` (id + input.command) paired
 *   to `tool_result` (tool_use_id + is_error).
 * - Codex: the raw `{ type, payload }` envelope — `function_call`
 *   (call_id + JSON-string arguments carrying command/cmd) paired to
 *   `function_call_output` / `exec_command_end` (call_id + exit_code or
 *   JSON output metadata).
 * - Pi: typed messages — `toolCall` content blocks (id + arguments.command)
 *   paired to `toolResult` (toolCallId + isError), plus `bashExecution`
 *   messages that carry command + exitCode directly.
 */
export const validationCommandPattern = /\b(test|verify|lint|typecheck|tsc|build|cargo\s+test|go\s+test|pytest|vitest|jest|playwright|cypress|harness|check)\b/i;

/**
 * Ids of tool calls whose command matched `validationCommandPattern`. A bare
 * tool result carries no command, so this pairs it back to the call that
 * produced it — without the pairing, every successful tool result would count
 * as passed validation and suppress the completion-without-evidence
 * intervention.
 */
export function validationToolUseIds(events: LoopwatchEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    for (const call of toolCallsFromEvent(event)) {
      if (call.id !== undefined && validationCommandPattern.test(call.command ?? '')) ids.add(call.id);
    }
  }
  return ids;
}

export function isValidationEvent(event: LoopwatchEvent, validationIds: ReadonlySet<string>): boolean {
  const command = commandFromEvent(event) ?? '';
  if (validationCommandPattern.test(command)) return true;
  const payload = recordValue(event.payload);
  if (recordValue(payload?.validation) !== undefined) return true;
  if (validationExitCode(event) === undefined) return false;
  const callId = resultCallId(event);
  return callId !== undefined && validationIds.has(callId);
}

/** The command an event ran, across explicit fields and all source shapes. */
export function commandFromEvent(event: LoopwatchEvent): string | undefined {
  const payload = recordValue(event.payload);
  if (typeof payload?.command === 'string') return payload.command;
  const tool = recordValue(payload?.tool);
  const argumentsRecord = recordValue(tool?.arguments);
  if (typeof argumentsRecord?.command === 'string') return argumentsRecord.command;
  const validation = recordValue(payload?.validation);
  if (typeof validation?.command === 'string') return validation.command;

  const call = toolCallsFromEvent(event).find((candidate) => candidate.command !== undefined);
  if (call?.command !== undefined) return call.command;

  // Pi bashExecution: the command rides on the message itself.
  const message = recordValue(payload?.message);
  if (message?.role === 'bashExecution' && typeof message.command === 'string') return message.command;

  // Codex exec_command_end: command is an argv array on the inner envelope.
  const inner = codexInner(payload);
  if (inner?.type === 'exec_command_end') return commandFromArgv(inner.command);
  return undefined;
}

/** Exit code of a tool/validation result, across all source shapes. */
export function validationExitCode(event: LoopwatchEvent): number | undefined {
  const payload = recordValue(event.payload);
  const direct = numberValue(payload?.exitCode) ?? numberValue(recordValue(payload?.tool)?.exit_code) ?? numberValue(recordValue(payload?.validation)?.exitCode);
  if (direct !== undefined) return direct;

  // Claude: tool_result block with is_error.
  const resultBlock = contentBlocks(event).find((block) => block.type === 'tool_result');
  if (typeof resultBlock?.is_error === 'boolean') return resultBlock.is_error ? 1 : 0;

  const message = recordValue(payload?.message);
  // Pi: bashExecution exitCode, or toolResult isError.
  if (message?.role === 'bashExecution') {
    const exitCode = numberValue(message.exitCode);
    if (exitCode !== undefined) return exitCode;
  }
  if (message?.role === 'toolResult' && typeof message.isError === 'boolean') return message.isError ? 1 : 0;

  // Codex: exec_command_end exit_code, or function_call_output whose output
  // is a JSON string carrying { metadata: { exit_code } }.
  const inner = codexInner(payload);
  if (inner) {
    const exitCode = numberValue(inner.exit_code);
    if (exitCode !== undefined) return exitCode;
    if (typeof inner.output === 'string') {
      const output = parseJsonRecord(inner.output);
      const metadataExit = numberValue(recordValue(output?.metadata)?.exit_code);
      if (metadataExit !== undefined) return metadataExit;
    }
  }
  return undefined;
}

/** The call id a tool result answers, for pairing back to its command. */
export function resultCallId(event: LoopwatchEvent): string | undefined {
  // Claude: tool_result block tool_use_id.
  const resultBlock = contentBlocks(event).find((block) => block.type === 'tool_result');
  if (typeof resultBlock?.tool_use_id === 'string') return resultBlock.tool_use_id;

  // Pi: toolResult message toolCallId.
  const message = recordValue(recordValue(event.payload)?.message);
  if (message?.role === 'toolResult' && typeof message.toolCallId === 'string') return message.toolCallId;

  // Codex: function_call_output / exec_command_end call_id.
  const inner = codexInner(recordValue(event.payload));
  if (inner && typeof inner.call_id === 'string') return inner.call_id;
  return undefined;
}

interface ToolCallShape {
  id?: string;
  command?: string;
}

/** Every tool call an event carries, with its pairing id and command. */
function toolCallsFromEvent(event: LoopwatchEvent): ToolCallShape[] {
  const calls: ToolCallShape[] = [];

  for (const block of contentBlocks(event)) {
    // Claude tool_use block.
    if (block.type === 'tool_use') {
      calls.push({
        id: typeof block.id === 'string' ? block.id : undefined,
        command: stringValue(recordValue(block.input)?.command),
      });
    }
    // Pi toolCall block.
    if (block.type === 'toolCall') {
      calls.push({
        id: typeof block.id === 'string' ? block.id : undefined,
        command: stringValue(recordValue(block.arguments)?.command),
      });
    }
  }

  // Codex function_call / custom_tool_call envelope.
  const inner = codexInner(recordValue(event.payload));
  if (inner && (inner.type === 'function_call' || inner.type === 'custom_tool_call')) {
    calls.push({
      id: typeof inner.call_id === 'string' ? inner.call_id : undefined,
      command: codexCommandFromArguments(inner.arguments),
    });
  }

  return calls;
}

/** Codex `function_call` arguments: a JSON string (or object) with command/cmd. */
function codexCommandFromArguments(args: unknown): string | undefined {
  const record = typeof args === 'string' ? parseJsonRecord(args) : recordValue(args);
  if (!record) return undefined;
  if (typeof record.command === 'string') return record.command;
  if (typeof record.cmd === 'string') return record.cmd;
  return commandFromArgv(record.command) ?? commandFromArgv(record.cmd);
}

function commandFromArgv(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const joined = value.filter((part): part is string => typeof part === 'string').join(' ');
  return joined.length > 0 ? joined : undefined;
}

/** Codex records nest the native payload one level down: `{ type, payload }`. */
function codexInner(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return recordValue(payload?.payload);
}

function contentBlocks(event: LoopwatchEvent): Record<string, unknown>[] {
  const payload = recordValue(event.payload);
  const message = recordValue(payload?.message);
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const record = recordValue(block);
    return record ? [record] : [];
  });
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
