import { config } from '../config.js';

export function ok(data) {
  let text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (text.length > config.maxResponseChars) {
    text =
      text.slice(0, config.maxResponseChars) +
      `\n\n[... resposta truncada em ${config.maxResponseChars} caracteres. Refine com $select/$top ou filtros.]`;
  }
  return { content: [{ type: 'text', text }] };
}

export function fail(err) {
  return { isError: true, content: [{ type: 'text', text: `Erro: ${err?.message || err}` }] };
}

export const wrap = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (e) {
    return fail(e);
  }
};

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
