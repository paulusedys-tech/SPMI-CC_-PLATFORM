const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const Papa = require('papaparse');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Set up static folder for frontend
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /csv|xls|xlsx/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only CSV, XLS, or XLSX files are allowed'));
    }
  }
});

// API endpoint to handle file uploads
app.post('/upload', upload.single('surveyFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileExtension = path.extname(filePath).toLowerCase();

    let jsonData = [];

    if (fileExtension === '.csv') {
      // Parse CSV file
      const fileContent = require('fs').readFileSync(filePath, 'utf8');
      const parsedData = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
      jsonData = parsedData.data;
    } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
      // Parse Excel file
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      jsonData = XLSX.utils.sheet_to_json(worksheet);
    }

    // Process the data for analysis
    const analysisResult = analyzeSurveyData(jsonData);

    res.json({
      success: true,
      data: jsonData,
      analysis: analysisResult
    });
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Error processing file: ' + error.message });
  }
});

// Function to analyze survey data
function analyzeSurveyData(data) {
  if (!data || data.length === 0) {
    return { error: 'No data to analyze' };
  }

  // Identify quantitative columns (numeric values)
  const numericColumns = [];
  const allKeys = Object.keys(data[0]);

  allKeys.forEach(key => {
    // Check if this column contains mostly numeric values
    let numericCount = 0;
    let totalValid = 0;

    for (let i = 0; i < Math.min(data.length, 100); i++) { // Check first 100 rows
      const value = data[i][key];
      if (value !== undefined && value !== null && value !== '') {
        totalValid++;
        if (!isNaN(parseFloat(value)) && isFinite(value)) {
          numericCount++;
        }
      }
    }

    if (totalValid > 0 && (numericCount / totalValid) >= 0.5) { // At least 50% numeric values
      numericColumns.push(key);
    }
  });

  // Calculate statistics for numeric columns
  const quantitativeAnalysis = {};
  numericColumns.forEach(column => {
    const values = data.map(row => parseFloat(row[column])).filter(val => !isNaN(val));
    
    if (values.length > 0) {
      const sum = values.reduce((acc, val) => acc + val, 0);
      const average = sum / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      
      // Calculate median
      const sortedValues = [...values].sort((a, b) => a - b);
      const midIndex = Math.floor(sortedValues.length / 2);
      const median = sortedValues.length % 2 === 0
        ? (sortedValues[midIndex - 1] + sortedValues[midIndex]) / 2
        : sortedValues[midIndex];

      quantitativeAnalysis[column] = {
        count: values.length,
        sum: sum,
        average: average,
        min: min,
        max: max,
        median: median
      };
    }
  });

  // Identify potential comment/text columns for qualitative analysis
  const textColumns = allKeys.filter(key => !numericColumns.includes(key));
  const qualitativeAnalysis = {};

  textColumns.forEach(column => {
    // Get top comments for qualitative analysis
    const comments = data
      .map(row => row[column])
      .filter(comment => comment && String(comment).trim().length > 0)
      .slice(0, 50); // Get first 50 non-empty comments

    qualitativeAnalysis[column] = {
      totalEntries: data.length,
      nonEmptyEntries: comments.length,
      sampleComments: comments.slice(0, 10) // Show first 10 comments as sample
    };
  });

  return {
    quantitative: quantitativeAnalysis,
    qualitative: qualitativeAnalysis,
    metadata: {
      totalRows: data.length,
      totalColumns: allKeys.length,
      numericColumns: numericColumns,
      textColumns: textColumns
    }
  };
}

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`SPMI Dashboard server is running on port ${PORT}`);
});