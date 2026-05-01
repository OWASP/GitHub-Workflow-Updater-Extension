export interface TokenEnvironment {
  [key: string]: string | undefined;
  GH_TOKEN?: string;
}

export function getGitHubTokenFromEnvironment(
  env: TokenEnvironment = process.env
): string {
  return env.GH_TOKEN?.trim() || "";
}

export function resolveGitHubToken(
  storedToken: string,
  env: TokenEnvironment = process.env
): string {
  return storedToken.trim() || getGitHubTokenFromEnvironment(env);
}
