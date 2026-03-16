// Inject last 10 commit messages as progress context
// OpenCode equivalent of .claude/hooks/inject-commit-context.sh

/** @type {import("@opencode-ai/plugin").Plugin} */
export const InjectCommitContext = async (ctx) => {
  let commitContext = ""

  try {
    const format = "### %h - %s%n%n%b"
    const output = await ctx.$`git log -10 --format=${format} 2>/dev/null`.text()
    if (output.trim()) {
      commitContext = `## Recent Commits\n\n${output.trim()}`
    }
  } catch {
    // Not a git repo or no commits — skip silently
  }

  return {
    "experimental.chat.system.transform": async (_ctx, { system }) => {
      if (commitContext) {
        system.push(`<commit-context>\n${commitContext}\n</commit-context>`)
      }
    },
  }
}
