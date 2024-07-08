const express = require("express");
const axios = require("axios");
const xmlbuilder = require("xmlbuilder");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv").config();
const app = express();
const port = 3000;

let latestBuffer = null;

let latestImageTimestamp = null;

const authKey = process.env.TRAFIKVERKET_API_KEY;

app.get("/latest", (req, res) => {
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Last-Modified", latestImageTimestamp.toISOString());
  res.send(latestBuffer);
});

// Using updateLatestImage function
updateLatestImage().then(() => {
  app.listen(port, () => console.log(`Example app listening on port ${port}!`));
});

setInterval(async () => {
  await updateLatestImage();
}, 5 * 1000);

async function updateLatestImage() {
  const xml = xmlbuilder
    .create("REQUEST")
    .ele("LOGIN", { authenticationkey: authKey })
    .up()
    .ele("QUERY", { objecttype: "Camera", schemaversion: "1", limit: "10" })
    .ele("FILTER")
    .ele("EQ", { name: "Name", value: "Örgrytemotet Södra norrut" })
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

  const image = json.RESPONSE.RESULT[0].Camera[0].PhotoUrl + "?type=fullsize";

  // const newDate = new Date(json.RESPONSE.RESULT[0].Camera[0].PhotoTime) - 60000;

  const newDate = subtractMinutes(
    new Date(json.RESPONSE.RESULT[0].Camera[0].PhotoTime),
    1
  );

  if (
    latestImageTimestamp &&
    latestImageTimestamp.getTime() == newDate.getTime()
  ) {
    console.log("No new image found, date same \n");
    return false;
  }

  const response = await axios({
    method: "get",
    url: image,
    responseType: "arraybuffer",
  });

  const newBuffer = response.data;

  if (latestBuffer && Buffer.compare(latestBuffer, newBuffer) === 0) {
    console.log("No new image found, buffer same \n");
    return false;
  }

  // Parse the timestamp to a Date object and subtract 1 minute
  latestImageTimestamp = subtractMinutes(
    new Date(json.RESPONSE.RESULT[0].Camera[0].PhotoTime),
    1
  );

  console.log("New image found \n");

  latestBuffer = response.data;

  await saveImage(newBuffer, latestImageTimestamp);
  return true;
}

function subtractMinutes(date, minutes) {
  return new Date(date.getTime() - minutes * 60000);
}

// Dummy function to save the image to the disk, will be replaced by S3
async function saveImage(buffer, timestamp) {
  const dir = "./photos";
  // Create directory if it does not exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Replace invalid characters in the timestamp
  const safeTimestamp = timestamp.toISOString().replace(/[:]/g, "-");
  const filename = path.join(dir, `${safeTimestamp}.jpg`);

  fs.writeFileSync(filename, buffer);
}
