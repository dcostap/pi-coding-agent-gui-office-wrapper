export function expandOfficeAgentPathPlaceholders(input: string, env: NodeJS.ProcessEnv): string {
  const withPercent = input.replaceAll(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, key: string) => getEnv(env, key) ?? match);
  return withPercent.replaceAll(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (match, key: string) => getEnv(env, key) ?? match);
}

export function getEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const direct = env[key];
  if (direct !== undefined) {
    return direct;
  }
  const actualKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return actualKey ? env[actualKey] : undefined;
}
