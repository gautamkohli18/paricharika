const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const cors = require("cors");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());  // <-- ENABLE THIS

const upload = multer({ dest: "uploads/" });


const KRUTRIM_KEY = "SlMqiQXZQIuzSTWlZ_r9bi22SNgDXLh"; // change this

app.post("/asr", upload.single("audio"), async (req, res) => {
    try {
        const inputPath = req.file.path;
        const wavPath = `${inputPath}.wav`;

        // Convert WebM → WAV
       await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
        .format("wav")
        .audioCodec("pcm_s16le")   // <--- MUST HAVE (16-bit PCM)
        .audioFrequency(16000)     // <--- MUST HAVE (16kHz)
        .audioChannels(1)          // <--- MUST HAVE (mono)
        .on("end", resolve)
        .on("error", reject)
        .save(wavPath);
});


        const wavBuffer = fs.readFileSync(wavPath);
        const base64Audio = wavBuffer.toString("base64");

        // Krutrim ASR call
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
                    audio: {
                        data: base64Audio,
                        encoding: "wav"
                    }
                })
            }
        );

        const result = await response.json();

        console.log("ASR response:", result);

        const transcript =
            result?.predictions?.[0]?.transcript ||
            result?.text ||
            result?.result ||
            "";

        res.json({ transcript });

        fs.unlinkSync(inputPath);
        fs.unlinkSync(wavPath);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "ASR failed" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ASR server running on port ${PORT}`));
