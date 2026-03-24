import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";

vi.mock("./lib/api", () => ({
  api: {
    health: vi.fn(),
    listServers: vi.fn(),
    listNodes: vi.fn(),
    getLogs: vi.fn(),
    login: vi.fn(),
    createServer: vi.fn(),
    installServer: vi.fn(),
    startServer: vi.fn(),
    stopServer: vi.fn(),
    providers: vi.fn()
  },
  setToken: vi.fn()
}));

import { api } from "./lib/api";

const mockedApi = vi.mocked(api);

describe("App component navigation", () => {
  beforeEach(() => {
    mockedApi.health.mockResolvedValue({ ok: true, authRequired: false });
    mockedApi.listServers.mockResolvedValue([]);
    mockedApi.listNodes.mockResolvedValue([]);
  });

  it("default page is Dashboard", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Dashboard" })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { level: 2, name: "Dashboard" })).toBeInTheDocument();
    expect(document.querySelector(".stats-grid")).toBeInTheDocument();
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByText("Dashboard")).toHaveClass("active");
  });

  it("navigates to Servers page", async () => {
    render(<App />);
    await waitFor(() => screen.getByRole("navigation"));
    fireEvent.click(screen.getByText("Servers", { selector: "nav a" }));
    expect(screen.getByRole("heading", { level: 2, name: "Servers" })).toBeInTheDocument();
  });

  it("navigates to Nodes page", async () => {
    render(<App />);
    await waitFor(() => screen.getByRole("navigation"));
    fireEvent.click(screen.getByText("Nodes", { selector: "nav a" }));
    // App renders "Cluster Nodes" in both the page header and the nodes card
    const [heading] = screen.getAllByRole("heading", { level: 2, name: "Cluster Nodes" });
    expect(heading).toBeInTheDocument();
  });

  it("navigates to Logs page", async () => {
    render(<App />);
    await waitFor(() => screen.getByRole("navigation"));
    fireEvent.click(screen.getByText("Logs", { selector: "nav a" }));
    // App renders "Logs" in both the page header and the LogsPanel card
    const [heading] = screen.getAllByRole("heading", { level: 2, name: "Logs" });
    expect(heading).toBeInTheDocument();
  });

  it("navigates to Settings page", async () => {
    render(<App />);
    await waitFor(() => screen.getByRole("navigation"));
    fireEvent.click(screen.getByText("Settings", { selector: "nav a" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Settings" })).toBeInTheDocument();
    });
    expect(screen.getByText("Auth required")).toBeInTheDocument();
  });

  it("active class follows navigation", async () => {
    render(<App />);
    await waitFor(() => screen.getByRole("navigation"));
    fireEvent.click(screen.getByText("Servers", { selector: "nav a" }));
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByText("Servers")).toHaveClass("active");
    expect(within(nav).getByText("Dashboard")).not.toHaveClass("active");
  });

  it("shows login form when auth is required", async () => {
    mockedApi.health.mockResolvedValue({ ok: true, authRequired: true });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    });
  });
});
