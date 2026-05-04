export type GitOpsVisualMode = "dirty" | "clean" | "not-git";

export function formatGitCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

export function getGitOpsEntryButtonClass(mode: GitOpsVisualMode) {
  if (mode === "not-git") {
    return "border-[rgba(255,110,110,0.22)] text-[#ff9c9c] hover:border-[rgba(255,110,110,0.36)] hover:bg-[rgba(255,94,94,0.08)] hover:text-[#ffd1d1]";
  }

  if (mode === "dirty") {
    return "border-[rgba(92,201,165,0.22)] text-[#7ee0bb] hover:border-[rgba(92,201,165,0.34)] hover:bg-[rgba(92,201,165,0.08)] hover:text-[#bdf7dd]";
  }

  return "border-white/10 text-[color:var(--muted)] hover:border-white/20 hover:bg-white/[0.04] hover:text-[color:var(--text)]";
}
