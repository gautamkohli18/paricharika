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
const KRUTRIM_KEY = process.env.KRUTRIM_KEY || "SlMqiQXZQIuzSTWlZ_r9bi22SNgDXLh";

// ------------------------
//  ASR ENDPOINT
// ------------------------
app.post("/asr", upload.single("audio"), async (req, res) => {
    try {
        const inputPath = req.file.path;
        const wavPath = `${inputPath}.wav`;

        // --- Convert WebM → WAV with silence removal ---
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .format("wav")
                .audioCodec("pcm_s16le")
                .audioFrequency(16000)
                .audioChannels(1)
                .audioFilters("silenceremove=1:0:-50dB")  // trim silence
                .on("end", resolve)
                .on("error", reject)
                .save(wavPath);
        });

        const wavBuffer = fs.readFileSync(wavPath);
        const base64Audio = wavBuffer.toString("base64");

        // Skip too-small recordings (< 0.2s)
        if (wavBuffer.length < 5000) {
            console.log("Short/empty audio → skipping ASR");
            return res.json({ transcript: "" });
        }

        // ---- CALL KRUTRIM ASR ----
        const response = await fetch(
            "https://cloud.olakrutrim.com/v1/models/shruti-hinglish-1-romanised:predict",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${KRUTRIM_KEY}`
                },
                body: JSON.stringify({
                    model: "shruti-hinglish-1-romanised",
                    instances: [
                        { audioFile: base64Audio }
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

        let json;
        try {
            json = JSON.parse(rawText);
        } catch (err) {
            return res.status(500).json({ error: "Invalid JSON from Krutrim" });
        }

        const transcript =
            json?.predictions?.[0]?.transcript ||
            json?.text ||
            json?.result ||
            "";

        fs.unlinkSync(inputPath);
        fs.unlinkSync(wavPath);

        res.json({ transcript });

    } catch (err) {
        console.error("ASR error:", err);
        res.status(500).json({ error: "ASR failed", details: err.message });
    }
});

// ------------------------
//  SERVER START
// ------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ASR server running on port ${PORT}`));
