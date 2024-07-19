const express = require("express");
const axios = require("axios");
const xmlbuilder = require("xmlbuilder");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv").config({ override: true });
const AWS = require("aws-sdk");
const app = express();
const port = 3000;

// Setup logging
const originalLog = console.log;
const originalError = console.error;

function getFormattedDateTime() {
  const now = new Date();
  return now.toISOString();
}

console.log = function (...args) {
  originalLog(`[${getFormattedDateTime()}]`, ...args);
};
console.error = function (...args) {
  originalError(`[${getFormattedDateTime()}]`, ...args);
};

// Set up AWS S3
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "eu-north-1",
});

const s3 = new AWS.S3();

const imageBufferMap = new Map();

const authKey = process.env.TRAFIKVERKET_API_KEY;

// const CONFIG_CACHE_TIME = 10 * 60 * 1000; // 10 Minutes
const CONFIG_CACHE_TIME = 1 * 60 * 1000; // 1 Minute
let last_cache_timestamp;
let config;

async function getConfigFromS3() {
  const now = new Date();

  if (
    config &&
    last_cache_timestamp &&
    now - last_cache_timestamp < CONFIG_CACHE_TIME
  ) {
    console.log("Cached config is new enough. Getting from cache.");
    return config;
  }

  const params = {
    Bucket: "traffic-cameras-archive",
    Key: "config.json",
  };

  return new Promise((resolve, reject) => {
    s3.getObject(params, function (err, data) {
      if (err) {
        console.error("Error getting config from S3. Error:", err);
        reject(err);
      }

      if (data) {
        console.log("Config was too old. Retrieved from S3.");
        config = JSON.parse(data.Body.toString());
        last_cache_timestamp = new Date();

        resolve(config);
      }
    });
  });
}

