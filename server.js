import express from 'express';
import dotenv from 'dotenv';
import { MCPClient } from "./build/index.js"; // adjust path to where your MCPClient is defined

dotenv.config();

const PORT = process.env.PORT || 4000;
const SERVER_SCRIPT_PATH = process.env.SERVER_SCRIPT_PATH || 'C:\\Users\\Nick\\weather\\build\\index.js'; // set this appropriately

async function startServer() {
    const app = express();
    app.use(express.json());

    const mcpClient = new MCPClient();
    try {
        await mcpClient.connectToServer(SERVER_SCRIPT_PATH);
    } catch (err) {
        console.error('Failed to connect to MCP server:', err);
        process.exit(1);
    }

    app.post('/api/mcp', async (req, res) => {
        const { sessionId, query } = req.body;
        if (!sessionId || !query) {
            return res.status(400).json({ error: 'Missing sessionId or query parameter' });
        }
        try {
            const result = await mcpClient.processQuery(sessionId, query);
            res.json({ result });
        } catch (err) {
            console.error('Error processing query:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });


    app.get('/api/mcp', async (req, res) => {
        const { sessionId, prompt } = req.query;
        if (!sessionId || !prompt) {
            return res.status(400).json({ error: 'Missing sessionId or prompt parameter' });
        }
        try {
            const result = await mcpClient.processQuery(sessionId, prompt);
            res.json({ result });
        } catch (err) {
            console.error('Error processing query:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`MCP client server running at http://0.0.0.0:${PORT}`);
    });

    // Cleanup on shutdown
    process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await mcpClient.cleanup();
        process.exit(0);
    });
}

startServer();
