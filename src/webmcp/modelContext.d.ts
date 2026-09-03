// Ambient types for the WebMCP `document.modelContext` API
// (https://github.com/webmachinelearning/webmcp). Shapes for getTools()/
// executeTool() match Chrome 149's actual behavior under
// chrome://flags/#enable-webmcp-testing, verified directly against this
// app's own deployment — notably: getTools() returns inputSchema as a JSON
// *string*, and executeTool() both takes its arguments and returns its
// result as JSON strings, not objects. This diverges from the spec
// explainer's own plain-object examples; see README's "Testing this in 60
// seconds" section.

interface ModelContextToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<ModelContextToolResult | unknown> | ModelContextToolResult | unknown;
}

interface RegisteredModelContextTool {
  name: string;
  description: string;
  inputSchema?: string | Record<string, unknown>;
  origin?: string;
  title?: string;
  [key: string]: unknown;
}

interface ModelContext extends EventTarget {
  registerTool: (tool: ModelContextTool, options?: { signal?: AbortSignal }) => Promise<void>;
  getTools: (options?: { fromOrigins?: string[] }) => Promise<RegisteredModelContextTool[]>;
  executeTool: (
    tool: RegisteredModelContextTool,
    input: string | Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<string | unknown>;
}

interface Document {
  modelContext?: ModelContext;
}
