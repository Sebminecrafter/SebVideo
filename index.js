//
// Imports and setup
//
// This file implements a small video server using Express.
// It accepts uploads then converts and stores video files.
// Thumbnails are processed and stored for quick serving.
const express = require("express");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isNumberObject } = require("util/types");
const ffmpeg = require("fluent-ffmpeg");
const { execSync } = require("child_process");
const sharp = require("sharp");

const app = express();
app.engine("ejs", ejs.renderFile);
app.use("/static", express.static("static"));

//
// Options
//

const port = 80;
function defaultDetails(id) {
  return {
    name: `Video ${id}`,
    author: "Unknown",
    description: "",
    similar: [],
    src: "/api/getvideo?id=" + id,
    thumb: "/static/images/thumb.png",
    similar: [],
  };
}

// Return a minimal details object for a video id
// This is used when no metadata file is present for the id

const MAX_SIZE = 8192 * 1024 * 1024; // 8G max

// Max allowed upload bytes for video files

const sebtoken = "seb";

// Simple static token used to protect upload endpoints

//
// Functions
//

function videoExists(id, next) {
  if (next == null) {
    next = function (err) {};
  }
  id = Number(id);
  if (!Number.isNaN(id) && Number.isSafeInteger(id)) {
    let path = "storage/videos/meta/" + id + ".json";
    if (fs.existsSync(path)) {
      return true;
    } else {
      const err = new Error("Not Found");
      err.code = 404;
      next(err);
      return false;
    }
  } else {
    const err = new Error("Bad Request");
    err.code = 400;
    next(err);
    return false;
  }
}

// Validate that the given id is a number and that meta file exists
// If the id is invalid or missing return false and call next with an error

function getVideoDetails(id) {
  if (videoExists(id, null)) {
    details = fs.readFileSync("storage/videos/meta/" + id + ".json", {
      encoding: "utf-8",
    });
    let parsed = JSON.parse(details);
    parsed.id = id;
    return parsed;
  }
  return defaultDetails(id);
}

// Read and return the metadata for a video id
// If there is no metadata the default details are returned

function checkAuth(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (!token || token !== sebtoken) {
    return res.status(401).send("Unauthorized");
  }
  next();
}

// Simple authorization middleware for admin style endpoints
// It checks for a bearer token that matches the static token above

function findNextAvailableId(currentId) {
  const metaPath = path.join(
    __dirname,
    `storage/videos/meta/${currentId}.json`,
  );
  const videoPath = path.join(__dirname, `storage/videos/mp4/${currentId}.mp4`);
  if (fs.existsSync(metaPath) || fs.existsSync(videoPath)) {
    return findNextAvailableId(currentId + 1);
  }
  return currentId;
}

// Find the next free numeric id where no meta or video file exists
// This is a simple sequential allocator starting from the given id

let conversionQueue = [];
let activeConversions = 0;
const MAX_CONCURRENT = 3;

// Detect the best available hardware encoder supported by ffmpeg (if any)
function detectHardwareEncoder() {
  try {
    const encoders = execSync("ffmpeg -hide_banner -encoders", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });

    let gpuVendor = null;
    try {
      const gpuInfo = execSync(
        process.platform === "win32"
          ? "wmic path win32_VideoController get name 2>nul"
          : "lspci 2>/dev/null | grep -iE 'vga|3d|display' || true",
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 10000,
        },
      );
      const normalizedGpu = gpuInfo.toLowerCase();
      if (
        normalizedGpu.includes("nvidia") ||
        normalizedGpu.includes("geforce") ||
        normalizedGpu.includes("quadro")
      ) {
        gpuVendor = "nvidia";
      } else if (
        normalizedGpu.includes("amd") ||
        normalizedGpu.includes("radeon") ||
        normalizedGpu.includes("vega")
      ) {
        gpuVendor = "amd";
      } else if (normalizedGpu.includes("intel")) {
        gpuVendor = "intel";
      }
    } catch (e) {
      // Fall back to encoder availability when GPU probing is unavailable
    }

    // Prefer AMD/Windows AMF before NVENC to avoid choosing NVIDIA-only encoders
    // on AMD systems that do not support them.
    if (encoders.includes("h264_amf") && (gpuVendor === "amd" || process.platform === "win32")) {
      return { codec: "h264_amf", hwaccel: "dxva2" };
    }
    if (encoders.includes("h264_qsv") && (gpuVendor === "intel" || process.platform === "win32")) {
      return { codec: "h264_qsv", hwaccel: "qsv" };
    }
    if (encoders.includes("h264_vaapi")) {
      return { codec: "h264_vaapi", hwaccel: "vaapi" };
    }
    if (
      (encoders.includes("h264_nvenc") || encoders.includes("hevc_nvenc")) &&
      gpuVendor === "nvidia"
    ) {
      return {
        codec: encoders.includes("h264_nvenc") ? "h264_nvenc" : "hevc_nvenc",
        hwaccel: "cuda",
      };
    }

    if (encoders.includes("h264_amf")) {
      return { codec: "h264_amf", hwaccel: "dxva2" };
    }
    if (encoders.includes("h264_qsv")) {
      return { codec: "h264_qsv", hwaccel: "qsv" };
    }
    if (encoders.includes("h264_nvenc") || encoders.includes("hevc_nvenc")) {
      return {
        codec: encoders.includes("h264_nvenc") ? "h264_nvenc" : "hevc_nvenc",
        hwaccel: "cuda",
      };
    }
  } catch (e) {
    // If ffmpeg isn't available in PATH or command fails, fall back to software
  }
  return { codec: "libx264", hwaccel: null };
}

