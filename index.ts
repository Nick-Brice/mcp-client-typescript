import { Anthropic } from "@anthropic-ai/sdk";
import {
    MessageParam,
    Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
}

// Helper function for making API requests
async function makeAPIGetRequest<T>(url: string): Promise<T | null> {
    const headers = {
        'Content-Type': 'application/json'
    };

    try {
        const response = await fetch(url, {
            headers,
            method: "GET",
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return (await response.json()) as T;
    } catch (error) {
        console.error("Error making Post request:", error);
        return null;
    }
}


export class MCPClient {
    private mcp: Client;
    private anthropic: Anthropic;
    private transport: StdioClientTransport | null = null;
    private tools: Tool[] = [];
    private conversationHistories: Map<string, MessageParam[]> = new Map();

    constructor() {
        this.anthropic = new Anthropic({
            apiKey: ANTHROPIC_API_KEY,
        });
        this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    }
    // methods will go here
    async connectToServer(serverScriptPath: string) {
        try {
            const isJs = serverScriptPath.endsWith(".js");
            const isPy = serverScriptPath.endsWith(".py");
            if (!isJs && !isPy) {
                throw new Error("Server script must be a .js or .py file");
            }
            const command = isPy
                ? process.platform === "win32"
                    ? "python"
                    : "python3"
                : process.execPath;

            this.transport = new StdioClientTransport({
                command,
                args: [serverScriptPath],
            });
            this.mcp.connect(this.transport);

            const toolsResult = await this.mcp.listTools();
            this.tools = toolsResult.tools.map((tool) => {
                return {
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.inputSchema,
                };
            });
            console.log(
                "Connected to server with tools:",
                this.tools.map(({ name }) => name)
            );
        } catch (e) {
            console.log("Failed to connect to MCP server: ", e);
            throw e;
        }
        this.conversationHistories = new Map();
    }

    async processQuery(sessionId: string, query: string) {
        // Get or create conversation history for this session
        let history = this.conversationHistories.get(sessionId);
        if (!history) {
            // history = [{
            //     role: "user",
            //     content: "You are a deeply technical assistant focused on helping users write correct TypeScript and database queries. Always double check API assumptions."
            // }];
            history = []
            this.conversationHistories.set(sessionId, history);
        }

        // Append the user message
        history.push({
            role: "user",
            content: query,
        });

        if (history?.length > 20 && (
            sessionId !== "clfbs4emw0000zb1s7kj4hv2q" && // Nick
            sessionId !== "clfiicx7a0000l00850uwfv3v" && // Jack
            sessionId !== "clfmmx6if0002zb14iwosj7uh" // Connor
        )) {
            return "You have ran out of messages, please email us if you need more."
        }

        const apiURL = `https://rubbishportal.com/api/mcp/records/users/${sessionId}`;
        const apiData = await makeAPIGetRequest(apiURL);

        const systemPrompt = [
            {
                "text": `
                    You are a helpful, friendly assistant for the venue manager ${apiData?.name} of the venue ${apiData?.venue_name} using the website. Your role is to guide users through how to use the platform, explain features clearly, and help them retrieve insights and statistics about their venue.

                    Never:
                    - Let users request data about another venue

                    Always:
                    - Use plain, professional language.
                    - Ask clarifying questions if the user's request is vague.
                    - Tailor your answers to venue operations — streams, products, deliveries, stock checks, sales, waste collections or waste sorting.
                    - Format responses cleanly using bullet points, tables, or headings when appropriate.
                    - If a user asks about something the assistant cannot do, respond honestly and redirect them to where they might get help.

                    Examples of tasks you handle well:
                    - Using FAQs to explain how to use the website.
                    - Finding basic statistics for their venue data.
                    - Suggesting ways to interpret or act on their venue data.

                    Be concise, helpful, and grounded in the features available on the website.

                    Venue Specific Data:
                    - Name: ${apiData?.venue_name}
                    - Venue Record ID: ${apiData?.venue_id}
                    - Subscription Level: ${apiData?.subscription_level}
                    - Venue Address: ${apiData?.address}
                    - Service Provider Name: ${apiData?.service_provider}
                    - Organiser Name: ${apiData?.organiser_name}
                    `,
                "type": "text"
            }
        ]

        // Send the entire conversation to Anthropic
        const response = await this.anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            system: systemPrompt,
            messages: history,
            tools: this.tools,
        });

        const finalText: string[] = [];

        for (const content of response.content) {
            if (content.type === "text") {
                finalText.push(content.text);
                history.push({
                    role: "assistant",
                    content: content.text,
                });
            } else if (content.type === "tool_use") {
                const toolName = content.name;
                const toolArgs = content.input as { [x: string]: unknown } | undefined;

                const result = await this.mcp.callTool({
                    name: toolName,
                    arguments: toolArgs,
                });
                finalText.push(
                    `[[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]]`
                );

                // Append the tool result as a user message
                history.push({
                    role: "user",
                    content: result.content as string,
                });

                // Call Anthropic again with the updated history
                const followUpResponse = await this.anthropic.messages.create({
                    model: "claude-3-5-sonnet-20241022",
                    max_tokens: 1000,
                    system: systemPrompt,
                    messages: history,
                });

                if (
                    followUpResponse.content &&
                    followUpResponse.content[0].type === "text"
                ) {
                    const text = followUpResponse.content[0].text;
                    finalText.push(text);
                    history.push({
                        role: "assistant",
                        content: text,
                    });
                }
            }
        }

        return finalText.join("\n");
    }

    async chatLoop() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        try {
            console.log("\nMCP Client Started!");
            console.log("Type your queries or 'quit' to exit.");

            while (true) {
                const message = await rl.question("\nQuery: ");
                if (message.toLowerCase() === "quit") {
                    break;
                }
                const response = await this.processQuery("abc", message);
                console.log("\n" + response);
            }
        } finally {
            rl.close();
        }
    }

    async cleanup() {
        await this.mcp.close();
    }
}

async function main() {
    if (process.argv.length < 3) {
        console.log("Usage: node index.ts <path_to_server_script>");
        return;
    }
    const mcpClient = new MCPClient();
    try {
        await mcpClient.connectToServer(process.argv[2]);
        await mcpClient.chatLoop();
    } finally {
        await mcpClient.cleanup();
        process.exit(0);
    }
}

main();
