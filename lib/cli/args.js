export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = 2;
  }
}

export function parseArgs(argv, { positionals = [], options = {}, command = 'command' } = {}) {
  const result = { _: [] };
  const definitions = new Map(Object.entries(options));
  for (const [name, definition] of definitions) {
    if (Object.hasOwn(definition, 'default')) result[name] = definition.default;
    else if (definition.kind === 'boolean') result[name] = false;
    else if (definition.kind === 'multiple') result[name] = [];
  }
  const args = [...argv];
  let positionalOnly = false;
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!positionalOnly && token === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && (token === '-h' || token === '--help')) return { help: true, _: [] };
    if (!positionalOnly && token.startsWith('--')) {
      const equals = token.indexOf('=');
      const name = token.slice(2, equals === -1 ? undefined : equals);
      const definition = definitions.get(name);
      if (!definition) throw new UsageError(`unrecognized arguments: ${token}`);
      const assigned = equals !== -1;
      if (definition.kind === 'boolean') {
        if (assigned) throw new UsageError(`option --${name} does not take a value`);
        result[name] = true;
      } else if (definition.kind === 'multiple') {
        if (assigned) result[name].push(token.slice(equals + 1));
        else {
          while (i + 1 < args.length && (positionalOnly || !args[i + 1].startsWith('--'))) result[name].push(args[++i]);
        }
      } else {
        const value = assigned ? token.slice(equals + 1) : args[++i];
        if (value === undefined || (!assigned && value === '--')) throw new UsageError(`argument --${name}: expected one argument`);
        result[name] = value;
      }
      continue;
    }
    if (!positionalOnly && token.startsWith('-')) throw new UsageError(`unrecognized arguments: ${token}`);
    result._.push(token);
  }
  let cursor = 0;
  for (const item of positionals) {
    const spec = typeof item === 'string' ? { name: item } : item;
    if (spec.multiple) {
      result[spec.name] = result._.slice(cursor);
      cursor = result._.length;
      if (spec.required && result[spec.name].length === 0) throw new UsageError(`the following arguments are required: ${spec.name}`);
      break;
    }
    const value = result._[cursor++];
    if (value === undefined && spec.required !== false) throw new UsageError(`the following arguments are required: ${spec.name}`);
    result[spec.name] = value;
  }
  if (cursor < result._.length) throw new UsageError(`unrecognized arguments: ${result._.slice(cursor).join(' ')}`);
  return result;
}

export function helpRequested(argv) {
  return argv.some((arg) => arg === '--help' || arg === '-h');
}