// Probe ffmpeg to find a good hardware encoder option when available
// If none are found the software encoder is used

const ffmpegHardware = detectHardwareEncoder();
console.log("[FFmpeg] selected encoder:", ffmpegHardware.codec);

function processConversionQueue() {
  if (activeConversions >= MAX_CONCURRENT || conversionQueue.length === 0)
    return;

  activeConversions++;
  const { id, inputPath, outputPath, metaPath, name, description } =
    conversionQueue.shift();

  ffmpeg(inputPath)
    // add hardware accel option where applicable before the input
    .inputOptions(
      ffmpegHardware.hwaccel ? ["-hwaccel", ffmpegHardware.hwaccel] : [],
    )
    // choose output options based on detected hardware encoder
    .outputOptions(
      (() => {
        const enc = ffmpegHardware.codec;
        if (enc === "libx264") {
          return ["-c:v libx264", "-b:v 2500k", "-c:a aac", "-b:a 128k"];
        }
        if (enc === "h264_nvenc" || enc === "hevc_nvenc") {
          return [
            `-c:v ${enc}`,
            "-b:v 2500k",
            "-c:a aac",
            "-b:a 128k",
            "-preset p1",
          ];
        }
        if (enc === "h264_qsv") {
          return ["-c:v h264_qsv", "-b:v 2500k", "-c:a aac", "-b:a 128k"];
        }
        if (enc === "h264_vaapi") {
          return ["-c:v h264_vaapi", "-b:v 2500k", "-c:a aac", "-b:a 128k"];
        }
        if (enc === "h264_amf") {
          return ["-c:v h264_amf", "-b:v 2500k", "-c:a aac", "-b:a 128k"];
        }
        return ["-c:v libx264", "-b:v 2500k", "-c:a aac", "-b:a 128k"];
      })(),
    )
    .output(outputPath)
    .on("end", () => {
      fs.unlink(inputPath, () => {});
      const metadata = {
        name,
        author: sebtoken,
        description,
        date: Date.now(),
        similar: [],
        processing: false,
      };
      fs.writeFileSync(metaPath, JSON.stringify(metadata));
      console.log(`[Video ${id}] Conversion complete`);
      activeConversions--;
      processConversionQueue();
    })
    .on("error", (err) => {
      console.error(`[Video ${id}] Conversion error:`, err.message);
      fs.unlink(inputPath, () => {});
      activeConversions--;
      processConversionQueue();
    })
    .run();
}

// Process queued video files and convert them to mp4 using ffmpeg
// This function respects a limit on concurrent conversions

function queueVideoConversion(
  id,
  inputPath,
  outputPath,
  metaPath,
  name,
  description,
) {
  conversionQueue.push({
    id,
    inputPath,
    outputPath,
    metaPath,
    name,
    description,
  });
  processConversionQueue();
}

// Add a conversion job to the queue and trigger processing

function processThumbnailQueue() {
  if (thumbnailQueue.length === 0) return;
  const { id, inputPath, outputPath } = thumbnailQueue.shift();

  sharp(inputPath)
    .resize(1280, 720, { fit: "cover" })
    .jpeg({ quality: 80 })
    .toFile(outputPath)
    .then(() => {
      fs.unlink(inputPath, () => {});
      console.log(`[Thumbnail ${id}] Processing complete`);
      processThumbnailQueue();
    })
    .catch((err) => {
      console.error(`[Thumbnail ${id}] Processing error:`, err.message);
      fs.unlink(inputPath, () => {});
      processThumbnailQueue();
    });
}

