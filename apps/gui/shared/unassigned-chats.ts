export const UNASSIGNED_CHATS_FAKE_PROJECT_ID = "officeagent:unassigned-chats";
export const UNASSIGNED_CHAT_PROJECT_PREFIX = ".officeagent-chat-";
export const UNASSIGNED_CHAT_PROJECT_NAME = "Chats sin proyecto";
export const UNNAMED_CHAT_TITLE = "Chat sin nombre";

export function createUnassignedChatToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getPathSeparator(pathValue: string) {
  return pathValue.includes("\\") ? "\\" : "/";
}

export function createUnassignedChatProjectId(projectsRoot: string, token = createUnassignedChatToken()) {
  const separator = getPathSeparator(projectsRoot);
  const normalizedRoot = projectsRoot.replace(/[\\/]+$/, "");
  return `${normalizedRoot}${separator}${UNASSIGNED_CHAT_PROJECT_PREFIX}${token}`;
}

export function isUnassignedChatProjectId(projectId: string | null | undefined) {
  if (!projectId) {
    return false;
  }

  const [lastSegment = ""] = projectId.split(/[\\/]+/).slice(-1);
  return lastSegment.startsWith(UNASSIGNED_CHAT_PROJECT_PREFIX);
}

export function getUnassignedChatDisplayTitle(title: string | null | undefined) {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle || /^new thread$/i.test(normalizedTitle)) {
    return UNNAMED_CHAT_TITLE;
  }

  const words = normalizedTitle.split(/\s+/).slice(0, 8);
  return words.join(" ");
}

// TODO: When promoting an unassigned chat to a real project, copy generated files from the
// temporary project folder into the target project. For now conflicts should auto-rename copied
// files, but we may need to decide whether to merge, overwrite, or surface conflicts to the user.
