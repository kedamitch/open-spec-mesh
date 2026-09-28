import { spawnSync } from 'node:child_process';

function report(stream, text) {
  stream.write(`${text}\n`);
}

/** Run required checks serially and fail closed at the first missing/failed command. */
export function runChecks(checks, {
  cwd = process.cwd(),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  spawn = spawnSync,
} = {}) {
  if (!Array.isArray(checks) || checks.length === 0) {
    report(stderr, 'No required validation checks are configured.');
    return 2;
  }
  for (const check of checks) {
    if (!check || typeof check.name !== 'string' || !check.name.trim()
      || typeof check.command !== 'string' || !check.command.trim()
      || !Array.isArray(check.args) || check.args.some((arg) => typeof arg !== 'string')) {
      report(stderr, 'Invalid required check definition; refusing to report success.');
      return 2;
    }
    report(stdout, `== ${check.name} ==`);
    let result;
    try {
      result = spawn(check.command, check.args, {
        cwd: check.cwd ?? cwd,
        env: { ...env, ...(check.env ?? {}) },
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      report(stderr, `FAILED ${check.name}: ${error?.message ?? error}`);
      return 127;
    }
    if (result?.error) {
      report(stderr, `FAILED ${check.name}: ${result.error.message}`);
      return 127;
    }
    const code = Number.isInteger(result?.status) ? result.status : 1;
    if (code !== 0) {
      report(stderr, `FAILED ${check.name}: exit=${code}${result?.signal ? ` signal=${result.signal}` : ''}`);
      return code;
    }
  }
  report(stdout, `ALL REQUIRED CHECKS PASSED (${checks.length})`);
  return 0;
}
