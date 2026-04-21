import {
  ensureOfficeAgentManagedAgentDir,
  getOfficeAgentAgentDir,
  getOfficeAgentManagedEnv,
  type OfficeAgentClientKind,
} from "@office-agent/runtime";

export async function ensureManagedPiAgentDir(
  userDataDir: string,
  clientKind: OfficeAgentClientKind = "gui",
): Promise<string> {
  const agentDir = getOfficeAgentAgentDir(userDataDir);
  Object.assign(process.env, getOfficeAgentManagedEnv(process.env, { agentDir, clientKind }));
  return ensureOfficeAgentManagedAgentDir(agentDir);
}
