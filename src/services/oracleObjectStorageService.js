const { GetObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { httpError } = require("./httpError");

let client;

function getOracleClient() {
  if (client) return client;

  const region = process.env.ORACLE_REGION;
  const namespace = process.env.ORACLE_NAMESPACE;
  const accessKeyId = process.env.ORACLE_ACCESS_KEY;
  const secretAccessKey = process.env.ORACLE_SECRET_KEY;

  if (!region || !namespace || !accessKeyId || !secretAccessKey) {
    throw httpError(
      500,
      "Configuration Oracle Object Storage manquante.",
      "Variables ORACLE_REGION, ORACLE_NAMESPACE, ORACLE_ACCESS_KEY ou ORACLE_SECRET_KEY manquantes."
    );
  }

  client = new S3Client({
    region,
    endpoint: `https://${namespace}.compat.objectstorage.${region}.oraclecloud.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

async function readTextObject(storagePath) {
  const bucket = process.env.ORACLE_BUCKET_NAME;
  if (!bucket) {
    throw httpError(500, "Bucket Oracle Object Storage manquant.");
  }

  try {
    const response = await getOracleClient().send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: storagePath.replace(/^\/+/, ""),
      })
    );
    return streamToString(response.Body);
  } catch (error) {
    throw httpError(
      502,
      "Lecture des cours optimises impossible.",
      error.message
    );
  }
}

async function streamToString(stream) {
  if (!stream) return "";
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = { readTextObject };
