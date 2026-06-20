//
// Imports and setup
//
const express = require("express");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isNumberObject } = require("util/types");

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

const UPLOAD_DIR = path.join(__dirname, "storage/videos/");
const MAX_SIZE = 2048 * 1024 * 1024; // 2G max

const sebtoken = "seb";

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

function checkAuth(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (!token || token !== sebtoken) {
    return res.status(401).send("Unauthorized");
  }
  next();
}

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

// Backend API
//

app.get("/api/getvideo", (req, res, next) => {
  let id = req.query.id;
  if (videoExists(id, next)) {
    const videoPath = "storage/videos/mp4/" + id + ".mp4";
    res.sendFile(videoPath, { root: "." });
  }
});

app.get("/api/thumbnail", (req, res, next) => {
  let id = req.query.id;
  if (videoExists(id, next)) {
    const thumbPath = "storage/videos/thumbnails/" + id + ".png";
    if (fs.existsSync(thumbPath)) {
      res.sendFile(thumbPath, { root: "." });
    } else {
      res.sendFile("static/images/thumb.png", { root: "." });
    }
  }
});

app.get("/api/details", (req, res, next) => {
  let id = req.query.id;
  res.send(getVideoDetails(id));
});

app.post("/api/upload", checkAuth, (req, res) => {
  // Pull metadata from headers (and/or query params)
  const name = req.headers["x-video-name"];
  const description = req.headers["x-video-description"] || "";

  if (!name) {
    return res.status(400).send("Missing X-Video-Name header");
  }
  if (req.headers["content-type"] !== "video/mp4") {
    return res.status(415).send("Expected Content-Type: video/mp4");
  }

  let nextId = 1;
  while (true) {
    if (!videoExists(nextId, null)) break;
    nextId++;
  }
  const id = nextId;

  const filePath = path.join(UPLOAD_DIR, `/mp4/${id}.mp4`);
  const filePathMeta = path.join(UPLOAD_DIR, `/meta/${id}.json`);

  const writeStream = fs.createWriteStream(filePath);
  let bytesReceived = 0;
  let aborted = false;

  req.on("data", (chunk) => {
    bytesReceived += chunk.length;
    if (bytesReceived > MAX_SIZE && !aborted) {
      aborted = true;
      req.unpipe(writeStream);
      writeStream.destroy();
      fs.unlink(filePath, () => {});
      res.status(413).send("File too large");
      req.destroy();
    }
  });

  req.pipe(writeStream);

  writeStream.on("finish", () => {
    if (aborted) return;
    let metadata = {
      name: name,
      author: sebtoken,
      description: description,
      date: Date.now(),
      similar: [],
    };
    let jsonFile = JSON.stringify(metadata);
    fs.writeFile(filePathMeta, jsonFile, (err) => {
      if (err) return res.status(500).send("Failed to save metadata file!");
      res.status(200).json({
        message: "Upload received",
        name,
        description,
        size: bytesReceived,
      });
    });
  });

  writeStream.on("error", (err) => {
    if (!res.headersSent) res.status(500).send("Failed to save file");
  });

  req.on("error", (err) => {
    writeStream.destroy();
    fs.unlink(filePath, () => {});
    if (!res.headersSent) res.status(400).send("Upload error");
  });

  // Disconnect or end
  req.on("close", () => {
    if (!req.complete && !aborted) {
      aborted = true;
      writeStream.destroy();
      fs.unlink(filePath, () => {});
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

app.listen(port, () => {
  console.log(`Running on http://localhost:${port}`);
});
