import { ensureOfficeAgentManagedAgentDir, getOfficeAgentAgentDir } from "@office-agent/runtime";

export async function ensureManagedPiAgentDir(userDataDir: string): Promise<string> {
  return ensureOfficeAgentManagedAgentDir(getOfficeAgentAgentDir(userDataDir));
}
