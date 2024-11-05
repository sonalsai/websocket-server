require('dotenv').config();
const WebSocket = require('ws');
const axios = require('axios');
const Buffer = require('buffer').Buffer;

// Configuration constants
const CONFIG = {
    PORT: 8080,
    SAMPLE_RATE: 8000,
    ENCODING: 'mulaw',  // Changed to mulaw for Twilio's PCMU format
    CHANNELS: 1
};

// WebSocket server to handle PCM audio stream from Twilio
const wss = new WebSocket.Server({ port: CONFIG.PORT });

// Deepgram WebSocket URL with correct encoding parameters for PCMU
const deepgramSocketUrl = process.env.WS_URL;
// const deepgramSocketUrl = `wss://api.deepgram.com/v1/listen?encoding=${CONFIG.ENCODING}&sample_rate=${CONFIG.SAMPLE_RATE}&channels=${CONFIG.CHANNELS}`;
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

wss.on('connection', (ws) => {
    console.log('Received connection from Twilio');

    // Set up a WebSocket connection to Deepgram's streaming API
    const targetWs = new WebSocket(deepgramSocketUrl, {
        headers: {
            Authorization: `Token ${deepgramApiKey}`,
        },
    });

    // Track connection state
    let isDeepgramConnected = false;

    targetWs.on('open', () => {
        console.log('Connected to Deepgram WebSocket for transcription');
        isDeepgramConnected = true;
    });

    // Handle incoming PCMU data from Twilio
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            // Only process media events with payload
            if (data.event === 'media' && data.media?.payload) {
                // Decode base64-encoded PCMU payload
                const pcmuBuffer = Buffer.from(data.media.payload, 'base64');

                // Only send if Deepgram connection is open
                if (isDeepgramConnected && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(pcmuBuffer);
                }
            }
        } catch (error) {
            console.error('Error processing Twilio message:', error);
        }
    });

    // Handle Twilio WebSocket events
    ws.on('close', () => {
        console.log('Twilio WebSocket closed');
        if (targetWs.readyState === WebSocket.OPEN) {
            targetWs.close();
        }
    });

    ws.on('error', (err) => {
        console.error('Error in Twilio WebSocket:', err);
        if (targetWs.readyState === WebSocket.OPEN) {
            targetWs.close();
        }
    });

    // Handle Deepgram WebSocket events
    targetWs.on('message', (message) => {
        try {
            // Check if message is a Buffer and convert it to string if necessary
            const messageStr = Buffer.isBuffer(message) ? message.toString('utf8') : message;

            // Parse the message string into JSON
            const transcriptionData = JSON.parse(messageStr);

            if (transcriptionData && transcriptionData.channel && transcriptionData.channel.alternatives) {
                const transcription = transcriptionData.channel.alternatives[0].transcript;
                if (transcription) {
                    console.log("Transcription text >> ", transcription);
                }
            }
        } catch (error) {
            console.error("Error processing Deepgram response:", error);
        }
    });


    targetWs.on('error', (err) => {
        console.error('Error connecting to Deepgram WebSocket:', err);
        isDeepgramConnected = false;

        if (err.message.includes('401')) {
            console.error(`
Authentication Error: Please check your Deepgram API key:
1. Verify the key in your .env file
2. Ensure the key hasn't expired
3. Check if the key has the necessary permissions
            `);
        }

        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });

    targetWs.on('close', (code, reason) => {
        console.log(`Deepgram WebSocket closed with code ${code}${reason ? `: ${reason}` : ''}`);
        isDeepgramConnected = false;

        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });
});

// Handle server startup
console.log(`WebSocket server listening on ws://localhost:${CONFIG.PORT}`);

// Handle process termination
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Closing WebSocket server...');
    wss.close(() => {
        console.log('Server closed. Exiting...');
        process.exit(0);
    });
});