app.get("/:cameraId/latest", (req, res) => {
  const imageBuffer = imageBufferMap.get(req?.params?.cameraId);
  if (!imageBuffer) {
    res.status(404).send("Camera not found.");
    return;
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader(
    "Last-Modified",
    imageBuffer.latestImageTimestamp.toISOString()
  );
  res.send(imageBuffer.latestBuffer);
});

app.get("/search", async (req, res) => {
  const search = req.query.search;

  if (!search) {
    res.status(400).send("No search query provided.");
  }

  const cameras = await searchCamera(search);
  if (!cameras || !cameras.length) {
    res.status(404).send("No cameras found.");
    return;
  }

  res.json(cameras);
});

app.use(express.static("public"));

(async () => {
  const camerasToFetch = await getConfigFromS3();
  if (!camerasToFetch) {
    console.error("Failed to retrieve config on boot. Exiting...");
    process.exit(1);
  }

  const imagePromises = camerasToFetch.map((camera) =>
    updateLatestImage(camera)
  );

  Promise.all(imagePromises).then(() => {
    app.listen(port, () =>
      console.log(`Traffic Camera Server listening on port ${port}!`)
    );
  });
})();

setInterval(async () => {
  const camerasToFetch = await getConfigFromS3();

  const imagePromises = camerasToFetch.map((camera) =>
    updateLatestImage(camera)
  );

  await Promise.all(imagePromises);
}, 5 * 1000);

async function searchCamera(name) {
  const xml = xmlbuilder
    .create("REQUEST")
    .ele("LOGIN", { authenticationkey: authKey })
    .up()
    .ele("QUERY", { objecttype: "Camera", schemaversion: "1", limit: "10" })
    .ele("FILTER")
    .ele("EQ", { name: "Name", value: name })
    .up()
    .up()
    .up()
    .end({ pretty: true });

  const xmlString = xml.toString();

  const trafikverketResponse = await axios({
    method: "post",
    url: "https://api.trafikinfo.trafikverket.se/v2/data.json",
    data: xmlString,
    headers: {
      "Content-Type": "application/xml",
    },
  });

  const json = trafikverketResponse.data;

  if (!json?.RESPONSE?.RESULT?.[0]?.Camera?.[0]) {
    console.log(`Invalid camera name. Camera name: ${name}`);
    return;
  }

  const cameras = json?.RESPONSE?.RESULT?.[0]?.Camera?.map((camera) => ({
    id: camera.Id,
    name: camera.Name,
    location: camera.Location,
    description: camera.Description,
    imageUrl: camera.PhotoUrl + "?type=fullsize",
  }));

  return cameras;
}

async function updateLatestImage(id) {
  const xml = xmlbuilder
    .create("REQUEST")
    .ele("LOGIN", { authenticationkey: authKey })
    .up()
    .ele("QUERY", { objecttype: "Camera", schemaversion: "1", limit: "10" })
    .ele("FILTER")
    .ele("EQ", { name: "Id", value: id })
    .up()
    .up()
    .up()
    .end({ pretty: true });

  const xmlString = xml.toString();

  const trafikverketResponse = await axios({
    method: "post",
    url: "https://api.trafikinfo.trafikverket.se/v2/data.json",
    data: xmlString,
    headers: {
      "Content-Type": "application/xml",
    },
  });

  const json = trafikverketResponse.data;

  if (!json?.RESPONSE?.RESULT?.[0]?.Camera?.[0]) {
    console.log(`Invalid camera id. Camera id: ${id}`);
    return;
  }

  const image = json.RESPONSE.RESULT[0].Camera[0].PhotoUrl + "?type=fullsize";

  const cameraId = json.RESPONSE.RESULT[0].Camera[0].Id;

  const newDate = subtractMinutes(
    new Date(json.RESPONSE.RESULT[0].Camera[0].PhotoTime),
    1
  );

  const imageBuffer = imageBufferMap.get(id);

  if (
    imageBuffer?.latestImageTimestamp &&
    imageBuffer.latestImageTimestamp.getTime() == newDate.getTime()
  ) {
    console.log(
      `No new image found for camera with id ${id}. Date was identical.`
    );
    return false;
  }

  const response = await axios({
    method: "get",
    url: image,
    responseType: "arraybuffer",
  });

  const newBuffer = response.data;

  if (
    imageBuffer?.latestBuffer &&
    Buffer.compare(imageBuffer.latestBuffer, newBuffer) === 0
  ) {
    console.log(
      `No new image found for camera with id ${id}. Buffer was identical.`
    );
    return false;
  }

  // Parse the timestamp to a Date object and subtract 1 minute
  const latestImageTimestamp = subtractMinutes(
    new Date(json.RESPONSE.RESULT[0].Camera[0].PhotoTime),
    1
  );

  console.log(`New image found for camera with ${id}.`);

  const latestBuffer = response.data;

  imageBufferMap.set(id, {
    latestImageTimestamp,
    latestBuffer,
  });

  await saveImageToS3(newBuffer, latestImageTimestamp, cameraId);
  return true;
}

function subtractMinutes(date, minutes) {
  return new Date(date.getTime() - minutes * 60000);
}

// Deprecated function
async function saveImageToDisk(buffer, timestamp, cameraId) {
  const dir =
    "./photos/" + cameraId + "/" + timestamp.toISOString().split("T")[0];
  // Create directory if it does not exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Replace invalid characters in the timestamp
  const safeTimestamp = timestamp.toISOString().replace(/[:]/g, "-");
  const filename = path.join(dir, `${safeTimestamp}.jpg`);

  fs.writeFileSync(filename, buffer);
}

async function saveImageToS3(buffer, timestamp, cameraId) {
  const dir =
    "photos/" + cameraId + "/" + timestamp.toISOString().split("T")[0];
  const safeTimestamp = timestamp.toISOString().replace(/[:]/g, "-");
  const filename = `${safeTimestamp}.jpg`;

  const params = {
    Bucket: "traffic-cameras-archive",
    Key: `${dir}/${filename}`,
    Body: buffer,
    ContentType: "image/jpeg",
  };

  s3.upload(params, function (err, data) {
    if (err) {
      console.error(
        `Something went wrong when uploading image for camera with id ${cameraId}. Error: `,
        err
      );
    }

    if (data) {
      console.log(`Successfully uploaded image for camera with id ${cameraId}`);
    }
  });
}
