const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const sourceDir = path.join(rootDir, 'frontend');
const outputDir = path.join(rootDir, 'public');
const nestedOutputDir = path.join(outputDir, 'frontend');
const apiBase = process.env.API_BASE || '';

const filesToCopy = ['index.html', 'style.css', 'app.js', 'env.js'];

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(nestedOutputDir, { recursive: true });

for (const fileName of filesToCopy) {
    const sourcePath = path.join(sourceDir, fileName);
    const outputPath = path.join(outputDir, fileName);
    const nestedOutputPath = path.join(nestedOutputDir, fileName);

    if (fileName === 'env.js') {
        const envFileContent = apiBase
            ? `window.__API_BASE__ = ${JSON.stringify(apiBase)};\n`
            : fs.readFileSync(sourcePath, 'utf8');
        fs.writeFileSync(outputPath, envFileContent);
        fs.writeFileSync(nestedOutputPath, envFileContent);
        continue;
    }

    fs.copyFileSync(sourcePath, outputPath);
    fs.copyFileSync(sourcePath, nestedOutputPath);
}

console.log('Copied frontend files to public/ for Vercel deployment.');