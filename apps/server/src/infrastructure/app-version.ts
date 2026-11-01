/**
 * The commit the running code comes from, to check which version a container runs. The Docker build writes it to
 * `VERSION` (there is no git in the image); in development, git is asked directly.
 */
export async function appVersion(): Promise<string> {
  const file = Bun.file('VERSION');
  if (await file.exists()) return (await file.text()).trim() || 'unknown';

  const commit = git('rev-parse', '--short', 'HEAD');
  if (!commit) return 'unknown';
  return git('status', '--porcelain') ? `${commit} + uncommitted changes` : commit;
}

/** Output of a git command, `null` when git is missing or fails. */
function git(...args: string[]): string | null {
  try {
    const result = Bun.spawnSync(['git', ...args], { stderr: 'ignore' });
    return result.success ? result.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}
