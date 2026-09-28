export function writeJson(value, stdout = process.stdout) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeLine(value, stdout = process.stdout) {
  stdout.write(`${String(value)}\n`);
}

export function writeError(error, stderr = process.stderr) {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}
