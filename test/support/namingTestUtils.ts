import { setNamingTestOverrides } from "../../src/naming.js";

export function installDeterministicNaming(args?: { slugs?: string[] }): void {
  const slugs = [...(args?.slugs ?? ["deterministic-branch"] )];
  let slugIndex = 0;

  setNamingTestOverrides({
    async generateBranchSlug() {
      const slug = slugs[Math.min(slugIndex, slugs.length - 1)] ?? "deterministic-branch";
      slugIndex += 1;
      return slug;
    },
    async generateIterationCommitMessage({ iteration, changedFiles }) {
      return {
        subject: `Iteration ${iteration} touches ${changedFiles[0] ?? "repo"}`,
        body: [`Summary for iteration v${iteration}.`, ...changedFiles.map((file) => `- ${file}`)].join("\n"),
      };
    },
    async generateMergeCommitMessage({ scratchBranchName, commits }) {
      return {
        subject: `Merge ${scratchBranchName}`,
        body: commits.map((commit) => `- ${commit.subject}`).join("\n"),
      };
    },
  });
}

export function resetDeterministicNaming(): void {
  setNamingTestOverrides(undefined);
}
