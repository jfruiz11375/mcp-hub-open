import fs from "fs-extra";
import path from "node:path";
import { simpleGit } from "simple-git";
import { config } from "../config.js";

function validateRepoHost(repoUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new Error("Invalid repository URL");
  }

  if (!config.allowedGithubHosts.includes(parsed.hostname)) {
    throw new Error(`Repository host not allowed: ${parsed.hostname}`);
  }
}

export class GitService {
  async cloneOrPull(serverId: string, repoUrl: string, branch = "main") {
    validateRepoHost(repoUrl);

    const targetDir = path.join(config.reposDir, serverId);
    await fs.ensureDir(config.reposDir);

    if (await fs.pathExists(targetDir)) {
      const git = simpleGit(targetDir);
      await git.fetch();
      await git.checkout(branch);
      await git.pull("origin", branch);
      return { action: "pulled", targetDir };
    }

    const git = simpleGit();
    await git.clone(repoUrl, targetDir, ["--branch", branch]);
    return { action: "cloned", targetDir };
  }
}
