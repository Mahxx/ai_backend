const path = require("path");
const multer = require("multer");

const allowedExtensions = new Set([".pdf", ".docx", ".txt"]);
const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || 10);

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: maxFileSizeMb * 1024 * 1024,
    files: Number(process.env.MAX_FILES || 10),
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(ext)) {
      return cb(new Error("Type de fichier non accepte. Formats autorises: PDF, DOCX, TXT."));
    }
    cb(null, true);
  },
});

module.exports = { upload };
