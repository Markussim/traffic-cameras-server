# Traffic Camera Image Saver 📸

This Node.js application retrieves the latest camera images from the Trafikverket API and saves them to an AWS S3 bucket.

## Features ✨

- Fetches images from a specified traffic camera every 5 seconds.
- Saves the images to an AWS S3 bucket.
- Provides the latest image through an HTTP endpoint.

## Prerequisites 📋

Ensure you have the following tools installed:

- Node.js
- npm

## Installation ⬇️

1. Clone the repository
   ```sh
   git clone https://github.com/yourusername/traffic-camera-image-saver.git
   ```
2. Navigate to the project directory
   ```sh
   cd traffic-camera-image-saver
   ```
3. Install the required dependencies

   ```sh
   npm install
   ```

4. Create a `.env` file in the root directory and specify the required environment variables:

   ```
   AWS_ACCESS_KEY_ID=your_aws_access_key_id
   AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
   TRAFIKVERKET_API_KEY=your_trafikverket_api_key
   ```

## Usage 🚀

1. Start the application

   ```sh
   node index.js
   ```

2. Access the latest image at:
   ```
   http://localhost:3000/latest
   ```

## Code Overview 🧩

### Dependencies 📦

- `express`: Web framework for Node.js.
- `axios`: Promise based HTTP client.
- `xmlbuilder`: XML builder for Node.js.
- `fs`: File system module.
- `path`: Utilities for working with file and directory paths.
- `dotenv`: Loads environment variables from a `.env` file.
- `aws-sdk`: AWS SDK for JavaScript.

### Main Functions 🛠️

- **updateLatestImage()**: Fetches the latest image data from the Trafikverket API, parses it, and checks for updates.
- **subtractMinutes(date, minutes)**: Helper function to subtract minutes from a Date object.
- **saveImageToDisk(buffer, timestamp, cameraId)**: Deprecated function to save images to the local disk.
- **saveImageToS3(buffer, timestamp, cameraId)**: Uploads images to an AWS S3 bucket.

### Endpoint 🏷️

- `GET /latest`: Returns the latest fetched image.

## AWS S3 Bucket Structure 🗄️

Uploaded images are stored in the S3 bucket in the following structure:

```
photos/
   └─ <cameraId>/
      └─ <YYYY-MM-DD>/
         └─ <HH-MM-SS>.jpg
```

## License 📝

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

# Warning ⚠️

Please don't fetch the url for the image of a traffic camera that this server fetches. This causes trafikverkets cache to break and some images will be skipped.
