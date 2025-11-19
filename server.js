const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const cors = require("cors");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });
const KRUTRIM_KEY = process.env.KRUTRIM_KEY || "SlMqiQXZQIuzSTWlZ_r9bi22SNgDXLh";  // Replace for now

app.post("/asr", upload.single("audio"), async (req, res) => {
    try {
        const inputPath = req.file.path;
        const wavPath = `${inputPath}.wav`;

        // Convert WebM → WAV (pcm_s16le, mono, 16kHz)
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

        // Read converted WAV
        const wavBuffer = fs.readFileSync(wavPath);
        const base64Audio = wavBuffer.toString("base64");

        console.log("WAV size:", wavBuffer.length);

        // --- CALL KRUTRIM ASR ---
        const response = await fetch(
            "https://cloud.olakrutrim.com/v1/models/shruti-hinglish-v2:predict",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${KRUTRIM_KEY}`
                },
                body: JSON.stringify({
                    model: "shruti-hinglish-v2",
                    instances: [
                        {
                            audioFile: base64Audio
                        }
                    ]
                })
            }
        );

        const rawText = await response.text();
        console.log("Krutrim raw:", rawText);

        if (!response.ok) {
            return res.status(500).json({
                error: "Krutrim API error",
                status: response.status,
                details: rawText
            });
        }

        let resultJson = {};
        try {
            resultJson = JSON.parse(rawText);
        } catch (err) {
            console.log("JSON parse error:", err);
            return res.status(500).json({ error: "Invalid JSON from Krutrim" });
        }

        console.log("Parsed JSON:", resultJson);

        const transcript =
            resultJson?.predictions?.[0]?.transcript ||
            resultJson?.text ||
            resultJson?.result ||
            "";

        res.json({ transcript });

        // Cleanup
        fs.unlinkSync(inputPath);
        fs.unlinkSync(wavPath);

    } catch (err) {
        console.error("ASR error:", err);
        res.status(500).json({ error: "ASR failed", details: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ASR server running on port ${PORT}`));
