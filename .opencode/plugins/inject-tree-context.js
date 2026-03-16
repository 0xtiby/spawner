// Inject directory tree so the LLM knows real file paths.
// Prevents path hallucination by giving structural context upfront.
// OpenCode equivalent of .claude/hooks/inject-tree-context.sh

/** @type {import("@opencode-ai/plugin").Plugin} */
export const InjectTreeContext = async (ctx) => {
  let treeContext = ""

  try {
    const projectRoot =
      await ctx.$`git rev-parse --show-toplevel 2>/dev/null`.text()
    const root = projectRoot.trim()
    if (!root) return {}

    // Auto-detect depth: 4 for monorepo (has apps/), 3 otherwise
    let depth = "3"
    if (process.env.TREE_DEPTH) {
      depth = process.env.TREE_DEPTH
    } else {
      try {
        await ctx.$`test -d ${root}/apps`
        depth = "4"
      } catch {
        // not a monorepo
      }
    }

    const excludes =
      "node_modules|.next|dist|.git|.beads|coverage|.turbo|.worktrees"

    let output = ""
    try {
      output =
        await ctx.$`tree -L ${depth} -I ${excludes} --dirsfirst ${root} 2>/dev/null`.text()
    } catch {
      // tree not installed — use find fallback
      output =
        await ctx.$`find ${root} -maxdepth ${depth} -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/dist/*' -not -path '*/.git/*' -not -path '*/.beads/*' -not -path '*/coverage/*' -not -path '*/.turbo/*' -not -path '*/.worktrees/*' -not -name 'node_modules' -not -name '.next' -not -name 'dist' -not -name '.git' -not -name '.beads' -not -name 'coverage' -not -name '.turbo' -not -name '.worktrees' | sort`.text()
    }

    if (output.trim()) {
      treeContext = `## Project Structure\n\n<tree>\n${output.trim()}\n</tree>`
    }
  } catch {
    // Not a git repo — skip silently
  }

  return {
    "experimental.chat.system.transform": async (_ctx, { system }) => {
      if (treeContext) {
        system.push(`<project-structure>\n${treeContext}\n</project-structure>`)
      }
    },
  }
}
