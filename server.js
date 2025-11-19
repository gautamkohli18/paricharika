const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const cors = require("cors");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();

// --- FIXED CORS CONFIG ---
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));

// Handle preflight requests for all routes
app.options("*", (req, res) => {
    res.sendStatus(200);
});

// --------------------------

const upload = multer({ dest: "uploads/" });
const KRUTRIM_KEY = process.env.KRUTRIM_KEY || "SlMqiQXZQIuzSTWlZ_r9bi22SNgDXLh";

// ASR endpoint
app.post("/asr", upload.single("audio"), async (req, res) => {
    try {
        const inputPath = req.file.path;
        const wavPath = `${inputPath}.wav`;

        // Convert WebM → WAV
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .format("wav")
                .audioCodec("pcm_s16le")
                .audioFrequency(16000)
                .audioChannels(1)
                .on("end", resolve)
                .on("error", reject)
                .save(wavPath);
        });

        const wavBuffer = fs.readFileSync(wavPath);
        const base64Audio = wavBuffer.toString("base64");

        // Call Krutrim ASR
        const response = await fetch(
            "https://cloud.olakrutrim.com/v1/models/shruti-hinglish-1-romanised:predict",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${KRUTRIM_KEY}`,
                },
                body: JSON.stringify({
                    model: "shruti-hinglish-1-romanised",
                    instances: [{ audioFile: base64Audio }],
                }),
            }
        );

        const rawText = await response.text();

        if (!response.ok) {
            return res.status(500).json({
                error: "Krutrim API error",
                status: response.status,
                details: rawText,
            });
        }

        let resultJson = {};
        try {
            resultJson = JSON.parse(rawText);
        } catch (err) {
            return res.status(500).json({ error: "Invalid JSON from Krutrim" });
        }

        const transcript =
            resultJson?.predictions?.[0]?.transcript ||
            resultJson?.text ||
            resultJson?.result ||
            "";

        res.json({ transcript });

        // Cleanup temp files
        fs.unlinkSync(inputPath);
        fs.unlinkSync(wavPath);

    } catch (err) {
        console.error("ASR error:", err);
        res.status(500).json({ error: "ASR failed", details: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ASR server running on port ${PORT}`));
