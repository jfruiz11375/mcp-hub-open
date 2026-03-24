import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGitInstance, mockFsExtra } = vi.hoisted(() => {
  const mockGitInstance = {
    fetch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    clone: vi.fn().mockResolvedValue(undefined)
  };
  const mockFsExtra = {
    pathExists: vi.fn(),
    ensureDir: vi.fn().mockResolvedValue(undefined)
  };
  return { mockGitInstance, mockFsExtra };
});

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGitInstance)
}));

vi.mock("fs-extra", () => ({
  default: mockFsExtra
}));

vi.mock("../../config.js", () => ({
  config: {
    allowedGithubHosts: ["github.com"],
    reposDir: "/tmp/mcp-git-test-repos"
  }
}));

import { GitService } from "../git-service.js";

describe("GitService", () => {
  let service: GitService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFsExtra.ensureDir.mockResolvedValue(undefined);
    service = new GitService();
  });

  describe("cloneOrPull", () => {
    it("throws 'Invalid repository URL' for a non-URL string", async () => {
      await expect(service.cloneOrPull("srv-1", "not-a-url")).rejects.toThrow("Invalid repository URL");
    });

    it("throws 'Repository host not allowed: ...' for a disallowed host", async () => {
      await expect(service.cloneOrPull("srv-1", "https://bitbucket.org/user/repo")).rejects.toThrow(
        "Repository host not allowed: bitbucket.org"
      );
    });

    it("calls git.clone when target directory does not exist", async () => {
      mockFsExtra.pathExists.mockResolvedValue(false);
      const result = await service.cloneOrPull("srv-1", "https://github.com/user/repo");
      expect(mockGitInstance.clone).toHaveBeenCalledWith(
        "https://github.com/user/repo",
        "/tmp/mcp-git-test-repos/srv-1",
        ["--branch", "main"]
      );
      expect(result).toEqual({ action: "cloned", targetDir: "/tmp/mcp-git-test-repos/srv-1" });
    });

    it("calls git.fetch, checkout, and pull when target directory exists", async () => {
      mockFsExtra.pathExists.mockResolvedValue(true);
      const result = await service.cloneOrPull("srv-1", "https://github.com/user/repo", "dev");
      expect(mockGitInstance.fetch).toHaveBeenCalled();
      expect(mockGitInstance.checkout).toHaveBeenCalledWith("dev");
      expect(mockGitInstance.pull).toHaveBeenCalledWith("origin", "dev");
      expect(result).toEqual({ action: "pulled", targetDir: "/tmp/mcp-git-test-repos/srv-1" });
    });
  });
});