// Resize and encode an uploaded image to a fixed thumbnail size
// Errors are logged and processing continues with remaining items

let thumbnailQueue = [];

function queueThumbnailProcessing(id, inputPath, outputPath) {
  thumbnailQueue.push({ id, inputPath, outputPath });
  processThumbnailQueue();
}

// Queue a thumbnail job then start processing if the queue is idle

//
// Routes
//

// Frontend pages
//

app.get("/", (req, res, next) => {
  let videos = [];
  let i = 1;
  while (true) {
    if (!videoExists(i, null)) break;
    let details = getVideoDetails(i);
    details.id = i;
    videos.push(details);
    i++;
  }
  res.render("home.ejs", { videos });
});

// Render the home page with all available videos

app.get("/watch", (req, res, next) => {
  let id = req.query.v;
  if (videoExists(id, next)) {
    const details = getVideoDetails(id);
    similar = details.similar;
    let recommended = [];
    for (let i = 0; i < similar.length; i++) {
      let details = getVideoDetails(similar[i]);
      details.id = similar[i];
      recommended.push(details);
    }
    res.render("video.ejs", { details, recommended });
  }
});

// Watch page for a single video with simple recommendations

app.get("/upload", (req, res) => {
  res.render("upload.ejs");
});

// Upload page form for manual uploads via browser

// Backend API
//

app.get("/api/getvideo", (req, res, next) => {
  let id = req.query.id;
  if (videoExists(id, next)) {
    const videoPath = "storage/videos/mp4/" + id + ".mp4";
    res.sendFile(videoPath, { root: "." });
  }
});

// Serve the converted mp4 file for a given id

app.get("/api/thumbnail", (req, res, next) => {
  let id = req.query.id;
  if (videoExists(id, next)) {
    const thumbPath = "storage/videos/thumbnails/" + id + ".jpg";
    if (fs.existsSync(thumbPath)) {
      res.sendFile(thumbPath, { root: "." });
    } else {
      res.sendFile("static/images/thumb.png", { root: "." });
    }
  }
});

// Serve a thumbnail image or a default placeholder if none exists

app.get("/api/details", (req, res, next) => {
  let id = req.query.id;
  res.send(getVideoDetails(id));
});

// Return JSON metadata for a given video id

app.post("/api/upload", checkAuth, (req, res) => {
  let name, description;

  try {
    const rawName = req.headers["x-video-name"];
    name = rawName ? decodeURIComponent(rawName) : rawName;
    description = decodeURIComponent(req.headers["x-video-description"] || "");
  } catch (e) {
    return res
      .status(400)
      .send("Invalid X-Video-Name or X-Video-Description header");
  }

  if (!name) {
    return res.status(400).send("Missing X-Video-Name header");
  }

  const id = findNextAvailableId(1);

  const contentType = req.headers["content-type"] || "";
  let extension = "mp4";
  if (contentType.includes("webm")) extension = "webm";
  else if (contentType.includes("video/quicktime")) extension = "mov";
  else if (contentType.includes("video/x-msvideo")) extension = "avi";
  else if (contentType.includes("video/mpeg")) extension = "mpeg";
  else if (contentType.includes("matroska")) extension = "mkv";

  const uploadPath = path.join(
    __dirname,
    `storage/uploads/videos/${id}.${extension}`,
  );
  const outputPath = path.join(__dirname, `storage/videos/mp4/${id}.mp4`);
  const metaPath = path.join(__dirname, `storage/videos/meta/${id}.json`);

  const writeStream = fs.createWriteStream(uploadPath);
  let bytesReceived = 0;
  let aborted = false;

  function rejectUpload(status, message) {
    if (aborted) return;
    aborted = true;
    writeStream.destroy();
    fs.unlink(uploadPath, () => {});
    if (!res.headersSent) res.status(status).send(message);
    req.destroy();
  }

  req.on("data", (chunk) => {
    if (aborted) return;

    bytesReceived += chunk.length;
    if (bytesReceived > MAX_SIZE) {
      rejectUpload(413, "File too large");
      return;
    }

    if (!writeStream.write(chunk)) {
      req.pause();
      writeStream.once("drain", () => req.resume());
    }
  });

  req.on("end", () => {
    if (aborted) return;
    writeStream.end();
  });

  writeStream.on("finish", () => {
    if (aborted) return;
    const metadata = {
      name,
      author: sebtoken,
      description,
      date: Date.now(),
      similar: [],
      processing: true,
    };
    fs.writeFileSync(metaPath, JSON.stringify(metadata));
    queueVideoConversion(
      id,
      uploadPath,
      outputPath,
      metaPath,
      name,
      description,
    );
    res.status(202).json({
      message: "Video uploaded, conversion in progress",
      id,
      name,
      description,
      size: bytesReceived,
    });
  });

  // Handle a raw upload stream from the client
  // The upload is saved to a temporary file then queued for conversion

  writeStream.on("error", (err) => {
    if (!res.headersSent) res.status(500).send("Failed to save file");
  });

  req.on("error", (err) => {
    writeStream.destroy();
    fs.unlink(uploadPath, () => {});
    if (!res.headersSent) res.status(400).send("Upload error");
  });

  req.on("close", () => {
    if (!req.complete && !aborted) {
      aborted = true;
      writeStream.destroy();
      fs.unlink(uploadPath, () => {});
    }
  });
});

