import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { legacyJson } from '../runtime/compat-json.js';
import { TOOL_SCHEMAS } from './contracts.js';
import { listTemplates } from './templates.js';
import { Runtime, enabled, fallback } from './runtime.js';
import { LosslessStdioTransport } from './stdio.js';

export function createMcpServer({ runtime = new Runtime(), stderr = process.stderr } = {}) {
  const server = new Server({ name: 'laya-decisions', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_SCHEMAS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    let result;
    try {
      switch (name) {
        case 'laya_status': result = await runtime.status(); break;
        case 'laya_templates':
          if (!enabled(runtime.configRoot)) result = fallback('disabled');
          else {
            try { result = { templates: listTemplates({ env: runtime.env, root: runtime.root }) }; }
            catch { result = fallback('invalid_template'); }
          }
          break;
        case 'laya_decide': result = await runtime.run(args.decision, args.items, Object.hasOwn(args, 'context') ? args.context : null, Object.hasOwn(args, 'model') ? args.model : 'auto'); break;
        case 'laya_predict': result = await runtime.predict(args.state, args.questions, Object.hasOwn(args, 'model') ? args.model : 'auto'); break;
        default: return { content: [{ type: 'text', text: legacyJson(fallback('unknown_tool'), { ensureAscii: false, separators: [',', ':'] }) }], isError: true };
      }
      return { content: [{ type: 'text', text: legacyJson(result, { ensureAscii: false, separators: [',', ':'] }) }] };
    } catch {
      stderr.write('System One MCP tool failed safely.\n');
      result = fallback('invalid_configuration_or_input');
      return { content: [{ type: 'text', text: legacyJson(result, { ensureAscii: false, separators: [',', ':'] }) }] };
    }
  });
  return server;
}

export async function runStdio({ runtime, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const instance = runtime ?? new Runtime();
  const transport = new LosslessStdioTransport(stdin, stdout, stderr);
  const server = createMcpServer({ runtime: instance, stderr });
  await server.connect(transport);
  return { server, transport };
}
