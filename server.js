const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Multer config — store file in memory (no disk persistence needed)
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') {
      return cb(new Error('Only CSV files are allowed.'));
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Serve static frontend from /public
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Cleaning helpers
// ---------------------------------------------------------------------------

/** Trim all string values in a row object. */
function trimRow(row) {
  const trimmed = {};
  for (const key of Object.keys(row)) {
    const cleanKey = key.trim();
    trimmed[cleanKey] = typeof row[key] === 'string' ? row[key].trim() : row[key];
  }
  return trimmed;
}

/** Convert a name string to Title Case. */
function toTitleCase(str) {
  if (!str) return str;
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Validate an email address format. */
function isValidEmail(email) {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Normalize a phone number.
 * - Strips spaces, dashes, parentheses.
 * - If it starts with "0", assumes Nigerian number and replaces leading 0 with +234.
 * - If it already starts with "+", leaves it as-is.
 * - Otherwise prepends "+" if it looks international.
 */
function normalizePhone(phone) {
  if (!phone) return phone;

  // Strip common formatting characters
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');

  // Nigerian local number → international
  if (cleaned.startsWith('0')) {
    cleaned = '+234' + cleaned.slice(1);
  } else if (!cleaned.startsWith('+')) {
    // If it's a raw international number without +, add it
    cleaned = '+' + cleaned;
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// POST /api/upload — accept CSV, clean, return JSON
// ---------------------------------------------------------------------------
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please upload a CSV file.' });
    }

    const csvString = req.file.buffer.toString('utf-8');

    // Parse CSV
    const { data, errors } = Papa.parse(csvString, {
      header: true,
      skipEmptyLines: true,
    });

    if (errors.length > 0 && data.length === 0) {
      return res.status(400).json({ error: 'Failed to parse CSV. Please check the file format.' });
    }

    const totalRows = data.length;
    let duplicatesRemoved = 0;
    let invalidEmails = 0;
    let missingFields = 0;

    // 1. Trim & normalize each row
    const cleaned = data.map((row) => {
      const trimmed = trimRow(row);

      // Normalize name capitalization
      if (trimmed.Name) {
        trimmed.Name = toTitleCase(trimmed.Name);
      }

      // Normalize company capitalization
      if (trimmed.Company) {
        trimmed.Company = toTitleCase(trimmed.Company);
      }

      // Normalize email to lowercase
      if (trimmed.Email) {
        trimmed.Email = trimmed.Email.toLowerCase();
      }

      // Normalize phone
      if (trimmed.Phone) {
        trimmed.Phone = normalizePhone(trimmed.Phone);
      }

      return trimmed;
    });

    // 2. Validate emails & flag missing required fields
    cleaned.forEach((row) => {
      if (!row.Email || !isValidEmail(row.Email)) {
        invalidEmails++;
      }
      if (!row.Name || !row.Email) {
        missingFields++;
      }
    });

    // 3. Remove duplicates by email (keep first occurrence)
    const seen = new Set();
    const deduped = [];
    for (const row of cleaned) {
      const email = (row.Email || '').toLowerCase();
      if (email && seen.has(email)) {
        duplicatesRemoved++;
        continue;
      }
      if (email) {
        seen.add(email);
      }
      deduped.push(row);
    }

    // Return result
    res.json({
      cleaned: deduped,
      summary: {
        totalRows,
        duplicatesRemoved,
        invalidEmails,
        missingFields,
      },
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'An internal error occurred while processing the file.' });
  }
});

// Multer error handler
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✔  CRM Cleaning Tool running at http://localhost:${PORT}`);
});
