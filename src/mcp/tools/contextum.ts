import type { McpServer } from "@modelcontextprotocol/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";

const contextumSchema = z.object({
  root: z.string().describe("Repository root path"),
  query: z.string().optional().describe("Search query across contextum files"),
});

export type ContextumOptions = z.infer<typeof contextumSchema>;

interface ContextumFile {
  path: string;
  name: string;
  type: "agents" | "context" | "status";
  content: string;
  size: number;
}

interface ContextumStatus {
  initialized: boolean;
  hasAgents: boolean;
  hasContext: boolean;
  taskCount?: number;
  lockCount?: number;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bridge between AIBrain memory and Contextum coordination center.
 * Reads .contextum/ folder and exposes coordination state as AIBrain context.
 */
export class ContextumBridge {
  private root: string;
  private contextumDir: string;

  constructor(options: ContextumOptions) {
    this.root = options.root;
    this.contextumDir = path.join(this.root, ".contextum");
  }

  async getStatus(): Promise<ContextumStatus> {
    const exists = await pathExists(this.contextumDir);

    if (!exists) {
      return {
        initialized: false,
        hasAgents: false,
        hasContext: false,
      };
    }

    const agentsFile = path.join(this.contextumDir, "agents.json");
    const contextFile = path.join(this.contextumDir, "context.yaml");

    const hasAgents = await pathExists(agentsFile);
    const hasContext = await pathExists(contextFile);

    return {
      initialized: true,
      hasAgents,
      hasContext,
    };
  }

  async listFiles(): Promise<ContextumFile[]> {
    const status = await this.getStatus();
    if (!status.initialized) {
      return [];
    }

    const files: ContextumFile[] = [];

    // Read coordination files
    const coordDir = path.join(this.contextumDir, "coord");
    if (await pathExists(coordDir)) {
      try {
        const entries = await fs.readdir(coordDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".json")) {
            const filePath = path.join(coordDir, entry.name);
            const content = await fs.readFile(filePath, "utf-8");
            const stats = await fs.stat(filePath);

            files.push({
              path: path.relative(this.root, filePath),
              name: entry.name,
              type: "agents",
              content,
              size: stats.size,
            });
          }
        }
      } catch {
        // Silently skip if reading fails
      }
    }

    // Read context files
    const contextFiles = ["context.yaml", "agents.md", "decisions.md"];
    for (const fileName of contextFiles) {
      const filePath = path.join(this.contextumDir, fileName);
      if (await pathExists(filePath)) {
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const stats = await fs.stat(filePath);

          files.push({
            path: path.relative(this.root, filePath),
            name: fileName,
            type: "context",
            content,
            size: stats.size,
          });
        } catch {
          // Silently skip if reading fails
        }
      }
    }

    return files;
  }

  async search(query: string): Promise<ContextumFile[]> {
    const files = await this.listFiles();
    const queryLower = query.toLowerCase();

    return files.filter(
      (file) =>
        file.name.toLowerCase().includes(queryLower) ||
        file.content.toLowerCase().includes(queryLower)
    );
  }

  async getAgentContext(): Promise<Record<string, unknown>> {
    const agentsFile = path.join(this.contextumDir, "agents.json");

    if (await pathExists(agentsFile)) {
      try {
        const content = await fs.readFile(agentsFile, "utf-8");
        return JSON.parse(content) as Record<string, unknown>;
      } catch {
        return {};
      }
    }

    return {};
  }

  async getCurrentTasks(): Promise<unknown[]> {
    const coordDir = path.join(this.contextumDir, "coord");
    const tasksFile = path.join(coordDir, "tasks.json");

    if (await pathExists(tasksFile)) {
      try {
        const content = await fs.readFile(tasksFile, "utf-8");
        return JSON.parse(content) as unknown[];
      } catch {
        return [];
      }
    }

    return [];
  }
}

export function registerContextum(server: McpServer): void {
  server.registerTool(
    "contextum_search",
    {
      description:
        "Search Contextum coordination center to get agent state, active tasks, locks, and handoffs. Use when working with multi-agent systems to avoid conflicts and understand who is doing what.",
      inputSchema: z.object({
        root: z
          .string()
          .describe(
            "Repository root path (where .contextum/ folder is located). Usually the git repository root."
          ),
        type: z
          .enum(["status", "list", "search", "agents", "tasks"])
          .describe(
            "status: check if Contextum is initialized; list: all coordination files; search: find specific files/tasks; agents: current agent state; tasks: active tasks and locks"
          ),
        query: z
          .string()
          .optional()
          .describe("Search query for tasks, agents, or coordination state (required for type=search)"),
      }),
    },
    async (args) => {
      const result = await handleContextumSearch(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

export async function handleContextumSearch(
  input: Record<string, unknown>
): Promise<unknown> {
  const { root, query, type } = input as {
    root: string;
    query?: string;
    type: string;
  };

  const bridge = new ContextumBridge({ root });

  switch (type) {
    case "status": {
      const status = await bridge.getStatus();
      return {
        contextum_status: status,
        message: status.initialized
          ? "Contextum coordination center found"
          : "No Contextum center in this repository",
      };
    }

    case "list": {
      const files = await bridge.listFiles();
      return {
        files: files.map((f) => ({
          path: f.path,
          name: f.name,
          type: f.type,
          size: f.size,
        })),
        count: files.length,
      };
    }

    case "search": {
      if (!query) {
        return {
          error: "query is required for search type",
        };
      }
      const results = await bridge.search(query);
      return {
        query,
        results: results.map((r) => ({
          path: r.path,
          name: r.name,
          type: r.type,
          preview: r.content.slice(0, 500),
        })),
        count: results.length,
      };
    }

    case "agents": {
      const agents = await bridge.getAgentContext();
      return {
        agents,
        message: "Current agent state from Contextum",
      };
    }

    case "tasks": {
      const tasks = await bridge.getCurrentTasks();
      return {
        tasks,
        count: Array.isArray(tasks) ? tasks.length : 0,
        message: "Active tasks and locks from Contextum coordination center",
      };
    }

    default: {
      return {
        error: `Unknown type: ${type}`,
      };
    }
  }
}