app.post("/api/upload-thumbnail", checkAuth, (req, res) => {
  const videoId = req.headers["x-video-id"];
  if (!videoId) {
    return res.status(400).send("Missing X-Video-Id header");
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("image/")) {
    return res.status(415).send("Expected Content-Type: image/*");
  }

  const uploadPath = path.join(
    __dirname,
    `storage/uploads/thumbnails/${videoId}.tmp`,
  );
  const outputPath = path.join(
    __dirname,
    `storage/videos/thumbnails/${videoId}.jpg`,
  );

  const writeStream = fs.createWriteStream(uploadPath);
  let bytesReceived = 0;
  let aborted = false;

  function rejectUpload(status, message) {
    if (aborted) return;
    aborted = true;
    writeStream.destroy();
    fs.unlink(uploadPath, () => {});
    if (!res.headersSent) res.status(status).send(message);
    req.destroy();
  }

  req.on("data", (chunk) => {
    if (aborted) return;

    bytesReceived += chunk.length;
    if (bytesReceived > 50 * 1024 * 1024) {
      rejectUpload(413, "Thumbnail file too large");
      return;
    }

    if (!writeStream.write(chunk)) {
      req.pause();
      writeStream.once("drain", () => req.resume());
    }
  });

  req.on("end", () => {
    if (aborted) return;
    writeStream.end();
  });

  writeStream.on("finish", () => {
    if (aborted) return;
    queueThumbnailProcessing(videoId, uploadPath, outputPath);
    res.status(202).json({
      message: "Thumbnail uploaded, processing in progress",
      videoId,
    });
  });

  writeStream.on("error", (err) => {
    if (!res.headersSent) res.status(500).send("Failed to save file");
  });

  req.on("error", (err) => {
    writeStream.destroy();
    fs.unlink(uploadPath, () => {});
    if (!res.headersSent) res.status(400).send("Upload error");
  });

  req.on("close", () => {
    if (!req.complete && !aborted) {
      aborted = true;
      writeStream.destroy();
      fs.unlink(uploadPath, () => {});
    }
  });
});

//
// Handling
//

// Unmatched routes (404)
app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.code = 404;
  next(err);
});

// Error handler (must be last)
app.use((err, req, res, next) => {
  let code = err.code || 500;
  const msg = err.message || "Internal Server Error";
  if (!(code >= 400 && code < 500)) console.error(err.stack); // Console error only if it's not user-error
  res.status(code).render("error.ejs", {
    code: code,
    msg: msg,
  });
});

//
// Execution
//

const requiredDirs = [
  "storage/uploads/videos",
  "storage/uploads/thumbnails",
  "storage/videos/mp4",
  "storage/videos/meta",
  "storage/videos/thumbnails",
  "storage/channels/meta",
];

function emptyDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  for (const file of fs.readdirSync(directory)) {
    const filePath = path.join(directory, file);
    try {
      fs.rmSync(filePath, { force: true, recursive: true });
    } catch (err) {
      console.error(`Failed to remove ${filePath}:`, err.message);
    }
  }
}

requiredDirs.forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

emptyDirectory(path.join(__dirname, "storage/uploads/videos"));
emptyDirectory(path.join(__dirname, "storage/uploads/thumbnails"));

app.listen(port, () => {
  console.log(`Running on http://localhost:${port}`);
});
