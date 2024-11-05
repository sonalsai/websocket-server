require('dotenv').config();
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
const Buffer = require('buffer').Buffer;

// Configuration constants
const CONFIG = {
    PORT: 8080,
    SAMPLE_RATE: 8000,
    ENCODING: 'mulaw',  // Changed to mulaw for Twilio's PCMU format
    CHANNELS: 1
};

// Initialize Deepgram SDK
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// WebSocket server to handle PCM audio stream from Twilio
const wss = new WebSocket.Server({ port: CONFIG.PORT });

wss.on('connection', (ws) => {
    console.log('Received connection from Twilio');

    // Set up a WebSocket connection to Deepgram's streaming API
    const targetWs = deepgram.transcription.live({
        encoding: CONFIG.ENCODING,
        sample_rate: CONFIG.SAMPLE_RATE,
        channels: CONFIG.CHANNELS,
        model: 'nova-2',
        language: 'en-IN',
        smart_format: true,
    });

    targetWs.on('open', () => {
        console.log('Connected to Deepgram WebSocket for transcription');
    });

    // Handle incoming PCMU data from Twilio
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            console.log("PCMU DATA >>> ", data);

            // Only process media events with payload
            if (data.event === 'media' && data.media?.payload) {
                // Decode base64-encoded PCMU payload
                const pcmuBuffer = Buffer.from(data.media.payload, 'base64');

                // Send PCM data to Deepgram if connection is open
                if (targetWs.readyState === WebSocket.OPEN) {
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
    targetWs.on('transcriptReceived', (transcriptionData) => {
        try {
            const alternatives = transcriptionData.channel.alternatives;
            if (alternatives && alternatives.length > 0) {
                const transcription = alternatives[0].transcript;
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
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });

    targetWs.on('close', (code, reason) => {
        console.log(`Deepgram WebSocket closed with code ${code}${reason ? `: ${reason}` : ''}`);
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
